// Representative desktop and narrow screenshots (issue #30). They are review evidence only: CI
// uploads `screenshots/` on every run and nothing compares pixels.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  editToNonDefault,
  fixture,
  gotoSetting,
  openCategory,
  openPlayground,
  pick,
  revealCategoryNav,
  searchFor,
  t,
  type Definition,
} from './playground';

const SCREENSHOTS = join(process.cwd(), 'screenshots');

const definition = (id: string): Definition => {
  const found = fixture.definitions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture is missing ${id}`);
  return found;
};

async function capture(page: Page, name: string): Promise<void> {
  // Viewport-only, so the fixed Apply bar stays where users see it; the result is never compared.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(SCREENSHOTS, `${name}.png`), fullPage: false, animations: 'disabled' });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('captures representative desktop states', async ({ page }) => {
    await openPlayground(page);
    await capture(page, 'desktop-shell');

    await gotoSetting(page, definition('video.fog'));
    await expect(page.locator('[data-graphics-preview]')).toBeVisible();
    await capture(page, 'desktop-graphics');

    await openCategory(page, t('settings.category.controls'));
    await expect(page.locator('[data-input-bindings-surface]')).toBeVisible();
    await capture(page, 'desktop-controls');

    const staged = pick((d) => d.apply_mode === 'apply', 'staged (apply) setting');
    await editToNonDefault(page, await gotoSetting(page, staged), staged);
    await capture(page, 'desktop-staged-apply');
  });

  test('captures the dark high-contrast appearance', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openPlayground(page);
    const contrast = definition('appearance.contrast');
    const settingRow = await gotoSetting(page, contrast);
    await settingRow.getByRole('combobox').selectOption('high');
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
    await capture(page, 'desktop-dark-high-contrast');
  });

  test('captures an integration failure diagnostic', async ({ page }) => {
    await page.goto('./?fail-integration=graphics');
    await openCategory(page, t('settings.category.graphics'));
    await expect(page.locator('[data-integration-failed="graphics"]')).toBeVisible();
    await capture(page, 'desktop-integration-failure');
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

  test('captures representative narrow states', async ({ page }) => {
    await openPlayground(page);
    await capture(page, 'mobile-shell');

    await revealCategoryNav(page);
    await capture(page, 'mobile-categories');

    await searchFor(page, 'motion');
    await capture(page, 'mobile-search');

    const staged = pick((d) => d.apply_mode === 'apply', 'staged (apply) setting');
    await editToNonDefault(page, await gotoSetting(page, staged), staged);
    await capture(page, 'mobile-staged-apply');
  });
});
