import * as vscode from 'vscode';

export function resolveImageUri(
  src: string,
  documentUri: vscode.Uri,
  webview?: vscode.Webview
): string {
  // Data URIs pass through
  if (src.startsWith('data:')) {
    return src;
  }

  // Absolute URLs pass through
  if (/^https?:\/\//.test(src)) {
    return src;
  }

  let imageUri: vscode.Uri;

  if (src.startsWith('file:')) {
    // file: scheme URI — parse directly
    imageUri = vscode.Uri.parse(src);
  } else if (src.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(src)) {
    // Absolute filesystem path (Unix or Windows drive letter)
    imageUri = vscode.Uri.file(src);
  } else {
    // Resolve relative paths against the document's directory
    const docDir = vscode.Uri.joinPath(documentUri, '..');
    imageUri = vscode.Uri.joinPath(docDir, src);
  }

  // For export mode (no webview), return the file system path
  if (!webview) {
    return imageUri.fsPath;
  }

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
