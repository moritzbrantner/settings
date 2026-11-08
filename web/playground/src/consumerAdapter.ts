// Playground-owned consumer adapter between committed setting changes and the application.
// A real consumer would dispatch each change to its renderer, audio engine or game here; the
// playground's previews already follow the committed values, so the adapter only decides whether
// the consumer accepted the changes. Its failure switch simulates a consumer that cannot apply a
// change, so the playground can exercise `revertApplied()` without failure injection in the core.
import type { SettingChange } from '@moritzbrantner/settings-browser';

export class ConsumerApplyError extends Error {}

export interface ConsumerAdapter {
  /** Throws `ConsumerApplyError` when the consumer cannot apply the changes. */
  apply(changes: readonly SettingChange[]): void;
}

export function createConsumerAdapter(simulateFailure: () => boolean): ConsumerAdapter {
  return {
    apply(changes) {
      if (changes.length > 0 && simulateFailure()) {
        throw new ConsumerApplyError(
          `Simulated consumer failure while applying ${changes.map((change) => change.id).join(', ')}`,
        );
      }
    },
  };
}
