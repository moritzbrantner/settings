// Live physics demo for the Simulation category (issue #26). Rapier simulates a small bounded
// scene through the playground's adapter (`physics.ts`); 3d-lab draws it with the committed
// graphics configuration. The preview receives only committed values and turns each world
// configuration change into explicit commands: a new body count or seed rebuilds the world, the
// other parameters update the running world in place. Interpolation and the debug overlay are
// presentation-only and never reach the simulation.
//
// Wall-clock time only paces how many fixed steps run per frame; the state after N steps depends
// on the configuration, the commands and the scripted input alone. The digest at CHECKPOINT_STEP
// after a rebuild is exposed so repeatability can be observed in the browser.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@moritzbrantner/ui/stable';
import { createThreeSceneRenderer, type RendererSceneNode, type ThreeSceneRenderer } from '@moritzbrantner/three-d-renderer';
import { environmentFor, lookAt, projectionMatrix, type RendererConfig } from './graphics';
import {
  ARENA,
  blendPose,
  CHECKPOINT_STEP,
  DemoWorld,
  initPhysics,
  physicsCommands,
  type BodyPose,
  type BodyShape,
  type PhysicsConfig,
  type PhysicsCommand,
  type WorldConfig,
} from './physics';

const MAX_STEPS_PER_FRAME = 5;
const EYE: [number, number, number] = [0, 6.5, 10];
const TARGET: [number, number, number] = [0, 0.5, 0];
const BODY_COLORS = ['#c2410c', '#0f766e', '#7c3aed', '#be123c', '#a16207', '#1d4ed8'] as const;

interface Live {
  world: DemoWorld | null;
  applied: WorldConfig | null;
  previous: BodyPose[];
  current: BodyPose[];
  checkpoint: string;
}

function bodyGeometry(shape: BodyShape): RendererSceneNode['geometry'] {
  return shape.kind === 'box'
    ? { kind: 'box', size: [shape.half * 2, shape.half * 2, shape.half * 2] }
    : { kind: 'sphere', radius: shape.radius };
}

function sceneNodes(world: DemoWorld, poses: readonly BodyPose[], debug: boolean): RendererSceneNode[] {
  const nodes: RendererSceneNode[] = [];
  for (const piece of ARENA) {
    const geometry: RendererSceneNode['geometry'] = {
      kind: 'box',
      size: [piece.halfExtents[0] * 2, piece.halfExtents[1] * 2, piece.halfExtents[2] * 2],
    };
    const transform = { translation: piece.translation, rotationQuaternion: piece.rotation };
    nodes.push({ id: `arena/${piece.id}`, geometry, color: piece.id === 'floor' ? '#5d7350' : '#8d8a84', transform });
    if (debug) {
      nodes.push({ id: `debug/arena/${piece.id}`, geometry, color: '#22d3ee', wireframe: true, unlit: true, transform });
    }
  }
  poses.forEach((pose, index) => {
    const geometry = bodyGeometry(world.shapes[index]);
    const transform = { translation: pose.translation, rotationQuaternion: pose.rotation };
    nodes.push({ id: `body/${index}`, geometry, color: BODY_COLORS[index % BODY_COLORS.length], transform });
    if (debug) {
      const color = pose.sleeping ? '#3b82f6' : '#facc15';
      nodes.push({ id: `debug/body/${index}`, geometry, color, wireframe: true, unlit: true, transform });
    }
  });
  return nodes;
}

export function PhysicsPreview({
  config,
  graphics,
  webgl,
}: {
  config: PhysicsConfig;
  graphics: RendererConfig;
  webgl: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const countersRef = useRef<HTMLPreElement>(null);
  const live = useRef<Live>({ world: null, applied: null, previous: [], current: [], checkpoint: '' });
  const presentation = useRef(config.presentation);
  presentation.current = config.presentation;
  const graphicsRef = useRef(graphics);
  graphicsRef.current = graphics;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [lastCommands, setLastCommands] = useState('');
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [renderer, setRenderer] = useState<ThreeSceneRenderer | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const { antialias, shadows } = graphics;

  useEffect(() => {
    let cancelled = false;
    initPhysics().then(
      () => !cancelled && setReady(true),
      (cause: unknown) => !cancelled && setError(`Rapier failed to load: ${String(cause)}`),
    );
    const state = live.current;
    return () => {
      cancelled = true;
      state.world?.dispose();
      state.world = null;
      state.applied = null;
    };
  }, []);

  function dispatch(commands: PhysicsCommand[]) {
    const state = live.current;
    for (const command of commands) {
      if (command.type === 'rebuild') {
        state.world?.dispose();
        state.world = new DemoWorld(command.config);
        state.current = state.world.poses();
        state.previous = state.current;
        state.checkpoint = '';
        setWorld(state.world);
        setGeneration((value) => value + 1);
      } else if (state.world) {
        state.world.apply(command);
        // The checkpoint describes an undisturbed run; an earlier in-place change supersedes it.
        if (state.world.stepCount < CHECKPOINT_STEP) state.checkpoint = 'superseded';
      }
    }
    if (commands.length > 0) setLastCommands(commands.map((command) => command.type).join(' '));
  }

  const worldConfig = config.world;
  useEffect(() => {
    if (!ready) return;
    const state = live.current;
    const commands = physicsCommands(state.applied, worldConfig);
    state.applied = worldConfig;
    dispatch(commands);
  }, [ready, worldConfig]);

  function restart() {
    const state = live.current;
    if (state.applied) dispatch([{ type: 'rebuild', config: state.applied }]);
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !webgl) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full';
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    let created: ThreeSceneRenderer | null = null;
    try {
      created = createThreeSceneRenderer(canvas, { antialias, shadows, pixelRatioLimit: 4 });
      setRenderer(created);
    } catch (cause) {
      setError(String(cause));
    }
    return () => {
      setRenderer(null);
      created?.dispose();
      canvas.remove();
    };
  }, [antialias, shadows, webgl]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Fixed-step loop: steps the world, publishes counters, and draws when a renderer exists.
  useEffect(() => {
    if (!world) return;
    const state = live.current;
    let frame = 0;
    let last = performance.now();
    let accumulator = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (state.world !== world) return;
      const dt = 1 / world.config.tickRate;
      accumulator = Math.min(accumulator + (now - last) / 1000, dt * MAX_STEPS_PER_FRAME);
      last = now;
      while (accumulator >= dt) {
        world.step();
        accumulator -= dt;
        state.previous = state.current;
        state.current = world.poses();
        if (world.stepCount === CHECKPOINT_STEP && state.checkpoint === '') state.checkpoint = world.digest();
      }
      const awake = state.current.filter((pose) => !pose.sleeping).length;
      const host = hostRef.current;
      if (host) {
        host.dataset.step = String(world.stepCount);
        host.dataset.awakeBodies = String(awake);
        host.dataset.checkpoint = state.checkpoint;
      }
      const { interpolation, debug } = presentation.current;
      if (countersRef.current) {
        countersRef.current.textContent = `step ${world.stepCount} · ${world.config.tickRate} Hz\nawake ${awake}/${state.current.length}`;
      }
      if (!renderer || !size) return;
      const alpha = interpolation ? accumulator / dt : 1;
      const poses = state.current.map((pose, index) =>
        state.previous[index] ? blendPose(state.previous[index], pose, alpha) : pose,
      );
      const view = graphicsRef.current;
      try {
        const camera = {
          viewMatrix: lookAt(EYE, TARGET),
          projectionMatrix: projectionMatrix(view.fovDegrees, size.width / size.height),
        };
        renderer.setSize(size.width, size.height, window.devicePixelRatio * view.renderScale);
        renderer.render({ camera, environment: environmentFor(view), nodes: sceneNodes(world, poses, debug) });
      } catch (cause) {
        cancelAnimationFrame(frame);
        setError(String(cause));
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [world, renderer, size]);

  const { world: wc, presentation: view } = config;
  return (
    <figure className="grid w-full max-w-2xl min-w-0 gap-1">
      <div
        ref={hostRef}
        data-physics-preview=""
        data-world-ready={String(world !== null)}
        data-renderer-ready={String(renderer !== null)}
        data-world-generation={String(generation)}
        data-last-commands={lastCommands}
        data-body-count={String(world?.shapes.length ?? 0)}
        data-tick-rate={String(wc.tickRate)}
        data-gravity={String(wc.gravity)}
        data-restitution={String(wc.restitution)}
        data-seed={String(wc.seed)}
        data-interpolation={String(view.interpolation)}
        data-debug={String(view.debug)}
        className="relative aspect-video w-full min-w-0 overflow-hidden rounded-lg border border-border bg-muted"
      >
        {!webgl && (
          <p className="p-3 text-sm text-muted-foreground">
            Drawing unavailable: this browser does not report WebGL 2 rendering. The simulation still runs.
          </p>
        )}
        {error && (
          <p role="alert" className="absolute inset-x-0 top-0 p-3 text-sm">
            The physics demo failed: {error}
          </p>
        )}
        <pre
          ref={countersRef}
          data-testid="physics-overlay"
          hidden={!view.debug}
          className="absolute top-2 left-2 rounded bg-background/80 px-2 py-1 text-xs"
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={world === null} onClick={restart}>
          Restart world
        </Button>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Rapier demo world drawn by 3d-lab: {wc.bodyCount} bodies dropped into a walled arena, one scripted push at step
        60. Body count and seed rebuild the world; gravity, bounciness and tick rate change it in place.
      </figcaption>
    </figure>
  );
}
