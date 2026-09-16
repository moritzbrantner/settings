import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SettingsBooleanField,
  assertBooleanBinding,
} from './settings-react.js';

function definition(id = 'accessibility.reduce_motion') {
  return {
    id,
    kind: { type: 'bool' },
    default: { type: 'bool', value: false },
    scope: 'user',
    apply_mode: 'immediate',
  };
}

function presentation(id = 'accessibility.reduce_motion') {
  return {
    id,
    metadata: {
      label_key: 'settings.reduceMotion.title',
      description_key: 'settings.reduceMotion.description',
      category_key: 'settings.presentation',
    },
  };
}

function renderField(overrides = {}) {
  return renderToStaticMarkup(
    createElement(SettingsBooleanField, {
      definition: definition(),
      presentation: presentation(),
      value: { type: 'bool', value: true },
      localize: (key) => `localized:${key}`,
      onValueChange: () => undefined,
      ...overrides,
    }),
  );
}

test('maps a validated boolean setting into the shared ToggleSetting surface', () => {
  const html = renderField({ switchProps: { 'data-testid': 'shared-toggle' } });

  assert.match(html, /localized:settings\.reduceMotion\.title/);
  assert.match(html, /localized:settings\.reduceMotion\.description/);
  assert.match(html, /data-setting-id="accessibility\.reduce_motion"/);
  assert.match(html, /data-setting-kind="bool"/);
  assert.match(html, /data-testid="shared-toggle"/);
  assert.match(html, /aria-checked="true"/);
});

test('rejects mismatched presentation and non-boolean values', () => {
  assert.throws(
    () => assertBooleanBinding(definition(), presentation('other.setting'), { type: 'bool', value: true }),
    /presentation metadata must match/,
  );
  assert.throws(
    () => assertBooleanBinding(definition(), presentation(), { type: 'text', value: 'true' }),
    /requires a bool setting value/,
  );
});

test('bridge-owned controlled props cannot be overridden by passthrough JavaScript props', () => {
  const html = renderField({
    title: 'untrusted title',
    checked: false,
    defaultChecked: false,
    onCheckedChange: () => {
      throw new Error('untrusted callback');
    },
    switchProps: {
      checked: false,
      defaultChecked: false,
      disabled: true,
      onCheckedChange: () => {
        throw new Error('untrusted switch callback');
      },
    },
  });

  assert.doesNotMatch(html, /untrusted title/);
  assert.match(html, /localized:settings\.reduceMotion\.title/);
  assert.match(html, /aria-checked="true"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('default ids remain unique even for setting ids that normalize similarly', () => {
  const html = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(SettingsBooleanField, {
        definition: definition('video.fullscreen'),
        presentation: presentation('video.fullscreen'),
        value: { type: 'bool', value: true },
        localize: (key) => key,
        onValueChange: () => undefined,
      }),
      createElement(SettingsBooleanField, {
        definition: definition('video-fullscreen'),
        presentation: presentation('video-fullscreen'),
        value: { type: 'bool', value: false },
        localize: (key) => key,
        onValueChange: () => undefined,
      }),
    ),
  );

  const ids = [...html.matchAll(/data-slot="switch"[^>]* id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});
