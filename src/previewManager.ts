import * as vscode from 'vscode';
import { MarkdownEngine } from './markdownEngine';
import { ScrollSync } from './scrollSync';
import { toggleCheckbox } from './checkboxHandler';
import { getPreviewConfig } from './utils/config';
import { computeLocalResourceRoots } from './utils/uri';
import { buildWebviewHtml, PreviewAboutInfo } from './utils/webviewHtml';
import { collectAboutInfo } from './utils/aboutInfo';
import { PreviewMessageContext, routeWebviewMessage } from './messageRouter';
import { PreviewEventHost, setupPreviewEventListeners } from './previewEventBindings';
import { WebviewMessage, PreviewConfig } from './types/messages';

// Debounce before re-rendering the preview after a document change, coalescing
// rapid keystrokes into a single render pass.
export const PREVIEW_UPDATE_DEBOUNCE = 300;

export class PreviewManager implements PreviewMessageContext, PreviewEventHost {
  public panel: vscode.WebviewPanel | undefined;
  public readonly engine: MarkdownEngine;
  public readonly scrollSync: ScrollSync;
  public config: PreviewConfig;
  public activeDocument: vscode.TextDocument | undefined;
  public currentResourceRoots: vscode.Uri[] = [];
  public checkboxToggleInProgress = false;
  private readonly aboutInfo: PreviewAboutInfo;
  private updateTimeout: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];
  private lastViewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.aboutInfo = collectAboutInfo(extensionUri);
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

  public recreatePanel(document: vscode.TextDocument): void {
    const viewColumn = this.panel?.viewColumn || this.lastViewColumn;
    this.disposeListeners();
    this.panel?.dispose();
    this.panel = undefined;
    this.createPanel(document, viewColumn);
    this.updatePreview(document);
  }

  private setupEventListeners(_document: vscode.TextDocument): void {
    this.disposeListeners();
    setupPreviewEventListeners(this, this.disposables);
  }

  public handleWebviewMessage(message: WebviewMessage): void {
    routeWebviewMessage(message, this);
  }

  public toggleCheckbox(
    document: vscode.TextDocument,
    line: number,
    checked: boolean
  ): Promise<boolean> {
    return toggleCheckbox(document, line, checked);
  }

  public openExternal(uri: vscode.Uri): void {
    void vscode.env.openExternal(uri);
  }

  public executeCommand(command: string, ...args: unknown[]): void {
    void vscode.commands.executeCommand(command, ...args);
  }

  public debouncedUpdate(document: vscode.TextDocument): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    this.updateTimeout = setTimeout(() => {
      this.updatePreview(document);
    }, PREVIEW_UPDATE_DEBOUNCE);
  }

  public updatePreview(document: vscode.TextDocument): void {
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

  public getTitle(document: vscode.TextDocument): string {
    const fileName = document.uri.path.split('/').pop() || 'Untitled';
    return fileName;
  }

  public getWebviewHtml(webview: vscode.Webview): string {
    // CSP and <body data-*> metadata live in buildWebviewHtml: nonce-only
    // script-src (Mermaid 11.x renders without eval — verified in headless
    // Chromium), img-src restricted to webview resources + data: unless the
    // documented markdownPreviewPro.allowRemoteImages opt-in is enabled, and
    // all four data-* values attribute-escaped on write.
    return buildWebviewHtml(
      webview,
      this.extensionUri,
      this.aboutInfo,
      this.config.allowRemoteImages,
      this.config.enableMermaid,
      this.config.enableExcalidraw
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
