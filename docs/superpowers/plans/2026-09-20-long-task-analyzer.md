# Long Task Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify saved-trace blocking intervals and aggregate duration by route, script and interaction while preserving attribution uncertainty.

**Architecture:** A pure analyzer validates a documented normalized trace subset, partitions each long task at route/interaction window edges, and reports known and unknown duration buckets. A strict local-file CLI handles confinement, bounded parsing, guarded optional report output, and contract exits.

**Tech Stack:** Node ESM, built-in fs/path, `node:test`, `node:assert/strict`; no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-long-task-analyzer-design.md`

## Global Constraints

- Offline saved traces only; not a generic Chrome trace parser and never a live browser.
- `TOOL_ID` equals `long-task-analyzer`; package version is `0.1.0`.
- A long task is duration >= 50 ms; 49.999 ms is not one.
- Unknown attribution has an explicit bucket; a check requiring that attribution is incomplete, never known zero.
- Function names appear only when explicitly exported; no source-map inference.
- Code-unit sort, bounded input, exact N/N+1, root-confined reads and guarded reports.

## File map

- `src/index.mjs`: trace validation, interval partition, aggregation and report envelope.
- `src/json.mjs`: bounded UTF-8 read, duplicate-key-safe parse, confinement.
- `src/write-guard.mjs`: independent central guard copy.
- `bin/long-task-analyzer.mjs`: flags, help, fixed summary, output and exits.
- `test/index.test.mjs`, `test/cli.test.mjs`: correct and adversarial cases.
- `examples/*.json`, `README.md`, `package.json`: runnable contract.

---

### Task 1: Blocking interval and attribution

**Files:** Create `src/index.mjs`; create `test/index.test.mjs`.

**Interfaces:** `analyze(document, options = {}) -> report`, `TOOL_ID`, `exitCodeFor(report)`.

- [ ] Test a legal 49.999 ms interval with no long-task finding; run red before implementation.
- [ ] Implement schema validation and exact >=50 threshold; run green.
- [ ] Test an 80 ms interval overlapping one declared route and interaction, expecting one long task and 80 ms in both matching aggregates; run red, implement partitioning, run green.
- [ ] Test absent script/function and missing map: explicit unknown script bucket, no fabricated function name; test an explicitly exported function name remains present without a map.
- [ ] Test ambiguous overlapping windows yield unknown/uncertain attribution, not double-counted known duration; mutate attribution handling and observe named failure; restore and commit.

### Task 2: CLI and path safety

**Files:** Create `src/json.mjs`, `src/write-guard.mjs`, `bin/long-task-analyzer.mjs`; create `test/cli.test.mjs`.

**Interfaces:** CLI flags `--root`, `--input`, `--report`, `--json`, `--help`, `--max-bytes`, `--max-tasks`, `--max-windows`, `--timeout-ms`.

- [ ] Add passing CLI control, JSON stdout, fixed human stderr, and `--json` silence; run red, implement, run green.
- [ ] Add invalid config/empty stdout and unreadable input/incomplete JSON, duplicate-key refusal, and byte/task/window limits at N and N+1.
- [ ] Add safe report destination and symlink, symlinked parent, hard-link, and dangling-input alias attacks; assert inputs remain byte-identical.
- [ ] Mutate the reached guard path to observe attack test fail; restore and commit.

### Task 3: Release contract

**Files:** Modify `README.md`, `package.json`; create `examples/pass.json`, `examples/blocking.json`, `examples/unknown.json`.

**Interfaces:** npm `lint`, `test`, `check`; documented examples run with the CLI.

- [ ] Document exact subset schema, threshold, window attribution, unknown buckets, rules, exits, limits, and non-goals.
- [ ] Run all examples and assert pass/fail/incomplete exits 0/1/2.
- [ ] Run `npm run check`, verify README guarantees by named counterfactual tests, and commit.
