// Playground-owned physics demo (issue #26): demo configuration, translation from committed
// settings values to explicit simulation commands, and the small adapter that executes those
// commands on Rapier. Rapier owns the simulation; nothing here decides physics behavior beyond
// choosing the demo scene. This adapter is the only module that may import Rapier, so swapping it
// for physics-engine later replaces this file without touching the settings or presentation code.
import RAPIER from '@dimforge/rapier3d-compat';
import type { SettingValue } from '@moritzbrantner/settings-browser';

/** Simulation parameters of one demo world. Changing `bodyCount` or `seed` rebuilds the world. */
export interface WorldConfig {
  /** Fixed simulation steps per second. */
  tickRate: number;
  /** Downward gravitational acceleration in m/s². */
  gravity: number;
  /** Bounciness applied to every collider, 0..1. */
  restitution: number;
  bodyCount: number;
  seed: number;
}

/** Presentation-only choices: they never reach the simulation. */
export interface PhysicsPresentation {
  /** Blend the last two fixed steps for drawing instead of drawing the latest step. */
  interpolation: boolean;
  /** Draw collider outlines coloured by sleep state and the step/awake counters. */
  debug: boolean;
}

export interface PhysicsConfig {
  world: WorldConfig;
  presentation: PhysicsPresentation;
}

export const DEFAULT_WORLD: WorldConfig = { tickRate: 60, gravity: 9.81, restitution: 0.3, bodyCount: 12, seed: 1 };

export function physicsConfig(values: Readonly<Record<string, SettingValue | undefined>>): PhysicsConfig {
  const bool = (id: string, fallback: boolean) => {
    const value = values[id];
    return value?.type === 'bool' ? value.value : fallback;
  };
  const number = (id: string, fallback: number) => {
    const value = values[id];
    return value?.type === 'number' || value?.type === 'integer' ? value.value : fallback;
  };
  return {
    world: {
      tickRate: number('simulation.tick_rate', DEFAULT_WORLD.tickRate),
      gravity: number('simulation.gravity', DEFAULT_WORLD.gravity),
      restitution: number('simulation.restitution', DEFAULT_WORLD.restitution),
      bodyCount: number('simulation.body_count', DEFAULT_WORLD.bodyCount),
      seed: number('simulation.random_seed', DEFAULT_WORLD.seed),
    },
    presentation: {
      interpolation: bool('simulation.interpolation', true),
      debug: bool('simulation.debug_overlay', false),
    },
  };
}

/** Explicit commands the playground sends to the demo world. */
export type PhysicsCommand =
  | { type: 'rebuild'; config: WorldConfig }
  | { type: 'setTickRate'; tickRate: number }
  | { type: 'setGravity'; gravity: number }
  | { type: 'setRestitution'; restitution: number };

/**
 * Translate a committed world configuration change into commands. A missing previous world, a new
 * body count or a new seed rebuilds the world (a rebuild already carries every parameter);
 * otherwise each changed parameter becomes one in-place command, in a fixed order.
 */
export function physicsCommands(before: WorldConfig | null, after: WorldConfig): PhysicsCommand[] {
  if (!before || before.bodyCount !== after.bodyCount || before.seed !== after.seed) {
    return [{ type: 'rebuild', config: after }];
  }
  const commands: PhysicsCommand[] = [];
  if (before.tickRate !== after.tickRate) commands.push({ type: 'setTickRate', tickRate: after.tickRate });
  if (before.gravity !== after.gravity) commands.push({ type: 'setGravity', gravity: after.gravity });
  if (before.restitution !== after.restitution) commands.push({ type: 'setRestitution', restitution: after.restitution });
  return commands;
}

/** Fixed scripted input: one sideways impulse on the first body at this step after each rebuild. */
export const SCRIPTED_IMPULSE = { step: 60, impulse: { x: 1.5, y: 3, z: 0 } } as const;

/** Step after each rebuild whose digest the preview publishes as its repeatability checkpoint. */
export const CHECKPOINT_STEP = 120;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type BodyShape = { kind: 'box'; half: number } | { kind: 'sphere'; radius: number };

export interface BodyPose {
  translation: Vec3;
  rotation: Quat;
  sleeping: boolean;
}

export interface StaticPiece {
  id: string;
  halfExtents: Vec3;
  translation: Vec3;
  rotation: Quat;
}

/** The bounded arena: a 10 m floor, four low walls and one tilted ramp. */
export const ARENA: readonly StaticPiece[] = [
  { id: 'floor', halfExtents: [5, 0.1, 5], translation: [0, -0.1, 0], rotation: [0, 0, 0, 1] },
  { id: 'wall-n', halfExtents: [5, 0.5, 0.1], translation: [0, 0.5, -5.1], rotation: [0, 0, 0, 1] },
  { id: 'wall-s', halfExtents: [5, 0.5, 0.1], translation: [0, 0.5, 5.1], rotation: [0, 0, 0, 1] },
  { id: 'wall-w', halfExtents: [0.1, 0.5, 5], translation: [-5.1, 0.5, 0], rotation: [0, 0, 0, 1] },
  { id: 'wall-e', halfExtents: [0.1, 0.5, 5], translation: [5.1, 0.5, 0], rotation: [0, 0, 0, 1] },
  // 15° about +Z.
  { id: 'ramp', halfExtents: [1.5, 0.1, 1.2], translation: [-1.5, 0.6, 0], rotation: [0, 0, 0.130526, 0.991445] },
];

/** Deterministic 32-bit generator for the body layout; depends only on the seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BodySpawn {
  shape: BodyShape;
  translation: Vec3;
}

/** Body layout: shapes and drop positions drawn from the seed, stacked so bodies start apart. */
export function bodyLayout(count: number, seed: number): BodySpawn[] {
  const random = mulberry32(seed);
  const spawns: BodySpawn[] = [];
  for (let index = 0; index < count; index++) {
    const size = 0.25 + random() * 0.2;
    const shape: BodyShape = random() < 0.5 ? { kind: 'box', half: size } : { kind: 'sphere', radius: size };
    spawns.push({ shape, translation: [(random() - 0.5) * 6, 1.5 + index * 0.6, (random() - 0.5) * 6] });
  }
  return spawns;
}

let initialized: Promise<void> | null = null;

/** Load Rapier's WebAssembly once per page (or Node process). */
export function initPhysics(): Promise<void> {
  initialized ??= RAPIER.init();
  return initialized;
}

/**
 * One Rapier world for the demo. Every mutation is an explicit command; `step` advances exactly one
 * fixed step and applies the scripted input, so a configuration and command sequence fully
 * determine the trace. Requires `initPhysics()` to have resolved.
 */
export class DemoWorld {
  readonly shapes: readonly BodyShape[];
  #world: RAPIER.World;
  #bodies: RAPIER.RigidBody[] = [];
  #colliders: RAPIER.Collider[] = [];
  #step = 0;
  #config: WorldConfig;

  constructor(config: WorldConfig) {
    this.#config = { ...config };
    this.#world = new RAPIER.World({ x: 0, y: -config.gravity, z: 0 });
    this.#world.timestep = 1 / config.tickRate;
    for (const piece of ARENA) {
      const [x, y, z] = piece.translation;
      const [qx, qy, qz, qw] = piece.rotation;
      const desc = RAPIER.ColliderDesc.cuboid(...piece.halfExtents)
        .setTranslation(x, y, z)
        .setRotation({ x: qx, y: qy, z: qz, w: qw })
        .setRestitution(config.restitution);
      this.#colliders.push(this.#world.createCollider(desc));
    }
    const layout = bodyLayout(config.bodyCount, config.seed);
    this.shapes = layout.map((spawn) => spawn.shape);
    for (const spawn of layout) {
      const body = this.#world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...spawn.translation));
      const desc =
        spawn.shape.kind === 'box'
          ? RAPIER.ColliderDesc.cuboid(spawn.shape.half, spawn.shape.half, spawn.shape.half)
          : RAPIER.ColliderDesc.ball(spawn.shape.radius);
      this.#colliders.push(this.#world.createCollider(desc.setRestitution(config.restitution), body));
      this.#bodies.push(body);
    }
  }

  get config(): Readonly<WorldConfig> {
    return this.#config;
  }

  /** Fixed steps taken since this world was built. */
  get stepCount(): number {
    return this.#step;
  }

  /** Apply an in-place command. A `rebuild` cannot be applied in place: build a new world. */
  apply(command: Exclude<PhysicsCommand, { type: 'rebuild' }>): void {
    switch (command.type) {
      case 'setTickRate':
        this.#config.tickRate = command.tickRate;
        this.#world.timestep = 1 / command.tickRate;
        return;
      case 'setGravity':
        this.#config.gravity = command.gravity;
        this.#world.gravity = { x: 0, y: -command.gravity, z: 0 };
        for (const body of this.#bodies) body.wakeUp();
        return;
      case 'setRestitution':
        this.#config.restitution = command.restitution;
        for (const collider of this.#colliders) collider.setRestitution(command.restitution);
        return;
    }
  }

  step(): void {
    if (this.#step === SCRIPTED_IMPULSE.step && this.#bodies.length > 0) {
      this.#bodies[0].applyImpulse(SCRIPTED_IMPULSE.impulse, true);
    }
    this.#world.step();
    this.#step += 1;
  }

  poses(): BodyPose[] {
    return this.#bodies.map((body) => {
      const t = body.translation();
      const r = body.rotation();
      return { translation: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w], sleeping: body.isSleeping() };
    });
  }

  /** FNV-1a digest of every body's exact position and rotation bits at the current step. */
  digest(): string {
    const floats = new Float64Array(this.#bodies.length * 7);
    this.poses().forEach((pose, index) => floats.set([...pose.translation, ...pose.rotation], index * 7));
    let hash = 0x811c9dc5;
    for (const byte of new Uint8Array(floats.buffer)) hash = Math.imul(hash ^ byte, 0x01000193);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  dispose(): void {
    this.#world.free();
    this.#bodies = [];
    this.#colliders = [];
  }
}

/** Interpolated pose for drawing: linear translation, normalized-lerp rotation along the short arc. */
export function blendPose(previous: BodyPose, current: BodyPose, alpha: number): BodyPose {
  const [px, py, pz, pw] = previous.rotation;
  let [cx, cy, cz, cw] = current.rotation;
  if (px * cx + py * cy + pz * cz + pw * cw < 0) [cx, cy, cz, cw] = [-cx, -cy, -cz, -cw];
  const rotation: Quat = [px + (cx - px) * alpha, py + (cy - py) * alpha, pz + (cz - pz) * alpha, pw + (cw - pw) * alpha];
  const length = Math.hypot(...rotation) || 1;
  return {
    translation: previous.translation.map((value, axis) => value + (current.translation[axis] - value) * alpha) as Vec3,
    rotation: rotation.map((value) => value / length) as Quat,
    sleeping: current.sleeping,
  };
}
