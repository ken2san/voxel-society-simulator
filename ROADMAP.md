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

Active phase: Phase 1
