# Voxel Society Simulator - Development Roadmap

_Last updated: 2026-04-13_

---

## Project Concept

**Voxel Society Simulator is a glass-tank observation tool, not a game to win.**

The mental model is a terrarium or ant farm: the user watches creatures live,
form relationships, reproduce, age, and die — from the outside, without
intervening. The goal is to make that observation interesting and legible,
not to balance a game loop or maximize birth rate.

Implications for all development decisions:

- **Realism over optimization.** Tuning parameters should make behavior feel
  organic, not efficient. A population decline is an interesting observation,
  not a failure state to fix.
- **Behavioral integrity over forced survival.** Avoid hard-coded rescue logic
  whose primary goal is to keep agents alive. Characters should survive (or not)
  through plausible behavior under environmental pressure.
- **Adaptation via environment and learning.** Prefer ecology-level changes
  (resource distribution, risk, travel cost) and character learning/growth
  dynamics over direct "do-not-die" overrides in decision code.
- **Observability over control.** UI investment should go toward making
  internal state readable (sidebar, telemetry, thought bubbles), not toward
  giving the user levers to steer outcomes.
- **Natural emergence over scripted cycles.** Births, deaths, and group
  formation should arise from individual character decisions, not from
  demographic targets or cooldown tuning.

### Pseudo-Evolution Guardrails (Anlife-like, Observation-First)

Goal: add believable generational drift while keeping behavior legible.

- **Trait-vector individuals.** Each character may carry a compact trait vector
  (for example sociality, risk tolerance, exploration bias, recovery priority).
- **Map traits into existing AI weights.** Do not replace core decision logic;
  traits should modulate current scoring/thresholds so behavior remains
  debuggable.
- **Inheritance + mutation at birth.** Child traits derive from parents with
  small noise and rare larger mutations.
- **Selection pressure must be environmental.** Never optimize directly for
  population targets; let food, risk, travel cost, and shelter constraints
  determine which traits propagate.
- **Telemetry before tuning.** Any evolution-related change must add or reuse
  observability metrics (mean/variance per trait, cohort trends) before
  balancing.
- **No Phase 4 spillover.** Keep this fully local/in-memory for now; no
  persistence, backend services, or replay dependency.

---

## Parameter Addition Rule

Any new tunable parameter **must** complete all three steps:

1. **`sim-settings.workspace.json`** — add under `settings.sidebarParams` with the intended default value.
2. **`sidebar.js` `PARAM_DEFAULTS`** — add the same key/value as a code-level fallback.
3. **`sidebar.js` slider row** — add a UI control in the right sidebar so the value can be adjusted at runtime without restarting.

Omitting any of the three steps is considered incomplete. Parameters that skip the slider step are not adjustable and violate the observability principle.

---

## Phase 1 - Core Simulation Stability

### Goal

Keep the colony simulation stable and predictable under normal gameplay load.

### Scope

- Stabilize movement/pathfinding/retry behavior to avoid jitter and thrash loops.
- Preserve world consistency (`gridPos`, mesh position, and `worldData` updates).

---

## Phase 2 - Gameplay Loop Quality

### Goal

Make core survival/build loops readable, debuggable, and fun without adding backend complexity.

### Scope

- Improve balancing and diagnostics for gathering, building, hunger, energy, and social actions.
- Improve UI feedback (sidebar/labels/icons) without regressing simulation correctness.

---

## Phase 3 - Production Hardening

### Goal

Prepare for reliable build/deploy workflows and maintainable operations.

### Scope

- Harden Docker/Cloud Run deployment flow and document operational commands.
- Add lightweight regression checks and improve developer documentation.

---

## Phase 4+ (Hold)

Requires explicit user instruction before implementation.

Potential themes:

- Persistence and replay
- Remote API/backend services
- Multi-session orchestration

---

## Current Status

Active phase: **Phase 1 → Phase 2 (overlap)**

---

## Current Sprint — Character Movement Quality

### Goal

Bring character movement to a level comparable to standard game characters:
natural collision handling, no wall clipping, smooth visual feel.

### Tasks

| Status     | Item                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| ✅ Done    | BFS pathfinding with path validation and invalidation backoff               |
| ✅ Done    | `canTraverseWorldSegment()` — substep solid collision (0.25 voxel interval) |
| ✅ Done    | `tryWallSlideMove()` — wall-slide fallback on blocked forward direction     |
| ✅ Done    | Micro-pause → retry → path-reset escalation chain in `updateMovement`       |
| ✅ Done    | Dead code removal (`moveAlongPath`) and constructor cleanup                 |
| ✅ Done    | `PARAM_DEFAULTS` registry in sidebar.js (parameter scaling prep)            |
| 🔲 Next    | Validate wall-slide with 5–10 min telemetry; compare stuckLike% baseline    |
| 🔲 Next    | Visual smoothing: interpolate mesh position between grid steps              |
| 🔲 Next    | Anticipatory rotation: face next path node ahead of move                    |
| 🔲 Backlog | Consolidate `state` / `action.type` dual intent representation              |
| 🔲 Backlog | Unify `targetPos` + `action.target` + `path` destination tracking           |
| 🔲 Backlog | Collapse `actionCooldown` + `_microPauseTimer` + `_arrivalDelay`            |

### Baseline Telemetry (2026-04-13, 153 s run)

- avgWanderRatio: 69.3% | avgStuckLikeRatio: 8.1% | avgLowEnergyRatio: 10.9%
- stallDetected: 0
- Target after wall-slide: stuckLikeRatio < 5%
