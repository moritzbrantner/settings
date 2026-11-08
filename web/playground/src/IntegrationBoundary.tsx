// App-level failure isolation (issue #30). A failing optional integration (3d-lab preview, Rapier
// physics, Web Audio, input-bindings editor) renders a named diagnostic in its place instead of
// unmounting the whole playground; the settings rows around it stay usable.
//
// `?fail-integration=<id>` makes that integration throw while rendering, so the diagnostic path is
// exercised deterministically by the browser journeys (and can be inspected by hand).
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@moritzbrantner/ui/stable';

export type IntegrationId = 'graphics' | 'physics' | 'audio' | 'input-bindings';

const SIMULATE_PARAM = 'fail-integration';

function simulatedFailure(id: IntegrationId): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).getAll(SIMULATE_PARAM).includes(id);
}

function SimulatedFailure({ id }: { id: IntegrationId }): never {
  throw new Error(`simulated failure requested by ?${SIMULATE_PARAM}=${id}`);
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message || error.name : String(error);

interface BoundaryProps {
  fallback: (error: unknown, retry: () => void) => ReactNode;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
  error?: unknown;
}

/** Generic React error boundary: renders `fallback` once a descendant throws. */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Settings Playground: a component failed', error, info.componentStack);
  }

  private readonly retry = () => this.setState({ failed: false, error: undefined });

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.state.error, this.retry) : this.props.children;
  }
}

/** Isolates one optional integration and names it in the diagnostic when it fails. */
export function IntegrationBoundary({
  id,
  name,
  children,
}: {
  id: IntegrationId;
  name: string;
  children: ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={(error, retry) => (
        <section
          role="alert"
          aria-label={`${name} failed`}
          data-integration-failed={id}
          className="grid min-w-0 gap-2 rounded-lg border border-destructive p-4"
        >
          <p className="font-medium">{name} could not be shown.</p>
          <p className="min-w-0 break-words text-sm text-muted-foreground">
            {errorMessage(error)}. The settings in this section remain editable.
          </p>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Retry {name}
            </Button>
          </div>
        </section>
      )}
    >
      {simulatedFailure(id) ? <SimulatedFailure id={id} /> : children}
    </ErrorBoundary>
  );
}

/** Whole-application diagnostic used both for startup failures and uncaught render failures. */
export function PlaygroundFailure({ error }: { error: unknown }) {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Settings Playground</h1>
      <p role="alert">The playground could not start: {errorMessage(error)}</p>
    </main>
  );
}
