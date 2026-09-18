# Voxel Society Simulator - Development Roadmap

_Last updated: 2026-09-18_

---

## Repo Timeline Note (read this first)

This roadmap's previous "last updated: 2026-04-25" stamp was written **in the middle of**
a 3-day, ~65-commit burst (2026-04-24 → 2026-04-26) that added large amounts of work this
file never documented. The repo has had **zero commits since 2026-04-26** (HEAD `3e73c34`)
until this doc pass — so treat everything below "Current Status" as accurate for that HEAD,
not as a gradual multi-month history.

What the burst added, undocumented until this pass, is now captured under the
**"Biology & Environment Systems"** section below. District-Scaled Observation Architecture —
the feature this roadmap called "next" — did **not** progress during the burst; it was
sidelined, not superseded. It remains valid backlog.

---

## Project Concept

### World Lore

**Setting: post-human Earth. The dominant civilization collapsed. What remains are AI-embedded autonomous robots ("golems") who inherited the structures, habits, and social patterns of the species that built them — but not the species itself.**

They gather food (fuel/materials), form bonds, build and maintain shelters, grieve their dead, and seek cover from the rain. The simulation is a window into their society, not a game about them. The observer is an outsider.

They build houses not because they strictly need shelter, but because they inherited the behavioral templates of the species that made them. The mimicry is imperfect, unconscious, and persistent — which is exactly what makes it interesting to watch.

This lore is intentionally kept implicit in the UI — nothing needs to be explained to the player. The behavior should feel organic enough that the setting is inferred, not announced.

---

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
5. `docs/roadmap-archive.md` only as historical reference — never as current direction

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

### Guardrail process gap — accepted as settled, noted for future enforcement

Two commits from the tail end of the 2026-04-26 burst (`d902a2f` "block AI and work actions
while inside home", `fb4be40` "stop instant re-socialize loop — exit cooldown + per-char sound
throttle") change AI action-gating and social-cooldown logic in `character.js`. That is exactly
the category the "Active guardrail for current polish work" above says requires an explicit user
ask, not a rendering/UI-only fix. Asked the user (2026-09-13); too long ago to recall whether it
was requested at the time. Treating the resulting behavior as settled/intentional rather than
reverting it on suspicion alone — but the gap itself is worth remembering: a render/UI-only
sprint drifted into AI-gating changes without a clear paper trail, and that's the failure mode
the guardrail exists to catch. Worth enforcing more legibly next time (e.g. a one-line "why" note
in the commit body when a guardrail-adjacent change is explicitly user-requested).

## Biology & Environment Systems (2026-04-25/26, previously undocumented)

Real, shipped, and verified with a metrics pass — but never written up here until now. Confirmed
by reading `character.js` / `world.js` directly, not just commit messages.

- **Body condition**: `fatReserve` mechanic — metabolism draws it down, overflow/burn drives a
  body-width animation; acts as a starvation buffer. Autumn hyperphagia (pre-winter overeating
  drive) feeds it seasonally.
- **Thermal drain**: cold exposure drains energy/condition; interacts with the campfire and
  home-shelter systems below.
- **Disease**: a compact SIR (susceptible/infected/recovered) model — `_diseaseState` /
  `_diseaseTimer` on each character, transmission on proximity, elder recovery handling.
- **Pregnancy**: `_pregnant` / `_pregnancyTimer` / `_giveBirth()` replace instant reproduction
  with a gestation period and parental-investment behavior afterward.
- **Weather**: two distinct rain types (downpour+thunder vs. drizzle) drive AI shelter-seeking
  and a home-absorption animation; golems are explicitly excluded from some of this (stone
  creatures behave differently from golems per the lore added in the same burst).
- **Campfire & Charge Stone**: campfires are placed world objects (`MAX_CAMPFIRE_SPOTS`,
  `CHARS_PER_CAMPFIRE`, `MIN_CAMPFIRE_SPACING`) that offset thermal drain; Charge Stone replaces
  the old Bed object as the golem-appropriate energy/recovery source.
- **Special entities — Angel / Reaper** (`sim-core/special-entities.js`): ambient roaming
  entities, not characters. Angel appears when the live child count reaches `CHILD_THRESHOLD`
  (10); Reaper appears when the live elder count reaches `ELDER_THRESHOLD` (10). This is a
  genuinely good fit for the project's "observability over control" principle — population
  structure becomes visible in the scene itself — but the thresholds are bare literals in
  `world.js`, not sidebar params.
- **Balance pass**: `balance(iter20)` tuned thermal drain, perception range, food-retry count,
  hunger decay, fruit cap, and reservation TTL together, and reported a real 4-run pass/fail
  (hunger avg, energy avg, end population, food-seek-fail rate, starvation — all pass). Same
  rigor as the "Ecology Tuning — Done Criteria" section further down, just never merged into it.

### Backlog this creates — Parameter Addition Rule violation

Every constant above (thermal drain rate, fat caps/rates, disease duration/transmission,
pregnancy duration, campfire density/spacing, angel/reaper thresholds) was grepped against
`public/sim-settings.workspace.json` and `sidebar.js` `PARAM_DEFAULTS` — **zero matches in
either file.** Per this roadmap's own Parameter Addition Rule, a parameter that skips the
workspace-JSON + PARAM_DEFAULTS + slider steps is "incomplete" and not adjustable at runtime.
This entire system currently fails that rule. Migrating these constants through the 3-step
process is real, scoped backlog — not a stylistic nice-to-have.

### Mobile surface (2026-04-24, previously undocumented)

A parallel mobile UI now exists (`mobile.html`, `mobile-main.js`): responsive bottom-sheet /
accordion panels, floating HUD, and its own perf throttling (30fps cap, no antialiasing,
reduced rain particles, skipped AI/animation ticks on frames it isn't rendering). Not mentioned
anywhere else in project docs; anyone touching shared rendering/AI code should be aware a second
consumer of that code exists.

### Sound system (2026-04-24 → 04-26, still stabilizing)

Synthesized Web Audio (no audio files) for dig/ambient/social sounds, with a volume slider and
Setup-tab toggle. The commit trail through the end of the burst is a chain of throttle-value and
waveform corrections (dig-sound spam, then a "poko" social-sound complaint, then an instant
re-socialize loop found while fixing that) — read as still being tuned by ear rather than
settled, not a finished feature.

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

**Status note (2026-09-13):** this sprint was interrupted, not completed — the 2026-04-25/26
burst diverted effort into the Biology & Environment Systems and Mobile work documented above
instead of the "🔲 Next" items below. Those items were never invalidated; they're simply where
this sprint left off if/when it resumes.

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

## Regression Found & Fixed — iter20 balance-pass criteria (2026-09-14)

**Symptom:** `npm run sim -- --minutes=10 --population=32` (the exact config `balance(iter20)`,
commit `2764bcf`, recorded as a 4-run pass) was producing much worse outcomes than its recorded
criteria (hunger avg 43-66, end pop 20-26, starvation 0) — end pop as low as 2, safety collapsing
to near 0.

**Ruled out:** the same-day Parameter Addition Rule migration (commit `baec233`, see
"Biology & Environment Systems" above) was not the cause — every literal it touched was verified
byte-for-byte identical to its pre-migration value, and a worktree run at the pre-migration commit
(`3e73c34`) reproduced the same instability. This predates that work.

**Root cause, confirmed by worktree bisection** (3 trials each at `2764bcf` iter20 baseline →
healthy end pop 17/33/25; `d902a2f` → still healthy 21/34/13; `fb4be40` → collapsed to 2/2/4):

`fb4be40` ("stop instant re-socialize loop") bundled two independent fixes for one symptom
(repeated `playSound('social')` spam): a per-character 8s sound throttle (fine, kept), and a
2-6s `this.actionCooldown = Math.max(this.actionCooldown, ...)` added on every socializing-exit
path. The bug: `actionCooldown` isn't a socialize-specific cooldown — in the `idle` state handler
it's the single gate on calling `decideNextAction` at all. So every social interaction, for both
participants, paused *all* AI decision-making (including hunger response) for 2-6s. At
population=32 with frequent socializing, this compounded into mass starvation — a case of a
sound-spam fix accidentally blocking survival behavior, not a deliberate behavior change, so it
falls outside (not in violation of) the "no AI changes without explicit ask" guardrail.

**Fix applied (2026-09-14, same day):** removed the 3 `actionCooldown` lines added by `fb4be40`;
kept its sound throttle intact (still solves the originally-reported spam). Verified: current
HEAD now reproduces end pop 10/10/32 across 3 trials — back in the healthy range alongside the
pre-regression commits.

**Re-validated (2026-09-14) against the original 6-metric table**, using
`npm run sim --out=<file>` + `node scripts/analyze-telemetry.mjs` + `benchmark-telemetry.mjs`
(3 fresh runs, same `--minutes=10 --population=32` config, post-fix):

| Metric             | Target        | Result (3 runs)                          | Verdict |
| ------------------ | ------------- | ----------------------------------------- | ------- |
| Benchmark          | PASS 5/5      | 5/5, 5/5, 4/5 (WARN — avgRelationships 16.2 vs ≥18 threshold, one run) | 🟡 close, not fully clean |
| starvation deaths  | ≤ 10%         | 0%, 0%, 0%                                | ✅ pass |
| old_age deaths     | ≥ 60%         | 100%, 100%, 100%                          | ✅ pass |
| Gen2+ births       | ≥1 per 3 runs | gen2/gen3 present in all 3/3 runs         | ✅ pass |
| wanderRatio avg    | < 72%         | tooling changed since 04-17 — `analyze-telemetry.mjs` now only reports wander% for a flagged "stuck-suspect" subset (17.4% avg there), not a full-population figure | ⚠️ can't confirm same metric with current tooling |
| socializeRatio avg | > 3%          | no longer exposed by any current script    | ⚠️ can't confirm with current tooling |

**Conclusion:** the fix is confirmed to restore healthy population/death/generation dynamics.
The two ratio metrics can't be re-checked apples-to-apples because the analysis tooling itself
changed between 2026-04-17 and now — that's a tooling gap, not a sign of regression, but it means
this project has lost the ability to verify those two specific criteria without adding the
metric back to `analyze-telemetry.mjs` first.

---

## Feature Shipped — Item Combination ("Creations") + Curio Pickups (2026-09-15/16)

**User-directed AI logic change** (explicit request, satisfies the guardrail in "Current Status"
above — noted here per the process-gap lesson from 2026-09-13): user wanted characters to
combine held items into new, unpredictable "creation" items — explicitly framed as Mandelbrot-like
(simple recursive rule → complex output) and later as a *2001*-monolith-like inert curiosity object.

### What shipped

- **`sim-core/item-genesis.js`** (new file): 5-dimension item vectors (hardness/organicness/
  sharpness/luminosity/volatility). Combining two items blends their vectors using the same
  average+noise+mutation+clamp shape already used for personality-trait inheritance
  (`_blendTrait` in `character.js`), plus depth-scaled noise so recursive combination doesn't
  regress to the mean. Result is classified into an archetype (`unstable`/`blade`/`radiant`/
  `husk`/`monolith`/`grown`/`edged`/`composite`) the same way mood is cascaded into a display
  category elsewhere in the codebase.
- **Curio pickups**: a new `BLOCK_TYPES.CURIO` / `ITEM_TYPES.CURIO_ITEM` — a rare, purely
  decorative find with zero economic function. Added *because* wood/fruit/stone almost never
  coexist in inventory (consumed immediately for their normal purpose), which meant item
  combination almost never had two items to work with. A curio just sits in inventory until
  combined, so it's the mechanism that actually makes combination reachable.
- **`sim-core/AI_rulebase.js`**: PRIORITY 9.4 (curio seeking) and 9.5 (item combination), both
  gated by a `curioSeekChance` / `itemCombineChance` `window` global. **Correction (2026-09-16):**
  these initially skipped the Parameter Addition Rule (console-only, no slider) — a violation
  AGENTS.md explicitly calls out as a known gap to not repeat. Fixed same day: both now have
  full `sim-settings.workspace.json` → `PARAM_DEFAULTS` → sidebar-slider wiring under
  "🌍 World & Ecology" ("🔮 Curio Seek Chance", "🧪 Item Combine Chance").
  Also PRIORITY 0.9 (curio retry): once a character commits to a curio, it gets a bounded
  10s/4-attempt window to retry past a single failed BFS attempt before a higher-priority goal
  (home building, priority 3) can steal the decision back — without this, the very first
  pathfinding failure to a distant curio reliably lost it permanently.
- **Curio regen**: curios were originally seeded once at `generateTerrain()` with no respawn,
  so a district's curio supply was a one-time, non-renewable burst — once dug up, item
  combination went permanently silent for the rest of the session. Added `tickCurioRegen()`
  in `world.js` (mirrors the existing `tickFruitRegen` pattern, wired into both the browser
  `animate()` loop and headless `run-sim.mjs`), plus two new sidebar sliders under
  "🌍 World & Ecology": **Curio Regen Interval** (default 90s) and **Curio Carrying Capacity**
  (default 12, caps accumulation).

### Key finding: growth shape is front-loaded-then-flat, not linear or exponential

Each combine event consumes 2 inventory items to produce 1 — net-negative on total item count,
so combination cannot compound on itself. Before the regen fix, headless testing showed a burst
of pickups/creations in the first few minutes (while a district's fixed curio pool lasted), then
a hard plateau at zero for the rest of a 60-minute run once the pool was exhausted. The regen fix
turns this into a repeating "deplete → wait → replenish" cycle instead of a one-time event.

**At shipped defaults** (`curioSpawnRate=1%`, `curioSeekChance=1%`, `itemCombineChance=0.4%`),
a pickup is genuinely rare — 0 pickups observed in a 60-minute/25-population headless run was not
unusual. Boosting `curioSeekChance`/`itemCombineChance` via console to ~0.2–0.5 makes it
observable within single-digit minutes in headless testing. Whether to raise the shipped defaults
(vs. keep the "monolith, found by chance" rarity) is an open decision — not yet made.

### Deploy status

Commit `a5fa67e` was built (`make build`) and deployed to Cloud Run
(`voxel-society-simulator` project, `us-central1`, revision `voxel-society-simulator-00053-7r6`)
via the repo's `Makefile`. **The curio-regen fix above was implemented and headless-verified
*after* that deploy and is not yet committed or redeployed** — check `git status` before assuming
prod matches local `world.js`/`sidebar.js`/`scripts/run-sim.mjs`.

### Open / unresolved at handoff

- User tested `window.curioSeekChance = 0.5; window.itemCombineChance = 0.5;` live in-browser
  (post-Start) and reported no observable behavior change after some minutes. An independent
  repro attempt via Chrome automation was inconclusive — the automated tab hit the
  session's known `document.hidden`/rAF-suspension artifact (ALL characters stuck at
  `state: 'idle', action: null` for 30+ seconds regardless of curio settings — a tooling
  limitation, not signal about the real bug). User was given this diagnostic to run in their
  actual session, result not yet received:
  ```js
  ({
    curioSeekChance: window.curioSeekChance,
    itemCombineChance: window.itemCombineChance,
    sample: window.characters.slice(0, 10).map(c => ({
      id: c.id, state: c.state, action: c.action ? c.action.type : null,
      curiosity: c.personality?.curiosity,
      invCount: c.inventory.filter(i => i !== null).length,
      hasCurio: c.inventory.includes('CURIO_ITEM')
    }))
  })
  ```
  **Next step for a fresh thread:** get this diagnostic's output before re-theorizing from
  scratch — likely candidates not yet ruled out: characters rarely reaching priority 9.4 because
  higher priorities (home building, hunger, social) keep firing first; or curios already picked
  up but stuck pre-combine because a second item never coexists long enough even at boosted
  `itemCombineChance`.
- **Unrelated observation, not investigated**: long (~60 min) headless runs repeatedly showed
  full population collapse/extinction, reproduced even at pure default rates (curio settings
  untouched) — likely a pre-existing population-dynamics issue, not caused by this feature.
  Flagged to the user, deferred by mutual agreement.
- ~~`curioSeekChance` / `itemCombineChance` have no UI slider yet~~ — fixed 2026-09-16, see above.

## Known Cosmetic Quirk — Accepted, Not Fixed (2026-09-18)

Tree trunks can show a faint vertical seam running the height of the trunk, visible mainly from
steep/oblique camera angles that look nearly straight up along the trunk's axis (not noticeable
from the normal top-down isometric view). Cause: `buildWoodGroup()`
(`sim-core/tree-voxel-renderer.js`) generates each 1-block trunk segment's fuzzy bark-cylinder
shape independently, seeded only by that block's own `(x, y, z)` — there's no continuity between
a segment and the one stacked above/below it, so their random edge-chipping doesn't line up.
Not a bug in the traditional sense (each segment renders exactly as designed); it's a side effect
of per-block-independent procedural generation. Fixing it would mean giving vertically-adjacent
trunk segments correlated RNG seeds so their boundaries agree — user reviewed and decided it's
not worth the design change for how minor/rare the viewing angle is. Leave as-is; don't
re-investigate from scratch if it comes up again.

## Archive Pointer

Older session-by-session handoff logs and superseded design narratives (2026-04-14 → 04-15,
pre-dating the District-Scaling feature brief above) were moved to
`docs/roadmap-archive.md` on 2026-09-13 to keep this file focused on current direction.
Reference only — this file's current sections always win on conflict.

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
