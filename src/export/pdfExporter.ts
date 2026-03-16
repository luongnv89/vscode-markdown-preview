import { findChromePath, ChromeNotFoundError } from './browserFinder';

export { ChromeNotFoundError };

export interface PdfOptions {
  format?: 'A4' | 'Letter' | 'Legal';
  margin?: { top: string; right: string; bottom: string; left: string };
  printBackground?: boolean;
}

const DEFAULT_PDF_OPTIONS: PdfOptions = {
  format: 'A4',
  margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
  printBackground: true,
};

const PAGE_LOAD_TIMEOUT = 60000;
const RENDER_COMPLETION_TIMEOUT = 30000;
const FINAL_RENDER_DELAY = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function launchBrowser(): Promise<any> {
  const chromePath = findChromePath();
  // Dynamic import to lazy-load puppeteer-core and avoid slowing extension activation
  const puppeteer = await import('puppeteer-core');
  return puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAndRender(page: any, html: string): Promise<void> {
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

  // Wait for Mermaid/KaTeX rendering to complete
  await page
    .waitForFunction('window.__exportRenderComplete === true', {
      timeout: RENDER_COMPLETION_TIMEOUT,
    })
    .catch(() => {
      // Continue even if rendering didn't signal completion
    });

  // Brief delay for any final rendering
  await new Promise((resolve) => setTimeout(resolve, FINAL_RENDER_DELAY));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function closeBrowser(browser: any): Promise<void> {
  try {
    await browser.close();
  } catch {
    // Ignore close errors to avoid masking the original error
  }
}

export async function generatePdf(
  html: string,
  outputPath: string,
  options?: PdfOptions
): Promise<void> {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await loadAndRender(page, html);

    await page.pdf({
      path: outputPath,
      format: opts.format,
      margin: opts.margin,
      printBackground: opts.printBackground,
      preferCSSPageSize: false,
    });
  } finally {
    await closeBrowser(browser);
  }
}

/**
 * Render HTML in headless browser and extract the final rendered HTML.
 * This allows Mermaid diagrams and KaTeX math to be rendered client-side
 * and then captured as static HTML for standalone export.
 */
export async function renderInBrowser(html: string): Promise<string> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await loadAndRender(page, html);

    // Extract the rendered content (with scripts removed)
    const renderedHtml = await page.evaluate(() => {
      document.querySelectorAll('script').forEach((s) => s.remove());
      return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    });

    return renderedHtml;
  } finally {
    await closeBrowser(browser);
  }
}
