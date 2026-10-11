// Settings Playground shell: category navigation, search, staged Apply/Cancel, restart/reconnect
// notices and per-setting, section and global reset. Every value, override, provenance and
// availability fact comes from the settings session; this component only decides presentation
// and routes edits by apply mode (immediate edits commit, all others are staged).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  BrowserSettingsSession,
  PresentationEntry,
  SettingDefinition,
  SettingState,
  SettingValue,
} from '@moritzbrantner/settings-browser';
import { Button, Input } from '@moritzbrantner/ui/stable';
import { SettingRow } from './SettingRow';
import { createLocalize, reasonText, sameValue, type PlaygroundFixture } from './model';

export interface AppProps {
  session: BrowserSettingsSession;
  fixture: PlaygroundFixture;
}

interface Category {
  key: string;
  name: string;
}

export function App({ session, fixture }: AppProps) {
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

  useAppearance(committed);

  const refresh = () => setRevision((value) => value + 1);
  const remount = () => setEpoch((value) => value + 1);

  function edit(definition: SettingDefinition, value: SettingValue) {
    if (definition.apply_mode === 'immediate') session.set(definition.id, value);
    else session.stageSet(definition.id, value);
    refresh();
  }

  function resetOne(definition: SettingDefinition) {
    if (definition.apply_mode === 'immediate') session.reset(definition.id);
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

  function apply() {
    session.applyStaged();
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
      </header>

      {restartPending.length > 0 && (
        <RuntimeNotice
          title="Restart required"
          text="These accepted changes take effect after the application restarts:"
          names={restartPending.map((definition) => labels.get(definition.id) ?? definition.id)}
        />
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
          <Button type="button" disabled={!hasStaged} onClick={apply}>
            Apply
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
