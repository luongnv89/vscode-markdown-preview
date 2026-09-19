import * as assert from 'assert';
import fs from 'fs';
import { ChromeNotFoundError, findChromePath } from '../../export/browserFinder';

suite('findChromePath', () => {
  const realExistsSync = fs.existsSync;
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  function setPlatform(platform: string): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  teardown(() => {
    fs.existsSync = realExistsSync;
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  });

  test('returns the candidate that exists on disk', () => {
    setPlatform('darwin');
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    fs.existsSync = (p) => p === edge;
    assert.strictEqual(findChromePath(), edge);
  });

  test('characterization: scans candidates in list order and returns the earliest hit', () => {
    setPlatform('darwin');
    const chromium = '/Applications/Chromium.app/Contents/MacOS/Chromium';
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    fs.existsSync = (p) => p === chromium || p === edge;
    assert.strictEqual(findChromePath(), chromium);
  });

  test('scans the linux candidate list under process.platform=linux', () => {
    setPlatform('linux');
    const chrome = '/usr/bin/google-chrome-stable';
    fs.existsSync = (p) => p === chrome;
    assert.strictEqual(findChromePath(), chrome);
  });

  test('scans the win32 candidate list under process.platform=win32', () => {
    setPlatform('win32');
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    fs.existsSync = (p) => p === chrome;
    assert.strictEqual(findChromePath(), chrome);
  });

  test('throws ChromeNotFoundError when no candidate exists', () => {
    setPlatform('darwin');
    fs.existsSync = () => false;
    assert.throws(
      () => findChromePath(),
      (e) =>
        e instanceof ChromeNotFoundError &&
        e.name === 'ChromeNotFoundError' &&
        /Chromium-based browser/.test(e.message)
    );
  });

  test('characterization: an unknown platform has no candidates and throws', () => {
    setPlatform('aix');
    fs.existsSync = () => true; // even a "everything exists" fs cannot rescue it
    assert.throws(() => findChromePath(), ChromeNotFoundError);
  });

  test('integration: returns an existing path or throws ChromeNotFoundError on this host', () => {
    try {
      const found = findChromePath();
      assert.strictEqual(realExistsSync(found), true);
    } catch (e) {
      assert.ok(e instanceof ChromeNotFoundError);
    }
  });
});
