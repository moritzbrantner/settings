// Playground-owned persistence, profiles and developer overlays. Storage, profile names and URL
// parsing are consumer decisions; every value, migration and diagnostic comes from the session.
// Only the durable User, Device and Save scopes are ever written: Session values and transient
// overlays have no export path, so they cannot reach storage.
import type {
  BrowserSettingsSession,
  ImportReport,
  LoadDiagnostic,
  OverlayLayer,
  SettingDefinition,
  SettingScope,
  SettingValue,
} from '@moritzbrantner/settings-browser';
import { SCOPE_LABEL } from './model';
// Retained deterministic persistence fixtures, bundled unchanged.
import corruptDevice from '../../../fixtures/persistence/v2-corrupt-device.json?raw';
import forwardCompatibleUser from '../../../fixtures/persistence/v2-user-forward-compatible.json?raw';
import legacyMixed from '../../../fixtures/persistence/v1-mixed.json?raw';

export interface RetainedFixture {
  id: string;
  label: string;
  scope: Exclude<SettingScope, 'session'>;
  snapshot: string;
}

export const RETAINED_FIXTURES: readonly RetainedFixture[] = [
  { id: 'v1-mixed', label: 'legacy v1 snapshot', scope: 'user', snapshot: legacyMixed },
  {
    id: 'v2-user-forward-compatible',
    label: 'forward-compatible snapshot',
    scope: 'user',
    snapshot: forwardCompatibleUser,
  },
  { id: 'v2-corrupt-device', label: 'corrupt snapshot', scope: 'device', snapshot: corruptDevice },
];

export type DurableScope = Exclude<SettingScope, 'session'>;
export const DURABLE_SCOPES: readonly DurableScope[] = ['user', 'device', 'save'];
export const OVERLAY_LAYERS: readonly OverlayLayer[] = ['policy', 'command_line', 'session'];
export const OVERLAY_LABEL: Record<OverlayLayer, string> = {
  policy: 'Policy',
  command_line: 'Command line',
  session: 'Session override',
};

const SCOPE_KEY = (scope: DurableScope) => `settings-playground.snapshot.${scope}`;
const PROFILES_KEY = 'settings-playground.profiles';

/** One user-created profile: the canonical `exportScope` snapshot of every durable scope. */
export type Profile = Record<DurableScope, string>;
export type Profiles = Record<string, Profile>;

/** A load outcome shown to the user: a structured report, or why the whole snapshot failed. */
export interface LoadResult {
  source: string;
  scope: DurableScope;
  report?: ImportReport;
  error?: string;
}

/** `localStorage`, or `undefined` when the browser denies it; the playground then stays in memory. */
export function browserStorage(): Storage | undefined {
  try {
    const storage = window.localStorage;
    const probe = 'settings-playground.probe';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return undefined;
  }
}

function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: string | null): boolean {
  if (!storage) return false;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function importSnapshot(
  session: BrowserSettingsSession,
  scope: DurableScope,
  snapshot: string,
  source: string,
): LoadResult {
  try {
    return { source, scope, report: session.importScopeReport(scope, snapshot) };
  } catch (error) {
    return { source, scope, error: errorText(error) };
  }
}

/** Load the stored durable snapshots into the session; scopes without one keep their defaults. */
export function loadStoredScopes(
  session: BrowserSettingsSession,
  storage: Storage | undefined,
): LoadResult[] {
  const results: LoadResult[] = [];
  for (const scope of DURABLE_SCOPES) {
    const snapshot = read(storage, SCOPE_KEY(scope));
    if (snapshot !== null) results.push(importSnapshot(session, scope, snapshot, 'Stored'));
  }
  return results;
}

/** Write the committed durable snapshots; returns whether storage accepted them. */
export function storeScopes(session: BrowserSettingsSession, storage: Storage | undefined): boolean {
  return DURABLE_SCOPES.every((scope) => write(storage, SCOPE_KEY(scope), session.exportScope(scope)));
}

export function clearStoredScopes(storage: Storage | undefined): void {
  for (const scope of DURABLE_SCOPES) write(storage, SCOPE_KEY(scope), null);
}

export function readProfiles(storage: Storage | undefined): Profiles {
  try {
    const parsed: unknown = JSON.parse(read(storage, PROFILES_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const profiles: Profiles = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      const profile = value as Partial<Profile> | null;
      if (profile && DURABLE_SCOPES.every((scope) => typeof profile[scope] === 'string')) {
        profiles[name] = profile as Profile;
      }
    }
    return profiles;
  } catch {
    return {};
  }
}

export function writeProfiles(storage: Storage | undefined, profiles: Profiles): boolean {
  return write(storage, PROFILES_KEY, JSON.stringify(profiles));
}

export function captureProfile(session: BrowserSettingsSession): Profile {
  return {
    user: session.exportScope('user'),
    device: session.exportScope('device'),
    save: session.exportScope('save'),
  };
}

export function loadProfile(
  session: BrowserSettingsSession,
  name: string,
  profile: Profile,
): LoadResult[] {
  return DURABLE_SCOPES.map((scope) =>
    importSnapshot(session, scope, profile[scope], `Profile “${name}”`),
  );
}

/** Turn developer text into a typed candidate; range and option checks stay in the session. */
export function parseValue(definition: SettingDefinition, text: string): SettingValue {
  const trimmed = text.trim();
  switch (definition.kind.type) {
    case 'bool':
      if (/^(true|on|1)$/i.test(trimmed)) return { type: 'bool', value: true };
      if (/^(false|off|0)$/i.test(trimmed)) return { type: 'bool', value: false };
      throw new Error(`${definition.id} expects true or false`);
    case 'integer':
      if (!/^[+-]?\d+$/.test(trimmed)) throw new Error(`${definition.id} expects a whole number`);
      return { type: 'integer', value: Number(trimmed) };
    case 'number': {
      const number = Number(trimmed);
      if (trimmed === '' || !Number.isFinite(number)) {
        throw new Error(`${definition.id} expects a finite number`);
      }
      return { type: 'number', value: number };
    }
    case 'choice':
      return { type: 'choice', value: trimmed };
    case 'text':
      return { type: 'text', value: text };
  }
}

/**
 * Apply `?policy=id:value`, `?command_line=id:value` and `?session=id:value` (each repeatable).
 * Returns one message per parameter that was not applied.
 */
export function applyUrlOverlays(
  session: BrowserSettingsSession,
  definitions: ReadonlyMap<string, SettingDefinition>,
  search: string,
): string[] {
  const problems: string[] = [];
  const params = new URLSearchParams(search);
  for (const layer of OVERLAY_LAYERS) {
    for (const raw of params.getAll(layer)) {
      const at = raw.indexOf(':');
      const id = at < 0 ? raw : raw.slice(0, at);
      const definition = definitions.get(id);
      try {
        if (at < 0) throw new Error('expected id:value');
        if (!definition) throw new Error(`unknown setting ${id}`);
        session.setOverlay(layer, id, parseValue(definition, raw.slice(at + 1)));
      } catch (error) {
        problems.push(`Ignored ?${layer}=${raw}: ${errorText(error)}.`);
      }
    }
  }
  return problems;
}

/** Compact, actionable text for one entry that was not loaded as-is. */
export function diagnosticText(diagnostic: LoadDiagnostic): string {
  switch (diagnostic.type) {
    case 'unknown_setting_preserved':
      return `${diagnostic.id}: unknown here, kept verbatim and written back on export.`;
    case 'invalid_value':
      return `${diagnostic.id}: rejected, ${diagnostic.reason}. The default stays active; set it again to fix.`;
    case 'corrupt_value':
      return `${diagnostic.id}: rejected, unreadable value (${diagnostic.reason}). The default stays active.`;
    case 'invalid_identifier':
      return `“${diagnostic.raw_id}”: rejected, ${diagnostic.reason}. Fix the id in the snapshot to keep it.`;
    case 'scope_mismatch':
      return `${diagnostic.id}: rejected, belongs to ${SCOPE_LABEL[diagnostic.actual]} not ${SCOPE_LABEL[diagnostic.expected]}. Import it into the ${SCOPE_LABEL[diagnostic.actual]} snapshot.`;
    case 'legacy_unknown_entry_dropped':
      return `${diagnostic.id}: dropped, unknown legacy entry whose scope cannot be decided.`;
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
