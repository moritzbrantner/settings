import { expect, test } from '@playwright/test';
import {
  categoryItems,
  categoryNames,
  editablePrimary,
  entryOf,
  expectAtDefault,
  fixture,
  gotoSetting,
  label,
  openPlayground,
  primaryControl,
  requireFixture,
  row,
  searchBox,
  searchFor,
  statusText,
} from './playground';

const SCOPE = { user: /user/i, device: /device/i, save: /save/i, session: /session/i } as const;
const MODE = {
  immediate: /immediate/i,
  apply: /apply|staged/i,
  restart: /restart/i,
  reconnect: /reconnect/i,
} as const;

test('opens the playground shell with a main region, search and category navigation', async ({
  page,
}) => {
  await openPlayground(page);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(searchBox(page)).toBeVisible();

  const items = await categoryItems(page).allInnerTexts();
  for (const name of categoryNames()) {
    expect(
      items.some((text) => text.trim().toLocaleLowerCase().startsWith(name.toLocaleLowerCase())),
      `category navigation lists ${name}`,
    ).toBe(true);
  }
});

test('each setting row shows scope, apply mode and default provenance when unmodified', async ({
  page,
}) => {
  await openPlayground(page);
  const definitions = editablePrimary();
  expect(definitions.length).toBeGreaterThan(0);
  for (const definition of definitions) {
    const settingRow = await gotoSetting(page, definition);
    await expect(primaryControl(settingRow, definition)).toBeVisible();
    const text = await statusText(settingRow, definition);
    expect(text, `${definition.id} scope`).toMatch(SCOPE[definition.scope]);
    expect(text, `${definition.id} apply mode`).toMatch(MODE[definition.apply_mode]);
    await expectAtDefault(settingRow, definition);
  }
});

test('gated settings render disabled with a visible reason', async ({ page }) => {
  requireFixture();
  await openPlayground(page);
  const gated = fixture.definitions.filter(
    (definition) =>
      (definition.availability as { when_unavailable?: string } | undefined)?.when_unavailable ===
      'disable',
  );
  expect(gated.length).toBeGreaterThan(0);

  let disabledWithReason = 0;
  for (const definition of gated) {
    await searchFor(page, label(definition.id));
    const settingRow = row(page, definition.id);
    await expect(settingRow, `${definition.id} is found by search`).toBeVisible();
    const control = primaryControl(settingRow, definition);
    if (await control.isDisabled()) {
      const text = await statusText(settingRow, definition);
      expect(text, `${definition.id} explains why it is unavailable`).toMatch(
        /requires|required|unavailable|not available|unsupported|disabled|needs|only when|depends|when /i,
      );
      disabledWithReason += 1;
    }
  }
  expect(disabledWithReason, 'at least one gated setting is disabled with a reason').toBeGreaterThan(0);
});

test('search-only and advanced settings stay discoverable through search', async ({ page }) => {
  requireFixture();
  await openPlayground(page);
  const hidden = fixture.presentation.filter(
    (entry) => (entry.metadata.discoverability ?? 'primary') !== 'primary',
  );
  expect(hidden.length).toBeGreaterThan(0);
  for (const entry of hidden) {
    await searchFor(page, label(entry.id));
    await expect(row(page, entry.id)).toBeVisible();
  }

  const searchOnly = hidden.find((entry) => entry.metadata.discoverability === 'search_only');
  if (searchOnly) {
    const anchor = editablePrimary().find(
      (definition) =>
        entryOf(definition.id).metadata.category_key === searchOnly.metadata.category_key,
    );
    if (anchor) {
      await gotoSetting(page, anchor);
      await expect(row(page, searchOnly.id)).toBeHidden();
    }
  }
});
