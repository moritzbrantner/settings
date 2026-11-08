// Developer tools for the persistence and transaction semantics: fixture presets and named
// profiles, canonical snapshots per durable scope, retained migration/corruption fixtures with
// their load diagnostics, transient overlays and the simulated consumer apply failure.
// Everything shown is read back from the settings session after each action.
import { useId, useState, type ReactNode } from 'react';
import type {
  BrowserSettingsSession,
  OverlayLayer,
  SettingChange,
  SettingDefinition,
  SettingState,
} from '@moritzbrantner/settings-browser';
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '@moritzbrantner/ui/stable';
import {
  DURABLE_SCOPES,
  OVERLAY_LABEL,
  OVERLAY_LAYERS,
  RETAINED_FIXTURES,
  diagnosticText,
  errorText,
  importSnapshot,
  parseValue,
  type DurableScope,
  type LoadResult,
  type Profiles,
} from './lab';
import { SCOPE_LABEL, valueLabel, type FixturePreset, type Localize } from './model';

export interface DeveloperToolsProps {
  session: BrowserSettingsSession;
  definitions: ReadonlyMap<string, SettingDefinition>;
  states: ReadonlyMap<string, SettingState>;
  stagedChanges: readonly SettingChange[];
  presets: readonly FixturePreset[];
  localize: Localize;
  labels: ReadonlyMap<string, string>;
  /** Changes whenever the session changed, so the canonical snapshots are re-read. */
  revision: number;
  persisted: boolean;
  loadResults: readonly LoadResult[];
  urlProblems: readonly string[];
  profiles: Profiles;
  simulateFailure: boolean;
  onSimulateFailure: (value: boolean) => void;
  onLoaded: (results: LoadResult[]) => void;
  onStagePreset: (preset: FixturePreset) => void;
  onSaveProfile: (name: string) => void;
  onLoadProfile: (name: string) => void;
  onDeleteProfile: (name: string) => void;
  onClearStorage: () => void;
  /** Re-read the session after an overlay edit. */
  onChanged: () => void;
}

export function DeveloperTools(props: DeveloperToolsProps) {
  return (
    <details className="min-w-0 rounded-lg border border-border bg-card/60 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Developer tools: profiles, snapshots, overlays and apply failure
      </summary>
      <div className="mt-3 grid min-w-0 gap-4 lg:grid-cols-2">
        <ProfilesPanel {...props} />
        <OverlaysPanel {...props} />
        <SnapshotsPanel {...props} />
        <ConsumerPanel {...props} />
      </div>
    </details>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid min-w-0 content-start gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ProfilesPanel({
  presets,
  profiles,
  persisted,
  localize,
  onStagePreset,
  onSaveProfile,
  onLoadProfile,
  onDeleteProfile,
  onClearStorage,
}: DeveloperToolsProps) {
  const [name, setName] = useState('');
  const nameId = useId();
  const trimmed = name.trim();
  return (
    <Panel title="Presets and profiles">
      <div className="flex min-w-0 flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant="outline"
            title={preset.description_key ? localize(preset.description_key) : undefined}
            onClick={() => onStagePreset(preset)}
          >
            Stage {localize(preset.label_key)} preset
          </Button>
        ))}
      </div>
      <form
        className="flex min-w-0 flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          onSaveProfile(trimmed);
          setName('');
        }}
      >
        <div className="grid min-w-0 flex-1 basis-40 gap-1">
          <Label htmlFor={nameId}>Profile name</Label>
          <Input id={nameId} value={name} maxLength={40} onChange={(event) => setName(event.currentTarget.value)} />
        </div>
        <Button type="submit" size="sm" disabled={!trimmed}>
          Save profile
        </Button>
      </form>
      <ul className="grid min-w-0 gap-1">
        {Object.keys(profiles)
          .sort()
          .map((profile) => (
            <li key={profile} className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="mr-auto min-w-0 break-all">{profile}</span>
              <Button type="button" size="sm" variant="outline" aria-label={`Load profile ${profile}`} onClick={() => onLoadProfile(profile)}>
                Load
              </Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Delete profile ${profile}`} onClick={() => onDeleteProfile(profile)}>
                Delete
              </Button>
            </li>
          ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {persisted
          ? 'User, Device and Save snapshots are stored in this browser and restored on reload. Session values and overlays are never stored.'
          : 'Browser storage is unavailable; settings and profiles last until reload.'}
      </p>
      {persisted && (
        <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={onClearStorage}>
          Forget stored snapshots
        </Button>
      )}
    </Panel>
  );
}

function OverlaysPanel({ session, definitions, states, localize, labels, urlProblems, onChanged }: DeveloperToolsProps) {
  const ids = [...definitions.keys()].sort();
  const [layer, setLayer] = useState<OverlayLayer>('policy');
  const [id, setId] = useState(ids[0] ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  const active = [...states.values()].flatMap((state) =>
    OVERLAY_LAYERS.flatMap((overlayLayer) => {
      const value = state.overlays[overlayLayer];
      return value ? [{ layer: overlayLayer, id: state.id, value }] : [];
    }),
  );

  function set() {
    const definition = definitions.get(id);
    if (!definition) return;
    try {
      session.setOverlay(layer, id, parseValue(definition, text));
      setError(null);
      onChanged();
    } catch (cause) {
      setError(`Overlay rejected: ${errorText(cause)}`);
    }
  }

  return (
    <Panel title="Overlays">
      <p className="text-xs text-muted-foreground">
        Precedence: policy, command line, session, durable preference, default. Overlays mask the
        durable preference without changing it and are never exported. URL form:{' '}
        <code>?policy=audio.master_volume:50</code>.
      </p>
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${baseId}-layer`}>Layer</Label>
          <NativeSelect id={`${baseId}-layer`} value={layer} onChange={(event) => setLayer(event.currentTarget.value as OverlayLayer)}>
            {OVERLAY_LAYERS.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {OVERLAY_LABEL[option]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={`${baseId}-setting`}>Setting</Label>
          <NativeSelect id={`${baseId}-setting`} value={id} onChange={(event) => setId(event.currentTarget.value)}>
            {ids.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {option}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-w-0 flex-1 basis-24 gap-1">
          <Label htmlFor={`${baseId}-value`}>Overlay value</Label>
          <Input
            id={`${baseId}-value`}
            value={text}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') set();
            }}
          />
        </div>
        <Button type="button" size="sm" onClick={set}>
          Set overlay
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {urlProblems.map((problem) => (
        <p key={problem} className="text-destructive">
          {problem}
        </p>
      ))}
      <ul aria-label="Active overlays" className="grid min-w-0 gap-1">
        {active.map((overlay) => (
          <li key={`${overlay.layer}:${overlay.id}`} className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline">{OVERLAY_LABEL[overlay.layer]}</Badge>
            <span className="mr-auto min-w-0 break-all">
              {labels.get(overlay.id) ?? overlay.id} = {valueLabel(localize, overlay.id, overlay.value)}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Clear ${OVERLAY_LABEL[overlay.layer]} overlay on ${overlay.id}`}
              onClick={() => {
                session.clearOverlay(overlay.layer, overlay.id);
                onChanged();
              }}
            >
              Clear
            </Button>
          </li>
        ))}
      </ul>
      {active.length > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() => {
            session.clearOverlays();
            onChanged();
          }}
        >
          Clear all overlays
        </Button>
      )}
    </Panel>
  );
}

function SnapshotsPanel({ session, revision, loadResults, labels, onLoaded }: DeveloperToolsProps) {
  const [scope, setScope] = useState<DurableScope>('user');
  const [draft, setDraft] = useState('');
  const baseId = useId();
  void revision;
  const canonical = session.exportScope(scope);
  return (
    <Panel title="Snapshots and migration">
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${baseId}-scope`}>Snapshot scope</Label>
          <NativeSelect id={`${baseId}-scope`} value={scope} onChange={(event) => setScope(event.currentTarget.value as DurableScope)}>
            {DURABLE_SCOPES.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {SCOPE_LABEL[option]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setDraft(canonical)}>
          Copy to editor
        </Button>
      </div>
      <pre
        aria-label="Canonical snapshot"
        data-testid="canonical-snapshot"
        className="max-h-48 min-w-0 overflow-auto rounded-md bg-muted/60 p-2 text-xs break-all whitespace-pre-wrap"
      >
        {canonical}
      </pre>
      <Label htmlFor={`${baseId}-draft`}>Snapshot to import</Label>
      <Textarea
        id={`${baseId}-draft`}
        className="min-h-24 font-mono text-xs"
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
      <Button
        type="button"
        size="sm"
        className="justify-self-start"
        disabled={!draft.trim()}
        onClick={() => onLoaded([importSnapshot(session, scope, draft, 'Pasted')])}
      >
        Import into {SCOPE_LABEL[scope]}
      </Button>
      <p className="text-xs text-muted-foreground">Retained fixtures (fixtures/persistence):</p>
      <div className="flex min-w-0 flex-wrap gap-2">
        {RETAINED_FIXTURES.map((fixture) => (
          <Button
            key={fixture.id}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setScope(fixture.scope);
              onLoaded([importSnapshot(session, fixture.scope, fixture.snapshot, fixture.id)]);
            }}
          >
            Load {fixture.label}
          </Button>
        ))}
      </div>
      <LoadReport results={loadResults} labels={labels} />
    </Panel>
  );
}

function LoadReport({ results, labels }: { results: readonly LoadResult[]; labels: ReadonlyMap<string, string> }) {
  return (
    <div role="status" aria-label="Import report" className="grid min-w-0 gap-2">
      {results.map((result) => {
        const where = `${result.source} → ${SCOPE_LABEL[result.scope]}`;
        if (result.error !== undefined) {
          return (
            <p key={where} className="text-destructive">
              {where}: not loaded, {result.error}. Nothing in this scope changed.
            </p>
          );
        }
        const report = result.report!;
        const rejected = report.diagnostics;
        return (
          <div key={where} className="grid min-w-0 gap-1 rounded-md border border-border/70 p-2">
            <p className="font-medium">{where}</p>
            {report.migrations.map((migration) => (
              <p key={migration.from_version}>
                Migrated schema v{migration.from_version} → v{migration.to_version}.
              </p>
            ))}
            <p>
              Loaded:{' '}
              {report.loaded.length > 0
                ? report.loaded.map((id) => labels.get(id) ?? id).join(', ')
                : 'no overrides'}
              .
            </p>
            {rejected.length > 0 && (
              <ul aria-label="Diagnostics" className="list-disc pl-5">
                {rejected.map((diagnostic, index) => (
                  <li key={index} data-diagnostic={diagnostic.type} className="break-words">
                    {diagnosticText(diagnostic)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConsumerPanel({ stagedChanges, labels, localize, simulateFailure, onSimulateFailure }: DeveloperToolsProps) {
  const id = useId();
  return (
    <Panel title="Consumer apply">
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={simulateFailure} onCheckedChange={(checked) => onSimulateFailure(checked === true)} />
        <Label htmlFor={id}>Simulate consumer apply failure</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        The playground’s consumer adapter rejects the next Apply, which then reverts to the state before it.
      </p>
      <h3 className="font-medium">Pending changes</h3>
      {stagedChanges.length === 0 ? (
        <p className="text-muted-foreground">None.</p>
      ) : (
        <ul aria-label="Pending changes" className="grid min-w-0 gap-0.5">
          {stagedChanges.map((change) => (
            <li key={change.id} className="break-words">
              {labels.get(change.id) ?? change.id}: {valueLabel(localize, change.id, change.before)} →{' '}
              {valueLabel(localize, change.id, change.after)}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
