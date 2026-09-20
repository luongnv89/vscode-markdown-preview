#!/usr/bin/env node
/**
 * Docs-consistency checks (run: `npm run check:docs`).
 *
 * 1. Every message type in the ExtensionMessage and WebviewMessage unions of
 *    `src/types/messages.ts` is named in `docs/API.md` — the protocol doc can
 *    never silently drift behind the typed protocol again.
 * 2. `RELEASE_NOTES.md`, when present, has a heading naming the version in
 *    `package.json`. An absent file passes: release notes are generated from
 *    the changelog at release time instead of being kept by hand.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const failures = [];

// --- 1. Every union message type appears in docs/API.md ------------------

const messagesSrc = read('src/types/messages.ts');
const apiDoc = read('docs/API.md');

// Union members: `export type WebviewMessage = A | B | C;`
const unionMembers = [];
for (const match of messagesSrc.matchAll(/export\s+type\s+(\w*Message)\s*=\s*([^;]+);/gs)) {
  const union = match[1];
  for (const member of match[2].split('|')) {
    const name = member.trim();
    if (name) {
      unionMembers.push({ union, member: name });
    }
  }
}

// Each member interface declares its discriminant: `type: '<literal>'`.
const messageTypes = [];
for (const { union, member } of unionMembers) {
  const memberRe = new RegExp(`interface\\s+${member}\\s*\\{[^}]*?type:\\s*'([^']+)'`, 's');
  const m = messagesSrc.match(memberRe);
  if (!m) {
    failures.push(`${union} member ${member}: no 'type' literal found in src/types/messages.ts`);
    continue;
  }
  messageTypes.push({ union, member, literal: m[1] });
}

for (const { union, member, literal } of messageTypes) {
  if (!apiDoc.includes(literal)) {
    failures.push(`docs/API.md does not document '${literal}' (${union} member ${member})`);
  }
}

// --- 2. RELEASE_NOTES.md names the package.json version -----------------

const notesPath = path.join(root, 'RELEASE_NOTES.md');
if (fs.existsSync(notesPath)) {
  const version = JSON.parse(read('package.json')).version;
  const heading = fs
    .readFileSync(notesPath, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('#'));
  if (!heading) {
    failures.push('RELEASE_NOTES.md has no heading');
  } else if (!heading.includes(version)) {
    failures.push(`RELEASE_NOTES.md heading does not name version ${version}: "${heading.trim()}"`);
  }
}

// --- Report --------------------------------------------------------------

if (failures.length > 0) {
  console.error('check-docs: FAILED');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`check-docs: OK — ${messageTypes.length} message types documented in docs/API.md`);
