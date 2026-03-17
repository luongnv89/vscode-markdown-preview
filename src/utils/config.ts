import * as vscode from 'vscode';
import { PreviewConfig } from '../types/messages';

export function getPreviewConfig(): PreviewConfig {
  const config = vscode.workspace.getConfiguration('markdownPreviewPro');
  return {
    scrollSync: config.get('scrollSync', true),
    enableMermaid: config.get('enableMermaid', true),
    enableKatex: config.get('enableKatex', true),
    enableCheckboxes: config.get('enableCheckboxes', true),
    enableExcalidraw: config.get('enableExcalidraw', true),
    lineBreaks: config.get('lineBreaks', false),
    typographer: config.get('typographer', true),
    showFrontmatter: config.get<'card' | 'none'>('showFrontmatter', 'card'),
  };
}
