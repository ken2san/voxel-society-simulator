# Roadmap Archive

_Split out of `ROADMAP.md` on 2026-09-13 to keep the live roadmap short. Everything here is
historical session log / superseded design narrative — reference only, not current direction._

_If an entry here conflicts with `ROADMAP.md`, `ROADMAP.md` wins._

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
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
| -------------------- | --------------------------------- | ---------------------------------------------------------------- |
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
