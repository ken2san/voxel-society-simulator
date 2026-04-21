# Voxel Society Simulator - Development Roadmap

_Last updated: 2026-04-18_

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
  - AI behavior code **may** be actively modified when the goal is to make behavior more
    realistic or naturalistic (e.g. anxiety when isolated, risk when entering rival territory).
  - AI behavior code **must not** be modified to force a desired simulation outcome
    (e.g. raising birth probability when population drops, boosting EAT priority when
    starvation deaths are high). Reverse-engineering AI toward a demographic target
    violates this principle even when framed as a "fix".
- **Adaptation via environment and learning.** Prefer ecology-level changes
  (resource distribution, risk, travel cost) and character learning/growth
  dynamics over direct "do-not-die" overrides in decision code.
- **Observability over control.** UI investment should go toward making
  internal state readable (sidebar, telemetry, thought bubbles), not toward
  giving the user levers to steer outcomes.
- **Natural emergence over scripted cycles.** Births, deaths, and group
  formation should arise from individual character decisions, not from
  demographic targets or cooldown tuning.

### Layered Fertility / Cohesion Model

When iterating on reproduction and long-run population retention, treat the
cause structure as nested layers rather than a single fertility knob:

1. **Pair bond** — whether two characters have a durable high-affinity tie.
2. **Local support** — whether nearby allies/group support make child-rearing plausible.
3. **Livelihood viability** — whether food, shelter, energy, and safety are stable enough.
4. **Future expectation** — whether current conditions feel survivable over time.

Implementation rule:

- Do **not** tune births directly toward a demographic target.
- Shared threat may strengthen cohesion and support at moderate levels.
- Chronic high pressure should still reduce viability and fertility.
- Model anxiety, crisis, and disaster effects through these intermediate layers,
  not as a single direct “stress raises births” switch.

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

1. **`public/sim-settings.workspace.json`** — add under `settings.sidebarParams` with the intended default value.
2. **`sidebar.js` `PARAM_DEFAULTS`** — add the same key/value as a code-level fallback.
3. **`sidebar.js` slider row** — add a range slider in the right sidebar (a synced numeric box may accompany it) so the value can be adjusted at runtime without restarting.

Omitting any of the three steps is considered incomplete. Parameters that skip the slider step are not adjustable and violate the observability principle.

### Hardcode Policy

- **Experiment-facing coefficients must not stay as unexplained literals.** If changing a number would alter telemetry, social structure, fertility, migration, survival, or other observed outcomes, that number belongs in the simulator settings and sidebar.
- **Hardcoded values are allowed only when they are theory-backed implementation constants** such as geometry invariants, safety clamps, rendering/layout values, or anti-thrash guardrails.
- **Any intentional hardcoded constant should be locally justified** with a short comment explaining why it is not treated as an experimental parameter.
- When uncertain, treat the number as a tunable first.

---

## Phase 1 - Core Simulation Stability

### Goal

Keep the colony simulation stable, readable, and predictable under normal observation load.

### Scope

- Stabilize movement/pathfinding/retry behavior to avoid jitter and thrash loops.
- Preserve world consistency (`gridPos`, mesh position, and `worldData` updates).

---

## Phase 2 - Observation and Behavior Legibility

### Goal

Make core survival, bonding, and household-formation loops readable, debuggable, and interpretable without adding backend complexity.

### Scope

- Improve balancing and diagnostics for gathering, sheltering, hunger, energy, and social actions.
- Improve UI feedback so internal state changes are easy to watch and explain.
- Prioritize behaviors that are visually legible and directionally believable over game-like optimization.

---

## Phase 3 - Tooling, Regression, and Analysis Support

### Goal

Support reliable iteration, comparison, and handoff without pulling the project away from its observation-first focus.

### Scope

- Keep build, export, and telemetry-analysis workflows reliable.
- Add lightweight regression checks and improve developer documentation.
- Treat deployment and infra work as secondary support tasks, not the product direction.

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

### Current priority rule

When this roadmap is read by a new thread, use the sections in this order:

1. Project Concept
2. Current Status
3. Next Feature Brief
4. Current Sprint
5. Historical archive sections below only as reference

If an older handoff says “implement next” but conflicts with the sections above, the older handoff is archival and should not override the current direction.

### Active guardrail for current polish work

During the current observation-polish / performance pass:

- **Do not change AI decision logic, ecology tuning, social-model thresholds, or telemetry-driving simulation data** unless the user explicitly asks for it.
- Prefer fixes in **rendering, camera behavior, DOM/UI refresh cadence, effect throttling, and visibility culling**.
- If performance regresses at larger populations, treat it as a **display-pipeline problem first**, not a behavior-model problem.

### Verified progress as of 2026-04-19

- Sim-core separation is now live: the simulation runtime has been decoupled from the browser-facing Three.js layer so headless execution and browser execution can share the same behavior model
- Headless CLI workflow is now live via `npm run sim`, with telemetry export, per-run parameter overrides, and district-mode population validation support
- Automated generation-tuning support is now live via `npm run sim:tune`, allowing repeated telemetry comparison without the manual browser loop
- Layer 1 complete: Crisis Mode, Spatial Memory, Full Trait Activation
- Layer 2 complete: Relationship Tiers, ally food sharing, bonded night aid
- Layer 3 complete: Death Record tombstones
- Deferred bonus already shipped: Generation Summary Banner in Chronicle/Timeline
- Latest hotfix (commit `b4db325`): fixed food-target blacklist persistence that caused telemetry to show `EAT = 0%` despite fruit existing in the world; added Society Phase history trail so phase transitions are readable over time
- Observation upgrade: lifespan-ratio life stages are now live — child / young / adult / elder affect behavior through soft weighting instead of rigid scripting, and the sidebar exposes stage-mix trends for population reading
- Telemetry upgrade: demographic stage mix and dependency ratio are now exported so population dynamics can be compared across runs, not just watched live
- District scaling baseline is now live: `1 / 4 / 16` selector, active district switching, per-district observation summaries, and telemetry export support
- District social-pressure link is now active through latent variables (`housingPressure`, `timeStress`, `supportAccess`, `relationshipStability`) instead of a separate pre-scaling system
- Stability hotfixes shipped for rollout issues: startup freeze reduction, initial population preservation, and off-screen thought-bubble flicker cleanup
- Observation polish: left-pane district badges and district migration flow cues now make 4+ district movement easier to read live
- District opportunity scoring is now live: bounded-rational wandering can drift toward lower-pressure, higher-support districts instead of moving as pure local randomness
- Relationship visibility improved: selected characters now surface top social ties and support-network cues so group structure is observable from outside the sim
- Selected-character observation now includes live tie lines in the scene, making support hubs and bonded pairs readable at a glance
- Observation polish pass shipped: live bubble/effects toggles, clearer tiny-home silhouettes, improved roof-vs-fruit contrast, and quiet ambient village cues
- Render-performance polish shipped: capped HiDPI canvas cost and throttled non-essential ambient updates so camera interaction stays more responsive at larger visible populations

---

## Next Feature Brief — District-Scaled Observation Architecture

### Goal

Enable believable observation of larger communities by separating:

- the **internal society simulation** that may contain 100–200+ agents,
- the **currently rendered voxel district** that the user is watching in detail.

The immediate product problem is that a community of 10 is too small to show durable social circulation,
but a fully rendered 100–200 agent voxel world is too expensive under the current architecture.

### Core decision

Do **not** render or pathfind every agent at full fidelity all the time.
Instead, split the society into square districts and render only the currently selected district in detail.

### User-facing model

The world should support a square district selector:

- **1 district** = current single-view world (`1 x 1`)
- **4 districts** = first scalable mode (`2 x 2`)
- **16 districts** = higher-density observation mode (`4 x 4`)

The user can switch which district is being observed while the full society continues to evolve internally.

### Recommended implementation order

1. **Preserve current behavior in 1-district mode**
   - this is the baseline and fallback mode
   - no behavior change should be required for old saves/tests
   - **Status:** baseline compatibility preserved

2. **Implement 4-district mode first**
   - this is the real target for the next thread
   - one active district rendered in full detail
   - the other 3 districts updated in lightweight aggregate form
   - **Status:** baseline implementation live; now in stabilization / scaling polish

3. **Add 16-district mode only after 4 is stable**
   - same architecture, just finer square partitioning
   - do not start here first
   - **Status:** selector exists, but tuning should continue to follow 4-district validation first

### Current district-scaling status snapshot

- ✅ Active district switching and minimap framing
- ✅ Per-district telemetry and export summaries
- ✅ District-aware social pressure connection
- ✅ Initial rollout regressions fixed (startup responsiveness, initial population, bubble flicker)
- 🔲 Next: scale-friendly population presets and continue lightweight off-screen behavior tuning
- 🔲 Next: validate larger-community observation in `4` mode with telemetry

### District simulation rules

- Only the **active district** gets full mesh updates, pathfinding, and detailed per-agent motion.
- Off-screen districts should use **low-fidelity updates**:
  - births / deaths
  - stage mix changes
  - migration in / out
  - food and pressure summaries
  - pair / support stability summaries
- Switching districts should not reset the world; it should reveal another live slice of the same society.

### Minimum district state to track

| District signal   | Why it matters              |
| ----------------- | --------------------------- |
| population        | basic viability / density   |
| births and deaths | local circulation           |
| stage mix         | demographic waves           |
| food pressure     | ecology constraint          |
| housing pressure  | family-formation constraint |
| support density   | social resilience           |
| conflict level    | instability / fragmentation |
| migration flow    | movement between districts  |

### UI / telemetry requirements

- district selector with **1 / 4 / 16** square modes
- ability to choose the observed district from a simple grid or heatmap
- telemetry must include both:
  - **global totals** for the whole society
  - **per-district summaries** for comparison
- observation sidebar should make it clear which district is currently being watched

### Suggested file targets

| Concern                                                    | Likely file                                          |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| district topology / active rendered district               | `world.js`                                           |
| simulation mode, orchestration, telemetry meta             | `main.js`                                            |
| district selector UI and observation panels                | `sidebar.js`                                         |
| promotion / demotion between high- and low-fidelity agents | `character.js` or a new lightweight district manager |
| export summaries                                           | `scripts/export-telemetry.mjs`                       |

### Success criteria

- 1-district mode still behaves like the current sim
- 4-district mode supports a noticeably larger society without frame collapse
- the user can switch districts and keep observing a live society
- telemetry explains both local and global demographic change
- the architecture remains compatible with the later social-pressure feature

### Non-goals

- No attempt to render 100–200 agents simultaneously at full detail
- No full-fidelity pathfinding in all districts at once
- No Phase 4 persistence/backend work as part of this feature

### Follow-on after scaling

Once this architecture exists, the next behavior layer remains:
**Social Pressure and Family Formation Abstraction**
using compact latent variables such as `housingPressure`, `timeStress`, `supportAccess`, and `relationshipStability`.
Those variables should plug naturally into the district summaries above rather than being implemented separately first.

---

## Current Sprint — Observation UI and Render Performance

### Goal

Keep the simulation easy to watch at larger visible populations without
changing the underlying society behavior.

### Guardrail

This sprint is **render/UI only**:

- no AI rewrites
- no ecology / survival retuning
- no changes whose main effect is to alter observed population outcomes

### Tasks

| Status     | Item                                                                |
| ---------- | ------------------------------------------------------------------- |
| ✅ Done    | Live bubble toggle for cleaner observation                          |
| ✅ Done    | Live effects toggle for optional scene polish                       |
| ✅ Done    | Tiny-home readability pass and roof/fruit contrast cleanup          |
| ✅ Done    | Quiet ambient world effects with house-body-only night warmth       |
| ✅ Done    | Canvas performance mitigation for larger scenes on HiDPI displays   |
| 🔲 Next    | Throttle selected-character overlay / marker refresh under load     |
| 🔲 Next    | Add a simple low/normal visual quality preset if needed             |
| 🔲 Next    | Continue camera-responsiveness profiling at ~50+ visible characters |
| 🔲 Backlog | Further DOM update coalescing for the left and right observation UI |

### Current success criteria

- camera drag / orbit stays responsive during active observation
- effects remain optional and subtle
- the scene reads clearly without distorting behavior
- AI and simulation-data layers remain untouched unless explicitly requested

---

## Ecology Tuning — Done Criteria (as of 2026-04-17)

_Concrete exit criteria for the reproduction/ecology tuning loop. Once all are met, stop tuning and move on._

### ✅ Metrics to track — done when all pass

| Metric             | Target                                       | Rationale                                    |
| ------------------ | -------------------------------------------- | -------------------------------------------- |
| Benchmark          | PASS 5/5 every valid run                     | Baseline integrity                           |
| starvation deaths  | ≤ 10% of total deaths                        | Survival must be plausible, not zero         |
| old_age deaths     | ≥ 60% of total deaths                        | Natural mortality is the dominant cause      |
| Gen2+ births       | Appears in ≥ 1 run per 3 full runs (> 300 s) | Multi-generational chain is reproducible     |
| wanderRatio avg    | < 72%                                        | Behavioral diversity beyond wandering exists |
| socializeRatio avg | > 3%                                         | Social layer is active, not vestigial        |

**Final status (2026-04-17, commit `9e4df32`, confirmed run `telemetry-2026-04-17T09-06-55`):**

- Benchmark: ✅ PASS 5/5
- starvation: ✅ 0/14 = 0%
- old_age: ✅ 14/14 = 100%
- Gen2+: ✅ gen2=2 confirmed
- wanderRatio: ✅ 71.7% (< 72%)
- socializeRatio: ✅ 3.6% (> 3%)

**Verdict: ALL 6 criteria pass. Ecology tuning phase COMPLETE. Move to District-Scaled Architecture.**

_Note: lowEnergyRatio=40.9% is elevated (chronic energy stress, not fatal). Watch if it resurfaces at district scale._

### ❌ Metrics NOT to chase

| Metric                  | Why to ignore                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `birthDeathRatio ≥ 1.0` | Requires 5.5× more births; forcing it causes starvation regression. A founding-cohort wave dying out is realistic and observable — not a failure state |
| Exact generation depth  | Stochastic by design; gen3 appearing at all is sufficient signal                                                                                       |
| Zero starvation         | Some starvation under severe conditions is authentic behavior                                                                                          |
| Population equilibrium  | Collapse and recovery cycles are the observation content, not bugs                                                                                     |

---

## Active Handoff — Session 2026-04-15 (Next feature scope)

_This section captures the next intended feature so a new thread can continue without re-deriving the design._

### User goal clarified

The product goal is **not only realism** and **not only spectacle**.
It is a glass-tank simulator where the user can:

1. change a small set of parameters,
2. watch the society respond in the canvas,
3. capture telemetry,
4. analyze the result with AI or by eye.

So the next feature should optimize for **interpretable abstraction**:
small causal systems, readable behavior, and directionally correct outcomes.

### Next feature to implement

**District-Scaled Observation Architecture**

This is now the immediate next feature because larger community observation has become the main blocker.
The social-pressure/family-formation work should continue **after** the scaling layer exists.

### Recommended first implementation order

1. **Introduce district modes without breaking the current single-world path**
   - `1 x 1` stays as the current baseline
   - `2 x 2` becomes the first real scalable mode

2. **Separate rendered detail from internal society updates**
   - active district = high fidelity
   - non-active districts = aggregate updates only

3. **Add district selector UI**
   - user-facing options: `1 / 4 / 16`
   - square layout only for now

4. **Add per-district telemetry and global summaries**
   - global population totals
   - district population / pressure / migration comparisons

5. **Only then layer social-pressure behavior into the larger world**
   - once scaling is stable, add readiness variables on top

### Suggested file targets

| Concern                                             | Likely file                                           |
| --------------------------------------------------- | ----------------------------------------------------- |
| district partitioning and active-view orchestration | `world.js`, `main.js`                                 |
| selector UI and observation summaries               | `sidebar.js`                                          |
| agent fidelity switching / lightweight state        | `character.js` or a new district manager              |
| telemetry export                                    | `main.js`, `world.js`, `scripts/export-telemetry.mjs` |

### Success criteria for the next thread

- district mode `1` remains backward-compatible
- district mode `4` becomes usable for substantially larger populations
- switching observed districts feels like observing another part of the same live society
- the roadmap remains observation-first rather than turning into a pure optimization exercise

---

## Archive — Historical Handoff — Session 2026-04-14 PM (System Design)

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

## Archive — Historical Handoff — Session 2026-04-14 AM

_This section is updated at the end of each working session so the next AI thread can pick up without re-explanation._

### What was discussed

Design review of the lifecycle loop: birth → eating + socializing → death.
Confirmed the core problem is **not food shortage** — it is **population structure**.

### What was built

| Commit    | Change                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ec757a7` | `animate()`: time-based fruit regeneration every `fruitRegenIntervalSeconds` (default 60 s). Scans all GRASS surfaces and places FRUIT at `fruitSpawnRate` probability.         |
| `091dab3` | `ROADMAP.md`: Parameter Addition Rule (3-step: workspace JSON → PARAM_DEFAULTS → sidebar slider). `sim-settings.workspace.json`: added missing `fruitRegenIntervalSeconds: 60`. |

### Confirmed findings (from telemetry `telemetry-2026-04-13T15-54-47-101Z.json`)

- **Death cause**: 100% old age (starvation: 0). Food is not the bottleneck.
- **Population crash**: 13 → 4 people in 2 seconds at sim_total = 360 s.
- **Root cause**: All 10 initial characters spawn at `age = 0` simultaneously → they all hit `lifespan = 360 s` at the same moment → mass extinction event.
- **Birth rate**: Only 3 births in 360 s (need ~10 to sustain initial pop of 10).
- **Reproduction bottleneck**: `affinityIncreaseRate = 6`, `pairReproductionCooldownSeconds = 90` → at most 2–3 children per pair per lifespan. Not enough to offset deaths.
- **Surviving 4** (gen=1): lifeRatio 0.81–0.97 — they are the next cohort collapse, forming the same synchronized death wave.

### Next tasks (prioritized)

| Priority | Task                                                                                                                         | Rationale                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ★★★      | ~~**Stagger initial spawn ages**~~ ✅ Done                                                                                   | `initialAgeMaxRatio` param (default 0.5) added via 3-step rule. `main.js` uses `window.initialAgeMaxRatio` instead of hardcoded `0.65`. Slider in Setup tab.                                                                                                                                                                                                                                |
| ★★★      | ~~**Ideology gap → affinity ceiling**~~ ✅ Done                                                                              | `Character.computeTraitDistance()` uses 6-trait vector (bravery/diligence/sociality/curiosity/resourcefulness/resilience). During socializing, `affinityCap = maxAffinity × (1 − capReduction × traitDist)`. Param: `traitAffinityCapReduction` (default 0.6) in Social tab → groups naturally form around compatible worldviews; Dunbar-scale fragmentation emerges without explicit rule. |
| ★★☆      | **Affinity lower floor (hate-but-persist)**                                                                                  | Currently affinity ≤ 0 causes `relationships.delete()`. Change floor to 5 — negative relationships remain visible as structural tension. Change: `character.js` line ~2618 `relationships.delete(k)` → clamp to 5.                                                                                                                                                                          |
| ★★☆      | ~~**Seasonal food variation**~~ ✅ Done                                                                                      | `animate.simTime` accumulator drives sin-wave on fruitSpawnRate. `seasonCycleSeconds` (default 120s) and `seasonAmplitude` (default 0.6) added via 3-step rule (Behavior tab). amplitude=0.6 → summer 1.6×, winter 0.4×; amplitude=1.0 → winter rate=0 (true famine).                                                                                                                       |
| ★★☆      | **Ease reproduction rate** — consider lowering `pairReproductionCooldownSeconds` (90 → 45) or raising `affinityIncreaseRate` | After age stagger, measure birth rate in telemetry before touching this.                                                                                                                                                                                                                                                                                                                    |
| ★☆☆      | **Hunger × fertility link** — suppress reproduction score when `hunger < threshold`                                          | Ecological pressure signal; low urgency while food is abundant.                                                                                                                                                                                                                                                                                                                             |

### Parameter addition rule (summary)

Every new parameter requires all 3 steps:

1. `sim-settings.workspace.json` → `settings.sidebarParams`
2. `sidebar.js` `PARAM_DEFAULTS`
3. `sidebar.js` slider in right panel

### Key file map (quick reference)

| Concern              | File                              | Key function/variable                                          |
| -------------------- | --------------------------------- | -------------------------------------------------------------- |
| World loop           | `world.js`                        | `animate()`                                                    |
| Fruit regen          | `world.js`                        | `animate.lastFruitRegenTime`, `fruitSpawnRate`                 |
| Character lifecycle  | `character.js`                    | `constructor` (`this.age`), `die()`, `reproduceWith()`         |
| AI decisions         | `AI_rulebase.js`, `AI_utility.js` | rule-based / utility-based modes                               |
| Sidebar params       | `sidebar.js`                      | `PARAM_DEFAULTS`, slider rows per tab                          |
| Initial param values | `sim-settings.workspace.json`     | `settings.sidebarParams`                                       |
| Telemetry            | `main.js`                         | `window.simTelemetryConfig`, `exportSimulatorSettingsObject()` |

---

## Archive — System Design Architecture

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

## Archive — System Design Backlog — Completed Foundation Work

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

| Priority  | Old formula             | New formula                                                  |
| --------- | ----------------------- | ------------------------------------------------------------ |
| P6 Safety | `safety < 20 * bravery` | `safety < 20 * (2.0 - bravery)` + `nightSafetyOverride`      |
| P7 Rest   | `70 * bravery`          | `clamp(45 + (2.0 - bravery) * 18 + adapt.rest * 15, 25, 75)` |
| P8 Food   | `95 * min(1.0, res)`    | `70 + (resourcefulness - 1.0) * 20`                          |

**Observable check**: with `seasonAmplitude ≥ 0.6`, telemetry should show high-resourcefulness
characters surviving famine more often over multiple generations → trait selection pressure active.

---

### 4 — ~~Relationship Tiers~~ ✅ Done `Layer 2` (commit `027fe72`)

**Implemented** in `character.js` + `AI_rulebase.js`:

| Class          | Affinity | Behavior added                                                                     |
| -------------- | -------- | ---------------------------------------------------------------------------------- |
| `acquaintance` | 30+      | (foundation only; no active gate yet)                                              |
| `ally`         | 60+      | Safety +1.5/s at night within 2 tiles; food donation when donor >70, recipient <40 |
| `bonded`       | 80+      | Safety +3/s at night; P6.5 partner-aid moves toward them when their safety <30     |

`getRelationshipClass(otherId)` — derived helper, no stored state. Added to `character.js`.

Food donation (learningTick, every 2s): transfers `min(20, hunger - 50)` — donor never drops below 50.
Shows 🤝 icon. Observable during famine: fed ally keeps hungry partner alive.

P6.5 bonded-approach (AI_rulebase.js): triggers at night when bonded partner safety<30, self energy>50.
WANDER toward adjacent spot. Observable: bonded pairs cluster at night automatically.

**Observable check**: during seasonal famine, watch ally pairs — one character should show 🤝 icon
while the other's hunger stabilizes. At night, bonded characters should move toward each other.

---

### 5 — ~~Death Record~~ ✅ Done `Layer 3` (commit `ff1c433`)

**Implemented** in `character.js` `die()` + `main.js` `resetPopulationStats()`:

Tombstone written before character is removed from array:

```javascript
window.__deathRecords.push({
  id,
  generation,
  ageAtDeath,
  lifespan,
  cause,
  traits: { ...this.personality },
  childCount,
  parentIds,
  groupIdAtDeath,
  finalNeeds: { hunger, energy, safety, social },
});
```

- Capped at 200 records (oldest shifted out). Same pattern as event log.
- Cleared on sim restart via `resetPopulationStats()`.
- Readable via DevTools: `window.__deathRecords`.

**Unlocks now stable**: Generation Summary Banner (can fire when `__maxGenSeen` increments).

---

## Deferred Observation Backlog

### B — Resource Sharing ✅ Done (implemented as part of Relationship Tiers, item 4)

Food donation is live: ally/bonded characters donate food every 2s tick when nearby.

### Generation Summary Banner

Depends on Death Record (item 5) — now stable.
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

| Signal                     | Implementation idea                                                                                                                          | File / function                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Hunger depletion**       | Gradually shrink character scale 1.0 → 0.85 as hunger 100 → 0. Already readable at a glance.                                                 | `character.js` mesh update                            |
| **Energy state**           | Movement speed already varies; make the range larger (exhausted = 0.4× normal)                                                               | `character.js` `updateMovement`                       |
| **State transition pulse** | On entering `eating`: brief scale pop (1.15 → 1.0 over 0.3s). On `die()`: dissolve (fade alpha + Y-sink).                                    | `character.js` `die()`, action entry                  |
| **Relationship line**      | Thin translucent line between characters with affinity ≥ 70, color by class (green=ally, pink=bonded). Hidden by default; toggle with a key. | `character.js` update loop or `world.js` overlay pass |
| **Ground aura**            | Small ring on the floor below grouped characters (same groupId). Faint warm color; disappears when isolated.                                 | `character.js` mesh setup                             |
| **Path ghost dots**        | Render next 2–3 path nodes as tiny semi-transparent spheres. Shows intent (not just current position).                                       | `character.js` `updateMovement`                       |

Priority order: hunger scale → state pulse → relationship line → rest.

### Sidebar / numbers — showing velocity, not just position

The numbers problem: the value today tells you nothing about where it's going.

| Signal                     | Implementation idea                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Delta arrow**            | Next to hunger/safety/social: ▲ green if rising, ▼ red if falling (compare last 3s). Small, doesn't need to be precise.                                        |
| **Per-value sparkline**    | 10s mini-sparkline per need bar in the character detail panel. Low cost; reuse `createSparklineSVG()` already in sidebar.                                      |
| **Threshold flash**        | When hunger crosses 30 (critical) or 70 (recovered), briefly highlight the cell in red/green for 1s. CSS animation only.                                       |
| **Activity bar animation** | The activity bars currently snap. Smoothing them with CSS `transition: width 0.4s ease` makes the shift between Eating/Moving/Idle feel like a living readout. |

Priority: activity bar CSS transition (1 line) → threshold flash → delta arrow → per-value sparkline.

### Population dynamics refinement — life stages (implemented 2026-04-15)

To make the colony read more like a living population and less like a binary child/adult switch:

- Replace the 2-state framing with four observation stages: child / young / adult / elder.
- Use lifespan ratio, not raw age seconds, so short-lived and long-lived individuals age fairly.
- Apply soft behavioral weighting rather than hard scripting:
  - young → slightly more movement, exploration, and sociality
  - adult → stable work/fertility baseline
  - elder → earlier rest, lower work/exploration, lower fertility
- Keep only one hard gate: children cannot reproduce until maturity window.
- Surface the stage mix in sidebar trend views so demographic waves become observable.
