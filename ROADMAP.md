# Voxel Society Simulator - Development Roadmap

_Last updated: 2026-04-14_

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

---

## Handoff — Session 2026-04-14

_This section is updated at the end of each working session so the next AI thread can pick up without re-explanation._

### What was discussed

Design review of the lifecycle loop: birth → eating + socializing → death.
Confirmed the core problem is **not food shortage** — it is **population structure**.

### What was built

| Commit | Change |
| ------ | ------ |
| `ec757a7` | `animate()`: time-based fruit regeneration every `fruitRegenIntervalSeconds` (default 60 s). Scans all GRASS surfaces and places FRUIT at `fruitSpawnRate` probability. |
| `091dab3` | `ROADMAP.md`: Parameter Addition Rule (3-step: workspace JSON → PARAM_DEFAULTS → sidebar slider). `sim-settings.workspace.json`: added missing `fruitRegenIntervalSeconds: 60`. |

### Confirmed findings (from telemetry `telemetry-2026-04-13T15-54-47-101Z.json`)

- **Death cause**: 100% old age (starvation: 0). Food is not the bottleneck.
- **Population crash**: 13 → 4 people in 2 seconds at sim_total = 360 s.
- **Root cause**: All 10 initial characters spawn at `age = 0` simultaneously → they all hit `lifespan = 360 s` at the same moment → mass extinction event.
- **Birth rate**: Only 3 births in 360 s (need ~10 to sustain initial pop of 10).
- **Reproduction bottleneck**: `affinityIncreaseRate = 6`, `pairReproductionCooldownSeconds = 90` → at most 2–3 children per pair per lifespan. Not enough to offset deaths.
- **Surviving 4** (gen=1): lifeRatio 0.81–0.97 — they are the next cohort collapse, forming the same synchronized death wave.

### Next tasks (prioritized)

| Priority | Task | Rationale |
| -------- | ---- | --------- |
| ★★★ | ~~**Stagger initial spawn ages**~~ ✅ Done | `initialAgeMaxRatio` param (default 0.5) added via 3-step rule. `main.js` uses `window.initialAgeMaxRatio` instead of hardcoded `0.65`. Slider in Setup tab. |
| ★★★ | ~~**Ideology gap → affinity ceiling**~~ ✅ Done | `Character.computeTraitDistance()` uses 6-trait vector (bravery/diligence/sociality/curiosity/resourcefulness/resilience). During socializing, `affinityCap = maxAffinity × (1 − capReduction × traitDist)`. Param: `traitAffinityCapReduction` (default 0.6) in Social tab → groups naturally form around compatible worldviews; Dunbar-scale fragmentation emerges without explicit rule. |
| ★★☆ | **Affinity lower floor (hate-but-persist)** | Currently affinity ≤ 0 causes `relationships.delete()`. Change floor to 5 — negative relationships remain visible as structural tension. Change: `character.js` line ~2618 `relationships.delete(k)` → clamp to 5. |
| ★★☆ | ~~**Seasonal food variation**~~ ✅ Done | `animate.simTime` accumulator drives sin-wave on fruitSpawnRate. `seasonCycleSeconds` (default 120s) and `seasonAmplitude` (default 0.6) added via 3-step rule (Behavior tab). amplitude=0.6 → summer 1.6×, winter 0.4×; amplitude=1.0 → winter rate=0 (true famine). |
| ★★☆ | **Ease reproduction rate** — consider lowering `pairReproductionCooldownSeconds` (90 → 45) or raising `affinityIncreaseRate` | After age stagger, measure birth rate in telemetry before touching this. |
| ★☆☆ | **Hunger × fertility link** — suppress reproduction score when `hunger < threshold` | Ecological pressure signal; low urgency while food is abundant. |

### Parameter addition rule (summary)

Every new parameter requires all 3 steps:
1. `sim-settings.workspace.json` → `settings.sidebarParams`
2. `sidebar.js` `PARAM_DEFAULTS`
3. `sidebar.js` slider in right panel

### Key file map (quick reference)

| Concern | File | Key function/variable |
| ------- | ---- | --------------------- |
| World loop | `world.js` | `animate()` |
| Fruit regen | `world.js` | `animate.lastFruitRegenTime`, `fruitSpawnRate` |
| Character lifecycle | `character.js` | `constructor` (`this.age`), `die()`, `reproduceWith()` |
| AI decisions | `AI_rulebase.js`, `AI_utility.js` | rule-based / utility-based modes |
| Sidebar params | `sidebar.js` | `PARAM_DEFAULTS`, slider rows per tab |
| Initial param values | `sim-settings.workspace.json` | `settings.sidebarParams` |
| Telemetry | `main.js` | `window.simTelemetryConfig`, `exportSimulatorSettingsObject()` |

---

## System Design Backlog

Ideas from design review session (2026-04-14). Not yet prioritized for implementation.
All ideas must stay within Phase 1–3 scope (no persistence, no backend).

### A — Relationship Tier System ★★★

Replace the single affinity float with a **relationship class** derived from the score:

| Range | Class | Behavioral effect |
|-------|-------|-------------------|
| < floor+3 | `rival` | Avoidance, conflict bubble |
| floor–30 | `stranger` | Ignores, no interaction bonus |
| 30–60 | `acquaintance` | Greeting interactions, minor safety bonus |
| 60–80 | `ally` | Will donate food when self-hunger > 70 and partner < 40 |
| 80+ | `bonded` | Moves toward partner during danger, defends |

**Risk**: bonded pairs may cluster indefinitely and monopolize food patches.
The food-competition pressure among bonded characters likely rebalances this.

---

### B — Group Resource Sharing ★★★

When group members detect hunger disparity, surplus characters donate:

```
if (myHunger > 80 && partner.hunger < 40 && affinity >= 60) → GIVE_FOOD action
```

**Effect**: Groups become "survive together" units, not just safety-buff clusters.
`diligence` becomes a real selection pressure (better foragers feed the group).
**Risk**: groups become extinction-resistant refuges. Acceptable under observation-first philosophy.
**Depends on**: Relationship Tier (A) — ally/bonded threshold should gate generosity.

---

### C — Social Contagion (Mood Propagation) ★★

Nearby characters' need states exert a tiny influence on each other per tick:

```
// Within radius 3: neighbor.hunger < 20 → self.safety -= 0.5 * deltaTime
// Within radius 3: neighbor fully content → self.social += 0.3 * deltaTime
```

**Effect**: Famine "waves" become visible — one starving character unsettles neighbors.
One content character in a group pulls others toward calm.
**Risk**: Cascade collapse if coefficient too high. Keep delta ≤ 0.5/s; test with famine amplitude 0.8+.

---

### D — Foraging Skill Accumulation ★

Each fruit eaten increments `_foragingSkill` (cap 2.0, start 1.0):

```
this._foragingSkill = Math.min(2.0, 1.0 + this._foragingCount * 0.008);
```

Applied as a score multiplier when choosing food targets (experienced foragers reach fruit faster).
**Risk**: without trait coupling, skill converges uniformly — `diligence` or `resourcefulness` must
gate the accumulation rate or this is just a time-alive buff, not individual character.

---

## State Change Expressiveness

The observation problem: internal values change, but the numbers are static snapshots
and the characters visually "just walk around." Two distinct surfaces to improve.

### 3D Character — making internal state readable on the voxel

These changes live in `character.js` (mesh update section, already per-frame):

| Signal | Implementation idea | File / function |
|--------|---------------------|-----------------|
| **Hunger depletion** | Gradually shrink character scale 1.0 → 0.85 as hunger 100 → 0. Already readable at a glance. | `character.js` mesh update |
| **Energy state** | Movement speed already varies; make the range larger (exhausted = 0.4× normal) | `character.js` `updateMovement` |
| **State transition pulse** | On entering `eating`: brief scale pop (1.15 → 1.0 over 0.3s). On `die()`: dissolve (fade alpha + Y-sink). | `character.js` `die()`, action entry |
| **Relationship line** | Thin translucent line between characters with affinity ≥ 70, color by class (green=ally, pink=bonded). Hidden by default; toggle with a key. | `character.js` update loop or `world.js` overlay pass |
| **Ground aura** | Small ring on the floor below grouped characters (same groupId). Faint warm color; disappears when isolated. | `character.js` mesh setup |
| **Path ghost dots** | Render next 2–3 path nodes as tiny semi-transparent spheres. Shows intent (not just current position). | `character.js` `updateMovement` |

Priority order: hunger scale → state pulse → relationship line → rest.

### Sidebar / numbers — showing velocity, not just position

The numbers problem: the value today tells you nothing about where it's going.

| Signal | Implementation idea |
|--------|---------------------|
| **Delta arrow** | Next to hunger/safety/social: ▲ green if rising, ▼ red if falling (compare last 3s). Small, doesn't need to be precise. |
| **Per-value sparkline** | 10s mini-sparkline per need bar in the character detail panel. Low cost; reuse `createSparklineSVG()` already in sidebar. |
| **Threshold flash** | When hunger crosses 30 (critical) or 70 (recovered), briefly highlight the cell in red/green for 1s. CSS animation only. |
| **Activity bar animation** | The activity bars currently snap. Smoothing them with CSS `transition: width 0.4s ease` makes the shift between Eating/Moving/Idle feel like a living readout. |

Priority: activity bar CSS transition (1 line) → threshold flash → delta arrow → per-value sparkline.
