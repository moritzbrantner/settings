// Physics demo determinism and command translation (issue #26), checked against the playground's
// Rapier adapter directly (no page): fixed configurations and scripted inputs must reproduce the
// exact per-step trace, and settings changes must become the documented explicit commands.
import { expect, test } from '@playwright/test';
import {
  DEFAULT_WORLD,
  DemoWorld,
  initPhysics,
  physicsCommands,
  physicsConfig,
  SCRIPTED_IMPULSE,
  type PhysicsCommand,
  type WorldConfig,
} from '../src/physics';

type InPlace = Exclude<PhysicsCommand, { type: 'rebuild' }>;

/** Per-step digests of a fresh world, with in-place commands injected before the given steps. */
function trace(config: WorldConfig, steps: number, script: ReadonlyArray<{ step: number; command: InPlace }> = []) {
  const world = new DemoWorld(config);
  try {
    const digests: string[] = [];
    for (let step = 0; step < steps; step++) {
      for (const entry of script) if (entry.step === step) world.apply(entry.command);
      world.step();
      digests.push(world.digest());
    }
    return digests;
  } finally {
    world.dispose();
  }
}

test.beforeAll(async () => {
  await initPhysics();
});

test('the same configuration reproduces the same trace, step for step', () => {
  const first = trace(DEFAULT_WORLD, 240);
  expect(trace(DEFAULT_WORLD, 240)).toEqual(first);
  expect(new Set(first).size).toBeGreaterThan(SCRIPTED_IMPULSE.step);
  expect(trace({ ...DEFAULT_WORLD, seed: 2 }, 240)).not.toEqual(first);
  expect(trace({ ...DEFAULT_WORLD, bodyCount: 5 }, 240)).not.toEqual(first);
});

test('scripted in-place commands are repeatable and only change the trace from their step on', () => {
  const script = [
    { step: 30, command: { type: 'setGravity', gravity: 3 } },
    { step: 90, command: { type: 'setRestitution', restitution: 0.9 } },
    { step: 150, command: { type: 'setTickRate', tickRate: 120 } },
  ] as const;
  const scripted = trace(DEFAULT_WORLD, 240, script);
  expect(trace(DEFAULT_WORLD, 240, script)).toEqual(scripted);

  const plain = trace(DEFAULT_WORLD, 240);
  expect(scripted.slice(0, 30)).toEqual(plain.slice(0, 30));
  expect(scripted[30]).not.toEqual(plain[30]);
});

test('world changes translate into rebuild or in-place commands', () => {
  expect(physicsCommands(null, DEFAULT_WORLD)).toEqual([{ type: 'rebuild', config: DEFAULT_WORLD }]);
  expect(physicsCommands(DEFAULT_WORLD, { ...DEFAULT_WORLD })).toEqual([]);
  const rebuilt = { ...DEFAULT_WORLD, bodyCount: 3, gravity: 1 };
  expect(physicsCommands(DEFAULT_WORLD, rebuilt)).toEqual([{ type: 'rebuild', config: rebuilt }]);
  expect(physicsCommands(DEFAULT_WORLD, { ...DEFAULT_WORLD, seed: 7 })).toHaveLength(1);
  expect(physicsCommands(DEFAULT_WORLD, { ...DEFAULT_WORLD, restitution: 0.8, gravity: 2, tickRate: 30 })).toEqual([
    { type: 'setTickRate', tickRate: 30 },
    { type: 'setGravity', gravity: 2 },
    { type: 'setRestitution', restitution: 0.8 },
  ]);
});

test('presentation settings never reach the simulation configuration', () => {
  const defaults = physicsConfig({});
  expect(defaults.world).toEqual(DEFAULT_WORLD);
  const presented = physicsConfig({
    'simulation.interpolation': { type: 'bool', value: false },
    'simulation.debug_overlay': { type: 'bool', value: true },
  });
  expect(presented.world).toEqual(DEFAULT_WORLD);
  expect(presented.presentation).toEqual({ interpolation: false, debug: true });
  expect(physicsConfig({ 'simulation.gravity': { type: 'number', value: 4 } }).world.gravity).toBe(4);
});
