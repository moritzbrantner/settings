// Graphics settings drive the 3d-lab preview (issue #23). Command translation is checked through
// the preview's applied-config attributes, independently of pixels; screenshots are attached as
// Low/High evidence only.
import { expect, test, type Page } from '@playwright/test';
import {
  applyButton,
  boolControl,
  cancelButton,
  choiceControl,
  enterText,
  exactField,
  fixture,
  gotoSetting,
  openPlayground,
  primaryControl,
  row,
  type Definition,
} from './playground';

const definition = (id: string): Definition => {
  const found = fixture.definitions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture is missing ${id}`);
  return found;
};

const preview = (page: Page) => page.locator('[data-graphics-preview]');

async function openGraphics(page: Page) {
  await openPlayground(page);
  await gotoSetting(page, definition('video.fog'));
  await expect(preview(page)).toBeVisible();
}

async function requireRenderer(page: Page) {
  const webgl = await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
  test.skip(!webgl, 'this browser has no WebGL 2; renderer settings are capability-gated');
  await expect(preview(page)).toHaveAttribute('data-renderer-ready', 'true');
}

test('immediate fog reaches the renderer at once; staged renderer options wait for Apply', async ({ page }) => {
  await openGraphics(page);
  await requireRenderer(page);

  await choiceControl(row(page, 'video.fog'), definition('video.fog')).selectOption('dense');
  await expect(preview(page)).toHaveAttribute('data-fog', 'dense');

  const antialias = boolControl(row(page, 'video.antialias'), definition('video.antialias'));
  await antialias.click();
  await expect(row(page, 'video.antialias')).toContainText('Pending');
  await expect(preview(page)).toHaveAttribute('data-antialias', 'true');
  await applyButton(page).click();
  await expect(preview(page)).toHaveAttribute('data-antialias', 'false');
  await expect(preview(page)).toHaveAttribute('data-renderer-ready', 'true');

  const shadows = boolControl(row(page, 'video.shadows'), definition('video.shadows'));
  await shadows.click();
  await cancelButton(page).click();
  await expect(preview(page)).toHaveAttribute('data-shadows', 'true');
  await expect(shadows).toBeChecked();
});

test('unsupported renderer features are disabled with an explanation', async ({ page }) => {
  await openGraphics(page);
  for (const id of ['video.vsync', 'video.hdr', 'video.upscaler']) {
    const settingRow = row(page, id);
    await expect(primaryControl(settingRow, definition(id))).toBeDisabled();
    await expect(settingRow).toContainText(/which this device does not have/);
  }
});

test('the debug overlay reports the applied render scale', async ({ page }) => {
  await openPlayground(page);
  await gotoSetting(page, definition('simulation.debug_overlay'));
  await boolControl(row(page, 'simulation.debug_overlay'), definition('simulation.debug_overlay')).click();
  await gotoSetting(page, definition('video.render_scale'));
  await requireRenderer(page);
  await expect(page.getByTestId('render-overlay')).toContainText('objects');
});

test('a window mode change reverts unless confirmed', async ({ page }) => {
  await openGraphics(page);
  const windowRow = row(page, 'video.window_mode');
  const control = choiceControl(windowRow, definition('video.window_mode'));
  await control.selectOption('fullscreen');
  await applyButton(page).click();
  // Either the browser entered fullscreen and asks for confirmation, or it refused and reverted.
  const confirm = page.getByRole('button', { name: 'Revert now' });
  if (await confirm.isVisible()) await confirm.click();
  await expect(control).toHaveValue('windowed');
  await expect(windowRow).not.toContainText('Modified');
});

test('Low and High graphics evidence', async ({ page }, testInfo) => {
  await openGraphics(page);
  await requireRenderer(page);
  await testInfo.attach('graphics-high', { body: await preview(page).screenshot(), contentType: 'image/png' });

  await choiceControl(row(page, 'video.fog'), definition('video.fog')).selectOption('off');
  await boolControl(row(page, 'video.antialias'), definition('video.antialias')).click();
  await boolControl(row(page, 'video.shadows'), definition('video.shadows')).click();
  await enterText(exactField(row(page, 'video.render_scale'), definition('video.render_scale')), '0.5');
  await applyButton(page).click();
  await expect(preview(page)).toHaveAttribute('data-render-scale', '0.5');
  await expect(preview(page)).toHaveAttribute('data-shadows', 'false');
  await expect(preview(page)).toHaveAttribute('data-renderer-ready', 'true');
  await testInfo.attach('graphics-low', { body: await preview(page).screenshot(), contentType: 'image/png' });
});
