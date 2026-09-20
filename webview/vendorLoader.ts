// Lazy vendor loading (issue #72): the preview HTML content-gates its vendor
// <script> tags on what the rendered markup uses, so a document that gains
// its first ```mermaid fence — or first math — while the user types has no
// script tag for it. The renderers call ensureVendor instead of reloading
// the webview, which keeps the patched DOM, observers, and scroll position
// intact. The asWebviewUri-resolved URLs ship unconditionally as
// <body data-vendor-*> attributes — a data attribute costs nothing and never
// triggers a fetch.

export type VendorKey = 'katex' | 'mermaid' | 'excalidraw';

interface VendorSpec {
  // document.body dataset key carrying the script URL (data-vendor-*).
  uriAttr: string;
  // dataset key carrying the companion stylesheet URL, when one exists.
  stylesheetAttr?: string;
  isReady(): boolean;
}

const VENDORS: Record<VendorKey, VendorSpec> = {
  katex: {
    uriAttr: 'vendorKatex',
    stylesheetAttr: 'vendorKatexCss',
    isReady: () => typeof window.katex !== 'undefined',
  },
  mermaid: {
    uriAttr: 'vendorMermaid',
    isReady: () => typeof window.mermaid !== 'undefined',
  },
  excalidraw: {
    uriAttr: 'vendorExcalidraw',
    isReady: () => typeof window.ExcalidrawUtils !== 'undefined',
  },
};

// One in-flight load per vendor — a document update and a theme re-render
// that both need the same runtime share the promise. The entry is dropped
// on settle so a failed load is retried by the next update.
const pending = new Map<VendorKey, Promise<void>>();

// A load that never settles must not freeze updateContent forever: a
// shipped-but-failed script tag leaves no global and fires no further
// events, so every wait is bounded. Local webview resources load in well
// under a second; this only bounds the broken-install edge.
export const VENDOR_LOAD_TIMEOUT = 30000;

// The CSP nonce the page was built with — script-src is nonce-only, so an
// injected vendor tag must carry it. Read from our own script element: the
// nonce attribute is hidden from getAttribute (that is the point of the
// hiding), but the .nonce IDL property still returns it to script code.
let cspNonce =
  (document.currentScript as HTMLScriptElement | null)?.nonce ?? document.scripts[0]?.nonce ?? '';

// Test seam: the jsdom module harness has no currentScript, so tests push
// the nonce in explicitly rather than relying on the bootstrap capture.
export function initVendorLoader(nonce: string): void {
  cspNonce = nonce;
}

/**
 * Load a vendor runtime on first use. Resolves once the runtime's global is
 * present — true — or once loading definitively failed (no URI, error
 * event, timeout) — false. Never rejects: the renderers degrade to their
 * existing "library not available" path on false.
 */
export function ensureVendor(key: VendorKey): Promise<boolean> {
  const spec = VENDORS[key];
  if (spec.isReady()) {
    return Promise.resolve(true);
  }
  let p = pending.get(key);
  if (!p) {
    p = loadVendor(key, spec);
    pending.set(key, p);
    // Drop the entry on settle — success leaves the global behind, failure
    // frees the next update to retry.
    p.finally(() => {
      if (pending.get(key) === p) {
        pending.delete(key);
      }
    });
  }
  return p.then(() => spec.isReady());
}

function loadVendor(key: VendorKey, spec: VendorSpec): Promise<void> {
  const uri = document.body.dataset[spec.uriAttr];
  if (!uri) {
    console.warn(`vendorLoader: no ${spec.uriAttr} URI on <body> — cannot load ${key}`);
    return Promise.resolve();
  }
  injectStylesheet(key, spec);
  const shipped = document.querySelector(`script[data-vendor="${key}"]`);
  if (shipped) {
    // The initial HTML shipped the tag and it is still parsing — await it
    // rather than injecting a duplicate fetch.
    return waitForScript(shipped as HTMLScriptElement);
  }
  const script = document.createElement('script');
  script.src = uri;
  script.nonce = cspNonce;
  script.dataset.vendor = key;
  const wait = waitForScript(script).then(() => {
    if (!spec.isReady()) {
      // A failed injected tag is dead weight: left in the DOM it would be
      // mistaken for a shipped tag on the next ensure and suppress every
      // retry until the 30 s timeout. Drop it so a later update can inject
      // a fresh one.
      script.remove();
    }
  });
  document.head.appendChild(script);
  return wait;
}

// The KaTeX stylesheet is gated alongside its script — when math first
// appears on update, inject the <link> too (style-src already allows
// webview resources, so no nonce is needed). Not awaited: KaTeX renders
// correctly while the stylesheet streams in.
function injectStylesheet(key: VendorKey, spec: VendorSpec): void {
  if (!spec.stylesheetAttr) {
    return;
  }
  const href = document.body.dataset[spec.stylesheetAttr];
  if (!href || document.querySelector(`link[data-vendor-css="${key}"]`)) {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.vendorCss = key;
  document.head.appendChild(link);
}

// Resolve when the script loads; resolve silently on error or timeout —
// the caller distinguishes via the global, never via a rejection.
function waitForScript(script: HTMLScriptElement): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => finish(), VENDOR_LOAD_TIMEOUT);
    script.addEventListener('load', () => finish(), { once: true });
    script.addEventListener('error', () => finish(), { once: true });
  });
}
