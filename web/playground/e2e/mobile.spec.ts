import { expect, test } from '@playwright/test';
import {
  applyButton,
  applyIfStaged,
  categoryNames,
  editToNonDefault,
  enterText,
  exactField,
  expectModified,
  gotoSetting,
  noHorizontalOverflow,
  openCategory,
  openPlayground,
  pick,
  searchFor,
} from './playground';

const WIDTH = 360;
test.use({ viewport: { width: WIDTH, height: 780 }, hasTouch: true, isMobile: true });

test('narrow layout has no horizontal overflow and every category stays reachable', async ({
  page,
}) => {
  await openPlayground(page);
  expect(await noHorizontalOverflow(page), 'initial layout fits').toBe(true);

  for (const name of categoryNames()) {
    await openCategory(page, name);
    expect(await noHorizontalOverflow(page), `${name} fits`).toBe(true);
    const rows = page.locator('[data-setting-id]');
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
      const box = await rows.nth(index).boundingBox();
      if (!box) continue;
      expect(box.x, `${name} row ${index} starts inside the viewport`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${name} row ${index} ends inside the viewport`).toBeLessThanOrEqual(
        WIDTH + 1,
      );
    }
  }

  await searchFor(page, 'a');
  expect(await noHorizontalOverflow(page), 'search results fit').toBe(true);
});

test('narrow layout supports exact numeric entry and staged Apply', async ({ page }) => {
  await openPlayground(page);
  const integer = pick((d) => d.kind.type === 'integer' && d.kind.max - d.kind.min >= 2, 'integer');
  if (integer.kind.type !== 'integer') throw new Error('unreachable');
  const target = Number(integer.default.value) === integer.kind.max ? integer.kind.min : integer.kind.max;
  let settingRow = await gotoSetting(page, integer);
  await enterText(exactField(settingRow, integer), String(target));
  await applyIfStaged(page);
  await expectModified(settingRow, integer);

  const staged = pick((d) => d.apply_mode === 'apply', 'staged (apply) setting');
  settingRow = await gotoSetting(page, staged);
  await editToNonDefault(page, settingRow, staged);
  const apply = applyButton(page);
  await apply.scrollIntoViewIfNeeded();
  await expect(apply).toBeVisible();
  const box = await apply.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= WIDTH + 1, 'Apply is inside the viewport').toBe(true);
  await apply.click();
  await expectModified(settingRow, staged);
  expect(await noHorizontalOverflow(page)).toBe(true);
});
