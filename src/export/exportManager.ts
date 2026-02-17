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
    await this.executeExport(uri, 'html', async (browserHtml, outputPath) => {
      const renderedHtml = await renderInBrowser(browserHtml);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(outputPath),
        Buffer.from(renderedHtml, 'utf-8')
      );
    });
  }

  async exportToPdf(uri?: vscode.Uri): Promise<void> {
    await this.executeExport(uri, 'pdf', async (browserHtml, outputPath) => {
      await generatePdf(browserHtml, outputPath);
    });
  }

  private async executeExport(
    uri: vscode.Uri | undefined,
    format: string,
    exportFn: (browserHtml: string, outputPath: string) => Promise<void>
  ): Promise<void> {
    const document = await this.getDocument(uri);
    if (!document) {
      return;
    }

    const outputPath = this.getOutputPath(document.uri, format);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting to ${format.toUpperCase()}`,
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: 'Rendering markdown...' });
          const config = getPreviewConfig();
          this.engine.updateConfig(config);
          this.engine.setExportContext(document.uri);
          const result = this.engine.render(document.getText());

          progress.report({ message: 'Building standalone HTML...' });
          const title = path.basename(document.uri.fsPath, '.md');
          const browserHtml = await this.htmlBuilder.buildForBrowser(
            result.html,
            title,
            document.uri
          );

          progress.report({ message: `Generating ${format.toUpperCase()}...` });
          await exportFn(browserHtml, outputPath);

          const openAction = 'Open File';
          const choice = await vscode.window.showInformationMessage(
            `${format.toUpperCase()} exported to ${path.basename(outputPath)}`,
            openAction
          );
          if (choice === openAction) {
            vscode.env.openExternal(vscode.Uri.file(outputPath));
          }
        } catch (error) {
          this.handleExportError(error, format.toUpperCase());
        }
      }
    );
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
