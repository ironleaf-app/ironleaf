// node --test tests/clipper-queue.test.mjs — clips waiting for the Vault (extensions/clipper/queue.js; 8.8): kept in
// order when the Vault is closed, each taken off only once it landed, nothing ever dropped.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueue } from '../extensions/clipper/queue.js';

const memory = () => {
  const data = new Map();
  return {
    async get(k) {
      return data.get(k);
    },
    async set(k, v) {
      data.set(k, v);
    },
  };
};

test('waiting clips: kept in order, each taken off only once it landed', async () => {
  const queue = createQueue(memory());
  assert.equal(await queue.count(), 0);
  assert.deepEqual(await queue.all(), []);
  const first = await queue.add({ kind: 'article', url: 'https://example.com/a' });
  const second = await queue.add({ kind: 'bookmark', url: 'https://example.com/b' });
  assert.ok(first.id && second.id && first.id !== second.id);
  assert.ok(first.queuedAt <= second.queuedAt);
  assert.equal(await queue.count(), 2);
  assert.deepEqual((await queue.all()).map((item) => item.clip.url), ['https://example.com/a', 'https://example.com/b']);
  await queue.remove(first.id);
  assert.equal(await queue.count(), 1);
  assert.equal((await queue.all())[0].id, second.id, 'the rest waits');
  await queue.remove('no-such-id');
  assert.equal(await queue.count(), 1, 'an unknown id takes nothing off');
  await queue.clear();
  assert.equal(await queue.count(), 0);
});

test('a strange store reads as empty, never a crash', async () => {
  const queue = createQueue({ get: async () => 'not a list', set: async () => {} });
  assert.deepEqual(await queue.all(), []);
  assert.equal(await queue.count(), 0);
});
