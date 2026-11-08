import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createSettingsSession } from '@moritzbrantner/settings-browser';
import { App } from './App';
import { ErrorBoundary, PlaygroundFailure } from './IntegrationBoundary';
import { detectRendererCapabilities } from './graphics';
import { applyUrlOverlays, browserStorage, loadStoredScopes } from './lab';
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
    // Restore the stored durable snapshots, then layer the developer overlays from the URL on top.
    const storage = browserStorage();
    const startupResults = loadStoredScopes(session, storage);
    const definitions = new Map(fixture.definitions.map((definition) => [definition.id, definition]));
    const urlProblems = applyUrlOverlays(session, definitions, window.location.search);
    root.render(
      <StrictMode>
        <ErrorBoundary fallback={(error) => <PlaygroundFailure error={error} />}>
          <App
            session={session}
            fixture={fixture}
            webgl={capabilities['renderer.webgl'] === true}
            storage={storage}
            startupResults={startupResults}
            urlProblems={urlProblems}
          />
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (error) {
    root.render(<PlaygroundFailure error={error} />);
  }
}

void start();
