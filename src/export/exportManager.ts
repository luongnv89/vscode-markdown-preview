import * as vscode from 'vscode';
import * as path from 'path';
import { MarkdownEngine } from '../markdownEngine';
import { getPreviewConfig } from '../utils/config';
import { StandaloneHtmlBuilder } from './standaloneHtmlBuilder';
import { generatePdf, renderInBrowser, ChromeNotFoundError } from './pdfExporter';

export class ExportManager {
  private engine: MarkdownEngine;
  private htmlBuilder: StandaloneHtmlBuilder;

  constructor(private readonly extensionUri: vscode.Uri) {
    const config = getPreviewConfig();
    this.engine = new MarkdownEngine(config);
    this.htmlBuilder = new StandaloneHtmlBuilder(extensionUri);
  }

  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('markdownPreviewPro.exportToHtml', (uri?: vscode.Uri) => {
        this.exportToHtml(uri);
      }),
      vscode.commands.registerCommand('markdownPreviewPro.exportToPdf', (uri?: vscode.Uri) => {
        this.exportToPdf(uri);
      })
    );
  }

  async exportToHtml(uri?: vscode.Uri): Promise<void> {
    await this.executeExport(uri, 'html', async (browserHtml, outputPath, token) => {
      const renderedHtml = await renderInBrowser(browserHtml, token);
      if (token.isCancellationRequested) {
        return;
      }
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(outputPath),
        Buffer.from(renderedHtml, 'utf-8')
      );
    });
  }

  async exportToPdf(uri?: vscode.Uri): Promise<void> {
    await this.executeExport(uri, 'pdf', async (browserHtml, outputPath, token) => {
      await generatePdf(browserHtml, outputPath, undefined, token);
    });
  }

  private async executeExport(
    uri: vscode.Uri | undefined,
    format: 'html' | 'pdf',
    exportFn: (
      browserHtml: string,
      outputPath: string,
      token: vscode.CancellationToken
    ) => Promise<void>
  ): Promise<void> {
    const document = await this.getDocument(uri);
    if (!document) {
      return;
    }

    // Resolve the destination before doing any work: the save dialog pre-fills
    // `<basename>.<ext>` beside the source and natively confirms before an
    // existing file is overwritten. Cancelling aborts the export silently.
    const outputUri = await this.resolveOutputUri(document, format);
    if (!outputUri) {
      return;
    }
    const outputPath = outputUri.fsPath;

    let cancelled = false;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Exporting to ${format.toUpperCase()}`,
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            cancelled = true;
          });

          progress.report({ message: 'Rendering markdown...' });
          const config = getPreviewConfig();
          this.engine.updateConfig(config);
          this.engine.setExportContext(document.uri);
          const result = this.engine.render(document.getText());
          if (token.isCancellationRequested) {
            return;
          }

          progress.report({ message: 'Building standalone HTML...' });
          const title = path.basename(document.uri.fsPath, '.md');
          const browserHtml = await this.htmlBuilder.buildForBrowser(
            result.html,
            title,
            document.uri,
            config
          );
          if (token.isCancellationRequested) {
            return;
          }

          progress.report({ message: `Generating ${format.toUpperCase()}...` });
          await exportFn(browserHtml, outputPath, token);
        }
      );
    } catch (error) {
      if (cancelled) {
        return; // user cancelled mid-export — abort without an error popup
      }
      this.handleExportError(error, format.toUpperCase());
      return;
    }

    if (cancelled) {
      return;
    }

    const openAction = 'Open File';
    const choice = await vscode.window.showInformationMessage(
      `${format.toUpperCase()} exported to ${path.basename(outputPath)}`,
      openAction
    );
    if (choice === openAction) {
      vscode.env.openExternal(vscode.Uri.file(outputPath));
    }
  }

  /**
   * Ask the user where the export should be written. The dialog is pre-filled
   * with `<basename>.<ext>` next to the source document; the OS save dialog
   * itself asks for confirmation when the chosen file already exists.
   */
  protected async resolveOutputUri(
    document: vscode.TextDocument,
    format: 'html' | 'pdf'
  ): Promise<vscode.Uri | undefined> {
    const defaultUri = vscode.Uri.file(this.getOutputPath(document.uri, format));
    const filters: { [name: string]: string[] } =
      format === 'pdf' ? { 'PDF files': ['pdf'] } : { 'HTML files': ['html', 'htm'] };
    return vscode.window.showSaveDialog({
      defaultUri,
      filters,
      saveLabel: 'Export',
      title: `Export to ${format.toUpperCase()}`,
    });
  }

  private async getDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    if (uri) {
      try {
        return await vscode.workspace.openTextDocument(uri);
      } catch {
        vscode.window.showWarningMessage('Failed to open the markdown file');
        return undefined;
      }
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'markdown') {
      return editor.document;
    }
    vscode.window.showWarningMessage('Open a markdown file to export');
    return undefined;
  }

  private getOutputPath(documentUri: vscode.Uri, ext: string): string {
    const dir = path.dirname(documentUri.fsPath);
    const baseName = path.basename(documentUri.fsPath, path.extname(documentUri.fsPath));
    return path.join(dir, `${baseName}.${ext}`);
  }

  private handleExportError(error: unknown, format: string): void {
    if (error instanceof ChromeNotFoundError) {
      const downloadAction = 'Download Chrome';
      vscode.window.showErrorMessage(error.message, downloadAction).then((action) => {
        if (action === downloadAction) {
          vscode.env.openExternal(vscode.Uri.parse('https://www.google.com/chrome/'));
        }
      });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`${format} export failed: ${message}`);
    }
  }
}
