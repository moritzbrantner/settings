// Assemble the @moritzbrantner/settings-browser package the playground consumes.
//
// The playground imports the package by its public name; Vite and TypeScript resolve that name to
// `.settings-browser/`, assembled here in the published `browser-dist` layout (adapter,
// declarations and generated WASM in `pkg/`) plus the React bridge source of the same commit.
// Set SETTINGS_BROWSER_DIST to an already assembled package directory (for example the `dist/`
// built by the Pages workflow) to reuse its WASM build instead of running wasm-pack.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const playgroundDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(playgroundDir, '..', '..');
const packageDir = join(playgroundDir, '.settings-browser');

rmSync(packageDir, { recursive: true, force: true });
mkdirSync(packageDir, { recursive: true });

if (process.env.SETTINGS_BROWSER_DIST) {
  const dist = resolve(process.env.SETTINGS_BROWSER_DIST);
  for (const file of ['settings-browser.js', 'pkg/settings_wasm.js', 'pkg/settings_wasm_bg.wasm']) {
    if (!existsSync(join(dist, file))) throw new Error(`${dist} is missing ${file}`);
  }
  cpSync(join(dist, 'pkg'), join(packageDir, 'pkg'), { recursive: true });
} else {
  execFileSync(
    'wasm-pack',
    [
      'build',
      join(repoRoot, 'crates', 'settings-wasm'),
      '--target',
      'web',
      '--release',
      '--out-dir',
      join(packageDir, 'pkg'),
      '--out-name',
      'settings_wasm',
    ],
    { stdio: 'inherit' },
  );
}

for (const file of ['settings-browser.js', 'settings-browser.d.ts', 'settings-react.ts']) {
  copyFileSync(join(repoRoot, 'web', file), join(packageDir, file));
}
copyFileSync(join(repoRoot, 'web', 'browser-package.json'), join(packageDir, 'package.json'));
console.log(`assembled @moritzbrantner/settings-browser at ${packageDir}`);
