# Long Task Analyzer design

The tool reads a documented saved-trace subset, not a generic Chrome trace or
live browser. A UTF-8 JSON object with `schemaVersion: 1` contains nonempty
`tasks`, optional `routes`, and optional `interactions`. Each task declares a
start and duration in milliseconds, plus optional script URL and script
function evidence. Route and interaction windows have start/end times. A task
of at least 50 ms is a long task. Its overlap with windows determines route
and interaction attribution; ambiguous or absent context is reported as
unknown, never guessed. A function name is emitted only if explicitly present
in the saved trace; missing source maps never authorize reconstruction.

The report includes each long task and deterministic aggregates by known
route/script/interaction, preserving unattributed time and uncertainty. Task
time is not double-counted across overlapping interaction windows. Malformed
required evidence or configured limits produces incomplete, not a clean pass.
The CLI uses confined local input and an optional guarded report destination,
with the catalog's JSON, summary, and exit semantics. Tests exercise a real
synthetic blocking interval through aggregation, legal short-task controls,
missing source context, ambiguous windows, N/N+1 limits, path attacks, and
behavioral mutations of every published guarantee.
