// Live 3d-lab preview for the Graphics category. It receives only committed renderer
// configuration: immediate settings arrive as soon as they commit, staged ones after Apply.
// Construction options (anti-aliasing, shadows) need a new WebGL context, so a change replaces
// the canvas and renderer; everything else is a per-frame command to the existing renderer.
//
// The scene is asset-tooling content (issue #25): the Ranger character and the Greyhaven nature
// members, loaded through 3d-lab's bundle adapters. Object density and draw distance choose which
// placements are drawn. An asset the renderer cannot draw becomes a proxy sized from the bundle's
// descriptor and is explained in the developer diagnostics below the preview.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createThreeSceneRenderer,
  type RendererSceneNode,
  type RendererWorkObservations,
  type ThreeSceneRenderer,
} from '@moritzbrantner/three-d-renderer';
import type { ImportedCharacterInstance, ImportedItemInstance } from '@moritzbrantner/three-d-renderer/imported-character';
import {
  DENSITY_COUNTS,
  drawnPlacements,
  environmentFor,
  EYE,
  lookAt,
  placementMatrix,
  projectionMatrix,
  scenePlacements,
  TARGET,
  type Placement,
  type PlacementMember,
  type RendererConfig,
} from './graphics';
import { CHARACTER_CLIP, loadSceneKit, type SceneKit, type SceneMember } from './sceneKit';
import { SceneKitDiagnostics } from './SceneKitDiagnostics';

const GROUND: RendererSceneNode = {
  id: 'ground',
  geometry: { kind: 'box', size: [60, 0.2, 140] },
  color: '#5d7350',
  transform: { translation: [0, -0.1, -50] },
};

const PROXY_COLOR: Record<SceneMember['family'], `#${string}`> = {
  character: '#b9a68a',
  tree: '#46613d',
  rock: '#8d8a84',
  bush: '#5f7d45',
};

/** Members used when the scene kit itself is unavailable, so density and distance stay visible. */
const PROXY_MEMBERS: SceneMember[] = (['character', 'tree', 'rock', 'bush'] as const).map((family) => ({
  key: `proxy.${family}`,
  bundle: 'none',
  family,
  footprint:
    family === 'character'
      ? { width: 0.6, height: 1.8, depth: 0.4 }
      : family === 'tree'
        ? { width: 5, height: 8, depth: 5 }
        : family === 'rock'
          ? { width: 3, height: 2, depth: 3 }
          : { width: 1.4, height: 1, depth: 1.3 },
  variant: null,
  attempts: [],
  item: null,
  character: null,
}));

/** A primitive stand-in sized from the member's footprint, for an asset that cannot be drawn. */
function proxyNode(placement: Placement, member: SceneMember): RendererSceneNode {
  const { width, height, depth } = member.footprint;
  const [x, y, z] = placement.position;
  const geometry: RendererSceneNode['geometry'] =
    member.family === 'tree' || member.family === 'character'
      ? { kind: 'cylinder', radius: Math.min(width, depth) / (member.family === 'tree' ? 6 : 2), height }
      : { kind: 'box', size: [width, height, depth] };
  return {
    id: `proxy/${placement.id}`,
    geometry,
    color: PROXY_COLOR[member.family],
    transform: { translation: [x, y + height / 2, z] },
  };
}

type Instance = { kind: 'item'; value: ImportedItemInstance } | { kind: 'character'; value: ImportedCharacterInstance };

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
  const [kit, setKit] = useState<SceneKit | null>(null);
  const instances = useRef(new Map<string, Instance>());
  const { antialias, shadows } = config;

  useEffect(() => {
    if (!webgl) return;
    let cancelled = false;
    let loaded: SceneKit | null = null;
    void loadSceneKit().then((result) => {
      loaded = result;
      if (cancelled) result.dispose();
      else setKit(result);
    });
    const pool = instances.current;
    return () => {
      cancelled = true;
      for (const instance of pool.values()) instance.value.dispose();
      pool.clear();
      loaded?.dispose();
    };
  }, [webgl]);

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

  const members = useMemo(() => {
    if (!kit) return [];
    return kit.members.length > 0 ? kit.members : PROXY_MEMBERS;
  }, [kit]);
  const placements = useMemo(
    () => scenePlacements(members as readonly PlacementMember[], config.objectDensity),
    [members, config.objectDensity],
  );
  const drawn = useMemo(() => drawnPlacements(placements, config.drawDistance), [placements, config.drawDistance]);

  useEffect(() => {
    if (!renderer || !size || !kit) return;
    try {
      const byKey = new Map(members.map((member) => [member.key, member]));
      const nodes: RendererSceneNode[] = [GROUND];
      // Pooled instances outside the drawn set are simply not submitted; the renderer removes them.
      const roots = [];
      for (const placement of drawn) {
        const member = byKey.get(placement.member);
        if (!member) continue;
        const instance = instanceFor(placement, member);
        if (instance) roots.push(instance.value.root);
        else nodes.push(proxyNode(placement, member));
      }
      const camera = {
        viewMatrix: lookAt(EYE, TARGET),
        projectionMatrix: projectionMatrix(config.fovDegrees, size.width / size.height),
      };
      renderer.setSize(size.width, size.height, window.devicePixelRatio * config.renderScale);
      renderer.renderImportedRoots({ camera, roots });
      setObservations(renderer.render({ camera, environment: environmentFor(config), nodes }));
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }

    function instanceFor(placement: Placement, member: SceneMember): Instance | null {
      const pooled = instances.current.get(placement.id);
      if (pooled) return pooled;
      const modelMatrix = placementMatrix(placement.position, placement.yaw);
      let created: Instance | null = null;
      if (member.character) {
        const value = member.character.createInstance({ modelMatrix });
        value.seek(CHARACTER_CLIP, 0);
        created = { kind: 'character', value };
      } else if (member.item) {
        const value = member.item.createInstance();
        value.root.matrixAutoUpdate = false;
        value.root.matrix.fromArray(modelMatrix);
        created = { kind: 'item', value };
      }
      if (created) instances.current.set(placement.id, created);
      return created;
    }
  }, [renderer, size, config, kit, members, drawn]);

  const pixelRatio = Math.min(window.devicePixelRatio * config.renderScale, 4);
  const kitStatus = !webgl ? 'unavailable' : kit === null ? 'loading' : kit.status;
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
        data-object-density={config.objectDensity}
        data-draw-distance={String(config.drawDistance)}
        data-scene-kit={kitStatus}
        data-placed-instances={String(placements.length)}
        data-drawn-instances={String(drawn.length)}
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
            {`objects ${observations.liveObjectCount} · materials ${observations.liveMaterialCount}\n`}
            {`instances ${drawn.length}/${placements.length} within ${config.drawDistance} m`}
          </pre>
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Live 3d-lab preview of the applied graphics settings with asset-tooling content
        {` (${DENSITY_COUNTS[config.objectDensity].characters} characters, ${DENSITY_COUNTS[config.objectDensity].props} props).`}
      </figcaption>
      {webgl && <SceneKitDiagnostics kit={kit} />}
    </figure>
  );
}
