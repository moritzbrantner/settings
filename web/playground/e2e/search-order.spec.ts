import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURE_ROUTE,
  applyIfStaged,
  categoryItems,
  categoryNames,
  categoryOf,
  clearSearch,
  editablePrimary,
  editToNonDefault,
  entryOf,
  expectModified,
  fixture,
  gotoSetting,
  label,
  openCategory,
  openPlayground,
  readValue,
  requireFixture,
  row,
  searchFor,
  t,
} from './playground';

test('search finds a setting by a localized search key across categories', async ({ page }) => {
  requireFixture();
  await openPlayground(page);
  const target = fixture.presentation.find((entry) => (entry.metadata.search_keys ?? []).length > 0);
  expect(target, 'a setting with search keys').toBeTruthy();
  const query = t(target!.metadata.search_keys![0]);
  const unrelated = editablePrimary().find((definition) => {
    const entry = entryOf(definition.id);
    const haystack = [
      definition.id,
      label(definition.id),
      entry.metadata.description_key ? t(entry.metadata.description_key) : '',
      ...(entry.metadata.search_keys ?? []).map(t),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return !haystack.includes(query.toLocaleLowerCase());
  });

  await searchFor(page, query);
  await expect(row(page, target!.id)).toBeVisible();
  if (unrelated) await expect(row(page, unrelated.id)).toBeHidden();
});

test('search filtering never changes, hides away or resets setting values', async ({ page }) => {
  await openPlayground(page);
  const editable = editablePrimary();
  const kept = editable[0];
  const other = editable.find(
    (definition) =>
      categoryOf(definition.id) !== categoryOf(kept.id) &&
      !label(definition.id).toLocaleLowerCase().includes(label(kept.id).toLocaleLowerCase()) &&
      !label(kept.id).toLocaleLowerCase().includes(label(definition.id).toLocaleLowerCase()),
  );
  expect(other, 'a second editable setting in another category').toBeTruthy();

  let keptRow = await gotoSetting(page, kept);
  await editToNonDefault(page, keptRow, kept);
  await applyIfStaged(page);
  await expectModified(keptRow, kept);
  const keptValue = await readValue(keptRow, kept);

  await searchFor(page, label(other!.id));
  await expect(row(page, kept.id)).toBeHidden();
  const otherRow = row(page, other!.id);
  await expect(otherRow).toBeVisible();
  await editToNonDefault(page, otherRow, other!);
  await applyIfStaged(page);
  await expectModified(otherRow, other!);

  await clearSearch(page);
  keptRow = await gotoSetting(page, kept);
  expect(await readValue(keptRow, kept), 'filtering kept the hidden value').toBe(keptValue);
  await expectModified(keptRow, kept);
  await expectModified(await gotoSetting(page, other!), other!);
});

async function displayedOrder(page: Page): Promise<{ categories: string[]; rows: string[][] }> {
  await openPlayground(page);
  const categories = (await categoryItems(page).allInnerTexts()).map((text) => text.trim());
  const rows: string[][] = [];
  for (const name of categoryNames()) {
    await openCategory(page, name);
    await expect(page.locator('[data-setting-id]').first()).toBeVisible();
    rows.push(
      await page.locator('[data-setting-id]').evaluateAll((elements) => {
        const seen: string[] = [];
        for (const element of elements) {
          const id = element.getAttribute('data-setting-id')!;
          if ((element as HTMLElement).getClientRects().length > 0 && !seen.includes(id)) {
            seen.push(id);
          }
        }
        return seen;
      }),
    );
  }
  return { categories, rows };
}

test('registration order does not change displayed order', async ({ page, browser }) => {
  requireFixture();
  const forward = await displayedOrder(page);
  expect(forward.rows.flat().length).toBeGreaterThan(1);

  const reversedPage = await browser.newPage();
  let served = false;
  await reversedPage.route(FIXTURE_ROUTE, async (route) => {
    served = true;
    await route.fulfill({
      json: {
        ...fixture,
        definitions: [...fixture.definitions].reverse(),
        presentation: [...fixture.presentation].reverse(),
      },
    });
  });
  const reversed = await displayedOrder(reversedPage);
  expect(served, 'the playground loads its fixture from playground-settings.json').toBe(true);
  expect(reversed).toEqual(forward);
  await reversedPage.close();
});
