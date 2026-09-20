import { PreviewConfig } from '../types/messages';

// Which client-side vendor runtimes a rendered document actually uses —
// KaTeX (script + stylesheet + fonts), Mermaid, and Excalidraw.
export interface VendorNeeds {
  math: boolean;
  mermaid: boolean;
  excalidraw: boolean;
}

// Feature flags that can force a renderer off even when its placeholder
// markup is present — a disabled engine emits no placeholders upstream
// (markdownCore.ts), so the flag check is defense in depth, not the gate.
export type VendorFeatureFlags = Partial<
  Pick<PreviewConfig, 'enableKatex' | 'enableMermaid' | 'enableExcalidraw'>
>;

export const ALL_VENDOR_NEEDS: VendorNeeds = { math: true, mermaid: true, excalidraw: true };
export const NO_VENDOR_NEEDS: VendorNeeds = { math: false, mermaid: false, excalidraw: false };

/**
 * Detect which vendor runtimes the rendered markup references. The match
 * requires a class attribute (`class="…katex-block…"`), so prose merely
 * mentioning a class name cannot trigger a payload; the classes are the same
 * selectors the renderers query (`.katex-inline[data-math]`, `.mermaid-block`,
 * `.excalidraw-block`). Single home for the detection the preview webview
 * gate (#72) and the export asset gate (#74) share — the export applies it
 * to sanitized markup, the preview to the engine's emitted HTML.
 */
export function detectVendorNeeds(
  renderedHtml: string,
  features: Required<VendorFeatureFlags>
): VendorNeeds {
  return {
    math: features.enableKatex && /class="[^"]*\bkatex-(?:inline|block)\b/.test(renderedHtml),
    mermaid: features.enableMermaid && /class="[^"]*\bmermaid-block\b/.test(renderedHtml),
    excalidraw: features.enableExcalidraw && /class="[^"]*\bexcalidraw-block\b/.test(renderedHtml),
  };
}
