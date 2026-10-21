// Playground composition of the input-bindings-owned Controls surface (issue #24). The playground
// owns its semantic actions, their defaults and where the binding profile is stored; actions,
// chords, conflicts, reset and the editor itself belong to `input-bindings`. No binding state ever
// enters the settings session.
import {
  portableConfigurationFromProfile,
  profileFromPortableConfiguration,
  resolvePortableConfiguration,
  serializePortableConfiguration,
  type ActionRegistry,
  type Binding,
  type InputStroke,
  type PortableConfigurationV1,
  type Profile,
} from '@moritzbrantner/input-bindings';

/** The opaque surface id the fixture's `input_bindings_surfaces` descriptor names. */
export const CONTROLS_SURFACE_ID = 'playground.controls';
export const BINDINGS_STORAGE_KEY = 'settings-playground.input-bindings.profile';
const REGISTRY_VERSION = 1;
const PROFILE_ID = 'playground-user';

const key = (id: string, action: string, code: string): Binding => ({
  id,
  action,
  sequence: [{ key: { kind: 'physical', value: code } }],
  when: { op: 'always' },
  priority: 0,
});
const stroke = (id: string, action: string, input: InputStroke): Binding => ({
  id,
  action,
  sequence: [input],
  when: { op: 'always' },
  priority: 0,
});
const pad = (button: number): InputStroke => ({ device: 'gamepadButton', button, threshold: 0.5 });

export const controlsRegistry: ActionRegistry = {
  actions: [
    {
      id: 'move.forward',
      title: 'Move forward',
      categoryPath: ['Movement'],
      repeatPolicy: 'allow',
      allowedDevices: ['keyboard', 'gamepad'],
      defaults: [key('move.forward.key', 'move.forward', 'KeyW')],
    },
    {
      id: 'move.back',
      title: 'Move back',
      categoryPath: ['Movement'],
      repeatPolicy: 'allow',
      allowedDevices: ['keyboard', 'gamepad'],
      defaults: [key('move.back.key', 'move.back', 'KeyS')],
    },
    {
      id: 'move.left',
      title: 'Strafe left',
      categoryPath: ['Movement'],
      repeatPolicy: 'allow',
      allowedDevices: ['keyboard', 'gamepad'],
      defaults: [key('move.left.key', 'move.left', 'KeyA')],
    },
    {
      id: 'move.right',
      title: 'Strafe right',
      categoryPath: ['Movement'],
      repeatPolicy: 'allow',
      allowedDevices: ['keyboard', 'gamepad'],
      defaults: [key('move.right.key', 'move.right', 'KeyD')],
    },
    {
      id: 'move.jump',
      title: 'Jump',
      categoryPath: ['Movement'],
      repeatPolicy: 'never',
      allowedDevices: ['keyboard', 'gamepad', 'pointer'],
      defaults: [
        key('move.jump.key', 'move.jump', 'Space'),
        stroke('move.jump.pad', 'move.jump', pad(0)),
        stroke('move.jump.swipe', 'move.jump', {
          device: 'gesture',
          gesture: { kind: 'swipe', direction: 'N' },
        }),
      ],
    },
    {
      id: 'action.interact',
      title: 'Interact',
      categoryPath: ['Actions'],
      repeatPolicy: 'never',
      allowedDevices: ['keyboard', 'gamepad', 'pointer'],
      defaults: [
        key('action.interact.key', 'action.interact', 'KeyE'),
        stroke('action.interact.pad', 'action.interact', pad(2)),
        stroke('action.interact.tap', 'action.interact', {
          device: 'gesture',
          gesture: { kind: 'tap' },
        }),
      ],
    },
    {
      id: 'action.attack',
      title: 'Attack',
      categoryPath: ['Actions'],
      repeatPolicy: 'never',
      allowedDevices: ['mouse', 'gamepad'],
      defaults: [
        stroke('action.attack.mouse', 'action.attack', { device: 'mouseButton', button: 0 }),
        stroke('action.attack.pad', 'action.attack', pad(7)),
      ],
    },
    {
      id: 'ui.inventory',
      title: 'Inventory',
      categoryPath: ['Interface'],
      repeatPolicy: 'never',
      allowedDevices: ['keyboard', 'gamepad'],
      defaults: [
        key('ui.inventory.key', 'ui.inventory', 'KeyI'),
        stroke('ui.inventory.pad', 'ui.inventory', pad(3)),
      ],
    },
    {
      id: 'ui.map',
      title: 'Map',
      categoryPath: ['Interface'],
      repeatPolicy: 'never',
      allowedDevices: ['keyboard', 'gamepad'],
      defaults: [
        key('ui.map.key', 'ui.map', 'KeyM'),
        stroke('ui.map.pad', 'ui.map', pad(8)),
      ],
    },
  ],
};

const emptyProfile = (): Profile => ({ id: PROFILE_ID, patches: [] });
const defaultBindings = controlsRegistry.actions.flatMap((action) => action.defaults ?? []);

/** Load the stored binding profile; anything input-bindings does not accept starts from defaults. */
export function loadBindingsProfile(storage: Pick<Storage, 'getItem'>): Profile {
  try {
    const raw = storage.getItem(BINDINGS_STORAGE_KEY);
    if (!raw) return emptyProfile();
    const report = resolvePortableConfiguration(JSON.parse(raw) as PortableConfigurationV1, {
      registry: controlsRegistry,
      currentRegistryVersion: REGISTRY_VERSION,
    });
    if (report.valid && report.configuration) return profileFromPortableConfiguration(report.configuration);
  } catch {
    // Corrupt stored bindings are discarded rather than reinterpreted.
  }
  return emptyProfile();
}

export function saveBindingsProfile(storage: Pick<Storage, 'setItem'>, profile: Profile): void {
  const { configuration } = portableConfigurationFromProfile(profile, defaultBindings, REGISTRY_VERSION);
  storage.setItem(BINDINGS_STORAGE_KEY, serializePortableConfiguration(configuration));
}
