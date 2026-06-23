import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { MarkdownEngine } from './markdownEngine';
import { ScrollSync } from './scrollSync';
import { toggleCheckbox } from './checkboxHandler';
import { getPreviewConfig } from './utils/config';
import { getNonce } from './utils/uri';
import { WebviewMessage, PreviewConfig } from './types/messages';

/**
 * Registers Markdown Preview Pro as a *custom text editor* for `.md` files.
 *
 * Unlike {@link PreviewManager} (a command-driven webview panel), this provider
 * lets the preview be used as the default editor for markdown documents via
 * `workbench.editorAssociations` (the manifest declares it with priority
 * "option", so it never hijacks files unless the user opts in). The rendering
 * pipeline — markdown engine, webview assets, message protocol — is shared with
 * the panel preview; only the surface (a custom editor instead of a panel)
 * differs.
 */
export class MarkdownCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'markdownPreviewPro.editor';

  private readonly aboutInfo: { version: string; publisher: string; repo: string; commit: string };

  constructor(private readonly extensionUri: vscode.Uri) {
    // Read about info from package.json using fs (webpack-safe), mirroring
    // PreviewManager so the webview toolbar's "about" data is consistent.
    let version = '';
    let publisher = '';
    let repo = '';
    try {
      const pkgPath = path.join(extensionUri.fsPath, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      version = pkg.version || '';
      publisher = pkg.publisher || '';
      repo = pkg.repository?.url || '';
    } catch {
      // package.json not readable — use empty defaults
    }
    let commit = '';
    try {
      commit = execSync('git rev-parse --short HEAD', {
        cwd: extensionUri.fsPath,
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
    } catch {
      // Not in a git repo or git not available
    }
    this.aboutInfo = { version, publisher, repo, commit };
  }

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new MarkdownCustomEditorProvider(context.extensionUri);
    return vscode.window.registerCustomEditorProvider(
      MarkdownCustomEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    let config: PreviewConfig = getPreviewConfig();
    const engine = new MarkdownEngine(config);
    const scrollSync = new ScrollSync();
    const disposables: vscode.Disposable[] = [];
    let updateTimeout: NodeJS.Timeout | undefined;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots(document.uri),
    };
    webviewPanel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png'),
    };
    webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview);

    const update = (): void => {
      engine.setContext(document.uri, webviewPanel.webview);
      const result = engine.render(document.getText());
      webviewPanel.webview.postMessage({
        type: 'updateContent',
        html: result.html,
        documentUri: document.uri.toString(),
        lineCount: document.lineCount,
      });
    };

    const debouncedUpdate = (): void => {
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      updateTimeout = setTimeout(update, 300);
    };

    // Find a visible text editor backing this document (only relevant when the
    // user has the source open to the side as well).
    const visibleEditorForDocument = (): vscode.TextEditor | undefined =>
      vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === document.uri.toString()
      );

    // --- Messages from the webview ---------------------------------------
    disposables.push(
      webviewPanel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        switch (message.type) {
          case 'ready':
            update();
            break;

          case 'revealLine': {
            // preview scroll -> editor scroll (only if source is open)
            if (config.scrollSync && !scrollSync.isLocked()) {
              const editor = visibleEditorForDocument();
              if (editor) {
                scrollSync.lock();
                scrollSync.revealEditorLine(editor, message.line);
              }
            }
            break;
          }

          case 'toggleCheckbox':
            // The resulting WorkspaceEdit fires onDidChangeTextDocument below,
            // which re-renders — no manual update needed.
            toggleCheckbox(document, message.line, message.checked);
            break;

          case 'navigateToLine': {
            const position = new vscode.Position(message.line, 0);
            vscode.window
              .showTextDocument(document, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: false,
              })
              .then((editor) => {
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                  new vscode.Range(position, position),
                  vscode.TextEditorRevealType.InCenter
                );
              });
            break;
          }

          case 'openLink': {
            const href = message.href;
            if (href.startsWith('http://') || href.startsWith('https://')) {
              vscode.env.openExternal(vscode.Uri.parse(href));
            }
            break;
          }

          case 'exportToPdf':
            vscode.commands.executeCommand('markdownPreviewPro.exportToPdf', document.uri);
            break;

          case 'exportToHtml':
            vscode.commands.executeCommand('markdownPreviewPro.exportToHtml', document.uri);
            break;
        }
      })
    );

    // --- Document edits -> re-render -------------------------------------
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === document.uri.toString()) {
          debouncedUpdate();
        }
      })
    );

    // --- Editor scroll -> preview scroll (source open to the side) -------
    disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        if (
          config.scrollSync &&
          event.textEditor.document.uri.toString() === document.uri.toString() &&
          !scrollSync.isLocked()
        ) {
          const line = scrollSync.getEditorVisibleLine(event.textEditor);
          scrollSync.lock();
          webviewPanel.webview.postMessage({
            type: 'scrollToLine',
            line,
            source: 'editor',
          });
        }
      })
    );

    // --- Configuration changes ------------------------------------------
    disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('markdownPreviewPro')) {
          config = getPreviewConfig();
          engine.updateConfig(config);
          update();
          webviewPanel.webview.postMessage({ type: 'configChanged', config });
        }
      })
    );

    webviewPanel.onDidDispose(() => {
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      scrollSync.dispose();
      disposables.forEach((d) => d.dispose());
    });
  }

  private getLocalResourceRoots(documentUri: vscode.Uri): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || []),
      vscode.Uri.joinPath(documentUri, '..'),
    ];

    // Add the filesystem root so local images from any location resolve,
    // matching the built-in markdown preview (and PreviewManager).
    if (process.platform === 'win32') {
      const driveLetter = documentUri.fsPath.match(/^([a-zA-Z]):\\/);
      if (driveLetter) {
        roots.push(vscode.Uri.file(`${driveLetter[1]}:\\`));
      }
    } else {
      roots.push(vscode.Uri.file('/'));
    }

    return roots;
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    const vendorUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'vendor');
    const mainScript = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
    );
    const mainStyle = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.css')
    );
    const katexStyle = webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'katex.min.css'));
    const katexScript = webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'katex.min.js'));
    const mermaidScript = webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'mermaid.min.js'));
    const excalidrawScript = webview.asWebviewUri(
      vscode.Uri.joinPath(vendorUri, 'excalidraw-utils.min.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      script-src 'nonce-${nonce}' 'unsafe-eval';
      style-src ${webview.cspSource} 'unsafe-inline';
      img-src ${webview.cspSource} https: data:;
      font-src ${webview.cspSource};
      connect-src ${webview.cspSource};
      worker-src 'none';
      frame-src 'none';">
  <link rel="stylesheet" href="${katexStyle}">
  <link rel="stylesheet" href="${mainStyle}">
  <title>Markdown Preview Pro</title>
</head>
<body data-version="${this.aboutInfo.version}" data-commit="${this.aboutInfo.commit}" data-publisher="${this.aboutInfo.publisher}" data-repo="${this.aboutInfo.repo}">
  <div id="preview-content"></div>
  <script nonce="${nonce}" src="${katexScript}"></script>
  <script nonce="${nonce}" src="${mermaidScript}"></script>
  <script nonce="${nonce}" src="${excalidrawScript}"></script>
  <script nonce="${nonce}" src="${mainScript}"></script>
</body>
</html>`;
  }
}
