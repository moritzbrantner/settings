// Scene kit for the 3d-lab graphics preview (issue #25): asset-tooling bundles fetched at build
// time from pinned release tars (`scene-kit.lock.json`, `scripts/fetch-scene-kit.mjs`) and loaded
// through the 3d-lab renderer's bundle adapters. asset-tooling owns generation and 3d-lab owns
// decoding and drawing; this module only selects representative entries, re-checks the bundle
// manifests against their export refs, and records why an entry could not be drawn. Provenance
// stays developer diagnostics here and never becomes settings metadata.
import {
  adaptImportedCharacterBundle,
  adaptImportedItemBundle,
  readBundleAttachment,
  type ImportedCharacterAsset,
  type ImportedItemAsset,
} from '@moritzbrantner/three-d-renderer/imported-character';

export const SCENE_KIT_BASE = 'scene-kit/';
export const CHARACTER_KEY = 'humanoid.ranger.male';
export const CHARACTER_CLIP = 'Idle_Loop';
const NATURE_DESCRIPTOR = 'nature-descriptor';

/** Build-time provenance written by `fetch-scene-kit.mjs` for one pinned release tar. */
export interface BundleProvenance {
  id: string;
  release: string;
  asset: string;
  tarSha256: string;
  exportRef: { sha256: string; byteLength: number };
  profile: string;
  entries: Array<{ key: string; variant: string; sha256: string; triangles: number | null }>;
}

interface SceneKitIndex {
  schema: 'settings-playground-scene-kit-v1';
  lockSha256: string;
  bundles: BundleProvenance[];
}

export type MemberFamily = 'character' | 'tree' | 'rock' | 'bush';

export interface Footprint {
  width: number;
  height: number;
  depth: number;
}

/** One attempted bundle variant and the renderer's verdict on it. */
export interface VariantAttempt {
  variant: string;
  sha256: string | null;
  triangles: number | null;
  error: string | null;
}

/** A representative asset: what was drawn, or why the preview fell back to a proxy. */
export interface SceneMember {
  key: string;
  bundle: string;
  family: MemberFamily;
  footprint: Footprint;
  /** The variant the renderer accepted, or `null` when the preview draws a proxy instead. */
  variant: string | null;
  attempts: VariantAttempt[];
  item: ImportedItemAsset | null;
  character: ImportedCharacterAsset | null;
}

export interface BundleDiagnostics extends BundleProvenance {
  /** Whether the served manifest still hashes to the export ref recorded at build time. */
  manifestVerified: boolean;
}

export type SceneKit =
  | { status: 'ready'; bundles: BundleDiagnostics[]; members: SceneMember[]; dispose(): void }
  | { status: 'unavailable'; reason: string; bundles: BundleDiagnostics[]; members: SceneMember[]; dispose(): void };

const CHARACTER_FOOTPRINT: Footprint = { width: 0.6, height: 1.8, depth: 0.4 };
const FALLBACK_FOOTPRINT: Record<Exclude<MemberFamily, 'character'>, Footprint> = {
  tree: { width: 5, height: 8, depth: 5 },
  rock: { width: 3, height: 2, depth: 3 },
  bush: { width: 1.4, height: 1, depth: 1.3 },
};

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.arrayBuffer();
}

interface ManifestEntry {
  key: string;
  variant: string;
  sha256: string;
  observations?: { triangles?: number };
  attachments?: Array<{ name?: string }>;
}

interface DescriptorAsset {
  key: string;
  family?: string;
  footprint?: Partial<Footprint>;
  lods?: { levels?: Array<{ variant: string }> };
}

const familyOf = (key: string, declared?: string): Exclude<MemberFamily, 'character'> => {
  if (declared === 'tree' || declared === 'rock' || declared === 'bush') return declared;
  if (key.includes('.tree.')) return 'tree';
  if (key.includes('.rock.')) return 'rock';
  return 'bush';
};

const footprintOf = (family: Exclude<MemberFamily, 'character'>, declared?: Partial<Footprint>): Footprint => {
  const fallback = FALLBACK_FOOTPRINT[family];
  const pick = (value: unknown, otherwise: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : otherwise;
  return {
    width: pick(declared?.width, fallback.width),
    height: pick(declared?.height, fallback.height),
    depth: pick(declared?.depth, fallback.depth),
  };
};

function attempt(entries: BundleProvenance["entries"], key: string, variant: string, error: string | null): VariantAttempt {
  const entry = entries.find((candidate) => candidate.key === key && candidate.variant === variant);
  return { variant, sha256: entry?.sha256 ?? null, triangles: entry?.triangles ?? null, error };
}

/**
 * Load the scene kit served under `base`. Never throws: a missing kit, bundle or variant becomes a
 * diagnostic and a proxy in the preview instead of an error.
 */
export async function loadSceneKit(base = SCENE_KIT_BASE): Promise<SceneKit> {
  const owned: Array<{ dispose(): void }> = [];
  const dispose = () => {
    for (const asset of owned.splice(0)) asset.dispose();
  };
  let index: SceneKitIndex;
  try {
    index = JSON.parse(new TextDecoder().decode(await fetchBytes(`${base}scene-kit.json`)));
    if (index.schema !== 'settings-playground-scene-kit-v1' || !Array.isArray(index.bundles)) {
      throw new Error('scene-kit.json has an unknown schema');
    }
  } catch (cause) {
    return {
      status: 'unavailable',
      reason: `The scene kit is not available (${message(cause)}); run \`bun run fetch:scene-kit\`.`,
      bundles: [],
      members: [],
      dispose,
    };
  }

  const bundles: BundleDiagnostics[] = [];
  const members: SceneMember[] = [];
  for (const provenance of index.bundles) {
    const root = `${base}${provenance.id}/`;
    const readResource = (path: string) => fetchBytes(`${root}${path}`);
    let manifest: { assets?: ManifestEntry[] } | null = null;
    let manifestVerified = false;
    try {
      const bytes = await fetchBytes(`${root}manifest.json`);
      manifestVerified = (await sha256Hex(bytes)) === provenance.exportRef.sha256;
      // A manifest that no longer matches its export ref is not trusted for any entry.
      if (manifestVerified) manifest = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      manifest = null;
    }
    bundles.push({ ...provenance, manifestVerified });
    const entries = manifest?.assets ?? [];
    const unverified = manifestVerified ? null : 'bundle manifest is missing or does not match its export ref';

    if (provenance.entries.some((entry) => entry.key === CHARACTER_KEY)) {
      const member: SceneMember = {
        key: CHARACTER_KEY,
        bundle: provenance.id,
        family: 'character',
        footprint: CHARACTER_FOOTPRINT,
        variant: null,
        attempts: [],
        item: null,
        character: null,
      };
      try {
        if (unverified) throw new Error(unverified);
        const character = await adaptImportedCharacterBundle({ manifest, key: CHARACTER_KEY, variant: 'default', readResource });
        owned.push(character);
        if (!character.clips.some((clip) => clip.name === CHARACTER_CLIP)) {
          throw new Error(`character has no ${CHARACTER_CLIP} clip`);
        }
        member.character = character;
        member.variant = 'default';
        member.attempts.push(attempt(provenance.entries, CHARACTER_KEY, 'default', null));
      } catch (cause) {
        member.attempts.push(attempt(provenance.entries, CHARACTER_KEY, 'default', message(cause)));
      }
      members.push(member);
      continue;
    }

    // Nature: one member per descriptor asset, trying its variants in level-of-detail order and
    // keeping the most detailed one the renderer accepts.
    let descriptorAssets: DescriptorAsset[] = [];
    const describing = entries.find((entry) => entry.attachments?.some((item) => item.name === NATURE_DESCRIPTOR));
    if (describing && !unverified) {
      try {
        const descriptor = (await readBundleAttachment({
          manifest,
          key: describing.key,
          variant: describing.variant,
          name: NATURE_DESCRIPTOR,
          readResource,
        })) as { assets?: DescriptorAsset[] };
        descriptorAssets = descriptor.assets ?? [];
      } catch {
        descriptorAssets = [];
      }
    }
    const keys = [...new Set(provenance.entries.map((entry) => entry.key))].sort();
    for (const key of keys) {
      const described = descriptorAssets.find((asset) => asset.key === key);
      const family = familyOf(key, described?.family);
      const variants =
        described?.lods?.levels?.map((level) => level.variant) ??
        provenance.entries.filter((entry) => entry.key === key).map((entry) => entry.variant).sort();
      const member: SceneMember = {
        key,
        bundle: provenance.id,
        family,
        footprint: footprintOf(family, described?.footprint),
        variant: null,
        attempts: [],
        item: null,
        character: null,
      };
      for (const variant of variants) {
        try {
          if (unverified) throw new Error(unverified);
          const item = await adaptImportedItemBundle({ manifest, key, variant, readResource });
          owned.push(item);
          member.item = item;
          member.variant = variant;
          member.attempts.push(attempt(provenance.entries, key, variant, null));
          break;
        } catch (cause) {
          member.attempts.push(attempt(provenance.entries, key, variant, message(cause)));
        }
      }
      members.push(member);
    }
  }
  return { status: 'ready', bundles, members, dispose };
}
