# Collaboration Model — Local Changes, Shared State, Versioning (Proposal)

## 1. Starting point: this is new infrastructure, not an evolution

Confirmed during this audit (`ARCHITECTURE_AUDIT.md` §4, and directly with the product owner): the
current app's storage is **provably single-user** — `sql.js` runs in-memory in one browser
tab/Electron process, autosaves to that browser profile's IndexedDB, and only touches a real file on
explicit Save. There is no separate shared SQL database anywhere in the studio's existing tooling
for this planning domain. Brief §15's "shared planning backend" is therefore **net-new
infrastructure to design and build**, not a matter of pointing the existing schema at a different
connection string. This changes the risk/effort calculus significantly versus reading the brief at
face value, and is worth the product owner explicitly signing off on before it's scheduled (see
`IMPLEMENTATION_PLAN.md`).

## 2. What "smallest viable" means here, concretely

Brief §15 already warns against building a Perforce-like system prematurely and suggests checking
whether "simple optimistic concurrency + versioning + conflict detection" is enough. Given the
actual user count implied by brief §17 (Producer + a handful of APs per project — not hundreds of
concurrent editors), this is very likely sufficient, and the recommended shape is:

```text
Each editable row gets:  version INTEGER, updated_at TEXT, updated_by TEXT

Write path:
  1. Client holds the version it last read for a row.
  2. Client submits a write with { row_id, expected_version, new_values }.
  3. Server: UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?
  4. Zero rows affected → conflict. Return current server row to the client.
  5. Client surfaces "this was changed by <updated_by> at <updated_at> since you last saw it —
     review their change" and lets the human decide (re-apply on top, discard, or merge by hand).
```

This is **row-level optimistic concurrency**, not field-level and not a merge algorithm — a
conflict on any field of a row blocks the whole row's write and asks a human, rather than trying to
auto-merge two edits to the same LOQ. That is the correct level of caution for a *committed
production plan*: silently auto-merging two people's edits to the same LOQ's committed date is
exactly the kind of "silently adapt the plan" behavior brief §5 forbids for forecasts, and the same
caution should extend to concurrent edits.

## 3. What changes for the append-only tables specifically

`loq_commitment_events` and `variance_events` (`DATA_MODEL.md` §2) are append-only inserts, not
updates — they have no meaningful "conflict" in the row-level sense above, because two people
declaring two different variances on the same LOQ at the same time is not a conflict, it's two facts
that both get recorded. The only thing that needs the version/conflict machinery in §2 is the
**mutable** rows: `loqs` itself (status, discipline, cinematic assignment), `loq_resources`,
`loq_dependencies`, `cinematics`. This narrows the surface area considerably — most of the new
schema doesn't need concurrency handling at all by construction.

## 4. Local edits before a shared backend exists

The brief's conceptual diagram (local user changes → push/merge → shared data) presupposes a server
already exists. Until one does (see phasing in `IMPLEMENTATION_PLAN.md`), the existing single-file
model remains the actual deployment for the vertical slice — one Producer's `.sqlite` file is "the"
plan for their project(s), same as today. This is an acceptable, deliberate limitation for the
vertical slice, not an oversight: brief §23 asks to validate the *planning loop* (committed → Jira →
variance → forecast → impact → history) on one Cinematic first, and that loop does not require
multi-user collaboration to prove out. Collaboration infrastructure should be sequenced *after* the
vertical slice validates the domain model, not before — building a sync server against a
still-changing schema would mean redoing the sync layer's assumptions repeatedly.

## 5. The `scenarios` table as a possible bridge, not a replacement

The dormant `scenarios` table + `scenario_id` FK (`ARCHITECTURE_AUDIT.md` §4) is real, wired through
the engine, and unused. It is tempting to reach for it as a "local branch" mechanism (each user's
local edits = their own scenario, merged into `base` on push) — **this is worth evaluating, but
flagging as a genuine open design question, not a decision**:

- **For**: the plumbing already exists end-to-end (schema, engine scoping, tests) and was seemingly
  designed with future branching in mind.
  in
- **Against**: `scenarios` was designed for *what-if planning* (comparing hypothetical alternatives
  within one person's view), which is a different concept from *concurrent-edit isolation* (multiple
  people's simultaneous changes to the same real plan). Conflating the two could make both features
  harder to reason about later — a what-if scenario a Producer creates to explore an alternative
  should not look, in the data, indistinguishable from an AP's in-progress local edit waiting to be
  pushed.

**Recommendation**: do not repurpose `scenarios` for collaboration without validating that a
what-if-scenario feature isn't also wanted soon (if it is, keep the two concepts separate from the
start; if it's genuinely dead and no what-if feature is planned, repurposing becomes safer). This is
a decision for the product owner, not something to resolve unilaterally during implementation — see
open questions in `IMPLEMENTATION_PLAN.md`.

## 6. Non-goals for the collaboration model (explicitly, per brief §15)

- No branch/merge UI, no diffing tool, no manual conflict-resolution editor beyond "show me the
  current server value and let me decide" (§2 step 5).
- No offline-first sync engine with vector clocks or CRDTs — the row-version check in §2 is
  sufficient for this user count and this rate of change (production planning edits, not
  real-time collaborative text editing).
- No attempt to make the *existing* single-file local mode and a *future* shared-backend mode look
  identical from day one — it is fine for the vertical slice to keep working exactly as the app does
  today (one file, one user) while the backend is designed and built separately, then cut over
  deliberately once ready.
