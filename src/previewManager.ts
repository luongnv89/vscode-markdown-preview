import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { MarkdownEngine } from './markdownEngine';
import { ScrollSync } from './scrollSync';
import { toggleCheckbox } from './checkboxHandler';
import { getPreviewConfig } from './utils/config';
import { computeLocalResourceRoots, isDocumentCoveredByRoots } from './utils/uri';
import { buildWebviewHtml, PreviewAboutInfo } from './utils/webviewHtml';
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
  private checkboxToggleInProgress = false;
  private readonly aboutInfo: PreviewAboutInfo;

  constructor(private readonly extensionUri: vscode.Uri) {
    // Read about info from package.json using fs (webpack-safe)
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

  private createPanel(document: vscode.TextDocument, viewColumn: vscode.ViewColumn): void {
    this.currentResourceRoots = computeLocalResourceRoots(
      this.extensionUri,
      vscode.workspace.workspaceFolders?.map((f) => f.uri),
      document.uri
    );

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
          // Skip debounced re-render when the change was triggered by our
          // own checkbox toggle. The toggle handler will issue a re-render
          // after the edit completes.
          if (this.checkboxToggleInProgress) {
            return;
          }
          this.debouncedUpdate(event.document);
        }
      })
    );

    // Watch for active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === 'markdown') {
          // Check if the new document's directory is covered by current roots
          if (
            this.panel &&
            !isDocumentCoveredByRoots(this.currentResourceRoots, editor.document.uri)
          ) {
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
          const previousAllowRemoteImages = this.config.allowRemoteImages;
          this.config = getPreviewConfig();
          this.engine.updateConfig(this.config);
          if (this.panel && this.config.allowRemoteImages !== previousAllowRemoteImages) {
            // img-src lives in the CSP meta baked into the webview document, so
            // the opt-in only takes effect on a fresh document.
            this.panel.webview.html = this.getWebviewHtml(this.panel.webview);
          }
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
          this.checkboxToggleInProgress = true;
          toggleCheckbox(this.activeDocument, message.line, message.checked)
            .then(() => {
              if (this.activeDocument) {
                this.updatePreview(this.activeDocument);
              }
            })
            .finally(() => {
              this.checkboxToggleInProgress = false;
            });
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

      case 'exportToPdf':
        vscode.commands.executeCommand('markdownPreviewPro.exportToPdf', this.activeDocument?.uri);
        break;

      case 'exportToHtml':
        vscode.commands.executeCommand('markdownPreviewPro.exportToHtml', this.activeDocument?.uri);
        break;
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
    // CSP and <body data-*> metadata live in buildWebviewHtml: nonce-only
    // script-src (Mermaid 11.x renders without eval — verified in headless
    // Chromium), img-src restricted to webview resources + data: unless the
    // documented markdownPreviewPro.allowRemoteImages opt-in is enabled, and
    // all four data-* values attribute-escaped on write.
    return buildWebviewHtml(
      webview,
      this.extensionUri,
      this.aboutInfo,
      this.config.allowRemoteImages
    );
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
