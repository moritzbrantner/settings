// Fetch the Settings Playground scene kit: pinned asset-tooling release tars (issue #25).
//
// asset-tooling owns generation; this script only downloads the release tars named in
// `scene-kit.lock.json`, refuses any tar whose SHA-256 differs from its pin, checks the bundle's
// content-only export ref against its manifest and every selected content-addressed resource
// against its declared hash, and copies the selected entries unchanged into `.scene-kit/`. The
// output is a pure function of the pinned tar bytes; nothing binary is committed.
//
// Usage: node scripts/fetch-scene-kit.mjs   (Vite serves and emits `.scene-kit/` as `scene-kit/`)
// A re-uploaded rolling release fails the pin check; adopt it by updating the pin.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RELEASES = 'https://github.com/moritzbrantner/asset-tooling/releases/download';
const SHA256 = /^[0-9a-f]{64}$/;
const BUNDLE_PATH = /^(?:scenes|resources|attachments)\/[\w.-]+(?:\/[\w.-]+)?$/;

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fail(message) {
  throw new Error(`scene kit: ${message}`);
}

/** Validate the lock file shape before any network or filesystem work. */
export function validateLock(lock) {
  if (lock?.schema !== 'settings-playground-scene-kit-lock-v1' || !Array.isArray(lock.bundles)) {
    fail('lock must be settings-playground-scene-kit-lock-v1 with a bundles array');
  }
  const ids = new Set();
  for (const bundle of lock.bundles) {
    if (!/^[a-z][a-z0-9-]*$/.test(bundle.id ?? '') || ids.has(bundle.id)) fail(`bad or duplicate bundle id ${bundle.id}`);
    ids.add(bundle.id);
    if (!/^[\w.-]+$/.test(bundle.release ?? '') || !/^[\w.-]+\.tar$/.test(bundle.asset ?? '')) {
      fail(`${bundle.id} needs a release tag and a .tar asset name`);
    }
    if (!SHA256.test(bundle.sha256 ?? '')) fail(`${bundle.id} must pin the tar by lowercase SHA-256`);
    const entries = bundle.entries;
    if (entries !== 'all' && !(Array.isArray(entries) && entries.length > 0 && entries.every((e) => e?.key && e?.variant))) {
      fail(`${bundle.id} entries must be "all" or a non-empty list of {key, variant}`);
    }
  }
  return lock;
}

async function httpDownload(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`download ${url} failed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The pinned tar bytes, from the cache when present and verified, else downloaded and verified. */
export async function obtainTar(bundle, cacheDir, download = httpDownload) {
  const cached = join(cacheDir, `${bundle.sha256}.tar`);
  if (existsSync(cached) && sha256(readFileSync(cached)) === bundle.sha256) return cached;
  const url = `${RELEASES}/${bundle.release}/${bundle.asset}`;
  const bytes = await download(url);
  const actual = sha256(bytes);
  if (actual !== bundle.sha256) {
    fail(`${url} has SHA-256 ${actual}, pinned ${bundle.sha256}; adopt a re-upload by updating the pin`);
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(`${cached}.partial`, bytes);
  renameSync(`${cached}.partial`, cached);
  return cached;
}

function readVerified(root, path, expected, byteLength) {
  if (!BUNDLE_PATH.test(path) || path.split('/').includes('..')) fail(`unsafe bundle path ${path}`);
  const file = join(root, path);
  if (!existsSync(file)) fail(`bundle is missing ${path}`);
  const bytes = readFileSync(file);
  if (expected !== undefined && sha256(bytes) !== expected) fail(`${path} does not match its declared SHA-256`);
  if (byteLength !== undefined && bytes.byteLength !== byteLength) fail(`${path} does not match its declared byte length`);
  return bytes;
}

/**
 * Verify an unpacked `gltf-resources-v1` bundle and copy the selected entries, unchanged, into
 * `outDir`. Returns the bundle's provenance record for developer diagnostics.
 */
export function installBundle(bundle, unpacked, outDir) {
  const manifestFile = join(unpacked, 'manifest.json');
  const refFile = join(unpacked, 'export.ref.json');
  if (!existsSync(manifestFile) || !existsSync(refFile)) fail(`${bundle.id} tar needs manifest.json and export.ref.json`);
  const manifestBytes = readFileSync(manifestFile);
  const exportRef = JSON.parse(readFileSync(refFile, 'utf8'));
  if (exportRef.kind !== 'asset-bundle' || exportRef.sha256 !== sha256(manifestBytes) || exportRef.byteLength !== manifestBytes.byteLength) {
    fail(`${bundle.id} export.ref.json does not identify its manifest.json`);
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.profile !== 'gltf-resources-v1' || !Array.isArray(manifest.assets)) {
    fail(`${bundle.id} manifest must be a gltf-resources-v1 bundle`);
  }
  const selected =
    bundle.entries === 'all'
      ? manifest.assets
      : bundle.entries.map(({ key, variant }) => {
          const matches = manifest.assets.filter((asset) => asset.key === key && asset.variant === variant);
          if (matches.length !== 1) fail(`${bundle.id} has no unique entry ${key}/${variant}`);
          return matches[0];
        });

  const target = join(outDir, bundle.id);
  mkdirSync(target, { recursive: true });
  const copy = (path, bytes) => {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    writeFileSync(join(target, path), bytes);
  };
  copy('manifest.json', manifestBytes);
  copyFileSync(refFile, join(target, 'export.ref.json'));
  for (const entry of selected) {
    copy(entry.path, readVerified(unpacked, entry.path));
    for (const file of [...(entry.resources ?? []), ...(entry.attachments ?? [])]) {
      copy(file.path, readVerified(unpacked, file.path, file.sha256, file.byteLength));
    }
  }

  return {
    id: bundle.id,
    release: bundle.release,
    asset: bundle.asset,
    tarSha256: bundle.sha256,
    exportRef: { sha256: exportRef.sha256, byteLength: exportRef.byteLength },
    profile: manifest.profile,
    entries: selected
      .map((entry) => ({
        key: entry.key,
        variant: entry.variant,
        sha256: entry.sha256,
        triangles: entry.observations?.triangles ?? null,
        source: {
          sha256: entry.source?.sha256 ?? null,
          operation: entry.source?.metadata?.operation ?? null,
          sourceSha256: entry.source?.metadata?.sourceSha256 ?? null,
        },
      }))
      .sort((a, b) => (a.key === b.key ? a.variant.localeCompare(b.variant) : a.key.localeCompare(b.key))),
  };
}

/** Fetch, verify and install every pinned bundle into `outDir`, replacing its previous contents. */
export async function installSceneKit({ lock, cacheDir, outDir, download }) {
  validateLock(lock);
  const lockSha256 = sha256(JSON.stringify(lock));
  const index = join(outDir, 'scene-kit.json');
  if (existsSync(index) && JSON.parse(readFileSync(index, 'utf8')).lockSha256 === lockSha256) {
    return JSON.parse(readFileSync(index, 'utf8'));
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const bundles = [];
  for (const bundle of lock.bundles) {
    const tar = await obtainTar(bundle, cacheDir, download);
    const unpacked = mkdtempSync(join(tmpdir(), `scene-kit-${bundle.id}-`));
    try {
      execFileSync('tar', ['-xf', tar, '-C', unpacked, '--no-same-owner', '--no-same-permissions']);
      bundles.push(installBundle(bundle, unpacked, outDir));
    } finally {
      rmSync(unpacked, { recursive: true, force: true });
    }
  }
  const kit = { schema: 'settings-playground-scene-kit-v1', lockSha256, bundles };
  writeFileSync(index, `${JSON.stringify(kit, null, 2)}\n`);
  return kit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const playgroundDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const lock = JSON.parse(readFileSync(join(playgroundDir, 'scene-kit.lock.json'), 'utf8'));
  const kit = await installSceneKit({
    lock,
    cacheDir: join(playgroundDir, '.scene-kit-cache'),
    outDir: join(playgroundDir, '.scene-kit'),
  });
  for (const bundle of kit.bundles) {
    console.log(`scene kit: ${bundle.release} ${bundle.tarSha256.slice(0, 12)} → ${bundle.entries.length} entries`);
  }
}
