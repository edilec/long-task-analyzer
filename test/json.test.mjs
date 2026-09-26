import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUniqueJson, readBoundedJson, JsonEvidenceError } from '../src/json.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('JSON depth and node limits accept N and refuse N plus one', () => {
  const text = '{"a":[1]}';
  assert.deepEqual(parseUniqueJson(text, { maxDepth: 2, maxNodes: 3 }), { a: [1] });
  assert.throws(() => parseUniqueJson(text, { maxDepth: 1, maxNodes: 3 }),
    (error) => error instanceof JsonEvidenceError && error.code === 'depth-limit');
  assert.throws(() => parseUniqueJson(text, { maxDepth: 2, maxNodes: 2 }),
    (error) => error instanceof JsonEvidenceError && error.code === 'node-limit');
});

test('duplicate task duration keys cannot overwrite blocking evidence', () => {
  assert.throws(() => parseUniqueJson('{"durationMs":80,"durationMs":40}'),
    (error) => error instanceof JsonEvidenceError && error.code === 'duplicate-key');
});

test('rounded numeric duration is refused but exact decimal representation is legal', () => {
  assert.equal(parseUniqueJson('49.999'), 49.999);
  assert.throws(() => parseUniqueJson('49.999999999999999999'),
    (error) => error instanceof JsonEvidenceError && error.code === 'numeric-precision');
});

test('reader rejects malformed UTF-8 inside an otherwise valid JSON string', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trace-json-'));
  const path = join(root, 'trace.json');
  writeFileSync(path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]));
  await assert.rejects(readBoundedJson(path, root),
    (error) => error instanceof JsonEvidenceError && error.code === 'invalid-utf8');
});
