export const TOOL_ID = 'long-task-analyzer';

const RULES = Object.freeze({
  'long-task': 'error',
  'invalid-evidence': 'warning',
  'task-limit': 'warning',
  'window-limit': 'warning',
  'work-limit': 'warning',
  'analysis-timeout': 'warning',
  'unknown-route': 'warning',
  'unknown-script': 'warning',
  'unknown-interaction': 'warning',
});
const DEFAULTS = Object.freeze({ maxTasks: 100000, maxWindows: 10000,
  maxAttributionPairs: 1000000, timeoutMs: 2000 });
const objectKeys = (value, required, optional = []) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const label = (value, route = false) => typeof value === 'string' && value.length > 0
  && value.length <= 100 && (route ? /^\/[A-Za-z0-9._/-]*$/u : /^[A-Za-z0-9._-]+$/u).test(value);
const time = (value) => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const codeUnit = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const bucketSort = (a, b) => a.id === null ? (b.id === null ? 0 : 1)
  : b.id === null ? -1 : codeUnit(a.id, b.id);
class DeadlineExceeded extends Error {}

export function exitCodeFor(report) {
  return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}

export function incompleteReport(message = 'The named trace could not be evaluated.') {
  return { schemaVersion: '1', tool: TOOL_ID, status: 'incomplete',
    summary: { checked: 0, errors: 0, warnings: 1, longTasks: 0 },
    findings: [{ ruleId: 'invalid-evidence', severity: RULES['invalid-evidence'], message }],
    longTasks: [], byRoute: [], byScript: [], byInteraction: [] };
}

function distribute(start, end, windows, buckets, now, started, timeoutMs) {
  const points = [start, end];
  for (const window of windows) {
    if (window.startMs > start && window.startMs < end) points.push(window.startMs);
    if (window.endMs > start && window.endMs < end) points.push(window.endMs);
  }
  points.sort((a, b) => a - b);
  let unknown = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    if (now() - started > timeoutMs) throw new DeadlineExceeded();
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const active = windows.filter((window) => window.startMs <= from && window.endMs >= to);
    const id = active.length === 1 ? active[0].id : null;
    buckets.set(id, (buckets.get(id) ?? 0) + to - from);
    if (id === null) unknown += to - from;
  }
  return unknown;
}

function mergeBuckets(target, source) {
  for (const [id, duration] of source) target.set(id, (target.get(id) ?? 0) + duration);
}

export function analyze(document, options = {}) {
  const maxTasks = options.maxTasks ?? DEFAULTS.maxTasks;
  const maxWindows = options.maxWindows ?? DEFAULTS.maxWindows;
  const maxAttributionPairs = options.maxAttributionPairs ?? DEFAULTS.maxAttributionPairs;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const now = options.now ?? Date.now;
  if (![maxTasks, maxWindows, maxAttributionPairs, timeoutMs].every((n) => Number.isSafeInteger(n) && n >= 1)
      || typeof now !== 'function') throw new TypeError('Invalid analysis limits.');
  const file = options.file ?? 'input.json';
  if (typeof file !== 'string' || file.length === 0
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Default_Ignorable_Code_Point}]/u.test(file)) {
    throw new TypeError('Invalid report file label.');
  }
  const started = now();
  const findings = [];
  const longTasks = [];
  const routeBuckets = new Map();
  const scriptBuckets = new Map();
  const interactionBuckets = new Map();
  let checked = 0;
  let incomplete = false;
  const add = (ruleId, pointer, message) => {
    findings.push({ ruleId, severity: RULES[ruleId], message, location: { file, pointer } });
    if (RULES[ruleId] === 'warning') incomplete = true;
  };
  const finish = () => {
    findings.sort((a, b) => codeUnit(a.location.file, b.location.file)
      || codeUnit(a.location.pointer, b.location.pointer) || codeUnit(a.ruleId, b.ruleId));
    longTasks.sort((a, b) => a.startMs - b.startMs || a.inputIndex - b.inputIndex);
    const buckets = (map) => [...map].map(([id, durationMs]) => ({ id, durationMs })).sort(bucketSort);
    return { schemaVersion: '1', tool: TOOL_ID,
      status: incomplete ? 'incomplete' : findings.some((finding) => finding.severity === 'error') ? 'fail' : 'pass',
      summary: { checked, errors: findings.filter((f) => f.severity === 'error').length,
        warnings: findings.filter((f) => f.severity === 'warning').length, longTasks: longTasks.length },
      findings,
      longTasks: longTasks.map(({ inputIndex, ...task }) => task),
      byRoute: buckets(routeBuckets), byScript: buckets(scriptBuckets),
      byInteraction: buckets(interactionBuckets) };
  };
  if (!objectKeys(document, ['schemaVersion', 'tasks'], ['routes', 'interactions'])
      || document.schemaVersion !== 1 || !Array.isArray(document.tasks) || document.tasks.length === 0
      || (document.routes !== undefined && !Array.isArray(document.routes))
      || (document.interactions !== undefined && !Array.isArray(document.interactions))) {
    add('invalid-evidence', '', 'The saved trace does not match the declared subset schema.');
    return finish();
  }
  const routes = document.routes ?? [];
  const interactions = document.interactions ?? [];
  if (document.tasks.length > maxTasks) {
    add('task-limit', '/tasks', 'The task limit was exceeded.');
    return finish();
  }
  if (routes.length + interactions.length > maxWindows) {
    add('window-limit', '', 'The route and interaction window limit was exceeded.');
    return finish();
  }
  if (document.tasks.length * (routes.length ** 2 + interactions.length ** 2) > maxAttributionPairs) {
    add('work-limit', '', 'The attribution work limit was exceeded.');
    return finish();
  }
  let routeTainted = false;
  let interactionTainted = false;
  for (const [kind, windows] of [['routes', routes], ['interactions', interactions]]) {
    for (let i = 0; i < windows.length; i += 1) {
      const window = windows[i];
      if (!objectKeys(window, ['id', 'startMs', 'endMs'])
          || !label(window.id, kind === 'routes') || !time(window.startMs)
          || !time(window.endMs) || window.endMs <= window.startMs) {
        add('invalid-evidence', `/${kind}/${i}`, 'A timing window has invalid identity or boundaries.');
        if (kind === 'routes') routeTainted = true;
        else interactionTainted = true;
      }
    }
  }
  const usableRoutes = routeTainted ? [] : routes;
  const usableInteractions = interactionTainted ? [] : interactions;
  for (let i = 0; i < document.tasks.length; i += 1) {
    if (now() - started > timeoutMs) {
      add('analysis-timeout', '/tasks', 'The analysis time limit was exceeded.');
      return finish();
    }
    const task = document.tasks[i];
    const pointer = `/tasks/${i}`;
    if (!objectKeys(task, ['startMs', 'durationMs'], ['script', 'functionName'])
        || !time(task.startMs) || !time(task.durationMs) || task.durationMs <= 0
        || !time(task.startMs + task.durationMs)
        || (task.script !== undefined && !label(task.script, true))
        || (task.functionName !== undefined && (!label(task.functionName)
          || task.script === undefined))) {
      add('invalid-evidence', pointer, 'A task has invalid timing or source evidence.');
      continue;
    }
    checked += 1;
    if (task.durationMs < 50) continue;
    add('long-task', pointer, 'A saved main-thread task blocked for at least 50 ms.');
    const end = task.startMs + task.durationMs;
    const taskRoutes = new Map();
    const taskInteractions = new Map();
    let unknownRoute;
    let unknownInteraction;
    try {
      unknownRoute = distribute(task.startMs, end, usableRoutes, taskRoutes, now, started, timeoutMs);
      unknownInteraction = distribute(task.startMs, end, usableInteractions, taskInteractions, now, started, timeoutMs);
    } catch (error) {
      if (!(error instanceof DeadlineExceeded)) throw error;
      add('analysis-timeout', pointer, 'The analysis time limit was exceeded.');
      longTasks.push({ inputIndex: i, startMs: task.startMs, durationMs: task.durationMs,
        script: task.script ?? null, functionName: task.functionName ?? null,
        routeUnknownMs: null, interactionUnknownMs: null });
      return finish();
    }
    mergeBuckets(routeBuckets, taskRoutes);
    mergeBuckets(interactionBuckets, taskInteractions);
    const script = task.script ?? null;
    scriptBuckets.set(script, (scriptBuckets.get(script) ?? 0) + task.durationMs);
    if (unknownRoute > 0) add('unknown-route', pointer, 'Some task duration has no unique route attribution.');
    if (script === null) add('unknown-script', pointer, 'The task has no saved script attribution.');
    if (unknownInteraction > 0) add('unknown-interaction', pointer, 'Some task duration has no unique interaction attribution.');
    longTasks.push({ inputIndex: i, startMs: task.startMs, durationMs: task.durationMs,
      script, functionName: task.functionName ?? null,
      routeUnknownMs: unknownRoute, interactionUnknownMs: unknownInteraction });
  }
  return finish();
}
