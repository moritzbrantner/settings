// Acceptance invariant for issue #22: the Settings Playground is added beside the existing
// minimal reference UI, which stays the small deterministic browser conformance fixture.
// The playground must not rewrite the reference UI or its shared fixture.
//
// Run: node --test web/reference-ui-unchanged.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Pinned at baseline fd12c1a2c3ecd73dd172a14c08b749f108ac244b.
const PINNED = {
  'web/index.html': '0954fc2a7ce9ba177f706af4fc56c88e6f0158e841de9e769e9f3681f97e302f',
  'web/reference-ui.js': '9dc5989fcea2ef55661f4e1e289de61ee2d4b95081efadb1fe4f50641af95eb3',
  'web/reference-ui.css': '585cfbc3c274b0f4c6571b8e1a3a6bc69860a422b1d7e8d14cb8e4332581a05f',
  'fixtures/presentation/reference.json':
    '0d29f85b7dc5b284bf1b7fcaa9a9203467797ac5656ba00b3159350518ee9d0c',
};

for (const [path, expected] of Object.entries(PINNED)) {
  test(`reference UI file ${path} is unchanged`, async () => {
    const bytes = await readFile(new URL(`../${path}`, import.meta.url));
    const actual = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      actual,
      expected,
      `${path} changed; the reference UI stays the unchanged conformance fixture (#22)`,
    );
  });
}
