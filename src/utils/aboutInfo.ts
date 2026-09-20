import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PreviewAboutInfo } from './webviewHtml';

// Injected by webpack's DefinePlugin at build time (webpack.config.js resolves
// `git rev-parse --short HEAD` once per build). Absent under tsc-only builds
// (the test suite's out/ tree), where the field degrades to an empty string.
declare const __GIT_COMMIT__: string | undefined;

/**
 * Collect the extension metadata the preview's About popup displays:
 * version/publisher/repository from package.json plus the git short SHA baked
 * in at build time. package.json is read with fs (webpack-safe — the bundled
 * extension has no module context for it). No child process is ever spawned:
 * the extension install directory is not a git repo for marketplace installs,
 * so a runtime `git rev-parse` would always fail anyway. Every field degrades
 * to an empty string when its source is unavailable; the values are
 * attribute-escaped when written into the webview document.
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
  const commit = typeof __GIT_COMMIT__ === 'string' ? __GIT_COMMIT__ : '';
  return { version, publisher, repo, commit };
}
