# AGENTS.md - Voxel Society Simulator

_Last updated: 2026-09-13_

This is the single source of agent-behavior policy for this project. Previously split across
`.github/copilot-instructions.md`, `.github/agents/*.agent.md`, and `agents/global.md`
(GitHub Copilot custom-agent format, not read by this project's actual Claude Code CLI workflow);
consolidated 2026-09-13 — those files are gone, this one is authoritative.

---

## Project

Voxel Society Simulator is a browser-based, observation-first voxel colony simulator (glass-tank
/ terrarium model, not a game to win — see `ROADMAP.md` "Project Concept" for the full framing).

- Stack: Vanilla JavaScript + Three.js + Vite. Browser entry: `main.js` / `index.html`
  (also `mobile-main.js` / `mobile.html` for the mobile surface).
- The simulation core is decoupled from the browser layer under `sim-core/` (AI rulebase, sound,
  weather, special entities, renderers), so the same behavior model runs headless via
  `npm run sim` and in-browser.
- Core state is spread across character instances and world-level structures (`worldData`,
  reservations, and runtime `window.*` globals).

## Before Any Task

- Read `ROADMAP.md` — "Current Status" and "Current Sprint" define the active phase and scope
  boundary. Do not implement Phase 4+ items without explicit user instruction.
- For anything touching reproduction, fertility, or household/support behavior, also read
  `docs/modeling-reference.md`.

## Intellectual Honesty Policy

- Agreement must be earned, not offered.
- Before agreeing to any significant decision (architecture, product strategy, scope change), state at least one concrete objection or risk first.
- If no objection can be found, say so explicitly.
- If the user's reasoning has a flaw, name it directly.
- Before writing code for any non-trivial task, identify potential edge cases, memory leaks, and unintended side effects first.
- Before acting on a non-trivial request, state the inferred underlying goal and then proceed.

## Scope Policy

- Always consider the whole project, not just the open file.
- Keep cross-file consistency, especially around gameplay state transitions and world simulation rules.
- Avoid partial fixes that create drift between visual state and simulation state.
- Prioritize behavior stability in pathfinding, movement, and reservation logic before adding new gameplay features.
- When debugging visual jitter, validate simulation causes first (retry loops, reservation contention, mesh-grid mismatch) before touching rendering.

## Optimization Policy

- Eliminate redundancy in logic and logs where possible.
- Prefer minimal changes with high impact and low regression risk.

## Project-Specific Code Rules

- Preserve grid/world consistency: any movement or block mutation must keep mesh position and grid position aligned.
- Keep block semantics stable (`BLOCK_TYPES`, diggable/passable checks, and world map key format `x,y,z`).
- Prefer targeted edits over broad refactors in high-risk files such as `character.js` and `world.js`.
- All code comments and documentation must be in English.
- Keep UI (`sidebar.js`) and simulation changes decoupled where possible.
- Do not add npm packages without explicit user approval.
- When exposing a new tunable (including via `window.*` for runtime diagnostics), follow
  `ROADMAP.md`'s Parameter Addition Rule (workspace JSON → `PARAM_DEFAULTS` → sidebar slider).
  Skipping this is a known gap in the current biology/environment systems — see `ROADMAP.md`.

## Backend / Persistence

No backend service is active in the current local architecture; everything is client-side +
headless CLI. A Phase 4+ backend (Node API layer, managed datastore for snapshots/metrics) is
planned but **on hold** — do not scaffold it without explicit instruction. Never introduce real
API keys or credentials into the codebase.

## Infra / Deployment

Vite build pipeline; Docker/Docker Compose for containerized dev; Google Cloud Run deployment via
`Makefile` (`make all`). Do not modify infrastructure configuration, or change registry/project
identifiers, without explicit instruction — see `README.md` "Cloud Run deployment" for the current
deploy flow.
