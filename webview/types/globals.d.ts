// Ambient typings for the vendor libraries the webview loads through CSP-safe
// <script> tags (dist/webview/vendor/) rather than through webpack imports —
// they land on `window` at runtime, so declare them once here instead of
// casting `(window as any)` at every call site.
// window.ExcalidrawUtils is already declared in webview/excalidrawUtils.ts.

// The slice of pele's global API (vendor/pele.min.js, the Mermaid-syntax
// renderer) the webview calls. Declared locally rather than imported from the
// ESM package so the webview tsconfig never resolves pele's module types.
interface PeleRenderOptions {
  idPrefix?: string;
  fontFamily?: string;
  fontFamilyMono?: string;
  fontSize?: number;
  links?: boolean;
  linkSchemes?: string[];
  images?: boolean;
  imageSchemes?: string[];
  limit?: number;
  maxEdges?: number;
}

interface PeleRenderResult {
  svg: string;
  width: number;
  height: number;
  type: string;
}

// pele.render throws a PeleError (an Error subclass) on bad input.
interface PeleError extends Error {
  code: 'unsupported-diagram' | 'syntax' | 'semantic' | 'limit';
  line: number;
  column: number;
  snippet: string;
}

interface PeleGlobal {
  render(source: string, options?: PeleRenderOptions): PeleRenderResult;
  PeleError: new (message: string) => PeleError;
}

interface Window {
  pele?: PeleGlobal;
  katex?: typeof import('katex');
}
