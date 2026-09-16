import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixtureUrl = new URL('../fixtures/presentation/reference.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const definitionIds = new Set(fixture.definitions.map((definition) => definition.id));
const presentationIds = new Set();

for (const entry of fixture.presentation) {
  assert(definitionIds.has(entry.id), `presentation references unknown setting ${entry.id}`);
  assert(!presentationIds.has(entry.id), `duplicate presentation entry ${entry.id}`);
  presentationIds.add(entry.id);

  const keys = [
    entry.metadata.label_key,
    entry.metadata.description_key,
    entry.metadata.category_key,
    entry.metadata.group_key,
    ...(entry.metadata.search_keys ?? []),
  ].filter(Boolean);

  for (const key of keys) {
    assert(
      Object.hasOwn(fixture.localizations, key),
      `reference localization is missing ${key}`,
    );
  }
}

assert.equal(
  presentationIds.size,
  definitionIds.size,
  'reference UI fixture should present every reference setting',
);
