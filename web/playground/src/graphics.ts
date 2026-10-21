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
}

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
  return {
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
