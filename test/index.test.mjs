import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, exitCodeFor, TOOL_ID } from '../src/index.mjs';

const trace = (durationMs = 49.999) => ({
  schemaVersion: 1,
  tasks: [{ startMs: 100, durationMs, script: '/bundle.js' }],
  routes: [{ id: '/catalog', startMs: 0, endMs: 300 }],
  interactions: [{ id: 'tap-add', startMs: 90, endMs: 250 }],
});

test('legal short task below 50 ms passes without a long-task finding', () => {
  const report = analyze(trace());
  assert.equal(TOOL_ID, 'long-task-analyzer');
  assert.equal(report.status, 'pass');
  assert.equal(exitCodeFor(report), 0);
  assert.equal(report.summary.checked, 1);
  assert.deepEqual(report.longTasks, []);
  assert.deepEqual(report.findings, []);
});

test('synthetic 80 ms blocking interval reaches route, script and interaction aggregates', () => {
  const report = analyze(trace(80));
  assert.equal(report.status, 'fail');
  assert.equal(exitCodeFor(report), 1);
  assert.equal(report.findings[0].ruleId, 'long-task');
  assert.equal(report.longTasks[0].durationMs, 80);
  assert.deepEqual(report.byRoute, [{ id: '/catalog', durationMs: 80 }]);
  assert.deepEqual(report.byScript, [{ id: '/bundle.js', durationMs: 80 }]);
  assert.deepEqual(report.byInteraction, [{ id: 'tap-add', durationMs: 80 }]);
  assert.equal(report.longTasks[0].functionName, null);
});

test('explicit function evidence survives absent source maps but names are never invented', () => {
  const noFunction = analyze(trace(80));
  assert.equal(noFunction.longTasks[0].functionName, null);
  const named = trace(80);
  named.tasks[0].functionName = 'renderCatalog';
  const report = analyze(named);
  assert.equal(report.longTasks[0].functionName, 'renderCatalog');
});

test('missing script attribution is an unknown bucket and incomplete, not known zero', () => {
  const input = trace(80);
  delete input.tasks[0].script;
  const report = analyze(input);
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.byScript, [{ id: null, durationMs: 80 }]);
  assert.equal(report.findings.some((finding) => finding.ruleId === 'unknown-script'), true);
  assert.equal(report.findings.some((finding) => finding.ruleId === 'long-task'), true);
});

test('overlapping interaction windows are not double-counted as known duration', () => {
  const input = trace(80);
  input.interactions.push({ id: 'tap-other', startMs: 100, endMs: 180 });
  const report = analyze(input);
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.byInteraction, [{ id: null, durationMs: 80 }]);
  assert.equal(report.findings.some((finding) => finding.ruleId === 'unknown-interaction'), true);
});

test('exactly 50 ms is long while 49.999 ms is not', () => {
  assert.equal(analyze(trace(49.999)).status, 'pass');
  const exact = analyze(trace(50));
  assert.equal(exact.status, 'fail');
  assert.equal(exact.summary.longTasks, 1);
});

test('task crossing route boundary partitions known and unknown time exactly once', () => {
  const input = trace(80);
  input.routes = [{ id: '/catalog', startMs: 0, endMs: 140 }];
  const report = analyze(input);
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.byRoute, [
    { id: '/catalog', durationMs: 40 }, { id: null, durationMs: 40 },
  ]);
  assert.equal(report.longTasks[0].routeUnknownMs, 40);
});

test('absent route and interaction windows stay unknown, never known zero', () => {
  const input = trace(80);
  delete input.routes;
  delete input.interactions;
  const report = analyze(input);
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.byRoute, [{ id: null, durationMs: 80 }]);
  assert.deepEqual(report.byInteraction, [{ id: null, durationMs: 80 }]);
});

test('task and window limits accept N and refuse N plus one', () => {
  assert.equal(analyze(trace(), { maxTasks: 1, maxWindows: 2 }).status, 'pass');
  const twoTasks = trace();
  twoTasks.tasks.push({ ...twoTasks.tasks[0], startMs: 200 });
  assert.equal(analyze(twoTasks, { maxTasks: 1 }).findings[0].ruleId, 'task-limit');
  const moreWindows = trace();
  moreWindows.routes.push({ id: '/other', startMs: 300, endMs: 400 });
  assert.equal(analyze(moreWindows, { maxWindows: 2 }).findings[0].ruleId, 'window-limit');
});

test('attribution work bound accepts exact pairs and refuses N plus one', () => {
  const one = trace(80);
  assert.equal(analyze(one, { maxAttributionPairs: 2 }).status, 'fail');
  const two = trace(80);
  two.tasks.push({ ...two.tasks[0], startMs: 200 });
  const report = analyze(two, { maxAttributionPairs: 3 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.findings[0].ruleId, 'work-limit');
  const dense = trace(80);
  dense.routes = Array.from({ length: 1001 }, (_, i) => ({
    id: `/r${i}`, startMs: 0, endMs: 300,
  }));
  const bounded = analyze(dense);
  assert.equal(bounded.status, 'incomplete');
  assert.equal(bounded.findings[0].ruleId, 'work-limit');
});

test('injected clock handles exact timeout and N plus one without report time', () => {
  let first = true;
  const exact = analyze(trace(), { timeoutMs: 1, now: () => {
    if (first) { first = false; return 0; }
    return 1;
  } });
  assert.equal(exact.status, 'pass');
  let tick = 0;
  const late = analyze(trace(), { timeoutMs: 1, now: () => tick++ * 2 });
  assert.equal(late.status, 'incomplete');
  assert.equal(late.findings[0].ruleId, 'analysis-timeout');
  assert.equal('time' in late, false);
});

test('timeout inside attribution emits no partial known aggregates', () => {
  const input = trace(80);
  input.routes.push({ id: '/next', startMs: 140, endMs: 220 });
  let tick = 0;
  const report = analyze(input, { timeoutMs: 1, now: () => [0, 0, 2][Math.min(tick++, 2)] });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.findings.some((finding) => finding.ruleId === 'analysis-timeout'), true);
  assert.deepEqual(report.byRoute, []);
  assert.deepEqual(report.byInteraction, []);
});

test('script aggregates use UTF-16 ordering and reject invisible names', () => {
  const input = trace(80);
  input.tasks.push({ startMs: 200, durationMs: 50, script: '/Z.js' });
  input.tasks[0].script = '/a.js';
  input.interactions[0].endMs = 300;
  assert.deepEqual(analyze(input).byScript.map((bucket) => bucket.id), ['/Z.js', '/a.js']);
  input.tasks[0].script = '\u034f';
  const invalid = analyze(input);
  assert.equal(invalid.status, 'incomplete');
  assert.equal(JSON.stringify(invalid).includes('\u034f'), false);
});

test('invalid route window leaves known blocking interval visible but route unknown', () => {
  const input = trace(80);
  input.routes.push({ id: '\u034f', startMs: 0, endMs: 300 });
  const report = analyze(input);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.findings.some((finding) => finding.ruleId === 'long-task'), true);
  assert.deepEqual(report.byRoute, [{ id: null, durationMs: 80 }]);
});

test('decimal-equal task and window endpoints attribute fully without a phantom gap', () => {
  const input = { schemaVersion: 1,
    tasks: [{ startMs: 0.1, durationMs: 50.2, script: '/bundle.js' }],
    routes: [{ id: '/route', startMs: 0.1, endMs: 50.3 }],
    interactions: [{ id: 'tap', startMs: 0.1, endMs: 50.3 }],
  };
  const report = analyze(input);
  assert.equal(report.status, 'fail');
  assert.deepEqual(report.byRoute, [{ id: '/route', durationMs: 50.2 }]);
  assert.deepEqual(report.byInteraction, [{ id: 'tap', durationMs: 50.2 }]);
  assert.equal(report.longTasks[0].routeUnknownMs, 0);
  assert.equal(report.longTasks[0].interactionUnknownMs, 0);
});

test('a real one-microsecond gap remains unknown, not silently snapped closed', () => {
  const input = { schemaVersion: 1,
    tasks: [{ startMs: 0.1, durationMs: 50.2, script: '/bundle.js' }],
    routes: [{ id: '/route', startMs: 0.1, endMs: 50.299 }],
    interactions: [{ id: 'tap', startMs: 0.1, endMs: 50.3 }],
  };
  const report = analyze(input);
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.byRoute, [
    { id: '/route', durationMs: 50.199 }, { id: null, durationMs: 0.001 },
  ]);
  assert.equal(report.longTasks[0].routeUnknownMs, 0.001);
});

test('finer-than-microsecond times are incomplete rather than rounded into coverage', () => {
  const input = trace(80);
  input.routes[0].endMs = 180.0001;
  const report = analyze(input);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.findings.some((finding) => finding.ruleId === 'invalid-evidence'), true);
  assert.deepEqual(report.byRoute, [{ id: null, durationMs: 80 }]);
});

test('nonfinite or backward injected clock readings cannot certify a trace', () => {
  for (const reading of [NaN, Infinity, -Infinity]) {
    assert.throws(() => analyze(trace(), { now: () => reading }), TypeError);
  }
  let tick = 0;
  assert.throws(() => analyze(trace(), { now: () => [10, 9][Math.min(tick++, 1)] }), TypeError);
  tick = 0;
  assert.throws(() => analyze(trace(80), { now: () => [0, 0, NaN][Math.min(tick++, 2)] }), TypeError);
});

test('aggregate millisecond output accepts an exact boundary and refuses one lost microsecond', () => {
  const firstMs = 8796093022158;
  assert.equal(firstMs.toString(), '8796093022158');
  assert.equal((50.001).toString(), '50.001');
  assert.equal(BigInt(firstMs) * 1000n + 50001n, 8796093022208001n);
  const input = { schemaVersion: 1,
    tasks: [{ startMs: 0, durationMs: firstMs, script: '/bundle.js' },
      { startMs: 0, durationMs: 50, script: '/bundle.js' }],
    routes: [{ id: '/route', startMs: 0, endMs: firstMs }],
    interactions: [{ id: 'tap', startMs: 0, endMs: firstMs }],
  };
  const exact = analyze(input, { now: () => 0 });
  assert.equal(exact.status, 'fail');
  assert.deepEqual(exact.byRoute, [{ id: '/route', durationMs: 8796093022208 }]);
  input.tasks[1].durationMs = 50.001;
  const lost = analyze(input, { now: () => 0 });
  assert.equal(lost.status, 'incomplete');
  assert.deepEqual(lost.byRoute, [{ id: '/route', durationMs: null }]);
  assert.deepEqual(lost.byScript, [{ id: '/bundle.js', durationMs: null }]);
  assert.deepEqual(lost.byInteraction, [{ id: 'tap', durationMs: null }]);
  assert.equal(lost.findings.some((finding) => finding.ruleId === 'aggregate-unrepresentable'), true);
});

test('aggregate overflow never rounds a one-microsecond excess into a known total', () => {
  const largeMs = 100000000000;
  assert.equal((largeMs + 0.001).toString(), '100000000000.001');
  assert.equal(100n * 100000000000000n + 100000000000001n, 10100000000000001n);
  const input = { schemaVersion: 1,
    tasks: Array.from({ length: 101 }, (_, i) => ({ startMs: 0,
      durationMs: i === 100 ? largeMs + 0.001 : largeMs, script: '/x.js' })),
    routes: [{ id: '/route', startMs: 0, endMs: largeMs + 0.001 }],
    interactions: [{ id: 'tap', startMs: 0, endMs: largeMs + 0.001 }],
  };
  const report = analyze(input, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.summary.checked, 101);
  assert.equal(report.summary.errors, 101);
  assert.deepEqual(report.byRoute, [{ id: '/route', durationMs: null }]);
  assert.deepEqual(report.byScript, [{ id: '/x.js', durationMs: null }]);
  assert.deepEqual(report.byInteraction, [{ id: 'tap', durationMs: null }]);
  assert.equal(report.findings.some((finding) => finding.ruleId === 'aggregate-unrepresentable'), true);
});
