// Live 3d-lab preview for the Graphics category. It receives only committed renderer
// configuration: immediate settings arrive as soon as they commit, staged ones after Apply.
// Construction options (anti-aliasing, shadows) need a new WebGL context, so a change replaces
// the canvas and renderer; everything else is a per-frame command to the existing renderer.
import { useEffect, useRef, useState } from 'react';
import {
  createThreeSceneRenderer,
  type RendererSceneNode,
  type RendererWorkObservations,
  type ThreeSceneRenderer,
} from '@moritzbrantner/three-d-renderer';
import { environmentFor, lookAt, projectionMatrix, type RendererConfig } from './graphics';

const EYE: [number, number, number] = [0, 2.4, 8];
const TARGET: [number, number, number] = [0, 1, 0];

const NODES: RendererSceneNode[] = [
  { id: 'ground', geometry: { kind: 'box', size: [40, 0.2, 80] }, color: '#5d7350', transform: { translation: [0, -0.1, -25] } },
  { id: 'sphere', geometry: { kind: 'sphere', radius: 1 }, color: '#d9a441', transform: { translation: [-1.8, 1, 0] } },
  { id: 'cylinder', geometry: { kind: 'cylinder', radius: 0.6, height: 2.4 }, color: '#4d7fc4', transform: { translation: [1.8, 1.2, -0.5] } },
  ...Array.from({ length: 8 }, (_, index): RendererSceneNode => ({
    id: `pillar-${index}`,
    geometry: { kind: 'box', size: [0.8, 3, 0.8] },
    color: '#c7c2b8',
    transform: { translation: [index % 2 === 0 ? -4 : 4, 1.5, -4 - index * 6] },
  })),
];

interface Size {
  width: number;
  height: number;
}

export function GraphicsPreview({ config, webgl }: { config: RendererConfig; webgl: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<ThreeSceneRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [observations, setObservations] = useState<RendererWorkObservations | null>(null);
  const { antialias, shadows } = config;

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
      setError(null);
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

  useEffect(() => {
    if (!renderer || !size) return;
    try {
      renderer.setSize(size.width, size.height, window.devicePixelRatio * config.renderScale);
      setObservations(
        renderer.render({
          camera: {
            viewMatrix: lookAt(EYE, TARGET),
            projectionMatrix: projectionMatrix(config.fovDegrees, size.width / size.height),
          },
          environment: environmentFor(config),
          nodes: NODES,
        }),
      );
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, [renderer, size, config]);

  const pixelRatio = Math.min(window.devicePixelRatio * config.renderScale, 4);
  return (
    <figure className="grid w-full max-w-2xl min-w-0 gap-1">
      <div
        ref={hostRef}
        data-graphics-preview=""
        data-renderer-ready={String(renderer !== null)}
        data-antialias={String(antialias)}
        data-shadows={String(shadows)}
        data-render-scale={String(config.renderScale)}
        data-fov={String(config.fovDegrees)}
        data-fog={config.fog}
        className="relative aspect-video w-full min-w-0 overflow-hidden rounded-lg border border-border bg-muted"
      >
        {!webgl && (
          <p className="p-3 text-sm text-muted-foreground">
            Preview unavailable: this browser does not report WebGL 2 rendering.
          </p>
        )}
        {error && (
          <p role="alert" className="absolute inset-x-0 top-0 p-3 text-sm">
            The renderer failed: {error}
          </p>
        )}
        {config.debugOverlay && observations && size && (
          <pre
            data-testid="render-overlay"
            className="absolute top-2 left-2 rounded bg-background/80 px-2 py-1 text-xs"
          >
            {`${Math.round(size.width * pixelRatio)}×${Math.round(size.height * pixelRatio)} px\n`}
            {`objects ${observations.liveObjectCount} · materials ${observations.liveMaterialCount}`}
          </pre>
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Live 3d-lab preview of the applied graphics settings.
      </figcaption>
    </figure>
  );
}
