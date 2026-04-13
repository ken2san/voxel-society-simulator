# Voxel Society Simulator

Simple local dev instructions and notes.

## Requirements

- Node.js (>=16 recommended)
- npm

## Quick start (development)

1. Install dependencies:

```bash
npm install
```

2. Start dev server (Vite):

```bash
npm run dev
```

Then open http://localhost:8080/ in your browser.

## Build / Preview

```bash
npm run build
npm run preview
```

## Agent Workspace Rules

This workspace includes Copilot agent configuration files.

- `AGENTS.md`: project-specific behavior and decision policy.
- `.github/copilot-instructions.md`: workspace instructions loaded before coding tasks.
- `.github/agents/`: role-specific agent guidance (`backend`, `frontend`, `infra`).
- `agents/global.md`: project-level clarifications that supplement `AGENTS.md`.

When updating these files, keep rules concise and avoid duplicating the same policy text across files.

## Roadmap Workflow

Use `ROADMAP.md` as the scope boundary for development work.

- Active phase is listed in the roadmap.
- Do not implement later-phase items unless explicitly requested.
- Before major changes, check roadmap phase alignment first.

## Notes

- Project currently uses CDN importmap for some ESM libs in `index.html`. Installing dependencies via npm (e.g. `three`) allows Vite to prebundle and manage them.
- `character.js` is large; some AI logic has been moved to `character_ai.js` to improve modularity.
- If you see stale visuals after regenerating world, try refreshing the page.

## Tailwind (production) note

If you plan to build for production, configure Tailwind as a PostCSS plugin or use the Tailwind CLI.
Quick setup (already added to repo):

```bash
npm install --save-dev tailwindcss postcss autoprefixer
```

Files added:

- `postcss.config.cjs` (PostCSS config with tailwindcss + autoprefixer)
- `tailwind.config.cjs` (tailwind content paths)

This suppresses the runtime advisory you may see in the browser console.
