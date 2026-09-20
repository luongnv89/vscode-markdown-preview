// Mirror of the host-side protocol types in src/types/messages.ts.
// tsconfig.webview.json is rooted at webview/, so the shared message types are
// duplicated here — keep the two files in sync.

export interface PreviewConfig {
  scrollSync: boolean;
  enableMermaid: boolean;
  enableKatex: boolean;
  enableCheckboxes: boolean;
  enableExcalidraw: boolean;
  lineBreaks: boolean;
  typographer: boolean;
  showFrontmatter: 'card' | 'none';
  allowRemoteImages: boolean;
}

export interface ConfigChangedMessage {
  type: 'configChanged';
  config: PreviewConfig;
}

// Messages sent from Webview -> Extension — mirror of the host-side union in
// src/types/messages.ts; keep the two files in sync.
export type WebviewMessage =
  | ReadyMessage
  | RevealLineMessage
  | ToggleCheckboxMessage
  | NavigateToLineMessage
  | OpenLinkMessage
  | ExportToPdfMessage
  | ExportToHtmlMessage;

export interface ReadyMessage {
  type: 'ready';
}

export interface RevealLineMessage {
  type: 'revealLine';
  line: number;
  source: 'preview';
}

export interface ToggleCheckboxMessage {
  type: 'toggleCheckbox';
  line: number;
  checked: boolean;
}

export interface NavigateToLineMessage {
  type: 'navigateToLine';
  line: number;
}

export interface OpenLinkMessage {
  type: 'openLink';
  href: string;
}

export interface ExportToPdfMessage {
  type: 'exportToPdf';
}

export interface ExportToHtmlMessage {
  type: 'exportToHtml';
}
