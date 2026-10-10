import { expect, test, type Page } from '@playwright/test';
import {
  applyIfStaged,
  enterText,
  exactField,
  expectModified,
  expectRejected,
  expectValidationMessage,
  gotoSetting,
  openPlayground,
  pick,
  readValue,
  revisit,
  statusText,
  type Definition,
} from './playground';

const integerSetting = () =>
  pick((d) => d.kind.type === 'integer' && d.kind.max - d.kind.min >= 2, 'integer setting');
const numberSetting = () =>
  pick((d) => d.kind.type === 'number' && d.kind.max > d.kind.min, 'number setting');

function bounds(definition: Definition): { min: number; max: number } {
  if (definition.kind.type !== 'integer' && definition.kind.type !== 'number') {
    throw new Error('not numeric');
  }
  return { min: definition.kind.min, max: definition.kind.max };
}

async function acceptsExactly(page: Page, definition: Definition, text: string): Promise<void> {
  let settingRow = await gotoSetting(page, definition);
  await enterText(exactField(settingRow, definition), text);
  await applyIfStaged(page);
  settingRow = await revisit(page, definition);
  expect(Number(await readValue(settingRow, definition)), `${text} is kept exactly`).toBe(Number(text));
  const isDefault = Number(text) === Number(definition.default.value);
  if (!isDefault) await expectModified(settingRow, definition);
  else expect(await statusText(settingRow, definition)).not.toMatch(/\bmodified\b/i);
}

async function rejects(page: Page, definition: Definition, text: string): Promise<void> {
  const settingRow = await gotoSetting(page, definition);
  const field = exactField(settingRow, definition);
  await enterText(field, text);
  await expectRejected(page, settingRow, definition, field, String(Number(definition.default.value)));
}

test('integer exact entry accepts both bounds', async ({ page }) => {
  await openPlayground(page);
  const definition = integerSetting();
  const { min, max } = bounds(definition);
  await acceptsExactly(page, definition, String(min));
  await acceptsExactly(page, definition, String(max));
});

test('integer exact entry rejects out-of-range, fractional and non-finite input', async ({ page }) => {
  await openPlayground(page);
  const definition = integerSetting();
  const { min, max } = bounds(definition);
  for (const text of ['', 'abc', String(min - 1), String(max + 1), `${min}.5`, '1e400', 'NaN', 'Infinity']) {
    await test.step(`rejects "${text}"`, () => rejects(page, definition, text));
  }

  const settingRow = await gotoSetting(page, definition);
  const field = exactField(settingRow, definition);
  await enterText(field, String(max + 1));
  await expectValidationMessage(field);
});

test('number exact entry accepts both bounds', async ({ page }) => {
  await openPlayground(page);
  const definition = numberSetting();
  const { min, max } = bounds(definition);
  await acceptsExactly(page, definition, String(min));
  await acceptsExactly(page, definition, String(max));
});

test('number exact entry preserves precision beyond slider steps', async ({ page }) => {
  await openPlayground(page);
  const definition = numberSetting();
  const { min, max } = bounds(definition);
  const fallback = Number(definition.default.value);

  const precise = Number((min + (max - min) * 0.123456789012).toPrecision(15));
  expect(precise).not.toBe(fallback);
  await acceptsExactly(page, definition, String(precise));

  // A change far smaller than any slider step must still become an override, not round away.
  const span = max - min;
  const tiny = Number(
    (fallback + span * 1e-9 <= max ? fallback + span * 1e-9 : fallback - span * 1e-9).toPrecision(15),
  );
  expect(tiny).not.toBe(fallback);
  await acceptsExactly(page, definition, String(tiny));
});

test('number exact entry rejects out-of-range and non-finite input', async ({ page }) => {
  await openPlayground(page);
  const definition = numberSetting();
  const { min, max } = bounds(definition);
  const span = max - min;
  for (const text of [
    '',
    'abc',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e400',
    String(max + span),
    String(min - span),
  ]) {
    await test.step(`rejects "${text}"`, () => rejects(page, definition, text));
  }

  const settingRow = await gotoSetting(page, definition);
  const field = exactField(settingRow, definition);
  await enterText(field, String(max + span));
  await expectValidationMessage(field);
});
