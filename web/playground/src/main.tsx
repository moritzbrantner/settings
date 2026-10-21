import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createSettingsSession } from '@moritzbrantner/settings-browser';
import { App } from './App';
import { detectRendererCapabilities } from './graphics';
import type { PlaygroundFixture } from './model';
import './styles.css';

const FIXTURE_URL = 'playground-settings.json';

async function start(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root');
  const root = createRoot(container);
  try {
    const response = await fetch(new URL(FIXTURE_URL, document.baseURI), { cache: 'no-store' });
    if (!response.ok) throw new Error(`failed to load ${FIXTURE_URL}: ${response.status}`);
    const fixture = (await response.json()) as PlaygroundFixture;
    const session = await createSettingsSession(fixture.definitions, fixture.presentation);
    const capabilities = detectRendererCapabilities();
    session.setCapabilities(capabilities);
    root.render(
      <StrictMode>
        <App session={session} fixture={fixture} webgl={capabilities['renderer.webgl'] === true} />
      </StrictMode>,
    );
  } catch (error) {
    root.render(
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Settings Playground</h1>
        <p role="alert">The playground could not start: {String(error)}</p>
      </main>,
    );
  }
}

void start();
