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

## Handoff — Session 2026-04-14 PM (System Design)

_This section is updated at the end of each working session so the next AI thread can pick up without re-explanation._

### What this session did

Pure design session — no simulation code changed. Three activities:

1. **System design brainstorming** — deep dive into character.js/AI_rulebase.js to find structural weaknesses
2. **Priority filtering** — selected top 5 items from 9+ ideas based on ROI + independence + whether they unblock other things
3. **ROADMAP restructure** — replaced unordered idea list with 3-layer architecture model

### Key structural findings (from code read)

- `learn()` is a **stub** — `adaptiveTendencies` Map exists and is used in AI scoring, but `learn()` is never called → characters have zero experiential learning currently
- `bravery` and `resourcefulness` affect **morphology only** — two of six traits are decorative in AI
- `groupId` and `relationships` are **fully disconnected** — groups form by proximity, not by trust → being in a group means nothing socially
- **No selection pressure**: all traits survive equally regardless of season/famine → generational drift is neutral/random
- `adaptiveTendencies.forage/rest/social/explore` are used to weight AI probabilities, but since `learn()` is never called, all characters keep initial values forever

### Architecture decision

Settled on a **3-layer implementation order**:

```
Layer 1 Individual (implement first — makes behavior meaningful):
  1. Crisis Mode       → single-purpose behavior when needs go critical
  2. Spatial Memory    → implement learn() as _knownFoodSpots/_dangerZones Maps
  3. Full trait use    → activate bravery (night safety override) + resourcefulness (proactive foraging threshold)

Layer 2 Social (implement after Layer 1 is stable):
  4. Relationship Tiers → getRelationshipClass() helper; affinity float → rival/stranger/acquaintance/ally/bonded

Layer 3 Population (implement after Layer 2 is stable):
  5. Death Record      → tombstone on die(), stored in window.__deathRecords; unlocks generation analytics
```

Deferred (with explicit preconditions noted in ROADMAP):
- Resource Sharing (needs Tiers first)
- Generation Summary banner (needs Death Record first)
- Social Contagion (coefficient-sensitive; needs Crisis Mode baseline first)
- groupId → affinity graph rebuild (high regression risk; defer until Tiers proven)

### What to implement next

**Start with Crisis Mode** — lowest cost, highest immediate observability impact.
Change: in `decideNextAction_rulebase()`, add a pre-check before priority tiers:
```javascript
if (this.hunger < 15) → force FIND_FOOD, skip all other rules
if (this.energy < 10) → force REST, skip all other rules
// also: block reproduction during crisis
```
File: `AI_rulebase.js` (or wherever `decideNextAction_rulebase` lives — confirm before editing).

After Crisis Mode: **Spatial Memory** (add `_knownFoodSpots` Map to constructor, populate on eat, use in food-target scoring).

### What was NOT changed this session

- `character.js`, `world.js`, `main.js`, `sidebar.js` — all unchanged
- `sim-settings.workspace.json` — unchanged
- All previously committed features remain intact

---

## Handoff — Session 2026-04-14 AM

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

## System Design Architecture

_Last reviewed: 2026-04-14_

### Core structural problem

The simulation has three missing layers that together cause "everyone walks around randomly and dies at the same time":

> **Individual**: no memory, two traits unused, no crisis response
> **Social**: affinity is a number with no behavioral consequence, groups are proximity clusters not trust networks
> **Population**: deaths leave no record, generational drift is invisible

### Three-layer model

```
Layer 1: Individual
  ├── Crisis Mode        → behavior shifts when needs hit critical threshold
  ├── Spatial Memory     → experienced characters remember food/danger locations
  └── Full trait activation  → bravery + resourcefulness actually drive decisions

Layer 2: Social
  └── Relationship Tiers → affinity float becomes a behavioral class (rival/stranger/ally/bonded)

Layer 3: Population
  └── Death Record       → deaths store trait snapshot; foundation for generation analytics

--- deferred until above layers are stable ---

  ├── Resource Sharing   → ally-class characters donate food (depends on Tier)
  ├── Generation Summary → per-generation trait averages, cause-of-death (depends on Death Record)
  ├── Social Contagion   → hunger/contentment propagates within radius 3 (tuning-sensitive)
  └── groupId rebuild    → groups form from affinity graph, not proximity (high risk)
```

**Implementation order**: Layer 1 → Layer 2 → Layer 3.
Individual behavior must be meaningful before social dynamics are observable.
Social structure must be real before generational drift can be read.

---

## System Design Backlog — Active (Layer 1–2)

### 1 — ~~Crisis Mode~~ ✅ Done `Layer 1` (commit `10b622b`)

**Implemented**: PRIORITY 0.5 inserted in `AI_rulebase.js` between energy-emergency and exploration.
When `hunger ≤ 15`: all social/home/exploration/role rules bypassed; character seeks food or wanders.
Reproduction blocked in `character.js` at both loveTimer trigger sites when either partner hunger ≤ 15.

**Observable check**: with `seasonAmplitude ≥ 0.8`, watch for characters scattering during winter famine
instead of clustering socially. Activity bars should show Eating collapse + Moving spike simultaneously.

---

### 2 — ~~Spatial Memory~~ ✅ Done `Layer 1` (commit `8735c77`)

**Note**: `learn()` was already fully implemented (not a stub). Missing piece was `_knownFoodSpots` Map.

**Implemented** in `character.js`:
- Constructor: `this._knownFoodSpots = new Map()` — `"x,y,z" → timestamp`
- `collectFood()` (EAT completion): `_knownFoodSpots.set(key, Date.now())` after eating
- `findClosestFood()`: TTL expiry (60s), 0.5× scoring bonus for known spots, on-miss purge

**Observable check**: new characters wander erratically; characters that have eaten before
walk directly toward previous food locations. Veteran vs novice movement is visually distinct.

---

### 3 — ~~Full Trait Activation~~ ✅ Done `Layer 1` (commit `8735c77`)

**Bug fixes + activation** in `AI_rulebase.js`:
- P6 bravery direction was **inverted** — high bravery caused MORE fleeing (fixed)
- P7 `70 * bravery` caused bravery=1.5 → rest threshold=105 = always resting (fixed)
- P8 `Math.min(1.0, resourcefulness)` cap killed the trait for high-value characters (removed)

| Priority | Old formula | New formula |
|----------|-------------|-------------|
| P6 Safety | `safety < 20 * bravery` | `safety < 20 * (2.0 - bravery)` + `nightSafetyOverride` |
| P7 Rest | `70 * bravery` | `clamp(45 + (2.0 - bravery) * 18 + adapt.rest * 15, 25, 75)` |
| P8 Food | `95 * min(1.0, res)` | `70 + (resourcefulness - 1.0) * 20` |

**Observable check**: with `seasonAmplitude ≥ 0.6`, telemetry should show high-resourcefulness
characters surviving famine more often over multiple generations → trait selection pressure active.

---

### 4 — ~~Relationship Tiers~~ ✅ Done `Layer 2` (commit `027fe72`)

**Implemented** in `character.js` + `AI_rulebase.js`:

| Class | Affinity | Behavior added |
|-------|----------|----------------|
| `acquaintance` | 30+ | (foundation only; no active gate yet) |
| `ally` | 60+ | Safety +1.5/s at night within 2 tiles; food donation when donor >70, recipient <40 |
| `bonded` | 80+ | Safety +3/s at night; P6.5 partner-aid moves toward them when their safety <30 |

`getRelationshipClass(otherId)` — derived helper, no stored state. Added to `character.js`.

Food donation (learningTick, every 2s): transfers `min(20, hunger - 50)` — donor never drops below 50.
Shows 🤝 icon. Observable during famine: fed ally keeps hungry partner alive.

P6.5 bonded-approach (AI_rulebase.js): triggers at night when bonded partner safety<30, self energy>50.
WANDER toward adjacent spot. Observable: bonded pairs cluster at night automatically.

**Observable check**: during seasonal famine, watch ally pairs — one character should show 🤝 icon
while the other's hunger stabilizes. At night, bonded characters should move toward each other.

---

### 5 — Death Record ★★☆ `Layer 3`

When `die()` is called, persist a lightweight tombstone (character instance discarded):

```javascript
window.__deathRecords = window.__deathRecords || [];
window.__deathRecords.push({
  id, generation,
  ageAtDeath: this.age,        // actual seconds lived
  lifespan,                    // expected max
  cause,                       // 'starvation' | 'old_age'
  traits: { ...this.personality },
  childCount: this.childCount,
  parentIds: this.parentIds,
  groupIdAtDeath: this.groupId,
  finalNeeds: { hunger, energy, safety, social }
});
```

**Observable effect**: world-level statistics become possible:
- Average lifespan per generation
- Dominant cause of death per season
- Trait distribution shift across generations (did diligence rise after a famine winter?)

**Unlocks**: Generation Summary banner (show per-generation averages when generation advances).
**Risk**: unbounded growth if simulation runs for many generations. Cap at last 200 records.

---

## System Design Backlog — Deferred

### B — Resource Sharing
Depends on Relationship Tiers (item 4). Ally-class characters donate food.
Add after Tier system is tested and stable.

### Generation Summary Banner
Depends on Death Record (item 5).
When `__maxGenSeen` increments, compute avg lifespan + trait delta for the completed generation.
Display as a Chronicle event with generational stats inline.

### Social Contagion
Coefficient-sensitive. Needs `seasonAmplitude` ≥ 0.8 to observe clearly.
Add after Crisis Mode is stable (item 1 changes baseline behavior that contagion modulates).

### groupId → Affinity Graph Rebuild
High impact, high regression risk. Replaces proximity clustering with connected-component
analysis of affinity ≥ 50 edges. Defer until Tier system (item 4) is proven stable.

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
