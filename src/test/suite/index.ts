import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
  // Create the Mocha test runner.
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 20000,
  });

  const testsRoot = __dirname;

  return new Promise((resolve, reject) => {
    try {
      const files = fs
        .readdirSync(testsRoot)
        .filter((file) => file.endsWith('.test.js'))
        .sort();

      for (const file of files) {
        mocha.addFile(path.resolve(testsRoot, file));
      }

      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
