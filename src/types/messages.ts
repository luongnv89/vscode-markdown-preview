// Messages sent from Extension -> Webview
export type ExtensionMessage = UpdateContentMessage | ScrollToLineMessage | ConfigChangedMessage;

export interface UpdateContentMessage {
  type: 'updateContent';
  html: string;
  documentUri: string;
  lineCount: number;
}

export interface ScrollToLineMessage {
  type: 'scrollToLine';
  line: number;
  source: 'editor';
}

export interface ConfigChangedMessage {
  type: 'configChanged';
  config: PreviewConfig;
}

// Messages sent from Webview -> Extension
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

// Configuration
export interface PreviewConfig {
  scrollSync: boolean;
  enableMermaid: boolean;
  enableKatex: boolean;
  enableCheckboxes: boolean;
  lineBreaks: boolean;
  typographer: boolean;
}
