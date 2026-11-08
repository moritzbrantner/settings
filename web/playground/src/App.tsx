// Settings Playground shell: category navigation, search, staged Apply/Cancel, restart/reconnect
// notices and per-setting, section and global reset. Every value, override, provenance and
// availability fact comes from the settings session; this component only decides presentation
// and routes edits by apply mode (immediate edits commit, all others are staged).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  BrowserSettingsSession,
  PresentationEntry,
  SettingChange,
  SettingDefinition,
  SettingState,
  SettingValue,
} from '@moritzbrantner/settings-browser';
import { Button, Input } from '@moritzbrantner/ui/stable';
import { audioMix, PREVIEWED_AUDIO, sampleRateOf } from './audio';
import { AudioPreview } from './AudioPreview';
import { ControlsBindings } from './ControlsBindings';
import { GraphicsPreview } from './GraphicsPreview';
import { IntegrationBoundary } from './IntegrationBoundary';
import { rendererConfig } from './graphics';
import { physicsConfig } from './physics';
import { PhysicsPreview } from './PhysicsPreview';
import { SettingRow } from './SettingRow';
import { createConsumerAdapter } from './consumerAdapter';
import { DeveloperTools } from './DeveloperTools';
import {
  captureProfile,
  clearStoredScopes,
  errorText,
  loadProfile,
  readProfiles,
  storeScopes,
  writeProfiles,
  type LoadResult,
  type Profiles,
} from './lab';
import {
  createLocalize,
  reasonText,
  sameValue,
  type FixturePreset,
  type PlaygroundFixture,
} from './model';

export interface AppProps {
  session: BrowserSettingsSession;
  fixture: PlaygroundFixture;
  /** Whether the browser reported WebGL 2, which the 3d-lab preview requires. */
  webgl: boolean;
  /** `localStorage`, or `undefined` when the browser denies it. */
  storage?: Storage;
  /** Outcome of restoring the stored snapshots at startup. */
  startupResults?: LoadResult[];
  /** URL overlay parameters that were not applied. */
  urlProblems?: string[];
}

const GRAPHICS_CATEGORY = 'settings.category.graphics';
const AUDIO_CATEGORY = 'settings.category.audio';
const SIMULATION_CATEGORY = 'settings.category.simulation';
const PREVIEWED = new Set(PREVIEWED_AUDIO);
const WINDOW_MODE = 'video.window_mode';
/** Changes the playground always applies with confirmation, because they can leave it unusable. */
const RISKY = new Set([WINDOW_MODE]);
/** The playground's monotonic tick is one second; a confirmation stays open for 15 ticks. */
const TICK_MS = 1_000;
const CONFIRM_TICKS = 15;

/** Browser application of the window mode: borderless and fullscreen both use the Fullscreen API. */
function showWindowMode(value: SettingValue): Promise<void> {
  const fullscreen = value.type === 'choice' && value.value !== 'windowed';
  if (fullscreen && !document.fullscreenElement) return document.documentElement.requestFullscreen();
  if (!fullscreen && document.fullscreenElement) return document.exitFullscreen();
  return Promise.resolve();
}

interface Category {
  key: string;
  name: string;
}

export function App({
  session,
  fixture,
  webgl,
  storage,
  startupResults = [],
  urlProblems = [],
}: AppProps) {
  const localize = useMemo(() => createLocalize(fixture.localizations), [fixture]);
  const definitions = useMemo(
    () => new Map(fixture.definitions.map((definition) => [definition.id, definition])),
    [fixture],
  );
  // Canonical, registration-order-independent presentation order from the session.
  const entries = useMemo(() => session.presentation(), [session]);
  const labels = useMemo(
    () => new Map(entries.map((entry) => [entry.id, localize(entry.metadata.label_key)])),
    [entries, localize],
  );
  const categories = useMemo(() => categoriesOf(entries, localize), [entries, localize]);

  const [revision, setRevision] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(categories[0]?.key ?? '');
  // Values the running application started with; restart/reconnect settings that differ from
  // them are accepted but not yet in effect.
  const [launchValues] = useState(() => session.effectiveValues());

  const states = useMemo(() => {
    void revision;
    return new Map(session.settingStates().map((state) => [state.id, state]));
  }, [session, revision]);
  const committed = useMemo(() => {
    void revision;
    return session.effectiveValues();
  }, [session, revision]);
  const hasStaged = useMemo(() => {
    void revision;
    return session.hasStagedChanges();
  }, [session, revision]);
  const stagedCount = [...states.values()].filter((state) => state.staged).length;
  const stagedChanges = useMemo(() => {
    void revision;
    return session.stagedChanges();
  }, [session, revision]);

  useAppearance(committed);
  const graphics = useMemo(() => rendererConfig(committed), [committed]);
  const physics = useMemo(() => physicsConfig(committed), [committed]);
  // Previewed audio follows the staged values, so Cancel's revert to the committed state is heard.
  const mix = useMemo(
    () => audioMix(Object.fromEntries(PREVIEWED_AUDIO.map((id) => [id, states.get(id)?.value]))),
    [states],
  );

  const refresh = () => setRevision((value) => value + 1);
  const remount = () => setEpoch((value) => value + 1);

  // Apply with confirmation, driven by the playground's own monotonic tick (one per second while a
  // confirmation is open). The session decides pending/expired from the ticks it is given and never
  // reads a clock, so tests drive it deterministically with a fake browser clock.
  const tickRef = useRef(0);
  const [tick, setTick] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const confirming = deadline !== null;
  const [notice, setNotice] = useState<string | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const simulateFailureRef = useRef(false);
  simulateFailureRef.current = simulateFailure;
  const adapter = useMemo(() => createConsumerAdapter(() => simulateFailureRef.current), []);

  const [loadResults, setLoadResults] = useState<LoadResult[]>(startupResults);
  const [profiles, setProfiles] = useState<Profiles>(() => readProfiles(storage));

  /** The session restored the pre-apply state; undo what the browser already showed. */
  function restored(changes: SettingChange[], message: string) {
    const windowMode = changes.find((change) => change.id === WINDOW_MODE);
    if (windowMode) void showWindowMode(windowMode.after).catch(() => undefined);
    setDeadline(null);
    setNotice(message);
    remount();
    refresh();
  }

  function apply(withConfirmation: boolean) {
    const changes = session.applyStagedWithConfirmation(tickRef.current + CONFIRM_TICKS);
    try {
      adapter.apply(changes);
    } catch (cause) {
      restored(
        session.revertApplied(),
        `The consumer could not apply the changes (${errorText(cause)}); the previous values were restored.`,
      );
      return;
    }
    if (withConfirmation || changes.some((change) => RISKY.has(change.id))) {
      setDeadline(tickRef.current + CONFIRM_TICKS);
      setNotice(null);
    } else {
      session.confirmApplied(tickRef.current);
    }
    const windowMode = changes.find((change) => change.id === WINDOW_MODE);
    if (windowMode) {
      showWindowMode(windowMode.after).catch((cause: unknown) => {
        if (session.confirmationStatus(tickRef.current) === 'none') return;
        restored(
          session.revertApplied(),
          `The browser refused the display change (${errorText(cause)}); the previous values were restored.`,
        );
      });
    }
    remount();
    refresh();
  }

  function keepApplied() {
    if (session.confirmApplied(tickRef.current)) setNotice('The applied changes were kept.');
    setDeadline(null);
    refresh();
  }

  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => {
      const now = (tickRef.current += 1);
      setTick(now);
      if (session.confirmationStatus(now) === 'expired') {
        const changes = session.rollBackExpired(now);
        restored(
          changes,
          `Not confirmed in time; ${changes.length} ${changes.length === 1 ? 'change was' : 'changes were'} rolled back.`,
        );
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [deadline, session]);

  // Persist the committed durable scopes, but never an unconfirmed candidate.
  useEffect(() => {
    if (session.confirmationStatus(tickRef.current) === 'none') storeScopes(session, storage);
  }, [revision, deadline, session, storage]);

  function loaded(results: LoadResult[]) {
    setLoadResults(results);
    remount();
    refresh();
  }

  function stagePreset(preset: FixturePreset) {
    try {
      session.stagePreset({ id: preset.id, values: preset.values });
      setNotice(null);
    } catch (cause) {
      setNotice(`The ${localize(preset.label_key)} preset was rejected: ${errorText(cause)}.`);
    }
    remount();
    refresh();
  }

  function saveProfiles(next: Profiles) {
    setProfiles(next);
    writeProfiles(storage, next);
  }


  /** Immediate settings commit at once, except previewed ones, which stay staged until Apply. */
  const commitsImmediately = (definition: SettingDefinition) =>
    definition.apply_mode === 'immediate' && !PREVIEWED.has(definition.id);

  function edit(definition: SettingDefinition, value: SettingValue) {
    if (commitsImmediately(definition)) session.set(definition.id, value);
    else session.stageSet(definition.id, value);
    refresh();
  }

  function resetOne(definition: SettingDefinition) {
    if (commitsImmediately(definition)) session.reset(definition.id);
    else session.stageResetMany([definition.id]);
    remount();
    refresh();
  }

  function resetSection(categoryKey: string) {
    session.stageResetMany(
      entries.filter((entry) => entry.metadata.category_key === categoryKey).map((entry) => entry.id),
    );
    remount();
    refresh();
  }

  function resetEverything() {
    session.stageResetAll();
    remount();
    refresh();
  }


  function cancel() {
    session.cancelStaged();
    remount();
    refresh();
  }

  const pendingRuntime = fixture.definitions
    .filter((definition) => definition.apply_mode === 'restart' || definition.apply_mode === 'reconnect')
    .filter((definition) => !sameValue(committed[definition.id], launchValues[definition.id]));
  const restartPending = pendingRuntime.filter((definition) => definition.apply_mode === 'restart');
  const reconnectPending = pendingRuntime.filter((definition) => definition.apply_mode === 'reconnect');

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searching = normalizedQuery.length > 0;
  const visible = entries.filter((entry) => {
    const state = states.get(entry.id);
    if (!state || state.availability.status === 'hidden') return false;
    if (searching) return matches(entry, normalizedQuery, localize);
    return (
      entry.metadata.category_key === activeCategory &&
      (entry.metadata.discoverability ?? 'primary') !== 'search_only'
    );
  });
  const activeName = categories.find((category) => category.key === activeCategory)?.name ?? '';

  const renderRow = (entry: PresentationEntry) => {
    const definition = definitions.get(entry.id);
    const state = states.get(entry.id);
    if (!definition || !state) return null;
    return (
      <SettingRow
        key={`${entry.id}:${epoch}`}
        definition={definition}
        entry={entry}
        state={state}
        localize={localize}
        unavailableReason={unavailableReason(state, localize, labels)}
        onEdit={(value) => edit(definition, value)}
        onReset={() => resetOne(definition)}
      />
    );
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl min-w-0 flex-col gap-4 px-4 pt-6 pb-28 sm:px-6">
      <header className="grid min-w-0 gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">settings</p>
          <h1 className="text-2xl font-semibold">Settings Playground</h1>
          <p className="text-sm text-muted-foreground">
            Every value, override, provenance and availability fact comes from the settings session.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            type="search"
            aria-label="Search settings"
            placeholder="Search settings"
            className="min-w-0 flex-1 basis-56"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Button type="button" variant="outline" onClick={resetEverything}>
            Reset all settings
          </Button>
        </div>
        <DeveloperTools
          session={session}
          definitions={definitions}
          states={states}
          stagedChanges={stagedChanges}
          presets={fixture.presets ?? []}
          localize={localize}
          labels={labels}
          revision={revision}
          persisted={storage !== undefined}
          loadResults={loadResults}
          urlProblems={urlProblems}
          profiles={profiles}
          simulateFailure={simulateFailure}
          onSimulateFailure={setSimulateFailure}
          onLoaded={loaded}
          onStagePreset={stagePreset}
          onSaveProfile={(name) => saveProfiles({ ...profiles, [name]: captureProfile(session) })}
          onLoadProfile={(name) => {
            const profile = profiles[name];
            if (profile) loaded(loadProfile(session, name, profile));
          }}
          onDeleteProfile={(name) => {
            const { [name]: _removed, ...rest } = profiles;
            saveProfiles(rest);
          }}
          onClearStorage={() => {
            clearStoredScopes(storage);
            setNotice('Stored snapshots were removed; the next change stores them again.');
          }}
          onChanged={() => {
            remount();
            refresh();
          }}
        />
      </header>

      {restartPending.length > 0 && (
        <RuntimeNotice
          title="Restart required"
          text="These accepted changes take effect after the application restarts:"
          names={restartPending.map((definition) => labels.get(definition.id) ?? definition.id)}
        />
      )}
      {deadline !== null && (
        <div role="alert" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/60 p-3 text-sm">
          <p className="mr-auto min-w-0">
            Keep the applied changes? Reverting in {Math.max(0, deadline - tick)} s.
          </p>
          <Button type="button" size="sm" onClick={keepApplied}>
            Keep changes
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => restored(session.revertApplied(), 'The previous values were restored.')}
          >
            Revert now
          </Button>
        </div>
      )}
      {notice && deadline === null && (
        <p role="status" className="min-w-0 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {reconnectPending.length > 0 && (
        <RuntimeNotice
          title="Reconnect required"
          text="These accepted changes take effect after the next reconnect:"
          names={reconnectPending.map((definition) => labels.get(definition.id) ?? definition.id)}
        />
      )}

      <div className="grid min-w-0 gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Categories" className="min-w-0">
          <ul className="flex min-w-0 flex-wrap gap-1 md:flex-col">
            {categories.map((category) => (
              <li key={category.key}>
                <Button
                  type="button"
                  variant={!searching && category.key === activeCategory ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  aria-current={!searching && category.key === activeCategory ? 'page' : undefined}
                  onClick={() => {
                    setQuery('');
                    setActiveCategory(category.key);
                  }}
                >
                  {category.name}
                </Button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="grid min-w-0 content-start gap-3">
          {searching ? (
            <section aria-label="Search results" className="grid min-w-0 gap-3">
              <h2 className="text-lg font-semibold">Search results</h2>
              {visible.length === 0 && (
                <p className="text-sm text-muted-foreground">No setting matches “{query.trim()}”.</p>
              )}
              {visible.map((entry) => (
                <div key={entry.id} className="grid min-w-0 gap-1">
                  <p className="text-xs text-muted-foreground">
                    {localize(entry.metadata.category_key)}
                  </p>
                  {renderRow(entry)}
                </div>
              ))}
            </section>
          ) : (
            <section aria-label={activeName} className="grid min-w-0 gap-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{activeName}</h2>
                <Button type="button" variant="outline" size="sm" onClick={() => resetSection(activeCategory)}>
                  Reset {activeName} section
                </Button>
              </div>
              {activeCategory === GRAPHICS_CATEGORY && (
                <IntegrationBoundary id="graphics" name="3d-lab preview">
                  <GraphicsPreview config={graphics} webgl={webgl} />
                </IntegrationBoundary>
              )}
              {activeCategory === SIMULATION_CATEGORY && (
                <IntegrationBoundary id="physics" name="Physics preview">
                  <PhysicsPreview config={physics} graphics={graphics} webgl={webgl} />
                </IntegrationBoundary>
              )}
              {activeCategory === AUDIO_CATEGORY && (
                <IntegrationBoundary id="audio" name="Audio preview">
                  <AudioPreview mix={mix} sampleRate={sampleRateOf(launchValues)} />
                </IntegrationBoundary>
              )}
              {(fixture.input_bindings_surfaces ?? [])
                .filter((surface) => surface.category_key === activeCategory)
                .map((surface) => (
                  <IntegrationBoundary
                    key={surface.descriptor.surface_id}
                    id="input-bindings"
                    name="Input-bindings editor"
                  >
                    <ControlsBindings surfaceId={surface.descriptor.surface_id} />
                  </IntegrationBoundary>
                ))}
              <CategoryRows entries={visible} localize={localize} renderRow={renderRow} />
            </section>
          )}
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-wrap items-center justify-end gap-2">
          <p className="mr-auto min-w-0 text-sm text-muted-foreground">
            {hasStaged
              ? `${stagedCount} pending ${stagedCount === 1 ? 'change' : 'changes'}`
              : 'No pending changes'}
          </p>
          <Button type="button" variant="outline" disabled={!hasStaged} onClick={cancel}>
            Cancel
          </Button>
          <Button type="button" disabled={!hasStaged || confirming} onClick={() => apply(false)}>
            Apply
          </Button>
          <Button type="button" variant="secondary" disabled={!hasStaged || confirming} onClick={() => apply(true)}>
            Apply with confirmation
          </Button>
        </div>
      </div>
    </div>
  );
}

function CategoryRows({
  entries,
  localize,
  renderRow,
}: {
  entries: PresentationEntry[];
  localize: (key: string) => string;
  renderRow: (entry: PresentationEntry) => ReactNode;
}) {
  const primary = entries.filter((entry) => (entry.metadata.discoverability ?? 'primary') === 'primary');
  const advanced = entries.filter((entry) => entry.metadata.discoverability === 'advanced');
  const groups: { key: string; entries: PresentationEntry[] }[] = [];
  for (const entry of primary) {
    const key = entry.metadata.group_key ?? '';
    const last = groups.at(-1);
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, entries: [entry] });
  }
  return (
    <>
      {groups.map((group, index) => (
        <div key={`${group.key}:${index}`} className="grid min-w-0 gap-2">
          {group.key && (
            <h3 className="text-sm font-medium text-muted-foreground">{localize(group.key)}</h3>
          )}
          {group.entries.map(renderRow)}
        </div>
      ))}
      {advanced.length > 0 && (
        <div className="grid min-w-0 gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Advanced</h3>
          {advanced.map(renderRow)}
        </div>
      )}
    </>
  );
}

function RuntimeNotice({ title, text, names }: { title: string; text: string; names: string[] }) {
  return (
    <div role="status" className="min-w-0 rounded-lg border border-border bg-muted/60 p-3 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">
        {text} {names.join(', ')}.
      </p>
    </div>
  );
}

function categoriesOf(entries: PresentationEntry[], localize: (key: string) => string): Category[] {
  const seen = new Map<string, Category>();
  for (const entry of entries) {
    const key = entry.metadata.category_key;
    if ((entry.metadata.discoverability ?? 'primary') === 'search_only' || seen.has(key)) continue;
    seen.set(key, { key, name: localize(key) });
  }
  return [...seen.values()];
}

function matches(entry: PresentationEntry, query: string, localize: (key: string) => string): boolean {
  const metadata = entry.metadata;
  const haystack = [
    entry.id,
    localize(metadata.label_key),
    metadata.description_key ? localize(metadata.description_key) : '',
    ...(metadata.search_keys ?? []).map(localize),
  ];
  return haystack.some((text) => text.toLocaleLowerCase().includes(query));
}

function unavailableReason(
  state: SettingState,
  localize: (key: string) => string,
  labels: ReadonlyMap<string, string>,
): string | undefined {
  if (state.availability.status === 'available') return undefined;
  const reasons = state.availability.reasons.map((reason) => reasonText(reason, localize, labels));
  return reasons.length > 0 ? reasons.join(' ') : 'Unavailable in the current configuration.';
}

function useAppearance(values: Record<string, SettingValue>) {
  const scheme = values['appearance.color_scheme']?.value;
  const contrast = values['appearance.contrast']?.value;
  const nightMode = values['appearance.night_mode']?.value;
  const reduceMotion = values['accessibility.reduce_motion']?.value;
  const textScale = values['accessibility.text_scale']?.value;
  const [prefersDark, setPrefersDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setPrefersDark(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', scheme === 'dark' || (scheme === 'system' && prefersDark));
    root.dataset.contrast = typeof contrast === 'string' ? contrast : 'system';
    root.dataset.nightMode = String(nightMode === true);
    root.dataset.reduceMotion = String(reduceMotion === true);
    root.style.setProperty('--playground-text-scale', String(typeof textScale === 'number' ? textScale : 1));
  }, [scheme, contrast, nightMode, reduceMotion, textScale, prefersDark]);
}
