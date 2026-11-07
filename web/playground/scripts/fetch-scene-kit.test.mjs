// Focused tests for the scene-kit fetcher (issue #25): pinned tars are verified before use, the
// bundle manifest must match its export ref, content-addressed files must match their hashes, and
// installation copies only the selected entries, unchanged, with deterministic provenance.
//
// Run: node --test web/playground/scripts/fetch-scene-kit.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installSceneKit, sha256, validateLock } from './fetch-scene-kit.mjs';

const playgroundDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A tiny gltf-resources-v1 bundle tar with two entries; `tamper` edits files before packing. */
function bundleTar(work, tamper = () => {}) {
  const root = join(work, 'bundle');
  const files = new Map();
  const put = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
    files.set(path, bytes);
  };
  const entry = (key) => {
    const resource = Buffer.from(`${key} buffer`);
    const resourcePath = `resources/${sha256(resource)}.bin`;
    put(resourcePath, resource);
    const scene = `scenes/${key}/default.gltf`;
    put(scene, Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: `../../${resourcePath}` }] })));
    return {
      key,
      variant: 'default',
      path: scene,
      sha256: sha256(Buffer.from(key)),
      observations: { triangles: 12 },
      resources: [{ path: resourcePath, sha256: sha256(resource), byteLength: resource.byteLength }],
      attachments: [],
      source: { sha256: 'a'.repeat(64), metadata: { operation: 'test.op' } },
    };
  };
  const manifest = Buffer.from(JSON.stringify({ profile: 'gltf-resources-v1', assets: [entry('b.prop'), entry('a.prop')] }));
  put('manifest.json', manifest);
  put('export.ref.json', Buffer.from(JSON.stringify({ kind: 'asset-bundle', sha256: sha256(manifest), byteLength: manifest.byteLength })));
  tamper(root);
  const tar = join(work, 'bundle.tar');
  execFileSync('tar', ['-cf', tar, '-C', root, '.']);
  return readFileSync(tar);
}

function lockFor(bytes, entries = 'all') {
  return {
    schema: 'settings-playground-scene-kit-lock-v1',
    bundles: [{ id: 'kit', release: 'kit-release', asset: 'kit.tar', sha256: sha256(bytes), entries }],
  };
}

function withWork(run) {
  const work = mkdtempSync(join(tmpdir(), 'scene-kit-test-'));
  return Promise.resolve(run(work)).finally(() => rmSync(work, { recursive: true, force: true }));
}

test('the committed lock pins every release tar by SHA-256', () => {
  const lock = JSON.parse(readFileSync(join(playgroundDir, 'scene-kit.lock.json'), 'utf8'));
  validateLock(lock);
  assert.deepEqual(
    lock.bundles.map((bundle) => bundle.id),
    ['ranger', 'nature'],
  );
});

test('installs selected entries unchanged with deterministic provenance', () =>
  withWork(async (work) => {
    const tar = bundleTar(work);
    const urls = [];
    const download = async (url) => (urls.push(url), tar);
    const outDir = join(work, 'out');
    const kit = await installSceneKit({ lock: lockFor(tar), cacheDir: join(work, 'cache'), outDir, download });
    assert.deepEqual(urls, ['https://github.com/moritzbrantner/asset-tooling/releases/download/kit-release/kit.tar']);
    const [bundle] = kit.bundles;
    assert.equal(bundle.tarSha256, sha256(tar));
    assert.deepEqual(
      bundle.entries.map((entry) => entry.key),
      ['a.prop', 'b.prop'],
      'entries are recorded in key order, not manifest order',
    );
    assert.equal(sha256(readFileSync(join(outDir, 'kit', 'manifest.json'))), bundle.exportRef.sha256);
    assert.ok(existsSync(join(outDir, 'kit', 'scenes', 'a.prop', 'default.gltf')));

    // A second install from the verified cache is identical and does not download again.
    rmSync(outDir, { recursive: true });
    const again = await installSceneKit({ lock: lockFor(tar), cacheDir: join(work, 'cache'), outDir, download });
    assert.equal(urls.length, 1);
    assert.deepEqual(again, kit);
  }));

test('installs only the listed entries', () =>
  withWork(async (work) => {
    const tar = bundleTar(work);
    const outDir = join(work, 'out');
    const lock = lockFor(tar, [{ key: 'b.prop', variant: 'default' }]);
    const kit = await installSceneKit({ lock, cacheDir: join(work, 'cache'), outDir, download: async () => tar });
    assert.deepEqual(kit.bundles[0].entries.map((entry) => entry.key), ['b.prop']);
    assert.ok(!existsSync(join(outDir, 'kit', 'scenes', 'a.prop')));

    const missing = lockFor(tar, [{ key: 'c.prop', variant: 'default' }]);
    await assert.rejects(
      installSceneKit({ lock: missing, cacheDir: join(work, 'cache'), outDir, download: async () => tar }),
      /no unique entry c\.prop\/default/,
    );
  }));

test('rejects a tar that does not match its pin', () =>
  withWork(async (work) => {
    const tar = bundleTar(work);
    const lock = lockFor(tar);
    const outDir = join(work, 'out');
    await assert.rejects(
      installSceneKit({ lock, cacheDir: join(work, 'cache'), outDir, download: async () => Buffer.concat([tar, Buffer.from('x')]) }),
      /pinned/,
    );
    assert.ok(!existsSync(join(work, 'cache', `${lock.bundles[0].sha256}.tar`)), 'unverified bytes are never cached');
  }));

test('rejects a manifest that does not match its export ref', () =>
  withWork(async (work) => {
    const tar = bundleTar(work, (root) => writeFileSync(join(root, 'manifest.json'), '{"profile":"gltf-resources-v1","assets":[]}'));
    await assert.rejects(
      installSceneKit({ lock: lockFor(tar), cacheDir: join(work, 'cache'), outDir: join(work, 'out'), download: async () => tar }),
      /export\.ref\.json does not identify its manifest\.json/,
    );
  }));

test('rejects a content-addressed resource whose bytes changed', () =>
  withWork(async (work) => {
    const tar = bundleTar(work, (root) => {
      const resources = join(root, 'resources');
      for (const name of execFileSync('ls', [resources]).toString().trim().split('\n')) {
        writeFileSync(join(resources, name), 'tampered');
      }
    });
    await assert.rejects(
      installSceneKit({ lock: lockFor(tar), cacheDir: join(work, 'cache'), outDir: join(work, 'out'), download: async () => tar }),
      /does not match its declared SHA-256/,
    );
  }));

test('rejects malformed locks before any download', () => {
  const base = { schema: 'settings-playground-scene-kit-lock-v1', bundles: [] };
  const bundle = { id: 'kit', release: 'r', asset: 'kit.tar', sha256: 'a'.repeat(64), entries: 'all' };
  assert.doesNotThrow(() => validateLock({ ...base, bundles: [bundle] }));
  assert.throws(() => validateLock({ ...base, bundles: [{ ...bundle, sha256: 'A'.repeat(64) }] }), /SHA-256/);
  assert.throws(() => validateLock({ ...base, bundles: [bundle, bundle] }), /duplicate/);
  assert.throws(() => validateLock({ ...base, bundles: [{ ...bundle, entries: [] }] }), /entries/);
  assert.throws(() => validateLock({ ...base, bundles: [{ ...bundle, asset: '../kit.tar' }] }), /\.tar asset/);
});
