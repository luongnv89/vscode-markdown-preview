import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generatePdf } from '../../export/pdfExporter';
import { findChromePath } from '../../export/browserFinder';

// PDF export integration test (issue #44): the end-to-end path through
// puppeteer-core must produce a real, non-empty PDF document in headless
// Chromium. Gated on a system Chromium-based browser, like the other
// real-Chromium export tests, so environments without Chrome skip cleanly.

function chromeAvailable(): boolean {
  try {
    findChromePath();
    return true;
  } catch {
    return false;
  }
}

suite('PDF export (#44)', function () {
  // Launching headless Chromium and printing a page can exceed the default
  // 20s Mocha timeout on a cold start.
  this.timeout(90000);

  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdp-pdf-export-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('produces a non-empty PDF document', async function () {
    if (!chromeAvailable()) {
      return this.skip();
    }
    const outputPath = path.join(tmpDir, 'export.pdf');
    await generatePdf('<!DOCTYPE html><html><body><h1>Export test</h1></body></html>', outputPath);

    assert.ok(fs.existsSync(outputPath), 'PDF file was not written');
    const pdf = fs.readFileSync(outputPath);
    assert.ok(pdf.length > 0, 'PDF file is empty');
    assert.strictEqual(
      pdf.subarray(0, 5).toString('latin1'),
      '%PDF-',
      'output is not a PDF document (missing %PDF- header)'
    );
  });
});
