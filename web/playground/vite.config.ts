import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const settingsBrowser = fileURLToPath(new URL('./.settings-browser/', import.meta.url));
const fixture = fileURLToPath(
  new URL('../../fixtures/presentation/playground.json', import.meta.url),
);
const FIXTURE_NAME = 'playground-settings.json';
const sceneKit = fileURLToPath(new URL('./.scene-kit/', import.meta.url));
const SCENE_KIT_PREFIX = '/scene-kit/';
const SCENE_KIT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
};

/**
 * Serve (dev) and copy (build) the fetched scene kit from `bun run fetch:scene-kit` unchanged as
 * `scene-kit/`. When it was not fetched nothing is served and the preview shows its fallback.
 */
function playgroundSceneKit(): Plugin {
  return {
    name: 'settings-playground-scene-kit',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent(request.url?.split('?')[0] ?? '');
        const at = path.indexOf(SCENE_KIT_PREFIX);
        if (at < 0) return next();
        const relative = normalize(path.slice(at + SCENE_KIT_PREFIX.length));
        const file = join(sceneKit, relative);
        if (relative.startsWith('..') || !existsSync(file) || !statSync(file).isFile()) return next();
        response.setHeader('content-type', SCENE_KIT_TYPES[extname(file)] ?? 'application/octet-stream');
        response.end(readFileSync(file));
      });
    },
    writeBundle(options) {
      if (options.dir && existsSync(sceneKit)) {
        cpSync(sceneKit, join(options.dir, 'scene-kit'), { recursive: true });
      }
    },
  };
}

/** Serve and emit the shared playground fixture unchanged as `playground-settings.json`. */
function playgroundFixture(): Plugin {
  return {
    name: 'settings-playground-fixture',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0]?.endsWith(`/${FIXTURE_NAME}`)) {
          response.setHeader('content-type', 'application/json');
          response.end(readFileSync(fixture));
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FIXTURE_NAME, source: readFileSync(fixture) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), playgroundFixture(), playgroundSceneKit()],
  resolve: {
    alias: [
      {
        find: /^@moritzbrantner\/settings-browser\/react$/,
        replacement: `${settingsBrowser}settings-react.ts`,
      },
      {
        find: /^@moritzbrantner\/settings-browser$/,
        replacement: `${settingsBrowser}settings-browser.js`,
      },
    ],
    dedupe: ['react', 'react-dom', '@moritzbrantner/ui'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  preview: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
  },
});
