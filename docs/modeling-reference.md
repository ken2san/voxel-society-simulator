# Simulation Modeling Reference

_Last updated: 2026-04-18_

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

### Stage A — Keep the current layered readiness model

Do not throw away the current structure. It already matches a believable causal story.

### Stage B — Replace hard reproduction gating with a hazard score

Keep the existing readiness value, but interpret it as a probability or event intensity rather than a strict threshold.

### Stage C — Add explicit household continuity

Treat the following as special support anchors:

- bonded partner,
- parent,
- child,
- sibling / co-resident kin.

This is likely the highest-value next step.

### Stage D — Add care load from dependent children

Existing children should reduce future fertility unless enough support and stability are present.

---

## Mapping to the current codebase

Useful existing hooks already exist in the code:

- `getReproductionReadiness(partner)`
- `shouldAttemptReproductionWith(partner)`
- `getPreferredSupportTarget()`
- `getRelationshipSnapshot()`
- district social context signals such as `supportAccess`, `housingPressure`, and `relationshipStability`

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

A practical next model iteration would be:

1. compute a household support score,
2. compute a child-care load score,
3. convert reproduction readiness into a hazard probability,
4. compare results across `districtMode=4` headless runs.

Success criteria should be:

- fewer isolated single-agent outcomes,
- stable gen1 continuation,
- occasional gen2 emergence without scripted intervention,
- no major rise in starvation or safety collapse.
