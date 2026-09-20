import * as vscode from 'vscode';
import * as path from 'path';

/**
 * True when `candidatePath` equals `rootPath` or lives beneath it.
 *
 * `path.relative`-based containment: a sibling directory sharing a path prefix
 * (`/home/u/notes-private` vs base `/home/u/notes`) resolves to `../...` and is
 * rejected, as is any result that is absolute (different drive/root). A plain
 * `startsWith` check is NOT a containment check — it admits sibling-prefix
 * escapes.
 */
export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** True when `candidatePath` is inside at least one of `rootPaths`. */
export function isPathInsideAny(candidatePath: string, rootPaths: string[]): boolean {
  return rootPaths.some((rootPath) => isPathInside(candidatePath, rootPath));
}

/**
 * The webview's localResourceRoots: the extension's own webview bundle, every
 * workspace folder, and the document's parent directory.
 *
 * Deliberately does NOT include the filesystem root: granting the webview read
 * access to the whole disk is what made the coverage check below meaningless.
 * When the active document moves outside these roots the preview panel is
 * recreated (see PreviewManager.recreatePanel), so legitimate documents still
 * get their own directory as a root — the boundary is explicit, not emergent.
 */
export function computeLocalResourceRoots(
  extensionUri: vscode.Uri,
  workspaceFolderUris: readonly vscode.Uri[] | undefined,
  documentUri: vscode.Uri
): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
    ...(workspaceFolderUris ?? []),
    vscode.Uri.joinPath(documentUri, '..'),
  ];
}

/**
 * True when the document's parent directory is inside one of the webview
 * resource roots — i.e. the panel can already serve that document's local
 * images without being recreated.
 */
export function isDocumentCoveredByRoots(
  resourceRoots: readonly vscode.Uri[],
  documentUri: vscode.Uri
): boolean {
  const docDir = vscode.Uri.joinPath(documentUri, '..').fsPath;
  return isPathInsideAny(
    docDir,
    resourceRoots.map((root) => root.fsPath)
  );
}

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
