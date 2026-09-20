import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PreviewAboutInfo } from './webviewHtml';

/**
 * Collect the extension metadata the preview's About popup displays:
 * version/publisher/repository from package.json plus the current git short
 * SHA. package.json is read with fs (webpack-safe — the bundled extension has
 * no module context for it). Every field degrades to an empty string when its
 * source is unavailable; the values are attribute-escaped when written into
 * the webview document.
 */
export function collectAboutInfo(extensionUri: vscode.Uri): PreviewAboutInfo {
  let version = '';
  let publisher = '';
  let repo = '';
  try {
    const pkgPath = path.join(extensionUri.fsPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    version = pkg.version || '';
    publisher = pkg.publisher || '';
    repo = pkg.repository?.url || '';
  } catch {
    // package.json not readable — use empty defaults
  }
  let commit = '';
  try {
    commit = execSync('git rev-parse --short HEAD', {
      cwd: extensionUri.fsPath,
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
  } catch {
    // Not in a git repo or git not available
  }
  return { version, publisher, repo, commit };
}
