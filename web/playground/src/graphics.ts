// Consumer-owned translation from committed settings values to 3d-lab renderer commands. The
// renderer owns its capabilities and application; this module only reads accepted values, and
// staged values never reach it. Capability facts reported here fail closed: the 3d-lab renderer
// has no HDR, present-mode or upscaler path, so those facts are always false.
import type { SettingValue } from '@moritzbrantner/settings-browser';
import type { Matrix4Values, RendererEnvironment } from '@moritzbrantner/three-d-renderer';

export type FogLevel = 'off' | 'light' | 'dense';

export interface RendererConfig {
  /** Construction options: changing either recreates the renderer and its WebGL context. */
  antialias: boolean;
  shadows: boolean;
  /** Multiplies the device pixel ratio. */
  renderScale: number;
  /** Horizontal field of view in degrees. */
  fovDegrees: number;
  fog: FogLevel;
  debugOverlay: boolean;
  /** How many scene-kit instances the preview places. */
  objectDensity: ObjectDensity;
  /** Placed instances farther than this many metres from the camera are not drawn. */
  drawDistance: number;
}

export type ObjectDensity = 'low' | 'medium' | 'high';

export function detectRendererCapabilities(): Record<string, boolean> {
  let webgl = false;
  try {
    webgl = document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    webgl = false;
  }
  return {
    'renderer.webgl': webgl,
    'renderer.hdr': false,
    'renderer.present_mode': false,
    'renderer.upscaler': false,
  };
}

export function rendererConfig(values: Readonly<Record<string, SettingValue>>): RendererConfig {
  const bool = (id: string, fallback: boolean) => {
    const value = values[id];
    return value?.type === 'bool' ? value.value : fallback;
  };
  const number = (id: string, fallback: number) => {
    const value = values[id];
    return value?.type === 'number' || value?.type === 'integer' ? value.value : fallback;
  };
  const fog = values['video.fog'];
  const density = values['video.object_density'];
  return {
    objectDensity:
      density?.type === 'choice' && (density.value === 'low' || density.value === 'high') ? density.value : 'medium',
    drawDistance: number('video.draw_distance', 80),
    antialias: bool('video.antialias', true),
    shadows: bool('video.shadows', true),
    renderScale: number('video.render_scale', 1),
    fovDegrees: number('video.fov', 90),
    fog: fog?.type === 'choice' && (fog.value === 'off' || fog.value === 'dense') ? fog.value : 'light',
    debugOverlay: bool('simulation.debug_overlay', false),
  };
}

const SKY = '#9fb4c8';
const FOG_RANGE: Record<Exclude<FogLevel, 'off'>, { near: number; far: number }> = {
  light: { near: 8, far: 45 },
  dense: { near: 2, far: 16 },
};

export function environmentFor(config: RendererConfig): RendererEnvironment {
  return {
    background: SKY,
    sun: { direction: [6, 10, 4], color: '#ffffff', intensity: 2.4 },
    fog: config.fog === 'off' ? null : { color: SKY, ...FOG_RANGE[config.fog] },
    shadowExtent: 14,
  };
}

/** Right-handed perspective projection with WebGPU depth (0..1), as the renderer expects. */
export function projectionMatrix(fovDegrees: number, aspect: number, near = 0.1, far = 120): Matrix4Values {
  const horizontal = (fovDegrees * Math.PI) / 180;
  const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / aspect);
  const f = 1 / Math.tan(vertical / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ];
}

type Vec3 = [number, number, number];

/** Column-major view matrix looking from `eye` at `target` with +Y up. */
export function lookAt(eye: Vec3, target: Vec3): Matrix4Values {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const normalize = (a: Vec3): Vec3 => {
    const length = Math.hypot(...a);
    return [a[0] / length, a[1] / length, a[2] / length];
  };
  const back = normalize(sub(eye, target));
  const right = normalize(cross([0, 1, 0], back));
  const up = cross(back, right);
  return [
    right[0], up[0], back[0], 0,
    right[1], up[1], back[1], 0,
    right[2], up[2], back[2], 0,
    -dot(right, eye), -dot(up, eye), -dot(back, eye), 1,
  ];
}

/** Camera of the preview, shared with the draw-distance test so culling matches what is seen. */
export const EYE: Vec3 = [0, 2.4, 8];
export const TARGET: Vec3 = [0, 1, 0];

/** Instances placed per density level; every level keeps all placements of the sparser ones. */
export const DENSITY_COUNTS: Record<ObjectDensity, { characters: number; props: number }> = {
  low: { characters: 1, props: 12 },
  medium: { characters: 3, props: 24 },
  high: { characters: 5, props: 48 },
};

const CHARACTER_SLOTS: Vec3[] = [
  [0, 0, 0],
  [-1.6, 0, -2.5],
  [1.6, 0, -2.5],
  [-3.2, 0, -5],
  [3.2, 0, -5],
];

export interface PlacementMember {
  key: string;
  family: 'character' | 'tree' | 'rock' | 'bush';
}

export interface Placement {
  id: string;
  member: string;
  position: Vec3;
  /** Rotation about +Y in radians. */
  yaw: number;
  /** Distance from the camera eye in metres. */
  distance: number;
}

const distanceFromEye = (position: Vec3) =>
  Math.hypot(position[0] - EYE[0], position[1] - EYE[1], position[2] - EYE[2]);

/**
 * Deterministic scene layout: characters near the camera, props cycling through the non-character
 * members (in key order) along both sides of a path that runs 110 m away from the camera. The
 * result depends only on the member keys and the density, never on load or registration order.
 */
export function scenePlacements(members: readonly PlacementMember[], density: ObjectDensity): Placement[] {
  const counts = DENSITY_COUNTS[density];
  const characters = members.filter((member) => member.family === 'character').map((member) => member.key).sort();
  const props = members.filter((member) => member.family !== 'character').map((member) => member.key).sort();
  const placements: Placement[] = [];
  if (characters.length > 0) {
    for (let index = 0; index < counts.characters; index++) {
      const position = CHARACTER_SLOTS[index];
      placements.push({
        id: `character-${index}`,
        member: characters[index % characters.length],
        position,
        yaw: 0,
        distance: distanceFromEye(position),
      });
    }
  }
  if (props.length > 0) {
    for (let index = 0; index < counts.props; index++) {
      const side = index % 2 === 0 ? -1 : 1;
      const position: Vec3 = [side * (6 + ((index * 37) % 11) * 1.3), 0, 4 - ((index * 113) % 48) * 2.4];
      placements.push({
        id: `prop-${index}`,
        member: props[index % props.length],
        position,
        yaw: (((index * 137) % 360) * Math.PI) / 180,
        distance: distanceFromEye(position),
      });
    }
  }
  return placements;
}

/** Placements within the draw distance, in placement order. */
export function drawnPlacements(placements: readonly Placement[], drawDistance: number): Placement[] {
  return placements.filter((placement) => placement.distance <= drawDistance);
}

/** Column-major model matrix: rotation `yaw` about +Y, then translation. */
export function placementMatrix(position: Vec3, yaw: number, scale = 1): Matrix4Values {
  const c = Math.cos(yaw) * scale;
  const s = Math.sin(yaw) * scale;
  return [c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, position[0], position[1], position[2], 1];
}
