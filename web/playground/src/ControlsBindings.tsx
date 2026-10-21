// Resolves the fixture's opaque input-bindings surface descriptor to the real `input-bindings`
// workbench. Binding edits, conflicts and reset happen inside that editor; this component only
// supplies the playground's action registry and stores the resulting profile.
import { useState } from 'react';
import type { Profile } from '@moritzbrantner/input-bindings';
import { InputBindingsWorkbench } from '@moritzbrantner/input-bindings-react/workbench';
import '@moritzbrantner/input-bindings-react/workbench.css';
import {
  CONTROLS_SURFACE_ID,
  controlsRegistry,
  loadBindingsProfile,
  saveBindingsProfile,
} from './controls';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ControlsBindings({ surfaceId }: { surfaceId: string }) {
  const [profile, setProfile] = useState<Profile>(() => {
    const store = storage();
    return store ? loadBindingsProfile(store) : { id: 'playground-user', patches: [] };
  });

  if (surfaceId !== CONTROLS_SURFACE_ID) {
    return (
      <p role="alert" className="min-w-0 text-sm text-muted-foreground">
        No input-bindings surface is registered for “{surfaceId}”.
      </p>
    );
  }

  const change = (next: Profile) => {
    setProfile(next);
    const store = storage();
    if (store) saveBindingsProfile(store, next);
  };

  return (
    <section
      aria-label="Key and button bindings"
      data-input-bindings-surface={surfaceId}
      className="min-w-0 overflow-x-auto rounded-lg border border-border"
    >
      <InputBindingsWorkbench
        registry={controlsRegistry}
        profile={profile}
        onProfileChange={change}
        title="Bindings"
        description="Owned by input-bindings: conflicts and binding resets live here, separate from the settings below."
      />
    </section>
  );
}
