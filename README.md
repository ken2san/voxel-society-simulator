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

## Headless simulation / telemetry

Use the CLI runner when you want to validate population behavior without opening the browser.

### Basic runs

```bash
npm run sim -- --minutes=1
npm run sim -- --minutes=2 --districtMode=4 --population=48
```

### Save telemetry to a file

```bash
npm run sim -- --minutes=2 --districtMode=4 --population=48 --out=telemetry/d4-p48.json
```

### Override runtime parameters for an experiment

```bash
npm run sim -- --minutes=2 --districtMode=4 --population=48 \
  --set=socialTh=82 \
  --set=bondPersistence=1.5 \
  --set=initialAgeMaxRatio=0.38
```

### Analyze or tune a run

```bash
npm run analyze:telemetry -- telemetry/d4-p48.json
npm run sim:tune -- --minutes=1 --districtMode=4 --population=48
```

### Common flags

- `--minutes=<n>` / `--seconds=<n>` / `--ticks=<n>`: choose run length
- `--population=<n>`: initial character count
- `--districtMode=<1|4|16>`: district scaling mode
- `--activeDistrictIndex=<n>`: district to observe in detail
- `--out=<path>`: write telemetry JSON to a file
- `--config=<path>`: load settings from a config file
- `--set=key=value`: override one parameter for the current run

The runner uses the workspace simulation defaults from `sim-settings.workspace.json`, so CLI experiments and browser experiments stay aligned.

## Cloud Run deployment

For a quick prototype deploy to Google Cloud Run:

```bash
make all
```

By default, the `Makefile` deploys to the intended `voxel-society-simulator` Google Cloud project for this repo.
If you want to deploy to a different project explicitly, run:

```bash
make all PROJECT_ID=trustflow-project
```

This target builds the container image for `linux/amd64`, pushes it to `gcr.io`, and deploys the service defined in the `Makefile`.
Make sure `gcloud` is authenticated and the target project is selected before running it.

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

## Simulation model reference

For the current reproduction / household-cohesion thinking and future academically inspired model directions, see:

- `docs/modeling-reference.md`

Use that document as the reference note when adjusting social, fertility, support, or child-rearing behavior.

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
