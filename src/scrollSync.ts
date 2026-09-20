import * as vscode from 'vscode';

// How long the scroll-sync lock stays engaged after a sync event, so an echoed
// scroll does not immediately retrigger a sync in the opposite direction.
export const SCROLL_SYNC_LOCK_TIMEOUT = 300;

export class ScrollSync {
  private scrollSyncLock = false;
  private lockTimeout: NodeJS.Timeout | undefined;

  public isLocked(): boolean {
    return this.scrollSyncLock;
  }

  public lock(): void {
    this.scrollSyncLock = true;
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
    }
    this.lockTimeout = setTimeout(() => {
      this.scrollSyncLock = false;
    }, SCROLL_SYNC_LOCK_TIMEOUT);
  }

  public getEditorVisibleLine(editor: vscode.TextEditor): number {
    const visibleRanges = editor.visibleRanges;
    if (visibleRanges.length === 0) {
      return 0;
    }
    return visibleRanges[0].start.line;
  }

  public revealEditorLine(editor: vscode.TextEditor, line: number): void {
    const targetLine = Math.max(0, Math.min(line, editor.document.lineCount - 1));
    const range = new vscode.Range(targetLine, 0, targetLine, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
  }

  public dispose(): void {
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = undefined;
    }
    this.scrollSyncLock = false;
  }
}
