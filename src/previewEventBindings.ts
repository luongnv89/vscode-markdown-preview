import * as vscode from 'vscode';
import { MarkdownEngine } from './markdownEngine';
import { ScrollSync } from './scrollSync';
import { getPreviewConfig } from './utils/config';
import { isDocumentCoveredByRoots } from './utils/uri';
import { PreviewConfig, WebviewMessage } from './types/messages';

/**
 * The slice of PreviewManager the event subscriptions drive. Declared as a
 * narrow interface so the wiring lives outside the panel-lifecycle class; the
 * manager implements it directly and tests can substitute a stub.
 */
export interface PreviewEventHost {
  readonly panel: vscode.WebviewPanel | undefined;
  readonly engine: MarkdownEngine;
  readonly scrollSync: ScrollSync;
  config: PreviewConfig;
  activeDocument: vscode.TextDocument | undefined;
  readonly currentResourceRoots: readonly vscode.Uri[];
  checkboxToggleInProgress: boolean;
  getTitle(document: vscode.TextDocument): string;
  getWebviewHtml(webview: vscode.Webview, document?: vscode.TextDocument): string;
  updatePreview(document: vscode.TextDocument): void;
  debouncedUpdate(document: vscode.TextDocument): void;
  recreatePanel(document: vscode.TextDocument): void;
  handleWebviewMessage(message: WebviewMessage): void;
}

/**
 * Subscribe to the webview and workspace events that drive the preview and
 * push the resulting disposables onto `disposables`. Covers: webview → host
 * messages, document edits (debounced re-render), active-editor switches
 * (retitle / panel rebuild when the roots no longer cover the file), editor →
 * preview scroll sync, and `markdownPreviewPro` configuration changes.
 */
export function setupPreviewEventListeners(
  host: PreviewEventHost,
  disposables: vscode.Disposable[]
): void {
  bindWebviewMessages(host, disposables);
  bindDocumentChanges(host, disposables);
  bindActiveEditorChanges(host, disposables);
  bindEditorScrollSync(host, disposables);
  bindConfigurationChanges(host, disposables);
}

// Handle messages from webview
function bindWebviewMessages(host: PreviewEventHost, disposables: vscode.Disposable[]): void {
  if (host.panel) {
    disposables.push(
      host.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        host.handleWebviewMessage(message);
      })
    );
  }
}

// Watch for text document changes
function bindDocumentChanges(host: PreviewEventHost, disposables: vscode.Disposable[]): void {
  disposables.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const document = host.activeDocument;
      if (document && event.document.uri.toString() === document.uri.toString()) {
        // Skip debounced re-render when the change was triggered by our
        // own checkbox toggle. The toggle handler will issue a re-render
        // after the edit completes.
        if (host.checkboxToggleInProgress) {
          return;
        }
        host.debouncedUpdate(event.document);
      }
    })
  );
}

// Watch for active editor changes
function bindActiveEditorChanges(host: PreviewEventHost, disposables: vscode.Disposable[]): void {
  disposables.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        // Check if the new document's directory is covered by current roots
        const panel = host.panel;
        if (panel && !isDocumentCoveredByRoots(host.currentResourceRoots, editor.document.uri)) {
          host.recreatePanel(editor.document);
          return;
        }
        host.activeDocument = editor.document;
        if (panel) {
          panel.title = 'Preview: ' + host.getTitle(editor.document);
          host.engine.setContext(editor.document.uri, panel.webview);
        }
        host.updatePreview(editor.document);
      }
    })
  );
}

// Watch for editor scroll (editor -> preview sync)
function bindEditorScrollSync(host: PreviewEventHost, disposables: vscode.Disposable[]): void {
  disposables.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      const document = host.activeDocument;
      if (
        host.config.scrollSync &&
        document &&
        event.textEditor.document.uri.toString() === document.uri.toString() &&
        !host.scrollSync.isLocked()
      ) {
        const line = host.scrollSync.getEditorVisibleLine(event.textEditor);
        host.scrollSync.lock();
        host.panel?.webview.postMessage({
          type: 'scrollToLine',
          line,
          source: 'editor',
        });
      }
    })
  );
}

// Watch for configuration changes
function bindConfigurationChanges(host: PreviewEventHost, disposables: vscode.Disposable[]): void {
  disposables.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('markdownPreviewPro')) {
        const previous = host.config;
        host.config = getPreviewConfig();
        host.engine.updateConfig(host.config);
        const documentShapeChanged =
          host.config.allowRemoteImages !== previous.allowRemoteImages ||
          host.config.enableKatex !== previous.enableKatex ||
          host.config.enableMermaid !== previous.enableMermaid ||
          host.config.enableExcalidraw !== previous.enableExcalidraw;
        const panel = host.panel;
        if (panel && documentShapeChanged) {
          // img-src lives in the CSP meta and the vendor <script> set is
          // baked into the webview document, so these opt-ins/outs only take
          // effect on a fresh document. The rebuilt HTML re-detects vendor
          // needs from the active document under the new flags.
          panel.webview.html = host.getWebviewHtml(panel.webview, host.activeDocument);
        }
        const document = host.activeDocument;
        if (document) {
          host.updatePreview(document);
        }
        host.panel?.webview.postMessage({
          type: 'configChanged',
          config: host.config,
        });
      }
    })
  );
}
