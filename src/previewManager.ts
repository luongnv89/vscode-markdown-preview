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

    this.panel = vscode.window.createWebviewPanel(
      'markdownPreviewPro',
      'Preview: ' + this.getTitle(editor.document),
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'katex', 'dist'),
          vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'highlight.js', 'styles'),
          // Allow access to workspace folders for local images
          ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || []),
          // Allow access to the document's directory
          vscode.Uri.joinPath(editor.document.uri, '..'),
        ],
        enableFindWidget: true,
      }
    );

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png'),
    };

    this.panel.webview.html = this.getWebviewHtml(this.panel.webview);
    this.setupEventListeners(editor.document);
    this.activeDocument = editor.document;

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposeListeners();
    });
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
        if (this.activeDocument && event.document.uri.toString() === this.activeDocument.uri.toString()) {
          this.debouncedUpdate(event.document);
        }
      })
    );

    // Watch for active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === 'markdown') {
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
          if (editor && this.activeDocument &&
              editor.document.uri.toString() === this.activeDocument.uri.toString()) {
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
        if (editor && this.activeDocument &&
            editor.document.uri.toString() === this.activeDocument.uri.toString()) {
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

    const webviewDistUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    );
    const mainScript = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
    );
    const mainStyle = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.css')
    );
    const katexStyle = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'katex', 'dist', 'katex.min.css')
    );
    const katexScript = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'katex', 'dist', 'katex.min.js')
    );
    const hljsStyle = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'highlight.js', 'styles', 'github-dark.min.css')
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
  <link rel="stylesheet" href="${hljsStyle}">
  <link rel="stylesheet" href="${mainStyle}">
  <title>Markdown Preview Pro</title>
</head>
<body>
  <div id="preview-content"></div>
  <script nonce="${nonce}" src="${katexScript}"></script>
  <script nonce="${nonce}">
    // Set webpack public path for dynamic chunk loading (mermaid, etc.)
    window.__webpack_public_path__ = "${webviewDistUri}/";
  </script>
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
