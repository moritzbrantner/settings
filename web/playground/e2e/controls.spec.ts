import { expect, test } from '@playwright/test';
import {
  applyIfStaged,
  differentText,
  editToNonDefault,
  enterText,
  expectAtDefault,
  expectModified,
  expectRejected,
  gotoSetting,
  openPlayground,
  pick,
  readValue,
  revisit,
  textField,
  type Definition,
} from './playground';

const KINDS: Array<[string, (definition: Definition) => boolean]> = [
  ['bool', (d) => d.kind.type === 'bool'],
  ['integer', (d) => d.kind.type === 'integer' && d.kind.max - d.kind.min >= 2],
  ['number', (d) => d.kind.type === 'number' && d.kind.max > d.kind.min],
  ['text', (d) => d.kind.type === 'text' && d.kind.min_chars >= 1 && d.kind.max_chars > d.kind.min_chars],
  ['choice', (d) => d.kind.type === 'choice' && d.kind.options.length >= 2],
];

for (const [kind, predicate] of KINDS) {
  test(`${kind} setting renders, edits through the session and resets by removing the override`, async ({
    page,
  }) => {
    await openPlayground(page);
    const definition = pick(predicate, `${kind} setting`);

    let settingRow = await gotoSetting(page, definition);
    const initial = await readValue(settingRow, definition);
    await expectAtDefault(settingRow, definition);

    await editToNonDefault(page, settingRow, definition);
    await applyIfStaged(page);
    await expectModified(settingRow, definition);
    const edited = await readValue(settingRow, definition);
    expect(edited, 'the edited value differs from the default').not.toBe(initial);

    settingRow = await revisit(page, definition);
    expect(await readValue(settingRow, definition), 'the session keeps the edited value').toBe(edited);
    await expectModified(settingRow, definition);

    await settingRow.getByRole('button', { name: /reset/i }).first().click();
    await applyIfStaged(page);
    await expectAtDefault(settingRow, definition);
    expect(await readValue(settingRow, definition)).toBe(initial);

    settingRow = await revisit(page, definition);
    expect(await readValue(settingRow, definition)).toBe(initial);
    await expectAtDefault(settingRow, definition);
  });
}

test('text entry enforces the declared length bounds', async ({ page }) => {
  await openPlayground(page);
  const definition = pick(KINDS[3][1], 'text setting with a minimum length');
  if (definition.kind.type !== 'text') throw new Error('unreachable');
  const { min_chars: min, max_chars: max } = definition.kind;

  let settingRow = await gotoSetting(page, definition);
  const committed = await readValue(settingRow, definition);
  const field = textField(settingRow, definition);

  await enterText(field, '');
  await expectRejected(page, settingRow, definition, field, committed);

  await enterText(field, 'x'.repeat(max + 1));
  if ((await field.getAttribute('aria-invalid')) === 'true') {
    await expectRejected(page, settingRow, definition, field, committed);
  } else {
    await applyIfStaged(page);
    settingRow = await revisit(page, definition);
    expect((await readValue(settingRow, definition)).length).toBeLessThanOrEqual(max);
  }

  for (const length of [min, max]) {
    const value = differentText(definition, length);
    settingRow = await gotoSetting(page, definition);
    await enterText(textField(settingRow, definition), value);
    await applyIfStaged(page);
    settingRow = await revisit(page, definition);
    expect(await readValue(settingRow, definition)).toBe(value);
    if (value !== definition.default.value) await expectModified(settingRow, definition);
  }
});
