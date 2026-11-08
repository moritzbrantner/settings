// Issue #28: profiles, persistence, migration, corruption, overlays and timed rollback.
//
// Seams: a "Developer tools" disclosure with a "Snapshot scope" select, the canonical snapshot of
// that scope (test id `canonical-snapshot`), a "Snapshot to import" editor with an
// "Import into <Scope>" button, one "Load …" button per retained fixture, an "Import report"
// status listing diagnostics (`data-diagnostic`), overlay controls, preset/profile buttons and a
// "Simulate consumer apply failure" checkbox. Durable snapshots live in localStorage under
// `settings-playground.snapshot.<scope>`. Rollback is driven by Playwright's fake clock only.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyButton,
  applyIfStaged,
  enterText,
  exactField,
  expectAtDefault,
  expectModified,
  fixture,
  gotoSetting,
  noHorizontalOverflow,
  openPlayground,
  readValue,
  repoRoot,
  revisit,
  row,
  statusText,
  type Definition,
} from './playground';

const definition = (id: string): Definition => {
  const found = fixture.definitions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture has no ${id}`);
  return found;
};

const retained = (name: string) =>
  readFileSync(join(repoRoot, 'fixtures', 'persistence', `${name}.json`), 'utf8');

async function openTools(page: Page): Promise<void> {
  const summary = page.getByText(/^Developer tools/);
  if ((await page.locator('details[open]').count()) === 0) await summary.click();
  await expect(page.getByTestId('canonical-snapshot')).toBeVisible();
}

async function chooseScope(page: Page, scope: 'User' | 'Device' | 'Save'): Promise<void> {
  await page.getByLabel('Snapshot scope').selectOption({ label: scope });
}

const canonical = (page: Page) => page.getByTestId('canonical-snapshot');
const report = (page: Page) => page.getByRole('status', { name: 'Import report' });
const stored = (page: Page, scope: string) =>
  page.evaluate((key) => window.localStorage.getItem(key), `settings-playground.snapshot.${scope}`);

async function storedOverrides(page: Page, scope: string): Promise<Record<string, unknown>> {
  await expect.poll(() => stored(page, scope)).not.toBeNull();
  return JSON.parse((await stored(page, scope))!).overrides;
}

async function importPasted(page: Page, scope: 'User' | 'Device' | 'Save', snapshot: string) {
  await chooseScope(page, scope);
  await page.getByLabel('Snapshot to import').fill(snapshot);
  await page.getByRole('button', { name: `Import into ${scope}` }).click();
}

async function setVolume(page: Page, value: number) {
  const volume = definition('audio.master_volume');
  const volumeRow = await gotoSetting(page, volume);
  await enterText(exactField(volumeRow, volume), String(value));
  await applyIfStaged(page);
  return volumeRow;
}

test('export is canonical and round-trips through import unchanged', async ({ page }) => {
  await openPlayground(page);
  await openTools(page);
  // Shuffled keys, a value equal to its default and compact formatting.
  await importPasted(
    page,
    'User',
    '{"overrides":{"audio.mute":{"value":false,"type":"bool"},"audio.master_volume":{"value":55,"type":"integer"},"accessibility.captions":{"type":"bool","value":true}},"scope":"user","schema_version":2}',
  );
  await expect(report(page)).toContainText('Loaded: Captions, Master volume.');
  const expected = JSON.stringify(
    {
      schema_version: 2,
      scope: 'user',
      overrides: {
        'accessibility.captions': { type: 'bool', value: true },
        'audio.master_volume': { type: 'integer', value: 55 },
      },
    },
    null,
    2,
  );
  await expect(canonical(page)).toHaveText(expected);
  await expect.poll(() => stored(page, 'user')).toBe(expected);

  await page.getByRole('button', { name: 'Copy to editor' }).click();
  await page.getByRole('button', { name: 'Import into User' }).click();
  await expect(canonical(page)).toHaveText(expected);

  // The stored snapshot is restored after a reload and exports identically.
  await page.reload();
  await openTools(page);
  await expect(canonical(page)).toHaveText(expected);
  await expect(report(page)).toContainText('Stored → User');
});

test('reset removes the override instead of storing the default', async ({ page }) => {
  await openPlayground(page);
  const volume = definition('audio.master_volume');
  let volumeRow = await setVolume(page, 65);
  await expectModified(volumeRow, volume);
  expect(await storedOverrides(page, 'user')).toHaveProperty(['audio.master_volume']);

  await volumeRow.getByRole('button', { name: /reset/i }).click();
  await applyIfStaged(page);
  volumeRow = await revisit(page, volume);
  await expectAtDefault(volumeRow, volume);
  await expect.poll(async () => Object.keys(await storedOverrides(page, 'user'))).toEqual([]);

  // Entering the default value again also leaves no override behind.
  await setVolume(page, 65);
  volumeRow = await setVolume(page, 80);
  await expectAtDefault(volumeRow, volume);
  await expect.poll(async () => Object.keys(await storedOverrides(page, 'user'))).toEqual([]);

  // Global reset empties every durable snapshot.
  await setVolume(page, 30);
  await page.getByRole('button', { name: /reset all settings/i }).click();
  await applyIfStaged(page);
  await openTools(page);
  await expect(canonical(page)).toContainText('"overrides": {}');
  await expect.poll(async () => Object.keys(await storedOverrides(page, 'user'))).toEqual([]);
});

test('session values and policy/command-line/session overlays never reach storage', async ({ page }) => {
  await page.goto('./?policy=audio.master_volume:10&session=audio.music_volume:20&policy=nope:1');
  await expect(page.locator('[data-setting-id]').first()).toBeVisible();
  const volume = definition('audio.master_volume');

  let volumeRow = await gotoSetting(page, volume);
  expect(await readValue(volumeRow, volume)).toBe('10');
  await expect.poll(() => statusText(volumeRow, volume)).toMatch(/policy/i);

  // Editing changes the durable preference beneath the policy; the effective value stays 10.
  await enterText(exactField(volumeRow, volume), '65');
  await applyIfStaged(page);
  volumeRow = await revisit(page, volume);
  expect(await readValue(volumeRow, volume)).toBe('10');
  await expect(volumeRow.getByTestId('durable')).toContainText('beneath: 65 (User override)');

  // A session-scoped setting and a command-line overlay from the developer panel.
  const tickRate = definition('simulation.tick_rate');
  const tickRow = await gotoSetting(page, tickRate);
  await enterText(exactField(tickRow, tickRate), '30');
  await applyIfStaged(page);
  await openTools(page);
  await expect(page.getByText(/Ignored \?policy=nope:1: unknown setting nope/)).toBeVisible();
  await page.getByLabel('Layer').selectOption('command_line');
  await page.getByLabel('Setting', { exact: true }).selectOption('audio.effects_volume');
  await page.getByLabel('Overlay value').fill('5');
  await page.getByRole('button', { name: 'Set overlay' }).click();
  const active = page.getByRole('list', { name: 'Active overlays' });
  await expect(active.getByRole('listitem')).toHaveCount(3);

  const user = await storedOverrides(page, 'user');
  expect(user).toEqual({ 'audio.master_volume': { type: 'integer', value: 65 } });
  const everything = await page.evaluate(() => JSON.stringify({ ...window.localStorage }));
  for (const leaked of ['simulation.tick_rate', 'audio.music_volume', 'audio.effects_volume']) {
    expect(everything).not.toContain(leaked);
  }
  await expect(canonical(page)).not.toContainText('"value": 10');

  // Without the URL overlays the durable preference returns; session values start fresh.
  await page.goto('./');
  volumeRow = await gotoSetting(page, volume);
  expect(await readValue(volumeRow, volume)).toBe('65');
  await expectModified(volumeRow, volume);
  const freshTick = await gotoSetting(page, tickRate);
  expect(await readValue(freshTick, tickRate)).toBe('60');
  await expectAtDefault(freshTick, tickRate);
});

test('retained legacy and corrupt fixtures load with compact diagnostics', async ({ page }) => {
  await openPlayground(page);
  await openTools(page);

  await page.getByRole('button', { name: /legacy v1 snapshot/i }).click();
  await expect(report(page)).toContainText('Migrated schema v1 → v2.');
  await expect(report(page)).toContainText('Loaded: Master volume.');
  for (const id of ['future.unknown', 'video.fullscreen']) {
    await expect(report(page).locator('[data-diagnostic="legacy_unknown_entry_dropped"]', { hasText: id })).toBeVisible();
  }
  const volume = definition('audio.master_volume');
  const volumeRow = await gotoSetting(page, volume);
  expect(await readValue(volumeRow, volume)).toBe('55');
  await expect.poll(() => statusText(volumeRow, volume)).toMatch(/migrated/i);
  await expect(volumeRow.getByTestId('differs')).toContainText('Differs from default (80)');

  await page.getByRole('button', { name: /forward-compatible snapshot/i }).click();
  await expect(report(page).locator('[data-diagnostic="unknown_setting_preserved"]')).toContainText(
    'future.accessibility.contrast_curve',
  );
  await expect(canonical(page)).toContainText('future.accessibility.contrast_curve');

  await page.getByRole('button', { name: /corrupt snapshot/i }).click();
  await expect(report(page).locator('[data-diagnostic="invalid_identifier"]')).toContainText('“ bad ”: rejected');
  await expect(report(page).locator('[data-diagnostic="unknown_setting_preserved"]')).toHaveCount(3);
  const device = JSON.parse(await canonical(page).innerText());
  expect(Object.keys(device.overrides)).toEqual(['future.renderer.option', 'video.fullscreen', 'video.quality']);
  expect(device.overrides).not.toHaveProperty([' bad ']);
  expect(retained('v2-corrupt-device')).toContain('" bad "');

  // Known settings with corrupt or invalid values are rejected, independent valid ones recovered.
  await importPasted(
    page,
    'Device',
    JSON.stringify({
      schema_version: 2,
      scope: 'device',
      overrides: {
        'video.antialias': { unexpected: true },
        'video.object_density': { type: 'choice', value: 'ultra' },
        'video.shadows': { type: 'bool', value: false },
        'audio.master_volume': { type: 'integer', value: 20 },
      },
    }),
  );
  await expect(report(page)).toContainText('Loaded: Shadows.');
  await expect(report(page).locator('[data-diagnostic="corrupt_value"]')).toContainText('video.antialias: rejected');
  await expect(report(page).locator('[data-diagnostic="invalid_value"]')).toContainText('video.object_density: rejected');
  await expect(report(page).locator('[data-diagnostic="scope_mismatch"]')).toContainText('Import it into the User snapshot');

  // A malformed envelope fails as a whole and changes nothing.
  const before = await canonical(page).innerText();
  await importPasted(page, 'Device', '{"schema_version": 99');
  await expect(report(page)).toContainText('not loaded');
  await expect(canonical(page)).toHaveText(before);
});

test('fixture presets and named profiles round-trip through storage', async ({ page }) => {
  await openPlayground(page);
  await openTools(page);
  await page.getByRole('button', { name: 'Stage Performance preset' }).click();
  await expect(page.getByRole('list', { name: 'Pending changes' })).toContainText('Render scale');
  await applyButton(page).click();
  const fog = definition('video.fog');
  const fogRow = await gotoSetting(page, fog);
  await expect.poll(() => statusText(fogRow, fog)).toMatch(/Modified · Preset/);

  await page.getByLabel('Profile name').fill('Fast');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('button', { name: /reset all settings/i }).click();
  await applyIfStaged(page);
  await expectAtDefault(await revisit(page, fog), fog);

  await page.reload();
  await openTools(page);
  await page.getByRole('button', { name: 'Load profile Fast' }).click();
  await chooseScope(page, 'Device');
  await expect(canonical(page)).toContainText('"video.render_scale"');
  await expectModified(await gotoSetting(page, fog), fog);
});

test('unconfirmed changes roll back on the fake clock; confirmed ones stay', async ({ page }) => {
  await page.clock.install();
  await openPlayground(page);
  const fov = definition('video.fov');
  const confirmButton = page.getByRole('button', { name: 'Apply with confirmation' });
  const alert = page.getByRole('alert');

  let fovRow = await gotoSetting(page, fov);
  await enterText(exactField(fovRow, fov), '100');
  await confirmButton.click();
  await expect(alert).toContainText('Reverting in 15 s');
  await page.clock.runFor(14_000);
  await expect(alert).toContainText('Reverting in 1 s');
  fovRow = await revisit(page, fov);
  expect(await readValue(fovRow, fov)).toBe('100');
  // An unconfirmed candidate is never stored.
  await expect.poll(async () => Object.keys(await storedOverrides(page, 'user'))).toEqual([]);

  await page.clock.runFor(1_000);
  await expect(page.getByRole('status').filter({ hasText: 'Not confirmed in time; 1 change was rolled back.' })).toBeVisible();
  fovRow = await revisit(page, fov);
  expect(await readValue(fovRow, fov)).toBe('90');
  await expectAtDefault(fovRow, fov);

  await enterText(exactField(fovRow, fov), '100');
  await confirmButton.click();
  await page.clock.runFor(5_000);
  await page.getByRole('button', { name: 'Keep changes' }).click();
  await page.clock.runFor(30_000);
  await expect(alert).toHaveCount(0);
  fovRow = await revisit(page, fov);
  expect(await readValue(fovRow, fov)).toBe('100');
  await expectModified(fovRow, fov);
  expect(await storedOverrides(page, 'user')).toEqual({ 'video.fov': { type: 'integer', value: 100 } });
});

test('a simulated consumer apply failure restores the previous values', async ({ page }) => {
  await openPlayground(page);
  const fov = definition('video.fov');
  let fovRow = await gotoSetting(page, fov);
  await enterText(exactField(fovRow, fov), '75');
  await applyButton(page).click();
  fovRow = await revisit(page, fov);
  await expectModified(fovRow, fov);

  await openTools(page);
  await page.getByRole('checkbox', { name: 'Simulate consumer apply failure' }).click();
  await enterText(exactField(fovRow, fov), '110');
  await applyButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: 'consumer could not apply' })).toContainText('video.fov');
  fovRow = await revisit(page, fov);
  expect(await readValue(fovRow, fov)).toBe('75');
  await expect(row(page, fov.id)).not.toContainText('Pending');
  expect(await storedOverrides(page, 'user')).toEqual({ 'video.fov': { type: 'integer', value: 75 } });
});

test('developer tools fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openPlayground(page);
  await openTools(page);
  await page.getByRole('button', { name: /corrupt snapshot/i }).click();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('the playground works in memory when browser storage is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await openPlayground(page);
  await openTools(page);
  await expect(page.getByText(/Browser storage is unavailable/)).toBeVisible();
  const volumeRow = await setVolume(page, 40);
  await expectModified(volumeRow, definition('audio.master_volume'));
  await page.getByLabel('Profile name').fill('Memory');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('button', { name: 'Load profile Memory' })).toBeVisible();
});
