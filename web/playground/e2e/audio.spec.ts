// Audio settings drive a generated Web Audio demo (issue #27). Command translation is checked
// through the gains read back from the live audio graph, not through audible output.
import { expect, test, type Page } from '@playwright/test';
import {
  applyButton,
  boolControl,
  cancelButton,
  enterText,
  exactField,
  fixture,
  gotoSetting,
  openPlayground,
  row,
  type Definition,
} from './playground';

const definition = (id: string): Definition => {
  const found = fixture.definitions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture is missing ${id}`);
  return found;
};

const preview = (page: Page) => page.locator('[data-audio-preview]');

async function gain(page: Page, bus: 'master' | 'music' | 'effects'): Promise<number> {
  return Number(await preview(page).getAttribute(`data-${bus}-gain`));
}

async function expectGain(page: Page, bus: 'master' | 'music' | 'effects', expected: number) {
  await expect.poll(() => gain(page, bus)).toBeCloseTo(expected, 5);
}

async function startAudio(page: Page) {
  await openPlayground(page);
  await gotoSetting(page, definition('audio.master_volume'));
  await page.getByRole('button', { name: 'Play demo audio' }).click();
  await expect(preview(page)).toHaveAttribute('data-playing', 'true');
}

async function setPercent(page: Page, id: string, value: number) {
  await enterText(exactField(row(page, id), definition(id)), String(value));
}

test('volume edits are heard at once and Apply keeps them', async ({ page }) => {
  await startAudio(page);
  await expectGain(page, 'master', 0.8);
  await expect(preview(page)).toHaveAttribute('data-sample-rate', '48000');

  await setPercent(page, 'audio.master_volume', 40);
  await setPercent(page, 'audio.music_volume', 25);
  await setPercent(page, 'audio.effects_volume', 0);
  await expectGain(page, 'master', 0.4);
  await expectGain(page, 'music', 0.25);
  await expectGain(page, 'effects', 0);
  await expect(row(page, 'audio.master_volume')).toContainText('Pending');

  await applyButton(page).click();
  await expect(row(page, 'audio.master_volume')).not.toContainText('Pending');
  await expectGain(page, 'master', 0.4);
});

test('Cancel restores the previewed mix', async ({ page }) => {
  await startAudio(page);
  await setPercent(page, 'audio.master_volume', 10);
  await boolControl(row(page, 'audio.mute'), definition('audio.mute')).click();
  await expectGain(page, 'master', 0);
  await expect(preview(page)).toHaveAttribute('data-muted', 'true');

  await cancelButton(page).click();
  await expectGain(page, 'master', 0.8);
  await expect(preview(page)).toHaveAttribute('data-muted', 'false');
  await expect(exactField(row(page, 'audio.master_volume'), definition('audio.master_volume'))).toHaveValue('80');
});

test('mute silences output but keeps the bus levels', async ({ page }) => {
  await startAudio(page);
  await setPercent(page, 'audio.music_volume', 60);
  await boolControl(row(page, 'audio.mute'), definition('audio.mute')).click();
  await applyButton(page).click();
  await expectGain(page, 'master', 0);
  await expectGain(page, 'music', 0.6);
  await expect.poll(() => page.getByRole('meter', { name: 'Output level' }).getAttribute('aria-valuenow')).toBe('0');
});
