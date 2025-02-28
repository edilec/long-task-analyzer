import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = new URL('../bin/long-task-analyzer.mjs', import.meta.url).pathname;
const fixture = { schemaVersion: 1,
  tasks: [{ startMs: 100, durationMs: 49.999, script: '/bundle.js' }],
  routes: [{ id: '/catalog', startMs: 0, endMs: 300 }],
  interactions: [{ id: 'tap-add', startMs: 90, endMs: 250 }],
};
const temp = () => mkdtempSync(join(tmpdir(), 'long-task-analyzer-'));
const run = (root, ...args) => spawnSync(process.execPath, [bin, '--root', root, ...args], { encoding: 'utf8' });

test('CLI short-task good case emits JSON and fixed human summary', () => {
  const root = temp();
  writeFileSync(join(root, 'trace.json'), JSON.stringify(fixture));
  const result = run(root, '--input', 'trace.json');
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, 'pass');
  assert.equal(result.stderr, 'Long task analyzer: PASS; 0 findings.\n');
  const json = run(root, '--input', 'trace.json', '--json');
  assert.equal(json.status, 0);
  assert.equal(json.stderr, '');
  assert.equal(json.stdout, result.stdout);
});

test('CLI synthetic blocking interval identifies task without fabricated function name', () => {
  const root = temp();
  const input = structuredClone(fixture);
  input.tasks[0].durationMs = 80;
  writeFileSync(join(root, 'trace.json'), JSON.stringify(input));
  const result = run(root, '--input', 'trace.json', '--json');
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(report.status, 'fail');
  assert.equal(report.longTasks[0].functionName, null);
  assert.deepEqual(report.byRoute, [{ id: '/catalog', durationMs: 80 }]);
});

test('CLI invalid config is empty stdout while unreadable named trace is incomplete', () => {
  const root = temp();
  const bad = run(root, '--input', 'missing.json', '--json', '--bad-option');
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, 'Invalid configuration or execution failure.\n');
  const missing = run(root, '--input', 'missing.json', '--json');
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).status, 'incomplete');
  const invisible = run(root, '--input', '\u034f', '--json');
  assert.equal(invisible.status, 2);
  assert.equal(invisible.stdout, '');
});

test('CLI help is explicit and has no report side effect', () => {
  const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: long-task-analyzer /u);
  assert.equal(result.stderr, '');
});

test('CLI safe report writes stdout bytes and refuses three alias classes', () => {
  const root = temp();
  const outside = temp();
  const input = join(root, 'trace.json');
  writeFileSync(input, JSON.stringify(fixture));
  const original = readFileSync(input);
  const safe = run(root, '--input', 'trace.json', '--report', 'report.json', '--json');
  assert.equal(safe.status, 0);
  assert.equal(readFileSync(join(root, 'report.json'), 'utf8'), safe.stdout);
  symlinkSync(input, join(root, 'symlink.json'));
  symlinkSync(outside, join(root, 'linked-parent'));
  linkSync(input, join(root, 'hard.json'));
  for (const name of ['symlink.json', 'linked-parent/out.json', 'hard.json']) {
    const result = run(root, '--input', 'trace.json', '--report', name, '--json');
    assert.equal(result.status, 2, name);
    assert.equal(JSON.parse(result.stdout).status, 'incomplete');
    assert.deepEqual(readFileSync(input), original);
  }
});

test('CLI dangling input alias cannot become a report, distinct missing input can', () => {
  const root = temp();
  symlinkSync(join(root, 'future.json'), join(root, 'missing.json'));
  const alias = run(root, '--input', 'missing.json', '--report', 'future.json', '--json');
  assert.equal(alias.status, 2);
  assert.equal(existsSync(join(root, 'future.json')), false);
  symlinkSync(join(root, 'future-two.json'), join(root, 'middle.json'));
  symlinkSync(join(root, 'middle.json'), join(root, 'missing-two.json'));
  const multi = run(root, '--input', 'missing-two.json', '--report', 'future-two.json', '--json');
  assert.equal(multi.status, 2);
  assert.equal(existsSync(join(root, 'future-two.json')), false);
  const distinct = run(root, '--input', 'absent.json', '--report', 'safe.json', '--json');
  assert.equal(distinct.status, 2);
  assert.equal(readFileSync(join(root, 'safe.json'), 'utf8'), distinct.stdout);
});

test('CLI confines reads and enforces input byte limit at N and N plus one', () => {
  const root = temp();
  const outside = temp();
  const json = JSON.stringify(fixture);
  writeFileSync(join(root, 'trace.json'), json);
  const exact = run(root, '--input', 'trace.json', '--max-bytes', String(Buffer.byteLength(json)), '--json');
  assert.equal(exact.status, 0);
  const over = run(root, '--input', 'trace.json', '--max-bytes', String(Buffer.byteLength(json) - 1), '--json');
  assert.equal(over.status, 2);
  assert.equal(JSON.parse(over.stdout).status, 'incomplete');
  writeFileSync(join(outside, 'trace.json'), json);
  symlinkSync(join(outside, 'trace.json'), join(root, 'escape.json'));
  const escaped = run(root, '--input', 'escape.json', '--json');
  assert.equal(escaped.status, 2);
  assert.equal(JSON.parse(escaped.stdout).status, 'incomplete');
});
