# Voxel Society Simulator - Development Roadmap

_Last updated: 2026-04-13_

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

| Status | Item |
|--------|------|
| ✅ Done | BFS pathfinding with path validation and invalidation backoff |
| ✅ Done | `canTraverseWorldSegment()` — substep solid collision (0.25 voxel interval) |
| ✅ Done | `tryWallSlideMove()` — wall-slide fallback on blocked forward direction |
| ✅ Done | Micro-pause → retry → path-reset escalation chain in `updateMovement` |
| ✅ Done | Dead code removal (`moveAlongPath`) and constructor cleanup |
| ✅ Done | `PARAM_DEFAULTS` registry in sidebar.js (parameter scaling prep) |
| 🔲 Next | Validate wall-slide with 5–10 min telemetry; compare stuckLike% baseline |
| 🔲 Next | Visual smoothing: interpolate mesh position between grid steps |
| 🔲 Next | Anticipatory rotation: face next path node ahead of move |
| 🔲 Backlog | Consolidate `state` / `action.type` dual intent representation |
| 🔲 Backlog | Unify `targetPos` + `action.target` + `path` destination tracking |
| 🔲 Backlog | Collapse `actionCooldown` + `_microPauseTimer` + `_arrivalDelay` |

### Baseline Telemetry (2026-04-13, 153 s run)
- avgWanderRatio: 69.3% | avgStuckLikeRatio: 8.1% | avgLowEnergyRatio: 10.9%
- stallDetected: 0
- Target after wall-slide: stuckLikeRatio < 5%
