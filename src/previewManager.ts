import * as vscode from 'vscode';
import { MarkdownEngine } from './markdownEngine';
import { ScrollSync } from './scrollSync';
import { toggleCheckbox } from './checkboxHandler';
import { getPreviewConfig } from './utils/config';
import { getNonce } from './utils/uri';
import { WebviewMessage, PreviewConfig } from './types/messages';

export class PreviewManager {
  private panel: vscode.WebviewPanel | undefined;
  private engine: MarkdownEngine;
  private scrollSync: ScrollSync;
  private config: PreviewConfig;
  private activeDocument: vscode.TextDocument | undefined;
  private updateTimeout: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];
  private currentResourceRoots: vscode.Uri[] = [];
  private lastViewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.config = getPreviewConfig();
    this.engine = new MarkdownEngine(this.config);
    this.scrollSync = new ScrollSync();
  }

  public showPreview(viewColumn: vscode.ViewColumn): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
      vscode.window.showWarningMessage('Open a markdown file to preview');
      return;
    }

    if (this.panel) {
      this.panel.reveal(viewColumn);
      this.updatePreview(editor.document);
      return;
    }

    this.lastViewColumn = viewColumn;
    this.createPanel(editor.document, viewColumn);
  }

  private getLocalResourceRoots(documentUri: vscode.Uri): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || []),
      // Always include the document's parent directory
      vscode.Uri.joinPath(documentUri, '..'),
    ];

    // Always add the filesystem root so local images from any location can
    // be resolved. This matches the approach used by the VS Code built-in
    // markdown preview.
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

  private isDocumentCoveredByRoots(documentUri: vscode.Uri): boolean {
    const docDir = vscode.Uri.joinPath(documentUri, '..').fsPath;
    return this.currentResourceRoots.some((root) => docDir.startsWith(root.fsPath));
  }

  private createPanel(document: vscode.TextDocument, viewColumn: vscode.ViewColumn): void {
    this.currentResourceRoots = this.getLocalResourceRoots(document.uri);

    this.panel = vscode.window.createWebviewPanel(
      'markdownPreviewPro',
      'Preview: ' + this.getTitle(document),
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: this.currentResourceRoots,
        enableFindWidget: true,
      }
    );

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png'),
    };

    this.panel.webview.html = this.getWebviewHtml(this.panel.webview);
    this.setupEventListeners(document);
    this.activeDocument = document;

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposeListeners();
    });
  }

  private recreatePanel(document: vscode.TextDocument): void {
    const viewColumn = this.panel?.viewColumn || this.lastViewColumn;
    this.disposeListeners();
    this.panel?.dispose();
    this.panel = undefined;
    this.createPanel(document, viewColumn);
    this.updatePreview(document);
  }

  private setupEventListeners(document: vscode.TextDocument): void {
    this.disposeListeners();

    // Handle messages from webview
    if (this.panel) {
      this.disposables.push(
        this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
          this.handleWebviewMessage(message);
        })
      );
    }

    // Watch for text document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          this.activeDocument &&
          event.document.uri.toString() === this.activeDocument.uri.toString()
        ) {
          this.debouncedUpdate(event.document);
        }
      })
    );

    // Watch for active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === 'markdown') {
          // Check if the new document's directory is covered by current roots
          if (this.panel && !this.isDocumentCoveredByRoots(editor.document.uri)) {
            this.recreatePanel(editor.document);
            return;
          }
          this.activeDocument = editor.document;
          if (this.panel) {
            this.panel.title = 'Preview: ' + this.getTitle(editor.document);
            this.engine.setContext(editor.document.uri, this.panel.webview);
          }
          this.updatePreview(editor.document);
        }
      })
    );

    // Watch for editor scroll (editor -> preview sync)
    this.disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        if (
          this.config.scrollSync &&
          this.activeDocument &&
          event.textEditor.document.uri.toString() === this.activeDocument.uri.toString() &&
          !this.scrollSync.isLocked()
        ) {
          const line = this.scrollSync.getEditorVisibleLine(event.textEditor);
          this.scrollSync.lock();
          this.panel?.webview.postMessage({
            type: 'scrollToLine',
            line,
            source: 'editor',
          });
        }
      })
    );

    // Watch for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('markdownPreviewPro')) {
          this.config = getPreviewConfig();
          this.engine.updateConfig(this.config);
          if (this.activeDocument) {
            this.updatePreview(this.activeDocument);
          }
          this.panel?.webview.postMessage({
            type: 'configChanged',
            config: this.config,
          });
        }
      })
    );
  }

  private handleWebviewMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        if (this.activeDocument) {
          this.updatePreview(this.activeDocument);
        }
        break;

      case 'revealLine':
        if (this.config.scrollSync && !this.scrollSync.isLocked()) {
          const editor = vscode.window.activeTextEditor;
          if (
            editor &&
            this.activeDocument &&
            editor.document.uri.toString() === this.activeDocument.uri.toString()
          ) {
            this.scrollSync.lock();
            this.scrollSync.revealEditorLine(editor, message.line);
          }
        }
        break;

      case 'toggleCheckbox':
        if (this.activeDocument) {
          toggleCheckbox(this.activeDocument, message.line, message.checked);
        }
        break;

      case 'navigateToLine': {
        const editor = vscode.window.activeTextEditor;
        if (
          editor &&
          this.activeDocument &&
          editor.document.uri.toString() === this.activeDocument.uri.toString()
        ) {
          const position = new vscode.Position(message.line, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );
          vscode.window.showTextDocument(editor.document, editor.viewColumn);
        }
        break;
      }

      case 'openLink': {
        const href = message.href;
        if (href.startsWith('http://') || href.startsWith('https://')) {
          vscode.env.openExternal(vscode.Uri.parse(href));
        }
        break;
      }
    }
  }

  private debouncedUpdate(document: vscode.TextDocument): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    this.updateTimeout = setTimeout(() => {
      this.updatePreview(document);
    }, 300);
  }

  private updatePreview(document: vscode.TextDocument): void {
    if (!this.panel) {
      return;
    }

    this.engine.setContext(document.uri, this.panel.webview);
    const result = this.engine.render(document.getText());

    this.panel.webview.postMessage({
      type: 'updateContent',
      html: result.html,
      documentUri: document.uri.toString(),
      lineCount: document.lineCount,
    });
  }

  private getTitle(document: vscode.TextDocument): string {
    const fileName = document.uri.path.split('/').pop() || 'Untitled';
    return fileName;
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
    const hljsStyle = webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'github-dark.min.css'));
    const mermaidScript = webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'mermaid.min.js'));

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
  <link rel="stylesheet" href="${hljsStyle}">
  <link rel="stylesheet" href="${mainStyle}">
  <title>Markdown Preview Pro</title>
</head>
<body>
  <div id="preview-content"></div>
  <script nonce="${nonce}" src="${katexScript}"></script>
  <script nonce="${nonce}" src="${mermaidScript}"></script>
  <script nonce="${nonce}" src="${mainScript}"></script>
</body>
</html>`;
  }

  private disposeListeners(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
  }

  public dispose(): void {
    this.disposeListeners();
    this.scrollSync.dispose();
    this.panel?.dispose();
    this.panel = undefined;
    this.activeDocument = undefined;
  }
}
