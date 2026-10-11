// Regression for availability dependencies crossing the durable user/device scope boundary.
// Route a test-only fixture so the independently authored acceptance fixture stays unchanged.
import { expect, test } from '@playwright/test';
import {
  FIXTURE_ROUTE,
  enterText,
  exactField,
  fixture,
  gotoSetting,
  label,
  openPlayground,
  primaryControl,
  row,
} from './playground';

test('cross-scope availability and explanation follow staged, canceled and reset preferences', async ({
  page,
}) => {
  const prerequisite = fixture.definitions.find((definition) => definition.id === 'video.fov');
  const dependent = fixture.definitions.find((definition) => definition.id === 'video.render_scale');
  if (!prerequisite || !dependent) throw new Error('graphics fixture is missing its settings');
  expect(prerequisite.scope).toBe('user');
  expect(dependent.scope).toBe('device');
  expect(prerequisite.apply_mode).toBe('apply');

  // The device setting requires a non-default value of an apply-mode user preference.
  const testFixture = structuredClone(fixture);
  const gated = testFixture.definitions.find((definition) => definition.id === dependent.id);
  if (!gated) throw new Error('missing dependent definition');
  gated.availability = {
    condition: {
      op: 'setting_equals',
      id: prerequisite.id,
      value: { type: 'integer', value: 100 },
    },
    when_unavailable: 'disable',
  };
  await page.route(FIXTURE_ROUTE, (route) => route.fulfill({ json: testFixture }));
  await openPlayground(page);

  const fovRow = await gotoSetting(page, prerequisite);
  const dependentRow = row(page, dependent.id);
  const dependentControl = primaryControl(dependentRow, dependent);
  const explanation = `Requires ${label(prerequisite.id)} to be 100.`;

  await expect(dependentControl).toBeDisabled();
  await expect(dependentRow).toContainText(explanation);

  // Staged edits change availability immediately, even though the committed value did not.
  await enterText(exactField(fovRow, prerequisite), '100');
  await expect(dependentControl).toBeEnabled();
  await expect(dependentRow).not.toContainText(explanation);
  await expect(fovRow).toContainText('Pending');

  await page.getByRole('button', { name: /^cancel$/i }).click();
  await expect(dependentControl).toBeDisabled();
  await expect(dependentRow).toContainText(explanation);

  await enterText(exactField(fovRow, prerequisite), '100');
  await page.getByRole('button', { name: /^apply$/i }).click();
  await expect(dependentControl).toBeEnabled();
  await expect(fovRow).toContainText('Modified');
  await expect(dependentRow).toContainText('Default');

  // Reset remains staged and affects the explanation before apply; cancel can undo it.
  await fovRow.getByRole('button', { name: /^reset/i }).click();
  await expect(dependentControl).toBeDisabled();
  await expect(dependentRow).toContainText(explanation);
  await page.getByRole('button', { name: /^cancel$/i }).click();
  await expect(dependentControl).toBeEnabled();

  await fovRow.getByRole('button', { name: /^reset/i }).click();
  await page.getByRole('button', { name: /^apply$/i }).click();
  await expect(dependentControl).toBeDisabled();
  await expect(dependentRow).toContainText(explanation);
  await expect(fovRow).toContainText('Default');
});
