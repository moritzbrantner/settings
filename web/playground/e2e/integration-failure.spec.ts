// A failing optional integration shows a named app-level diagnostic instead of a blank page, and
// the settings around it stay usable (issue #30). Failures are injected deterministically with
// `?fail-integration=<id>`.
import { expect, test } from '@playwright/test';
import {
  applyIfStaged,
  categoryOf,
  editablePrimary,
  editToNonDefault,
  expectModified,
  FIXTURE_ROUTE,
  gotoSetting,
  openCategory,
  requireFixture,
  t,
} from './playground';

const INTEGRATIONS = [
  { id: 'graphics', name: '3d-lab preview', category: 'settings.category.graphics' },
  { id: 'physics', name: 'Physics preview', category: 'settings.category.simulation' },
  { id: 'audio', name: 'Audio preview', category: 'settings.category.audio' },
  { id: 'input-bindings', name: 'Input-bindings editor', category: 'settings.category.controls' },
] as const;

for (const integration of INTEGRATIONS) {
  test(`a failing ${integration.name} shows a diagnostic and keeps its section usable`, async ({
    page,
  }) => {
    requireFixture();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`./?fail-integration=${integration.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/playground/i);

    const category = t(integration.category);
    await openCategory(page, category);
    const diagnostic = page.locator(`[data-integration-failed="${integration.id}"]`);
    await expect(diagnostic).toBeVisible();
    await expect(diagnostic).toHaveAttribute('role', 'alert');
    await expect(diagnostic).toContainText(integration.name);
    await expect(diagnostic).toContainText(`fail-integration=${integration.id}`);
    await expect(diagnostic.getByRole('button', { name: `Retry ${integration.name}` })).toBeVisible();
    await expect(page.locator('[data-integration-failed]')).toHaveCount(1);

    const editable = editablePrimary().find(
      (definition) =>
        categoryOf(definition.id) === category &&
        (definition.apply_mode === 'immediate' || definition.apply_mode === 'apply'),
    );
    if (editable) {
      const settingRow = await gotoSetting(page, editable);
      await editToNonDefault(page, settingRow, editable);
      await applyIfStaged(page);
      await expectModified(settingRow, editable);
    }
    expect(errors, 'the failure is contained by the boundary').toEqual([]);
  });
}

test('a startup failure names its cause instead of leaving a blank page', async ({ page }) => {
  await page.route(FIXTURE_ROUTE, (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/playground/i);
  await expect(page.getByRole('alert')).toContainText(/could not start.*503/);
});
