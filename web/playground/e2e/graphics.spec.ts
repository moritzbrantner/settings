// Graphics settings drive the 3d-lab preview (issue #23). Command translation is checked through
// the preview's applied-config attributes, independently of pixels; screenshots are attached as
// Low/High evidence only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  repoRoot,
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

// Scene kit (issue #25): asset-tooling content from the pinned release tars, drawn by 3d-lab.
const lock = JSON.parse(readFileSync(join(repoRoot, 'web', 'playground', 'scene-kit.lock.json'), 'utf8')) as {
  bundles: Array<{ id: string; release: string; sha256: string }>;
};
const diagnostics = (page: Page) => page.getByTestId('scene-kit-diagnostics');

async function openSceneKit(page: Page) {
  await openGraphics(page);
  await requireRenderer(page);
  await expect(preview(page)).toHaveAttribute('data-scene-kit', 'ready', { timeout: 30_000 });
  await diagnostics(page).locator('summary').click();
}

test('the preview draws the pinned scene kit and shows its provenance', async ({ page }) => {
  await openSceneKit(page);
  for (const bundle of lock.bundles) {
    const bundleRow = diagnostics(page).locator(`[data-bundle="${bundle.id}"]`);
    await expect(bundleRow).toContainText(bundle.release);
    await expect(bundleRow).toContainText(bundle.sha256);
    await expect(bundleRow).toContainText('verified');
  }
  // The Ranger is drawn as a real character; every nature member is either drawn or explained.
  await expect(diagnostics(page).locator('[data-member="humanoid.ranger.male"]')).toHaveAttribute('data-variant', 'default');
  const members = diagnostics(page).locator('[data-member^="greyhaven.nature."]');
  await expect(members).not.toHaveCount(0);
  for (const member of await members.all()) {
    if ((await member.getAttribute('data-variant')) === 'proxy') await expect(member).toContainText('not drawn:');
    else await expect(member).toContainText('drawn');
  }
  expect(await diagnostics(page).locator('[data-variant]:not([data-variant="proxy"])').count()).toBeGreaterThan(1);
});

test('object density is staged and draw distance culls placements at once', async ({ page }) => {
  await openSceneKit(page);
  await expect(preview(page)).toHaveAttribute('data-placed-instances', '27');

  await gotoSetting(page, definition('video.object_density'));
  await choiceControl(row(page, 'video.object_density'), definition('video.object_density')).selectOption('high');
  await expect(preview(page)).toHaveAttribute('data-object-density', 'medium');
  await applyButton(page).click();
  await expect(preview(page)).toHaveAttribute('data-object-density', 'high');
  await expect(preview(page)).toHaveAttribute('data-placed-instances', '53');
  const far = Number(await preview(page).getAttribute('data-drawn-instances'));

  await gotoSetting(page, definition('video.draw_distance'));
  await enterText(exactField(row(page, 'video.draw_distance'), definition('video.draw_distance')), '20');
  await expect(preview(page)).toHaveAttribute('data-draw-distance', '20');
  const near = Number(await preview(page).getAttribute('data-drawn-instances'));
  expect(near).toBeGreaterThan(0);
  expect(near).toBeLessThan(far);
});

test('an unavailable asset variant falls back to the next variant or a proxy', async ({ page }) => {
  // Every variant of one member is missing; the rest of the scene still loads.
  await page.route('**/scene-kit/nature/scenes/greyhaven.nature.bush.1/**', (route) => route.fulfill({ status: 404 }));
  await openSceneKit(page);
  const bush = diagnostics(page).locator('[data-member="greyhaven.nature.bush.1"]');
  await expect(bush).toHaveAttribute('data-variant', 'proxy');
  await expect(bush).toContainText('HTTP 404');
  await expect(diagnostics(page).locator('[data-member="humanoid.ranger.male"]')).toHaveAttribute('data-variant', 'default');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a missing scene kit leaves a working preview with proxies', async ({ page }) => {
  await page.route('**/scene-kit/scene-kit.json', (route) => route.fulfill({ status: 404 }));
  await openGraphics(page);
  await requireRenderer(page);
  await expect(preview(page)).toHaveAttribute('data-scene-kit', 'unavailable');
  await expect(preview(page)).toHaveAttribute('data-placed-instances', '27');
  await diagnostics(page).locator('summary').click();
  await expect(diagnostics(page)).toContainText('fetch:scene-kit');
});
