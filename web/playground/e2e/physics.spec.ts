// Simulation settings drive a live Rapier demo world drawn by 3d-lab (issue #26). Translation and
// lifecycle are checked through the preview's applied-config and command attributes; repeatability
// through the digest it publishes at a fixed step after each rebuild. No timing is asserted.
import { expect, test, type Page } from '@playwright/test';
import { CHECKPOINT_STEP, DEFAULT_WORLD, DemoWorld, initPhysics } from '../src/physics';
import {
  applyButton,
  boolControl,
  cancelButton,
  categoryOf,
  enterText,
  exactField,
  fixture,
  gotoSetting,
  openCategory,
  openPlayground,
  row,
  searchFor,
  type Definition,
} from './playground';

const definition = (id: string): Definition => {
  const found = fixture.definitions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture is missing ${id}`);
  return found;
};

const preview = (page: Page) => page.locator('[data-physics-preview]');
const attribute = (page: Page, name: string) => preview(page).getAttribute(`data-${name}`);

async function openSimulation(page: Page) {
  await openPlayground(page);
  await gotoSetting(page, definition('simulation.gravity'));
  await expect(preview(page)).toHaveAttribute('data-world-ready', 'true');
}

async function setNumber(page: Page, id: string, value: number) {
  await enterText(exactField(row(page, id), definition(id)), String(value));
}

async function checkpoint(page: Page): Promise<string> {
  await expect(preview(page)).toHaveAttribute('data-checkpoint', /^[0-9a-f]{8}$/, { timeout: 30_000 });
  return (await attribute(page, 'checkpoint')) ?? '';
}

async function setSeed(page: Page, seed: number) {
  // The seed is search-only and commits immediately; leaving and reopening the category remounts the demo.
  await searchFor(page, 'seed');
  await setNumber(page, 'simulation.random_seed', seed);
  await searchFor(page, '');
  await openCategory(page, categoryOf('simulation.gravity'));
  await expect(preview(page)).toHaveAttribute('data-seed', String(seed));
}

test('staged world parameters update the running world on Apply; Cancel sends nothing', async ({ page }) => {
  await openSimulation(page);
  await expect(preview(page)).toHaveAttribute('data-world-generation', '1');
  await expect(preview(page)).toHaveAttribute('data-last-commands', 'rebuild');
  await expect(preview(page)).toHaveAttribute('data-body-count', '12');

  await setNumber(page, 'simulation.gravity', 3);
  await setNumber(page, 'simulation.restitution', 0.8);
  await expect(row(page, 'simulation.gravity')).toContainText('Pending');
  await expect(preview(page)).toHaveAttribute('data-gravity', '9.81');
  await expect.poll(async () => Number(await attribute(page, 'step'))).toBeGreaterThan(0);
  const before = Number(await attribute(page, 'step'));

  await applyButton(page).click();
  await expect(preview(page)).toHaveAttribute('data-gravity', '3');
  await expect(preview(page)).toHaveAttribute('data-restitution', '0.8');
  await expect(preview(page)).toHaveAttribute('data-last-commands', 'setGravity setRestitution');
  // Updated in place: same world, still counting up from before the change.
  await expect(preview(page)).toHaveAttribute('data-world-generation', '1');
  expect(Number(await attribute(page, 'step'))).toBeGreaterThanOrEqual(before);

  await setNumber(page, 'simulation.gravity', 15);
  await cancelButton(page).click();
  await expect(preview(page)).toHaveAttribute('data-gravity', '3');
  await expect(preview(page)).toHaveAttribute('data-last-commands', 'setGravity setRestitution');
});

test('applying a new body count or resetting the section rebuilds the world', async ({ page }) => {
  await openSimulation(page);
  await setNumber(page, 'simulation.body_count', 5);
  await expect(preview(page)).toHaveAttribute('data-body-count', '12');
  await applyButton(page).click();
  await expect(preview(page)).toHaveAttribute('data-world-generation', '2');
  await expect(preview(page)).toHaveAttribute('data-body-count', '5');
  await expect(preview(page)).toHaveAttribute('data-last-commands', 'rebuild');

  await page.getByRole('button', { name: /reset simulation section/i }).click();
  await applyButton(page).click();
  await expect(preview(page)).toHaveAttribute('data-world-generation', '3');
  await expect(preview(page)).toHaveAttribute('data-body-count', '12');
});

test('presentation settings apply at once without commanding the simulation', async ({ page }) => {
  await openSimulation(page);
  await boolControl(row(page, 'simulation.interpolation'), definition('simulation.interpolation')).click();
  await expect(preview(page)).toHaveAttribute('data-interpolation', 'false');
  await boolControl(row(page, 'simulation.debug_overlay'), definition('simulation.debug_overlay')).click();
  await expect(preview(page)).toHaveAttribute('data-debug', 'true');
  await expect(page.getByTestId('physics-overlay')).toContainText('awake');

  await setNumber(page, 'simulation.tick_rate', 120);
  await expect(preview(page)).toHaveAttribute('data-last-commands', 'setTickRate');
  await expect(preview(page)).toHaveAttribute('data-world-generation', '1');
});

test('restarting or revisiting the demo reproduces the checkpoint; another seed changes it', async ({ page }) => {
  await initPhysics();
  const world = new DemoWorld(DEFAULT_WORLD);
  for (let step = 0; step < CHECKPOINT_STEP; step++) world.step();
  const expected = world.digest();
  world.dispose();

  await openSimulation(page);
  expect(await checkpoint(page)).toBe(expected);

  await page.getByRole('button', { name: 'Restart world' }).click();
  await expect(preview(page)).toHaveAttribute('data-world-generation', '2');
  expect(await checkpoint(page)).toBe(expected);

  await setSeed(page, 2);
  await expect(preview(page)).toHaveAttribute('data-world-generation', '1');
  expect(await checkpoint(page)).not.toBe(expected);

  await setSeed(page, 1);
  expect(await checkpoint(page)).toBe(expected);
});
