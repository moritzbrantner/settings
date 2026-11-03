// Independent expected-state contract: staging, commit, cancel and reset from
// ARCHITECTURE.md (Transactions and preview) and the Settings Playground UX.
// The application never imports this model and its real settings session remains authoritative.
import { expect, test, type Page } from '@playwright/test';
import { createMachine, type AnyMachineSnapshot } from 'xstate';
import { getAdjacencyMap, getShortestPaths } from 'xstate/graph';
import {
  applyButton,
  cancelButton,
  editToNonDefault,
  expectAtDefault,
  expectModified,
  expectNoEnabledButton,
  gotoSetting,
  openPlayground,
  pick,
  readValue,
  row,
  type Definition,
} from './playground';

const events = ['EDIT', 'CANCEL', 'APPLY', 'RESET', 'CANCEL_RESET', 'APPLY_RESET'] as const;
type Event = (typeof events)[number];
type State = 'default' | 'staged' | 'committed' | 'resetPending';

const model = createMachine({
  id: 'settings-transaction',
  initial: 'default',
  states: {
    default: { on: { EDIT: 'staged' } },
    staged: { on: { CANCEL: 'default', APPLY: 'committed' } },
    committed: { on: { RESET: 'resetPending' } },
    resetPending: { on: { CANCEL_RESET: 'committed', APPLY_RESET: 'default' } },
  },
});

type Step = { event: { type: string }; state: { value: State } };
type Path = { steps: Step[]; state: unknown };
const options = {
  events: events.map((type) => ({ type })),
  filterEvents: (snapshot: AnyMachineSnapshot, event: { type: string }) => snapshot.can(event),
  limit: 100,
};
const shortest = new Map(
  (getShortestPaths(model, options) as unknown as Path[]).map((path) => [
    JSON.stringify(path.state),
    path.steps.filter((step) => step.event.type !== 'xstate.init'),
  ]),
);
const graph = getAdjacencyMap(model, options) as unknown as Record<
  string,
  { state: unknown; transitions: Record<string, Step> }
>;
const candidates: Step[][] = [...shortest.values()];
const coveredTransitions = new Set<string>();
for (const vertex of Object.values(graph)) {
  const prefix = shortest.get(JSON.stringify(vertex.state));
  if (!prefix) throw new Error('Model vertex has no reachable shortest path');
  for (const transition of Object.values(vertex.transitions)) {
    coveredTransitions.add(`${JSON.stringify(vertex.state)}:${transition.event.type}`);
    candidates.push([...prefix, transition]);
  }
}
const unique = new Map(
  candidates.filter((path) => path.length > 0).map((path) => [path.map((step) => step.event.type).join(' > '), path]),
);
const paths = [...unique]
  .filter(([key]) => ![...unique.keys()].some((other) => other !== key && other.startsWith(`${key} > `)))
  .sort(([left], [right]) => left.localeCompare(right));

test('settings model has bounded, independent transition coverage', () => {
  expect(coveredTransitions.size).toBe(6);
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.length).toBeLessThanOrEqual(10);
});

const definition = () => pick((item) => item.id === 'video.fov' && item.apply_mode === 'apply', 'staged FOV');

async function assertState(page: Page, setting: Definition, state: State, original: string, changed: string | undefined) {
  const current = row(page, setting.id);
  await expect(current).toBeVisible();
  const value = await readValue(current, setting);
  if (state === 'default') {
    expect(value).toBe(original);
    await expectAtDefault(current, setting);
    await expectNoEnabledButton(applyButton(page));
  } else if (state === 'staged') {
    expect(value).not.toBe(original);
    await expect(applyButton(page)).toBeEnabled();
    await expect(cancelButton(page)).toBeEnabled();
  } else if (state === 'committed') {
    expect(value).toBe(changed);
    await expectModified(current, setting);
    await expectNoEnabledButton(applyButton(page));
  } else {
    expect(value).toBe(original);
    await expect(applyButton(page)).toBeEnabled();
    await expect(cancelButton(page)).toBeEnabled();
  }
}

for (const [name, path] of paths) {
  test(`@state:settings ${name}`, async ({ page }) => {
    await openPlayground(page);
    const setting = definition();
    await gotoSetting(page, setting);
    const original = await readValue(row(page, setting.id), setting);
    let changed: string | undefined;
    await assertState(page, setting, 'default', original, changed);

    for (const step of path) {
      await test.step(`${step.event.type} -> ${step.state.value}`, async () => {
        switch (step.event.type) {
          case 'EDIT':
            await editToNonDefault(page, row(page, setting.id), setting);
            changed = await readValue(row(page, setting.id), setting);
            break;
          case 'CANCEL':
          case 'CANCEL_RESET':
            await cancelButton(page).click();
            break;
          case 'APPLY':
          case 'APPLY_RESET':
            await applyButton(page).click();
            break;
          case 'RESET':
            await row(page, setting.id).getByRole('button', { name: /reset/i }).click();
            break;
          default:
            throw new Error(`Unrecognized model event ${step.event.type}`);
        }
        await assertState(page, setting, step.state.value, original, changed);
      });
    }
  });
}
