// Vendor entry: @excalidraw/utils is ESM-only since 0.1.4 (the old
// dist/excalidraw-utils.min.js UMD bundle was removed). Webpack bundles this
// file to dist/webview/vendor/excalidraw-utils.min.js, which previewManager.ts
// loads via a <script> tag; the global keeps the same contract renderer.ts
// already consumes.
import * as ExcalidrawUtils from '@excalidraw/utils';

declare global {
  interface Window {
    ExcalidrawUtils: typeof ExcalidrawUtils;
  }
}

window.ExcalidrawUtils = ExcalidrawUtils;
