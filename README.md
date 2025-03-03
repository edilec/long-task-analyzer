# Long Task Analyzer

An offline reporter for a documented, normalized subset of a saved browser
trace. It identifies main-thread tasks of at least 50 ms and attributes their
duration to route, script, and interaction windows where the export supplies
enough evidence. Unknown or overlapping context remains an explicit unknown
bucket. This makes blocking time visible without inventing source-level detail.

## Quick start

Requires Node 22 or newer; no runtime or development dependencies. The CLI
never launches a browser, resolves a host, or uses the network.

```sh
node bin/long-task-analyzer.mjs --root examples --input pass.json
node bin/long-task-analyzer.mjs --root examples --input blocking.json
node bin/long-task-analyzer.mjs --root examples --input unknown.json
npm run check
```

The examples exit 0, 1, and 2 respectively. Stdout is one JSON report.
Stderr has a fixed human summary unless `--json` is present. `--help` alone
prints usage. Optional `--report FILE` writes exactly the stdout bytes to a
separate path under `--root`; it refuses a symlink destination, symlinked
parent escaping root, hard link or path alias to an input, including a dangling
one- or two-hop input symlink. A refused or failed write emits an incomplete
report on stdout and exits 2; no task is claimed as analyzed in that report.

## Saved trace subset

Input is UTF-8 JSON with `schemaVersion: 1`, nonempty `tasks`, and optional
`routes` and `interactions` arrays. It is **not** an arbitrary Chrome trace
parser. All times are nonnegative milliseconds. The finite task start plus
duration must stay within the JavaScript safe-number range.

| Array | Required item fields | Optional item fields |
| --- | --- | --- |
| `tasks` | `startMs`, positive `durationMs` | `script`, `functionName` |
| `routes` | `id`, `startMs`, `endMs` | none |
| `interactions` | `id`, `startMs`, `endMs` | none |

Each window has `endMs > startMs`. Route and script labels are local paths
beginning with `/`, with no host or query. Interaction and function names use
printable identifier characters. A function name is reported **only** when
the saved task explicitly includes it; it must have a script. The tool does
not read or infer source maps. A missing source map never supplies a function
name and does not erase an explicitly exported one.

Tasks below 50 ms remain checked but are not long-task findings. A task of
exactly 50 ms is long. Each long interval is divided at window boundaries.
Duration covered by exactly one route or interaction window goes to that
window; gaps and overlapping windows go to the `id: null` bucket. A missing
script also goes to `id: null`. Every dimension's known plus unknown buckets
sum to the long-task duration—overlaps are never double-counted. Missing or
ambiguous attribution makes the overall report `incomplete` because the
route/script/interaction summary cannot be certified, while the known
long-task finding remains visible. Invalid window evidence taints that
dimension, putting its duration in the unknown bucket. Output buckets sort
known IDs by UTF-16 code unit, then the unknown bucket.

## Rule table

| Rule | Severity | Effect |
| --- | --- | --- |
| `long-task` | error | A saved task lasts at least 50 ms. |
| `unknown-route` | warning | Some blocking time lacks unique route attribution; incomplete. |
| `unknown-script` | warning | Script evidence is absent; incomplete. |
| `unknown-interaction` | warning | Some blocking time lacks unique interaction attribution; incomplete. |
| `invalid-evidence` | warning | Trace subset or item cannot be evaluated; incomplete. |
| `task-limit` | warning | Too many tasks; incomplete. |
| `window-limit` | warning | Too many route and interaction windows; incomplete. |
| `work-limit` | warning | Attribution comparison bound exceeded; incomplete. |
| `analysis-timeout` | warning | Analysis time limit exceeded; incomplete. |

The report envelope has `schemaVersion: "1"`, `tool`, `status`, `summary`,
`findings`, `longTasks`, and `byRoute`/`byScript`/`byInteraction` arrays.
`status` is `pass`, `fail`, or `incomplete`.

## Limits and exits

Defaults: 1,048,576 input bytes, JSON depth 16, 100,000 JSON nodes,
100,000 tasks, 10,000 total windows, 1,000,000 conservative attribution
checks, and 2,000 ms analysis time. The CLI exposes `--max-bytes`,
`--max-depth`, `--max-nodes`, `--max-tasks`, `--max-windows`,
`--max-attribution-pairs`, and `--timeout-ms`; each is a positive integer.
The work estimate is `tasks × (routes² + interactions²)`, bounding the
window-partition algorithm before it runs. All limit overruns are incomplete,
not truncated passes. Input must resolve within the real root. Duplicate JSON
keys, malformed UTF-8, and numeric tokens rounded by JavaScript conversion
are refused rather than silently reinterpreted.

| Exit | Meaning | Stdout |
| ---: | --- | --- |
| 0 | Complete trace, no long task. | Pass JSON report. |
| 1 | Complete attribution, at least one long task. | Fail JSON report. |
| 2 | Missing, ambiguous, malformed, or limited evidence. | Incomplete JSON report. |
| 2 | Invalid CLI option or configuration. | Empty; fixed diagnostic on stderr. |

## Limits of interpretation and non-goals

Attribution follows only the supplied windows and script fields. The tool
does not de-minify, resolve source maps, guess a function, download source,
run a browser, collect a live trace, or decide which application change to
make. It reports saved evidence; it does not act on a site or account.
