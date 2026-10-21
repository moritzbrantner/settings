// Controls composes the authoritative input-bindings editor (issue #24): binding state lives only in
// the editor's own profile, and settings reset and binding reset stay separate authorities.
import { expect, test, type Page } from '@playwright/test';
import {
  enterText,
  exactField,
  expectAtDefault,
  expectModified,
  fixture,
  gotoSetting,
  openPlayground,
  row,
  type Definition,
} from './playground';

const BINDINGS_KEY = 'settings-playground.input-bindings.profile';
const mouse = fixture.definitions.find((d) => d.id === 'input.mouse_sensitivity') as Definition;

const surface = (page: Page) => page.locator('[data-input-bindings-surface="playground.controls"]');
const storedBindings = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), BINDINGS_KEY);

test('the Controls category embeds the input-bindings editor beside ordinary preferences', async ({ page }) => {
  await openPlayground(page);
  await gotoSetting(page, mouse);
  await expect(surface(page)).toBeVisible();
  await expect(surface(page).getByText('Move forward').first()).toBeVisible();
  await expect(row(page, 'input.touch_look_sensitivity')).toBeVisible();

  await enterText(exactField(row(page, mouse.id), mouse), '2.5');
  await expectModified(row(page, mouse.id), mouse);
  expect(await storedBindings(page), 'a settings edit must not write binding state').toBeNull();
});

test('settings reset and binding reset are distinct authorities', async ({ page }) => {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        registryVersion: 1,
        profileId: 'playground-user',
        patches: [{ op: 'remove', actionId: 'ui.map', bindingId: 'ui.map.key' }],
      }),
    );
  }, BINDINGS_KEY);
  await openPlayground(page);
  await gotoSetting(page, mouse);
  await enterText(exactField(row(page, mouse.id), mouse), '2.5');
  await expectModified(row(page, mouse.id), mouse);

  // Resetting the Controls settings section leaves the binding profile untouched.
  await page.getByRole('button', { name: /reset controls section/i }).click();
  await page.getByRole('button', { name: /^\s*apply\b/i }).first().click();
  await expectAtDefault(row(page, mouse.id), mouse);
  expect(await storedBindings(page)).toContain('ui.map.key');

  // The editor's own reset clears bindings and leaves settings alone.
  await enterText(exactField(row(page, mouse.id), mouse), '3');
  await expectModified(row(page, mouse.id), mouse);
  await surface(page).getByRole('button', { name: 'Reset all', exact: true }).click();
  await expect.poll(() => storedBindings(page)).not.toContain('ui.map.key');
  await expectModified(row(page, mouse.id), mouse);
});
