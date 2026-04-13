# global.md

This file supplements AGENTS.md with project-specific clarifications.

---

## Usage

- All universal agent rules are defined in `AGENTS.md` and must be followed.
- Only add project-specific exceptions and concrete operational examples here.
- Keep this file short; avoid duplicating global policy text.

## Project Clarifications

- Prioritize behavior stability in pathfinding, movement, and reservation logic before adding new gameplay features.
- When changing AI retries/cooldowns, expose tunables through `window.*` only if needed for runtime diagnostics.
- When debugging visual jitter, validate simulation causes first (retry loops, reservation contention, mesh-grid mismatch).

---

_Last updated: 2026-04-13_
