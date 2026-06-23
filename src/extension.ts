import * as vscode from 'vscode';
import { PreviewManager } from './previewManager';
import { ExportManager } from './export/exportManager';
import { MarkdownCustomEditorProvider } from './customEditorProvider';

let previewManager: PreviewManager | undefined;
let exportManager: ExportManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  try {
    console.log('[Markdown Preview Pro] Activating...');

    previewManager = new PreviewManager(context.extensionUri);
    console.log('[Markdown Preview Pro] PreviewManager created');

    exportManager = new ExportManager(context.extensionUri);
    console.log('[Markdown Preview Pro] ExportManager created');

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

    exportManager.registerCommands(context);
    console.log('[Markdown Preview Pro] All commands registered');

    // Register the custom editor so the preview can be set as the default
    // editor for .md files (opt-in via workbench.editorAssociations).
    context.subscriptions.push(MarkdownCustomEditorProvider.register(context));
    console.log('[Markdown Preview Pro] Custom editor registered');

    context.subscriptions.push({
      dispose: () => {
        previewManager?.dispose();
        previewManager = undefined;
        exportManager = undefined;
      },
    });

    console.log('[Markdown Preview Pro] Activation complete');
  } catch (error) {
    console.error('[Markdown Preview Pro] Activation FAILED:', error);
  }
}

export function deactivate() {
  previewManager?.dispose();
  previewManager = undefined;
  exportManager = undefined;
}
