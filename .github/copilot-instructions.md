# Voxel Society Simulator - GitHub Copilot Workspace Instructions

_Last updated: 2026-04-13_

---

## Project

Voxel Society Simulator is a browser-based voxel colony simulation game.
Stack: Vanilla JavaScript + Three.js + Vite. Entry: `main.js` and `index.html`.
Core state is spread across character instances and world-level structures (for example `worldData`, reservations, and runtime globals).

## Before Any Task

- Read `ROADMAP.md` to understand current phase and scope boundaries.
- Do not implement Phase 4 or later features without explicit user instruction.

## Project-Specific Code Rules

- Preserve grid/world consistency: any movement or block mutation changes must keep mesh position and grid position aligned.
- Keep block semantics stable (`BLOCK_TYPES`, diggable/passable checks, and world map key format `x,y,z`).
- Prefer targeted edits over broad refactors in high-risk files such as `character.js` and `world.js`.
