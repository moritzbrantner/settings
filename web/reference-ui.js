import { createSettingsSession } from './settings-browser.js';

const root = document.querySelector('#settings-root');
const searchInput = document.querySelector('#settings-search');
const advancedInput = document.querySelector('#show-advanced');
const status = document.querySelector('#status');

let session;
let fixture;
let definitions;

initialize().catch((error) => {
  root.textContent = 'The reference settings UI could not be initialized.';
  status.textContent = String(error);
});

async function initialize() {
  const response = await fetch('./reference-settings.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`failed to load reference fixture: ${response.status}`);
  }

  fixture = await response.json();
  definitions = new Map(
    fixture.definitions.map((definition) => [definition.id, definition]),
  );
  session = await createSettingsSession(
    fixture.definitions,
    fixture.presentation,
  );

  searchInput.addEventListener('input', render);
  advancedInput.addEventListener('change', render);
  render();
}

function localize(key) {
  return key ? (fixture.localizations[key] ?? key) : '';
}

function render() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const showAdvanced = advancedInput.checked;
  const values = session.effectiveValues();
  const entries = session.presentation().filter((entry) => {
    const metadata = entry.metadata;
    if (!query) {
      if (metadata.discoverability === 'search_only') return false;
      if (metadata.discoverability === 'advanced' && !showAdvanced) return false;
      return true;
    }

    const searchable = [
      entry.id,
      localize(metadata.label_key),
      localize(metadata.description_key),
      ...(metadata.search_keys ?? []).map(localize),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return searchable.includes(query);
  });

  root.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No settings match the current filters.';
    root.append(empty);
    return;
  }

  const categories = new Map();
  for (const entry of entries) {
    const categoryKey = entry.metadata.category_key;
    const groupKey = entry.metadata.group_key ?? '';
    const groups = categories.get(categoryKey) ?? new Map();
    const groupEntries = groups.get(groupKey) ?? [];
    groupEntries.push(entry);
    groups.set(groupKey, groupEntries);
    categories.set(categoryKey, groups);
  }

  for (const [categoryKey, groups] of categories) {
    const category = document.createElement('section');
    category.className = 'category';
    const heading = document.createElement('h2');
    heading.textContent = localize(categoryKey);
    category.append(heading);

    for (const [groupKey, groupEntries] of groups) {
      const group = document.createElement('section');
      group.className = 'group';
      if (groupKey) {
        const groupHeading = document.createElement('h3');
        groupHeading.textContent = localize(groupKey);
        group.append(groupHeading);
      }
      for (const entry of groupEntries) {
        group.append(createSettingRow(entry, values[entry.id]));
      }
      category.append(group);
    }
    root.append(category);
  }
}

function createSettingRow(entry, value) {
  const definition = definitions.get(entry.id);
  const row = document.createElement('div');
  row.className = 'setting-row';

  const copy = document.createElement('div');
  copy.className = 'setting-copy';
  const label = document.createElement('span');
  label.className = 'setting-label';
  label.textContent = localize(entry.metadata.label_key);
  const description = document.createElement('p');
  description.className = 'setting-description';
  description.textContent = localize(entry.metadata.description_key);
  const metadata = document.createElement('div');
  metadata.className = 'setting-meta';
  metadata.textContent = `${entry.id} · ${definition.scope} · ${definition.apply_mode}`;
  copy.append(label, description, metadata);

  const control = document.createElement('div');
  control.className = 'setting-control';
  control.append(createValueControl(entry.id, definition, value));

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => {
    session.reset(entry.id);
    status.textContent = `${localize(entry.metadata.label_key)} reset to its consumer default.`;
    render();
  });
  control.append(reset);

  row.append(copy, control);
  return row;
}

function createValueControl(id, definition, value) {
  switch (definition.kind.type) {
    case 'bool': {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value.value;
      input.setAttribute('aria-label', localizeLabel(id));
      input.addEventListener('change', () => {
        setValue(id, { type: 'bool', value: input.checked });
      });
      return input;
    }
    case 'integer':
      return createNumericControl(id, definition.kind, value, true);
    case 'number':
      return createNumericControl(id, definition.kind, value, false);
    case 'choice': {
      const select = document.createElement('select');
      select.setAttribute('aria-label', localizeLabel(id));
      for (const optionValue of definition.kind.options) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        option.selected = optionValue === value.value;
        select.append(option);
      }
      select.addEventListener('change', () => {
        setValue(id, { type: 'choice', value: select.value });
      });
      return select;
    }
    case 'text': {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value.value;
      input.setAttribute('aria-label', localizeLabel(id));
      input.addEventListener('change', () => {
        setValue(id, { type: 'text', value: input.value });
      });
      return input;
    }
    default: {
      const unsupported = document.createElement('span');
      unsupported.textContent = `Unsupported control: ${definition.kind.type}`;
      return unsupported;
    }
  }
}

function createNumericControl(id, kind, value, integer) {
  const wrapper = document.createElement('span');
  wrapper.className = 'setting-control';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(kind.min);
  input.max = String(kind.max);
  input.step = integer ? '1' : 'any';
  input.value = String(value.value);
  input.setAttribute('aria-label', localizeLabel(id));
  const output = document.createElement('output');
  output.value = String(value.value);
  input.addEventListener('input', () => {
    output.value = input.value;
  });
  input.addEventListener('change', () => {
    const numericValue = integer ? Number.parseInt(input.value, 10) : Number(input.value);
    setValue(id, { type: integer ? 'integer' : 'number', value: numericValue });
  });
  wrapper.append(input, output);
  return wrapper;
}

function localizeLabel(id) {
  const entry = session.presentation().find((candidate) => candidate.id === id);
  return entry ? localize(entry.metadata.label_key) : id;
}

function setValue(id, value) {
  session.set(id, value);
  status.textContent = `${localizeLabel(id)} updated.`;
  render();
}
