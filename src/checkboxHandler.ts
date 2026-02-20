import * as vscode from 'vscode';

export async function toggleCheckbox(
  document: vscode.TextDocument,
  line: number,
  checked: boolean
): Promise<boolean> {
  if (line < 0 || line >= document.lineCount) {
    return false;
  }

  const lineText = document.lineAt(line).text;
  const checkboxRegex = /^(\s*[-*+]\s*\[)([ xX])(\])/;
  const match = lineText.match(checkboxRegex);

  if (!match) {
    return false;
  }

  const newChar = checked ? 'x' : ' ';
  const newText = lineText.replace(checkboxRegex, `$1${newChar}$3`);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(line, 0, line, lineText.length), newText);

  const success = await vscode.workspace.applyEdit(edit);
  if (!success) {
    vscode.window.showWarningMessage('Failed to toggle checkbox');
    return false;
  }

  return true;
}
