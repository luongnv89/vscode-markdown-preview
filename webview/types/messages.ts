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
