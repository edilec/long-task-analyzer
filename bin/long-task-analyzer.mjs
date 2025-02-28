#!/usr/bin/env node
import { writeFile, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { analyze, exitCodeFor, incompleteReport } from '../src/index.mjs';
import { readBoundedJson } from '../src/json.mjs';
import { assertWritableDestination } from '../src/write-guard.mjs';

const help = `Usage: long-task-analyzer --root DIR --input FILE [options]

Analyze a documented saved browser-trace subset; no browser is launched.
  --report FILE            Also write the JSON report under root.
  --max-bytes N            Maximum input bytes (default 1048576).
  --max-depth N            Maximum JSON depth (default 16).
  --max-nodes N            Maximum JSON nodes (default 100000).
  --max-tasks N            Maximum tasks (default 100000).
  --max-windows N          Maximum route and interaction windows (default 10000).
  --max-attribution-pairs N Maximum attribution comparisons (default 1000000).
  --timeout-ms N           Analysis time limit (default 2000).
  --json                   Suppress the human stderr summary.
  --help                   Show this help when used alone.
Exit codes: 0 pass, 1 fail, 2 incomplete evidence or invalid configuration.
`;
const flags = Object.freeze({ '--root': 'root', '--input': 'input', '--report': 'report',
  '--max-bytes': 'maxBytes', '--max-depth': 'maxDepth', '--max-nodes': 'maxNodes',
  '--max-tasks': 'maxTasks', '--max-windows': 'maxWindows',
  '--max-attribution-pairs': 'maxAttributionPairs', '--timeout-ms': 'timeoutMs' });
const numeric = new Set(['maxBytes', 'maxDepth', 'maxNodes', 'maxTasks', 'maxWindows',
  'maxAttributionPairs', 'timeoutMs']);
const cleanPath = (path) => typeof path === 'string' && path.length > 0
  && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Default_Ignorable_Code_Point}]/u.test(path);

function parseArgs(args) {
  const options = { jsonOnly: false, limits: {} };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--json') {
      if (seen.has(flag)) throw new TypeError('duplicate option');
      seen.add(flag);
      options.jsonOnly = true;
      continue;
    }
    const key = flags[flag];
    if (!key || seen.has(flag) || args[i + 1] === undefined || args[i + 1].startsWith('--')) {
      throw new TypeError('invalid option');
    }
    seen.add(flag);
    const value = args[++i];
    if (numeric.has(key)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
        throw new TypeError('invalid limit');
      }
      options.limits[key] = Number(value);
    } else if (cleanPath(value)) options[key] = value;
    else throw new TypeError('invalid path');
  }
  if (!options.root || !options.input) throw new TypeError('root and input required');
  return options;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(help);
    return;
  }
  const { root: rootName, input: inputName, report: reportName, jsonOnly, limits } = parseArgs(args);
  const root = resolve(rootName);
  const input = resolve(root, inputName);
  let report;
  try {
    const doc = await readBoundedJson(input, root, limits.maxBytes, {
      maxDepth: limits.maxDepth, maxNodes: limits.maxNodes,
    });
    const base = await realpath(root);
    const path = await realpath(input);
    const file = relative(base, path);
    report = analyze(doc, { file, maxTasks: limits.maxTasks,
      maxWindows: limits.maxWindows, maxAttributionPairs: limits.maxAttributionPairs,
      timeoutMs: limits.timeoutMs });
  } catch {
    report = incompleteReport();
  }
  if (reportName !== undefined) {
    try {
      const destination = await assertWritableDestination(resolve(root, reportName), {
        root, inputs: [input], label: '--report',
      });
      await writeFile(destination, `${JSON.stringify(report)}\n`, 'utf8');
    } catch {
      report = incompleteReport('The guarded report destination could not be written.');
    }
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!jsonOnly) {
    const status = { pass: 'PASS', fail: 'FAIL', incomplete: 'INCOMPLETE' }[report.status];
    const n = report.findings.length;
    process.stderr.write(`Long task analyzer: ${status}; ${n} finding${n === 1 ? '' : 's'}.\n`);
  }
  process.exitCode = exitCodeFor(report);
}

main().catch(() => {
  process.stderr.write('Invalid configuration or execution failure.\n');
  process.exitCode = 2;
});
