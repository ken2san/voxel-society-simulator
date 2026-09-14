# Simulation Modeling Reference

_Last updated: 2026-09-14_

---

## Status update (2026-09-13, revised 2026-09-14)

Read `character.js` directly against the plan below (not just commit messages). Result: **Stages
A, B, C, and D are all now implemented** — this document was still framing them as future
recommendations. Corrected status:

- **Stage A (layered readiness model)** — ✅ done. `getReproductionReadiness(partner)` computes
  `pairBond`, `localSupport`, `livelihoodViability`, and `futureExpectation` exactly as the
  "Current model structure" section below describes.
- **Stage B (hazard score instead of hard gate)** — ✅ done. The function also returns a
  `reproductionHazard` value, and `shouldAttemptReproductionWith(partner)` converts it into a
  per-tick `attemptChance` fed through `Math.random()` — a probabilistic event, not a threshold
  gate. This is the "Fertility hazard model" from section 1 below, already shipped.
- **Stage C (household continuity anchors)** — ✅ done (closed 2026-09-14). `isHouseholdTie(other)`
  recognizes bonded partner (`_lovePartnerId`), parent, child, and now sibling (shared entry in
  both sides' `parentIds`) — the fourth anchor type this doc originally called for. "Co-resident
  kin" beyond that (e.g. extended family sharing a home without a direct parent/child/sibling
  link) was left out as too vague to implement as a concrete check; `localSupport`/`nearbySupport`
  in the readiness formula already cover general proximity-based support separately.
- **Stage D (care load from dependent children)** — ✅ done. A `careLoad` term (dependent child
  count, elder load, crowding, rivalry, minus support) feeds negatively into both `readiness` and
  `reproductionHazard` — matching the "Cooperative child-rearing load model" in section 4 below
  almost variable-for-variable.
- **Parameter Addition Rule compliance** — ✅ this system followed it correctly:
  `reproductionReadinessThreshold`, `reproductionAnxietyCohesionBonus`, and
  `reproductionPressurePenalty` are all present in `sim-settings.workspace.json`, `sidebar.js`
  `PARAM_DEFAULTS`, and have sidebar sliders. Worth noting as the model to copy — the 2026-04-25
  biology system (disease/pregnancy/thermal/fat, see `ROADMAP.md`) did not follow this pattern
  and needs the same treatment retroactively.

**Now integrated (2026-09-14):** `selfNeedMargin`/`partnerNeedMargin` gained a `healthCondition`
component — `(disease infected ? 0.4 : 1.0) * 0.7 + clamp01(fatReserve / fatReserveCap) * 0.3` —
folded in at weight 0.15 (hunger/energy/safety weights compressed from 0.35/0.35/0.30 to
0.30/0.30/0.25 to make room, so the term still sums to 1.0). Disease and fat reserve now actually
affect reproduction readiness instead of sitting beside the model unconnected. Verified with 3
headless trials at `--minutes=10 --population=32`: end population 18/25/17 (healthy range,
consistent with pre-change runs), starvation 0% and old_age 100% of deaths in all 3, gen2/gen3
present in all 3 — no destabilization observed. Pregnancy's own gestation-delay mechanic was
already independent of this readiness score (it governs timing after conception succeeds, not
whether conception is attempted) and needed no change here.

---

## Purpose

This document collects the current simulation model, the bottlenecks observed through telemetry, and academically inspired directions for future work.

It is not intended as a strict literature review. Instead, it is a practical bridge between:

- the current voxel colony implementation,
- demographic / social modeling ideas from population science and agent-based simulation,
- future contributors who may want to design a different model without starting from zero.

---

## Current observation summary

Recent headless telemetry runs suggest that the main realism bottleneck is no longer raw fertility gating.

The stronger constraints are:

1. weak pair continuity,
2. weak household persistence,
3. high fragmentation into isolated individuals,
4. energy and safety pressure reducing long-run family stability.

This means the simulator already supports births, but it does not yet maintain multi-generation household continuity reliably.

---

## Current model structure

The current reproduction readiness logic is intentionally layered:

1. **Pair bond**
   - affinity
   - trusted tie persistence
   - repeated social contact

2. **Local support**
   - nearby allies / bonded ties
   - group support
   - household or shelter stability

3. **Livelihood viability**
   - hunger margin
   - energy margin
   - safety margin
   - food / housing pressure

4. **Future expectation**
   - whether conditions feel sustainable enough for child-rearing

This direction is good and should be preserved.

---

## Useful academic model families

### 1. Fertility hazard model

Instead of using one hard threshold, reproduction can be treated as a conditional event probability:

$$
P(\text{birth attempt at } t) = \sigma(\beta_0 + \beta_1 B + \beta_2 S + \beta_3 V - \beta_4 R - \beta_5 D)
$$

Where:

- $B$ = pair bond strength
- $S$ = support availability
- $V$ = livelihood viability
- $R$ = environmental / social risk
- $D$ = dependency load from existing children

Why this fits the project:

- smoother than a rigid yes/no gate,
- easier to tune across different district pressures,
- more realistic for low-frequency life events.

### 2. Household support model

A household should not be modeled only as a single pair. It should be a small support field.

A compact form:

$$
\text{supportScore}_i = \sum_j (k_{ij} \cdot a_{ij} \cdot p_{ij})
$$

Where:

- $k_{ij}$ = kinship / household relevance
- $a_{ij}$ = trust / affinity
- $p_{ij}$ = proximity or contact persistence

Why this fits the project:

- children become less fragile when adults remain nearby,
- families and bonded pairs matter even without formal group membership,
- isolation can be modeled as a measurable condition rather than a binary state.

### 3. Bond persistence model

Relationships should accumulate and decay dynamically:

$$
\text{bond}_{t+1} = \text{bond}_t + c_1 \cdot \text{contact} + c_2 \cdot \text{cooperation} + c_3 \cdot \text{sharedChild} - c_4 \cdot \text{distance} - c_5 \cdot \text{stress}
$$

Why this fits the project:

- repeated co-presence matters,
- co-parenting can stabilize a tie,
- chronic stress can weaken ties without arbitrary hard resets.

### 4. Cooperative child-rearing load model

A child should increase not only population count, but also local burden:

$$
\text{careLoad} = w_1 \cdot \text{youngChildren} + w_2 \cdot \text{travelCost} + w_3 \cdot \text{resourcePressure} - w_4 \cdot \text{supportNetwork}
$$

Why this fits the project:

- second and third generations become hard for realistic reasons,
- support and housing matter naturally,
- survival pressure becomes interpretable in telemetry.

---

## Recommended implementation order

_See "Status update (2026-09-13)" above for what's actually done vs. open — this section is kept
as the original design narrative, not a live checklist._

### Stage A — Keep the current layered readiness model ✅ done

Do not throw away the current structure. It already matches a believable causal story.

### Stage B — Replace hard reproduction gating with a hazard score ✅ done

Keep the existing readiness value, but interpret it as a probability or event intensity rather than a strict threshold.

### Stage C — Add explicit household continuity ✅ done (2026-09-14)

Treat the following as special support anchors:

- bonded partner, ✅ (`_lovePartnerId`)
- parent, ✅ (`parentIds`)
- child, ✅ (`children`)
- sibling, ✅ (shared entry in both sides' `parentIds`)
- co-resident kin beyond the above — intentionally not implemented; too vague to express as a
  concrete check, and general proximity-based support is already covered separately by
  `localSupport`/`nearbySupport` in the readiness formula.

### Stage D — Add care load from dependent children ✅ done

Existing children should reduce future fertility unless enough support and stability are present.

---

## Mapping to the current codebase

Confirmed hooks in `character.js` (verified by reading the code, 2026-09-13):

- `getReproductionReadiness(partner)` (~line 3764) — returns `pairBond`, `localSupport`,
  `livelihoodViability`, `futureExpectation`, `careLoad`, `reproductionHazard`, `readiness`.
- `shouldAttemptReproductionWith(partner)` (~line 3962) — converts `reproductionHazard` into a
  probabilistic attempt via `Math.random()`.
- `isHouseholdTie(other)` (~line 2984) — the Stage C anchor check (partner/parent/child/sibling).
- `getPreferredSupportTarget()`, `getRelationshipSnapshot()`
- district social context signals such as `supportAccess`, `housingPressure`, and `relationshipStability`
- `getReproductionModelParams()` (~line 3751) — reads `reproductionReadinessThreshold`,
  `reproductionAnxietyCohesionBonus`, `reproductionPressurePenalty` from `window.*`, all three
  wired through the full Parameter Addition Rule (workspace JSON + `PARAM_DEFAULTS` + slider).

This means a new model can be layered into the current system incrementally instead of requiring a rewrite.

---

## What to avoid

- Do not directly optimize for a target population.
- Do not hard-code “keep everyone alive” rescue logic.
- Do not force births when the ecology is unstable.
- Do not overfit to one telemetry scenario only.

The simulator should stay observation-first rather than turning into a demographic game.

---

## Suggested next experiment

Items 1–3 below are now implemented (`localSupport`, `careLoad`, `reproductionHazard` — see
Status update above); they weren't necessarily ever validated against districtMode=4 telemetry
the way the "Ecology Tuning — Done Criteria" pass in `ROADMAP.md` was. A practical next iteration:

1. ~~compute a household support score~~ ✅ done (`localSupport`)
2. ~~compute a child-care load score~~ ✅ done (`careLoad`)
3. ~~convert reproduction readiness into a hazard probability~~ ✅ done (`reproductionHazard`)
4. **compare results across `districtMode=4` headless runs** — not confirmed done; run
   `npm run sim -- --districtMode=4` and check the success criteria below before assuming this
   model is tuned, not just implemented.
5. ~~close the Stage C gap (sibling anchor)~~ ✅ done (2026-09-14, `isHouseholdTie()`)
6. ~~wire biology state (disease/`fatReserve`) into `livelihoodViability`~~ ✅ done (2026-09-14,
   `healthCondition` term) — see the Status update above.

Success criteria should be:

- fewer isolated single-agent outcomes,
- stable gen1 continuation,
- occasional gen2 emergence without scripted intervention,
- no major rise in starvation or safety collapse.
