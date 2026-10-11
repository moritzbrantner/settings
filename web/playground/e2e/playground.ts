// Shared helpers for the Settings Playground acceptance journeys (issue #22).
//
// Seams the playground must provide (accessible roles/names first, one data attribute):
// - It is served at the Playwright baseURL root and fetches its settings fixture at runtime from a
//   URL ending in `playground-settings.json` (the bytes of fixtures/presentation/playground.json).
// - A level-1 heading containing "Playground", a `main` landmark, a `searchbox` named /search/i and
//   a `navigation` landmark named /categor/i whose links/buttons/tabs carry the localized category
//   names. On narrow screens the navigation may be behind a button named /categor|menu|navigation/i.
// - One element per rendered setting with `data-setting-id="<setting id>"` (the attribute the React
//   bridge already emits); nested duplicates are allowed, the outermost one is the row.
// - Inside the row, the value control is named by the localized label:
//     bool -> switch|checkbox; integer/number -> exact-entry spinbutton|textbox (a slider is
//     optional); text -> textbox; choice -> combobox (native or listbox popup) | radiogroup.
//   A per-setting button named /reset/i. The row text shows scope and apply mode, the word
//   "Modified" only while the setting has an override, and "default" provenance otherwise.
// - Rejected entries leave the authoritative value unchanged and mark the field aria-invalid="true"
//   (or revert it to the committed value).
// - Staged changes surface buttons named /^apply/i and /^cancel/i; restart/reconnect requirements
//   appear in a role=status|alert notice. Section reset: a button whose name contains "reset" and
//   "section" or "category"; global reset: a button named /reset (all|everything)/i.
import { expect, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type SettingKind =
  | { type: 'bool' }
  | { type: 'integer'; min: number; max: number }
  | { type: 'number'; min: number; max: number }
  | { type: 'text'; min_chars: number; max_chars: number }
  | { type: 'choice'; options: string[] };

export interface Definition {
  id: string;
  kind: SettingKind;
  default: { type: string; value: boolean | number | string };
  scope: 'session' | 'save' | 'device' | 'user';
  apply_mode: 'immediate' | 'apply' | 'restart' | 'reconnect';
  availability?: unknown;
}

export interface Entry {
  id: string;
  metadata: {
    label_key: string;
    description_key?: string;
    category_key: string;
    group_key?: string;
    order?: number;
    discoverability?: 'primary' | 'advanced' | 'search_only';
    search_keys?: string[];
  };
}

export interface Fixture {
  definitions: Definition[];
  presentation: Entry[];
  localizations: Record<string, string>;
}

export const FIXTURE_ROUTE = '**/playground-settings.json';

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'fixtures', 'presentation', 'reference.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`settings repository root not found from ${start}`);
    dir = parent;
  }
}

export const repoRoot = findRepoRoot(process.cwd());
export const fixturePath = join(repoRoot, 'fixtures', 'presentation', 'playground.json');

function loadFixture(): Fixture {
  if (!existsSync(fixturePath)) {
    // Keep test collection working so every journey reports the missing seam.
    return { definitions: [], presentation: [], localizations: {} };
  }
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
}

export const fixture = loadFixture();

export function requireFixture(): void {
  expect(
    existsSync(fixturePath),
    'fixtures/presentation/playground.json must define the playground settings',
  ).toBe(true);
}

export const t = (key: string): string => fixture.localizations[key] ?? key;

export function entryOf(id: string): Entry {
  const entry = fixture.presentation.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`no presentation entry for ${id}`);
  return entry;
}

export const label = (id: string): string => t(entryOf(id).metadata.label_key);
export const categoryOf = (id: string): string => t(entryOf(id).metadata.category_key);
export const discoverability = (id: string) => entryOf(id).metadata.discoverability ?? 'primary';

/** Primary, ungated settings sorted by id (deterministic picks independent of fixture order). */
export function editablePrimary(): Definition[] {
  return fixture.definitions
    .filter((definition) => definition.availability === undefined || definition.availability === null)
    .filter((definition) => discoverability(definition.id) === 'primary')
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function pick(predicate: (definition: Definition) => boolean, what: string): Definition {
  requireFixture();
  const found = editablePrimary().find(predicate);
  if (!found) throw new Error(`playground fixture has no editable primary ${what}`);
  return found;
}

export function categoryNames(): string[] {
  const names = new Set<string>();
  for (const entry of fixture.presentation) {
    if ((entry.metadata.discoverability ?? 'primary') === 'primary') {
      names.add(t(entry.metadata.category_key));
    }
  }
  return [...names];
}

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function openPlayground(page: Page): Promise<void> {
  requireFixture();
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/playground/i);
  await expect(page.locator('[data-setting-id]').first()).toBeVisible();
}

export const categoryNav = (page: Page) => page.getByRole('navigation', { name: /categor/i });

export function categoryItems(page: Page): Locator {
  const nav = categoryNav(page);
  return nav.getByRole('link').or(nav.getByRole('button')).or(nav.getByRole('tab'));
}

export async function revealCategoryNav(page: Page): Promise<void> {
  const nav = categoryNav(page);
  if (await nav.isVisible()) return;
  await page.getByRole('button', { name: /categor|menu|navigation/i }).first().click();
  await expect(nav).toBeVisible();
}

export async function openCategory(page: Page, name: string): Promise<void> {
  await revealCategoryNav(page);
  const nav = categoryNav(page);
  const named = new RegExp(`^\\s*${escapeRegExp(name)}`, 'i');
  const item = nav
    .getByRole('link', { name: named })
    .or(nav.getByRole('button', { name: named }))
    .or(nav.getByRole('tab', { name: named }))
    .first();
  await item.click();
}

export const searchBox = (page: Page) => page.getByRole('searchbox', { name: /search/i });

export async function clearSearch(page: Page): Promise<void> {
  const box = searchBox(page);
  if ((await box.inputValue()) !== '') await box.fill('');
}

export async function searchFor(page: Page, query: string): Promise<void> {
  await searchBox(page).fill(query);
}

export const row = (page: Page, id: string): Locator =>
  page.locator(`[data-setting-id="${id}"]`).first();

export async function gotoSetting(page: Page, definition: Definition): Promise<Locator> {
  await clearSearch(page);
  await openCategory(page, categoryOf(definition.id));
  const settingRow = row(page, definition.id);
  await settingRow.scrollIntoViewIfNeeded();
  await expect(settingRow).toBeVisible();
  return settingRow;
}

/** Leave the category and come back so the row re-renders from the settings session. */
export async function revisit(page: Page, definition: Definition): Promise<Locator> {
  const here = categoryOf(definition.id);
  const elsewhere = categoryNames().find((name) => name !== here);
  if (elsewhere) await openCategory(page, elsewhere);
  return gotoSetting(page, definition);
}

export function boolControl(settingRow: Locator, definition: Definition): Locator {
  const name = label(definition.id);
  return settingRow.getByRole('switch', { name }).or(settingRow.getByRole('checkbox', { name })).first();
}

export function exactField(settingRow: Locator, definition: Definition): Locator {
  const name = label(definition.id);
  return settingRow
    .getByRole('spinbutton', { name })
    .or(settingRow.getByRole('textbox', { name }))
    .first();
}

export function textField(settingRow: Locator, definition: Definition): Locator {
  return settingRow.getByRole('textbox', { name: label(definition.id) }).first();
}

export function choiceControl(settingRow: Locator, definition: Definition): Locator {
  const name = label(definition.id);
  return settingRow
    .getByRole('combobox', { name })
    .or(settingRow.getByRole('radiogroup', { name }))
    .first();
}

export function primaryControl(settingRow: Locator, definition: Definition): Locator {
  switch (definition.kind.type) {
    case 'bool':
      return boolControl(settingRow, definition);
    case 'integer':
    case 'number':
      return exactField(settingRow, definition);
    case 'text':
      return textField(settingRow, definition);
    case 'choice':
      return choiceControl(settingRow, definition);
  }
}

export async function readValue(settingRow: Locator, definition: Definition): Promise<string> {
  switch (definition.kind.type) {
    case 'bool':
      return String(await boolControl(settingRow, definition).isChecked());
    case 'integer':
    case 'number':
      return String(Number((await exactField(settingRow, definition).inputValue()).trim()));
    case 'text':
      return textField(settingRow, definition).inputValue();
    case 'choice': {
      const control = choiceControl(settingRow, definition);
      return control.evaluate((element) => {
        if (element instanceof HTMLSelectElement) return element.value;
        if (element.getAttribute('role') === 'radiogroup') {
          const checked = element.querySelector<HTMLElement>(
            'input:checked, [aria-checked="true"], [data-state="checked"]',
          );
          return checked?.getAttribute('value') ?? checked?.textContent?.trim() ?? '';
        }
        return (element.textContent ?? '').trim();
      });
    }
  }
}

/** Type into an exact-entry field and commit with Enter followed by blur. */
export async function enterText(field: Locator, text: string): Promise<void> {
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.press('Backspace');
  if (text) await field.pressSequentially(text);
  await field.press('Enter');
  await field.blur();
}

export const applyButton = (page: Page) => page.getByRole('button', { name: /^\s*apply\b/i }).first();
export const cancelButton = (page: Page) =>
  page.getByRole('button', { name: /^\s*cancel\b/i }).first();

export async function expectNoEnabledButton(button: Locator): Promise<void> {
  if ((await button.count()) === 0) return;
  if (!(await button.isVisible())) return;
  await expect(button).toBeDisabled();
}

/** Commit staged changes if the playground is currently offering Apply. */
export async function applyIfStaged(page: Page): Promise<void> {
  const apply = applyButton(page);
  if ((await apply.count()) === 0 || !(await apply.isVisible()) || !(await apply.isEnabled())) {
    return;
  }
  await apply.click();
  await expectNoEnabledButton(apply);
}

/** Row text without controls, buttons, label and description: scope/mode/provenance/state. */
export async function statusText(settingRow: Locator, definition: Definition): Promise<string> {
  const entry = entryOf(definition.id);
  const strip = [t(entry.metadata.label_key)];
  if (entry.metadata.description_key) strip.push(t(entry.metadata.description_key));
  return settingRow.evaluate((element, stripped) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll(
        'button, input, select, textarea, option, label, output, [role="switch"], [role="slider"], [role="combobox"], [role="checkbox"], [role="radiogroup"], [role="spinbutton"], [role="textbox"], [role="listbox"]',
      )
      .forEach((node) => node.remove());
    let text = clone.textContent ?? '';
    for (const value of stripped) text = text.split(value).join(' ');
    return text.replace(/\s+/g, ' ').trim();
  }, strip);
}

const MODIFIED = /\bmodified\b/i;

export async function expectModified(settingRow: Locator, definition: Definition): Promise<void> {
  await expect.poll(() => statusText(settingRow, definition)).toMatch(MODIFIED);
}

export async function expectAtDefault(settingRow: Locator, definition: Definition): Promise<void> {
  await expect.poll(() => statusText(settingRow, definition)).not.toMatch(MODIFIED);
  await expect.poll(() => statusText(settingRow, definition)).toMatch(/default/i);
}

/** Choose a choice option different from the current one; returns the value as readValue sees it. */
export async function chooseDifferent(
  page: Page,
  settingRow: Locator,
  definition: Definition,
): Promise<void> {
  if (definition.kind.type !== 'choice') throw new Error('not a choice setting');
  const options = definition.kind.options;
  const control = choiceControl(settingRow, definition);
  const tag = await control.evaluate((element) => element.tagName);
  const role = await control.getAttribute('role');
  if (tag === 'SELECT') {
    const values = await control.locator('option').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value),
    );
    expect(values).toEqual(options);
    const current = await control.inputValue();
    await control.selectOption(options.find((option) => option !== current)!);
    return;
  }
  if (role === 'radiogroup') {
    const radios = control.getByRole('radio');
    await expect(radios).toHaveCount(options.length);
    const count = await radios.count();
    for (let index = 0; index < count; index += 1) {
      if (!(await radios.nth(index).isChecked())) {
        await radios.nth(index).click();
        return;
      }
    }
    throw new Error('no unchecked radio option');
  }
  await control.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const items = listbox.getByRole('option');
  await expect(items).toHaveCount(options.length);
  const count = await items.count();
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const selected =
      (await item.getAttribute('aria-selected')) === 'true' ||
      (await item.getAttribute('data-state')) === 'checked';
    if (!selected) {
      await item.click();
      return;
    }
  }
  throw new Error('no unselected option');
}

export function differentText(definition: Definition, length?: number): string {
  if (definition.kind.type !== 'text') throw new Error('not a text setting');
  const { min_chars: min, max_chars: max } = definition.kind;
  const target = Math.min(max, Math.max(min, length ?? Math.min(max, 12)));
  let candidate = 'Playground'.repeat(Math.ceil(target / 10) + 1).slice(0, target);
  if (candidate === definition.default.value) candidate = 'Z'.repeat(target);
  return candidate;
}

/** Edit any kind to a valid non-default value through its control. Does not press Apply. */
export async function editToNonDefault(
  page: Page,
  settingRow: Locator,
  definition: Definition,
): Promise<void> {
  const kind = definition.kind;
  switch (kind.type) {
    case 'bool':
      await boolControl(settingRow, definition).click();
      return;
    case 'integer': {
      const current = Number(definition.default.value);
      const next = current + 1 <= kind.max ? current + 1 : current - 1;
      await enterText(exactField(settingRow, definition), String(next));
      return;
    }
    case 'number': {
      const current = Number(definition.default.value);
      const next =
        current < kind.max ? current + (kind.max - current) / 2 : current - (current - kind.min) / 2;
      await enterText(exactField(settingRow, definition), String(Number(next.toPrecision(12))));
      return;
    }
    case 'text':
      await enterText(textField(settingRow, definition), differentText(definition));
      return;
    case 'choice':
      await chooseDifferent(page, settingRow, definition);
      return;
  }
}

/** A rejected entry leaves the field invalid or reverted, and the setting not overridden. */
export async function expectRejected(
  page: Page,
  settingRow: Locator,
  definition: Definition,
  field: Locator,
  committed: string,
): Promise<void> {
  const invalid = (await field.getAttribute('aria-invalid')) === 'true';
  if (!invalid) {
    expect(await readValue(settingRow, definition), 'rejected entry must revert the field').toBe(
      committed,
    );
  }
  await applyIfStaged(page);
  await expect.poll(() => statusText(settingRow, definition)).not.toMatch(MODIFIED);
}

/** The field references a visible, non-empty validation message. */
export async function expectValidationMessage(field: Locator): Promise<void> {
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  const ids = [
    ...((await field.getAttribute('aria-errormessage')) ?? '').split(/\s+/),
    ...((await field.getAttribute('aria-describedby')) ?? '').split(/\s+/),
  ].filter(Boolean);
  const texts = await field.page().evaluate(
    (refs) =>
      refs
        .map((id) => document.getElementById(id))
        .filter((node): node is HTMLElement => !!node && node.getClientRects().length > 0)
        .map((node) => node.textContent?.trim() ?? ''),
    ids,
  );
  expect(texts.some((text) => text.length > 0), 'invalid field must reference a visible message').toBe(
    true,
  );
}

export async function confirmIfAsked(page: Page): Promise<void> {
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
  try {
    await dialog.waitFor({ state: 'visible', timeout: 1_500 });
  } catch {
    return;
  }
  await dialog.getByRole('button', { name: /reset|confirm|yes|continue/i }).first().click();
  await expect(dialog).toBeHidden();
}

export async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
}
