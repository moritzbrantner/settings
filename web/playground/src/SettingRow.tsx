// One setting row: a typed control, scope/apply-mode/provenance/modified state, availability
// reason and a per-setting reset. Values are always read from the settings session; edits are
// handed to the caller, which routes them through the session and reports rejection.
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import type {
  PresentationEntry,
  SettingDefinition,
  SettingState,
  SettingValue,
} from '@moritzbrantner/settings-browser';
import { SettingsBooleanField } from '@moritzbrantner/settings-browser/react';
import { Badge, Button, Input, NativeSelect, NativeSelectOption, Slider } from '@moritzbrantner/ui/stable';
import {
  MODE_LABEL,
  PROVENANCE_LABEL,
  SCOPE_LABEL,
  optionLabel,
  parseExact,
  rangeMessage,
  sliderStep,
  type Localize,
} from './model';

export interface SettingRowProps {
  definition: SettingDefinition;
  entry: PresentationEntry;
  state: SettingState;
  localize: Localize;
  unavailableReason?: string;
  /** Route an edit through the session; throws when the session rejects the value. */
  onEdit: (value: SettingValue) => void;
  onReset: () => void;
}

export function SettingRow({
  definition,
  entry,
  state,
  localize,
  unavailableReason,
  onEdit,
  onReset,
}: SettingRowProps) {
  const baseId = useId();
  const label = localize(entry.metadata.label_key);
  const description = entry.metadata.description_key
    ? localize(entry.metadata.description_key)
    : undefined;
  const disabled = state.availability.status === 'disabled';
  const ids = { control: `${baseId}-control`, description: `${baseId}-description` };

  const meta = (
    <RowMeta
      definition={definition}
      state={state}
      label={label}
      unavailableReason={unavailableReason}
      onReset={onReset}
    />
  );

  if (definition.kind.type === 'bool' && state.value.type === 'bool') {
    return (
      <article
        data-setting-id={definition.id}
        className="grid min-w-0 gap-2 rounded-lg border border-border/70 bg-card/70 p-3"
      >
        <SettingsBooleanField
          definition={definition as SettingDefinition & { kind: { type: 'bool' } }}
          presentation={entry}
          value={state.value}
          localize={localize}
          disabled={disabled}
          onValueChange={(checked) => onEdit({ type: 'bool', value: checked })}
          className="border-0 bg-transparent p-0 shadow-none"
        />
        {meta}
      </article>
    );
  }

  return (
    <article
      data-setting-id={definition.id}
      className="grid min-w-0 gap-2 rounded-lg border border-border/70 bg-card/70 p-3"
    >
      <div className="grid min-w-0 gap-1">
        <label htmlFor={ids.control} className="text-sm font-medium leading-snug">
          {label}
        </label>
        {description && (
          <p id={ids.description} className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Control
        definition={definition}
        state={state}
        label={label}
        localize={localize}
        disabled={disabled}
        controlId={ids.control}
        descriptionId={description ? ids.description : undefined}
        onEdit={onEdit}
      />
      {meta}
    </article>
  );
}

function RowMeta({
  definition,
  state,
  label,
  unavailableReason,
  onReset,
}: {
  definition: SettingDefinition;
  state: SettingState;
  label: string;
  unavailableReason?: string;
  onReset: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {/* Explicit spaces keep the badges separate words for text and assistive technology. */}
      <Badge variant="outline">{SCOPE_LABEL[definition.scope]}</Badge>{' '}
      <Badge variant="outline">{MODE_LABEL[definition.apply_mode]}</Badge>{' '}
      {state.overridden ? (
        <Badge variant="secondary">Modified · {PROVENANCE_LABEL[state.provenance.type]}</Badge>
      ) : (
        <Badge variant="ghost">{PROVENANCE_LABEL[state.provenance.type]}</Badge>
      )}{' '}
      {state.staged && <Badge variant="default">Pending</Badge>}{' '}
      {unavailableReason && (
        <span className="basis-full text-xs text-muted-foreground">{unavailableReason}</span>
      )}{' '}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto"
        aria-label={`Reset ${label} to default`}
        disabled={!state.overridden}
        onClick={onReset}
      >
        Reset
      </Button>
    </div>
  );
}

interface ControlProps {
  definition: SettingDefinition;
  state: SettingState;
  label: string;
  localize: Localize;
  disabled: boolean;
  controlId: string;
  descriptionId?: string;
  onEdit: (value: SettingValue) => void;
}

function Control(props: ControlProps) {
  const { definition, state, localize, disabled, controlId, descriptionId, onEdit } = props;
  const kind = definition.kind;
  if (kind.type === 'choice' && state.value.type === 'choice') {
    return (
      <NativeSelect
        id={controlId}
        className="w-full max-w-xs"
        value={state.value.value}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => onEdit({ type: 'choice', value: event.currentTarget.value })}
      >
        {kind.options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {optionLabel(localize, definition.id, option)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  if (kind.type === 'integer' || kind.type === 'number' || kind.type === 'text') {
    return <ExactField {...props} />;
  }
  return null;
}

/** Precision-first exact entry: the typed text is committed on Enter or blur, never clamped. */
function ExactField({
  definition,
  state,
  label,
  disabled,
  controlId,
  descriptionId,
  onEdit,
}: ControlProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${controlId}-error`;
  const current = state.value.value;
  const shown = draft ?? String(current);
  const kind = definition.kind;
  const numeric = kind.type === 'integer' || kind.type === 'number';
  const step = sliderStep(definition);

  function commit() {
    if (draft === null) return;
    const parsed = parseExact(definition, draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    try {
      onEdit(parsed.value);
    } catch {
      setError(rangeMessage(definition));
      return;
    }
    setDraft(null);
    setError(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDraft(null);
      setError(null);
    }
  }

  const describedBy = [descriptionId, error ? errorId : undefined].filter(Boolean).join(' ');
  let slider: ReactNode = null;
  if (numeric && step !== undefined && typeof current === 'number') {
    slider = (
      <Slider
        className="min-w-0 flex-1"
        min={kind.min}
        max={kind.max}
        step={step}
        value={[current]}
        disabled={disabled}
        thumbAriaLabel={`${label} slider`}
        onValueChange={([next]) => {
          if (next === undefined || next === current) return;
          setDraft(null);
          setError(null);
          onEdit(
            kind.type === 'integer'
              ? { type: 'integer', value: Math.round(next) }
              : { type: 'number', value: next },
          );
        }}
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Input
          id={controlId}
          type="text"
          inputMode={kind.type === 'integer' ? 'numeric' : kind.type === 'number' ? 'decimal' : 'text'}
          autoComplete="off"
          spellCheck={kind.type === 'text'}
          className={numeric ? 'w-40 max-w-full tabular-nums' : 'w-full max-w-sm'}
          value={shown}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          aria-errormessage={error ? errorId : undefined}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
        {slider}
      </div>
      {numeric && (
        <p className="text-xs text-muted-foreground">
          Range {kind.min} to {kind.max}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
