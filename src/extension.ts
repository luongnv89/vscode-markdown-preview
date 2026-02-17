import * as vscode from 'vscode';
import { PreviewManager } from './previewManager';

let previewManager: PreviewManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  previewManager = new PreviewManager(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownPreviewPro.showPreview', () => {
      previewManager?.showPreview(vscode.ViewColumn.Active);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownPreviewPro.showPreviewToSide', () => {
      previewManager?.showPreview(vscode.ViewColumn.Beside);
    })
  );

  context.subscriptions.push({
    dispose: () => {
      previewManager?.dispose();
      previewManager = undefined;
    },
  });
}

export function deactivate() {
  previewManager?.dispose();
  previewManager = undefined;
}
