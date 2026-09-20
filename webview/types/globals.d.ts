// Ambient typings for the vendor libraries the webview loads through CSP-safe
// <script> tags (dist/webview/vendor/) rather than through webpack imports —
// they land on `window` at runtime, so declare them once here instead of
// casting `(window as any)` at every call site.
// window.ExcalidrawUtils is already declared in webview/excalidrawUtils.ts.

interface Window {
  mermaid?: import('mermaid').Mermaid;
  katex?: typeof import('katex');
}
