import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const settingsBrowser = fileURLToPath(new URL('./.settings-browser/', import.meta.url));
const fixture = fileURLToPath(
  new URL('../../fixtures/presentation/playground.json', import.meta.url),
);
const FIXTURE_NAME = 'playground-settings.json';

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
  plugins: [react(), tailwindcss(), playgroundFixture()],
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
