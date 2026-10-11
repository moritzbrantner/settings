import { expect, test, type Page } from '@playwright/test';
import {
  applyButton,
  applyIfStaged,
  cancelButton,
  categoryOf,
  confirmIfAsked,
  editablePrimary,
  editToNonDefault,
  expectAtDefault,
  expectModified,
  expectNoEnabledButton,
  gotoSetting,
  openPlayground,
  pick,
  readValue,
  revisit,
  type Definition,
} from './playground';

test('immediate settings take effect without Apply', async ({ page }) => {
  await openPlayground(page);
  const definition = pick((d) => d.apply_mode === 'immediate', 'immediate setting');
  const settingRow = await gotoSetting(page, definition);
  await editToNonDefault(page, settingRow, definition);
  await expectModified(settingRow, definition);
  await expectNoEnabledButton(applyButton(page));
});

test('staged settings offer Apply and Cancel; Cancel restores the baseline', async ({ page }) => {
  await openPlayground(page);
  const definition = pick((d) => d.apply_mode === 'apply', 'staged (apply) setting');
  await expectNoEnabledButton(applyButton(page));
  await expectNoEnabledButton(cancelButton(page));

  let settingRow = await gotoSetting(page, definition);
  const initial = await readValue(settingRow, definition);

  await editToNonDefault(page, settingRow, definition);
  await expect(applyButton(page)).toBeEnabled();
  await expect(cancelButton(page)).toBeEnabled();

  await cancelButton(page).click();
  await expectNoEnabledButton(applyButton(page));
  settingRow = await revisit(page, definition);
  expect(await readValue(settingRow, definition), 'Cancel restores the baseline value').toBe(initial);
  await expectAtDefault(settingRow, definition);

  await editToNonDefault(page, settingRow, definition);
  const staged = await readValue(settingRow, definition);
  await applyButton(page).click();
  await expectNoEnabledButton(applyButton(page));
  settingRow = await revisit(page, definition);
  expect(await readValue(settingRow, definition), 'Apply commits the staged value').toBe(staged);
  await expectModified(settingRow, definition);
});

test('restart and reconnect requirements are surfaced after the change', async ({ page }) => {
  await openPlayground(page);
  const definition = pick(
    (d) => d.apply_mode === 'restart' || d.apply_mode === 'reconnect',
    'restart or reconnect setting',
  );
  const word = new RegExp(definition.apply_mode, 'i');
  const notice = page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: word });
  await expect(notice).toHaveCount(0);

  const settingRow = await gotoSetting(page, definition);
  await editToNonDefault(page, settingRow, definition);
  await applyIfStaged(page);
  await expect(notice.first()).toBeVisible();
});

function twoCategories(): [Definition, Definition] {
  const editable = editablePrimary();
  const first = editable[0];
  const second = editable.find((d) => categoryOf(d.id) !== categoryOf(first.id));
  if (!first || !second) throw new Error('need editable settings in two categories');
  return [first, second];
}

async function modify(page: Page, definition: Definition): Promise<string> {
  const settingRow = await gotoSetting(page, definition);
  const initial = await readValue(settingRow, definition);
  await editToNonDefault(page, settingRow, definition);
  await applyIfStaged(page);
  await expectModified(settingRow, definition);
  return initial;
}

test('section reset removes overrides in that section only', async ({ page }) => {
  await openPlayground(page);
  const [inSection, elsewhere] = twoCategories();
  await modify(page, elsewhere);
  const initial = await modify(page, inSection);

  await gotoSetting(page, inSection);
  await page
    .getByRole('button', { name: /reset.*\b(section|category)\b|\b(section|category)\b.*reset/i })
    .first()
    .click();
  await confirmIfAsked(page);
  await applyIfStaged(page);

  let settingRow = await revisit(page, inSection);
  await expectAtDefault(settingRow, inSection);
  expect(await readValue(settingRow, inSection)).toBe(initial);

  settingRow = await gotoSetting(page, elsewhere);
  await expectModified(settingRow, elsewhere);
});

test('global reset removes every override', async ({ page }) => {
  await openPlayground(page);
  const [first, second] = twoCategories();
  const firstInitial = await modify(page, first);
  const secondInitial = await modify(page, second);

  await page
    .getByRole('button', { name: /^(?!.*\b(section|category)\b).*reset (all|everything)/i })
    .first()
    .click();
  await confirmIfAsked(page);
  await applyIfStaged(page);

  for (const [definition, initial] of [
    [first, firstInitial],
    [second, secondInitial],
  ] as const) {
    const settingRow = await revisit(page, definition);
    await expectAtDefault(settingRow, definition);
    expect(await readValue(settingRow, definition)).toBe(initial);
  }
});
