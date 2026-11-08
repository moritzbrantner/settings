// Accessibility and appearance settings are applied to the document (issue #30). Checked through
// the root element's class, data attributes and computed font size, never through pixels.
import { expect, test, type Page } from '@playwright/test';
import {
  boolControl,
  choiceControl,
  enterText,
  exactField,
  fixture,
  gotoSetting,
  openPlayground,
  type Definition,
} from './playground';

const definition = (id: string): Definition => {
  const found = fixture.definitions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture is missing ${id}`);
  return found;
};

const html = (page: Page) => page.locator('html');
const rootFontSize = (page: Page) =>
  page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));

test('colour scheme follows the setting and the system preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openPlayground(page);
  const scheme = definition('appearance.color_scheme');
  await expect(html(page)).not.toHaveClass(/\bdark\b/);

  // `system` tracks the browser preference live.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html(page)).toHaveClass(/\bdark\b/);

  const settingRow = await gotoSetting(page, scheme);
  await choiceControl(settingRow, scheme).selectOption('light');
  await expect(html(page)).not.toHaveClass(/\bdark\b/);

  await page.emulateMedia({ colorScheme: 'light' });
  await choiceControl(settingRow, scheme).selectOption('dark');
  await expect(html(page)).toHaveClass(/\bdark\b/);
});

test('contrast, night mode and reduced motion are reflected on the document', async ({ page }) => {
  await openPlayground(page);
  await expect(html(page)).toHaveAttribute('data-contrast', 'system');
  await expect(html(page)).toHaveAttribute('data-night-mode', 'false');
  await expect(html(page)).toHaveAttribute('data-reduce-motion', 'false');

  const contrast = definition('appearance.contrast');
  await choiceControl(await gotoSetting(page, contrast), contrast).selectOption('high');
  await expect(html(page)).toHaveAttribute('data-contrast', 'high');

  const night = definition('appearance.night_mode');
  await boolControl(await gotoSetting(page, night), night).click();
  await expect(html(page)).toHaveAttribute('data-night-mode', 'true');

  const motion = definition('accessibility.reduce_motion');
  await boolControl(await gotoSetting(page, motion), motion).click();
  await expect(html(page)).toHaveAttribute('data-reduce-motion', 'true');
  const duration = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.transition = 'opacity 2s';
    document.body.append(probe);
    const value = getComputedStyle(probe).transitionDuration;
    probe.remove();
    return value;
  });
  expect(Number.parseFloat(duration), 'transitions are effectively disabled').toBeLessThan(0.01);
});

test('text scale resizes the document root font', async ({ page }) => {
  await openPlayground(page);
  const base = await rootFontSize(page);
  const scale = definition('accessibility.text_scale');
  await enterText(exactField(await gotoSetting(page, scale), scale), '1.5');
  await expect.poll(() => rootFontSize(page)).toBeCloseTo(base * 1.5, 1);
});
