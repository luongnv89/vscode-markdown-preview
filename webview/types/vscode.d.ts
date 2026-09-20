interface VsCodeApi {
  // The host only understands the WebviewMessage union — anything else is a
  // compile error here instead of a silent no-op on the other side.
  postMessage(message: import('./messages').WebviewMessage): void;
  getState(): WebviewPersistedState | undefined;
  setState(state: WebviewPersistedState): void;
}

// The only state the webview persists between reloads (see main.ts).
interface WebviewPersistedState {
  scrollPosition?: number;
}

declare function acquireVsCodeApi(): VsCodeApi;
