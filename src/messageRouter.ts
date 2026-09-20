import * as vscode from 'vscode';
import { ScrollSync } from './scrollSync';
import { PreviewConfig, WebviewMessage } from './types/messages';

/**
 * The slice of PreviewManager the webview message handlers drive. Declared as
 * a narrow interface so the handlers live outside the panel-lifecycle class
 * and tests can substitute a stub. The side-effectful pieces — the checkbox
 * workspace edit, the external-link open and command dispatch — are reachable
 * only through this seam, so a test never touches a real editor, browser or
 * export dialog.
 */
export interface PreviewMessageContext {
  readonly config: PreviewConfig;
  readonly scrollSync: ScrollSync;
  readonly activeDocument: vscode.TextDocument | undefined;
  checkboxToggleInProgress: boolean;
  updatePreview(document: vscode.TextDocument): void;
  toggleCheckbox(document: vscode.TextDocument, line: number, checked: boolean): Promise<boolean>;
  openExternal(uri: vscode.Uri): void;
  executeCommand(command: string, ...args: unknown[]): void;
}

type WebviewMessageType = WebviewMessage['type'];

type HandlerFor<T extends WebviewMessageType> = (
  message: Extract<WebviewMessage, { type: T }>,
  ctx: PreviewMessageContext
) => void;

/**
 * Dispatch table keyed by message type — replaces the former seven-case
 * switch in `PreviewManager.handleWebviewMessage`. The mapped type makes a
 * missing entry for any `WebviewMessage` variant a compile error, so the
 * table can never drift behind the protocol.
 */
export const webviewMessageHandlers: { [T in WebviewMessageType]: HandlerFor<T> } = {
  ready: (_message, ctx) => {
    if (ctx.activeDocument) {
      ctx.updatePreview(ctx.activeDocument);
    }
  },

  revealLine: (message, ctx) => {
    if (ctx.config.scrollSync && !ctx.scrollSync.isLocked()) {
      const editor = vscode.window.activeTextEditor;
      if (
        editor &&
        ctx.activeDocument &&
        editor.document.uri.toString() === ctx.activeDocument.uri.toString()
      ) {
        ctx.scrollSync.lock();
        ctx.scrollSync.revealEditorLine(editor, message.line);
      }
    }
  },

  toggleCheckbox: (message, ctx) => {
    const document = ctx.activeDocument;
    if (document) {
      ctx.checkboxToggleInProgress = true;
      ctx
        .toggleCheckbox(document, message.line, message.checked)
        .then(() => {
          if (ctx.activeDocument) {
            ctx.updatePreview(ctx.activeDocument);
          }
        })
        .finally(() => {
          ctx.checkboxToggleInProgress = false;
        });
    }
  },

  navigateToLine: (message, ctx) => {
    const editor = vscode.window.activeTextEditor;
    if (
      editor &&
      ctx.activeDocument &&
      editor.document.uri.toString() === ctx.activeDocument.uri.toString()
    ) {
      const position = new vscode.Position(message.line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
      vscode.window.showTextDocument(editor.document, editor.viewColumn);
    }
  },

  openLink: (message, ctx) => {
    const href = message.href;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      ctx.openExternal(vscode.Uri.parse(href));
    }
  },

  exportToPdf: (_message, ctx) => {
    ctx.executeCommand('markdownPreviewPro.exportToPdf', ctx.activeDocument?.uri);
  },

  exportToHtml: (_message, ctx) => {
    ctx.executeCommand('markdownPreviewPro.exportToHtml', ctx.activeDocument?.uri);
  },
};

/**
 * Route a webview message to the handler registered for its type. A type with
 * no handler — the webview is loosely trusted input — is ignored, matching
 * the old switch's fall-through.
 */
export function routeWebviewMessage<T extends WebviewMessageType>(
  message: Extract<WebviewMessage, { type: T }>,
  ctx: PreviewMessageContext
): void {
  const handler: HandlerFor<T> | undefined = webviewMessageHandlers[message.type];
  handler?.(message, ctx);
}
