// Acceptance architecture invariants for issue #22 (Settings Playground shell).
//
// - The playground is a separate application under web/playground with its sources in src/.
// - It consumes settings semantics only through the public `@moritzbrantner/settings-browser`
//   package API (never the generated WASM bindings or repository-relative adapter files).
// - Its UI uses `@moritzbrantner/ui` stable primitives, consumed as a commit-pinned git
//   dependency (owner rule: no registry publishing, no GH_PACKAGES_TOKEN).
//
// Run: node --test web/playground/architecture.test.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const playgroundDir = fileURLToPath(new URL('.', import.meta.url));
const srcDir = join(playgroundDir, 'src');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (SOURCE.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) out.push(path);
  }
  return out;
}

function importSpecifiers(code) {
  const specifiers = [];
  const pattern =
    /\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

async function allImports() {
  assert.ok(existsSync(srcDir), 'web/playground/src must contain the playground application');
  const files = await sourceFiles(srcDir);
  assert.ok(files.length > 0, 'web/playground/src must contain source files');
  const imports = [];
  for (const file of files) {
    for (const specifier of importSpecifiers(await readFile(file, 'utf8'))) {
      imports.push({ file, specifier });
    }
  }
  return imports;
}

test('playground consumes settings-browser only through its public package API', async () => {
  const imports = await allImports();
  assert.ok(
    imports.some(({ specifier }) => /^@moritzbrantner\/settings-browser(?:\/react)?$/.test(specifier)),
    'the playground must import @moritzbrantner/settings-browser',
  );
  const internal = imports.filter(
    ({ specifier }) =>
      /settings_wasm|(?:^|\/)pkg\//.test(specifier) ||
      /^\.{1,2}\/.*settings-(?:browser|react)(?:\.[cm]?[jt]s)?$/.test(specifier) ||
      /^@moritzbrantner\/settings-browser\/(?!react$|package\.json$)/.test(specifier),
  );
  assert.deepEqual(
    internal,
    [],
    'the playground must not reach into WASM bindings or repository-relative adapter files',
  );
});

test('playground UI uses @moritzbrantner/ui primitives', async () => {
  const imports = await allImports();
  assert.ok(
    imports.some(({ specifier }) => /^@moritzbrantner\/ui(?:\/|$)/.test(specifier)),
    'the playground must build its UI from @moritzbrantner/ui',
  );
});

test('@moritzbrantner/ui is a commit-pinned git dependency', async () => {
  const manifestPath = join(playgroundDir, 'package.json');
  assert.ok(existsSync(manifestPath), 'web/playground/package.json must exist');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const spec = manifest.dependencies?.['@moritzbrantner/ui'] ?? manifest.devDependencies?.['@moritzbrantner/ui'];
  assert.match(
    spec ?? '',
    /^(?:git\+https:\/\/github\.com\/moritzbrantner\/ui(?:\.git)?|github:moritzbrantner\/ui)#[0-9a-f]{40}$/,
    '@moritzbrantner/ui must be pinned to an exact git commit',
  );
});
