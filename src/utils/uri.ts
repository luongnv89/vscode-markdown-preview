import * as vscode from 'vscode';
import * as path from 'path';

export function resolveImageUri(
  src: string,
  documentUri: vscode.Uri,
  webview: vscode.Webview
): string {
  // Data URIs pass through
  if (src.startsWith('data:')) {
    return src;
  }

  // Absolute URLs pass through
  if (/^https?:\/\//.test(src)) {
    return src;
  }

  // Resolve relative paths against the document's directory
  const docDir = vscode.Uri.joinPath(documentUri, '..');
  const imageUri = vscode.Uri.joinPath(docDir, src);
  return webview.asWebviewUri(imageUri).toString();
}

export function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
