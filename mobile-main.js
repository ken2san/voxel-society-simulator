/**
 * mobile-main.js — Entry point for mobile.html
 * Sets up defaults, boots the game engine via main.js, and wires the mobile HUD.
 */

import { focusCameraOnActiveDistrict, setTreeSpawnRate, setFruitSpawnRate } from './world.js';

// ── 1. Defaults ──────────────────────────────────────────────────────────────
// Set before main.js init() reads these values.
window.sidebarParams = window.sidebarParams || {};
window.sidebarParams.charNum          = window.sidebarParams.charNum          ?? 20;
window.sidebarParams.districtMode     = window.sidebarParams.districtMode     ?? 1;
window.sidebarParams.activeDistrictIndex = window.sidebarParams.activeDistrictIndex ?? 0;

// Start paused so world generates before sim begins (user taps Play to start)
window.simulationRunning = false;

// ── Mobile performance: set before main.js reads renderer options ─────────────
// Enables lower pixel ratio (1.0), antialias-off, and frame-throttled rendering.
window.__mobileOptimized = true;

// ── 2. Boot game engine ───────────────────────────────────────────────────────
// main.js auto-calls main() → init() → animate() on module load.
// All DOM references in main.js are null-guarded so missing elements are safe.
await import('./main.js');

// ── 3. HUD wiring ─────────────────────────────────────────────────────────────
const BASE_DAY_DURATION = 120; // seconds per day (default)
const SPEED_STEPS = [1, 2, 4];

let speedIdx = 0;

const elSeasonIcon = document.getElementById('hud-time-icon');
const elSeasonName = document.getElementById('hud-season-name');
const elSeasonPill = document.getElementById('hud-season');
const elPop        = document.getElementById('hud-pop-num');
const elDay        = document.getElementById('hud-day-num');
const elPauseIcon  = document.getElementById('pause-icon');
const elPauseLabel = document.getElementById('pause-label');
const elSpeedLabel = document.getElementById('speed-label');
const elLoading    = document.getElementById('loading');

const btnPause    = document.getElementById('btn-pause');
const btnSpeed    = document.getElementById('btn-speed');
const btnCentre   = document.getElementById('btn-centre');
const btnSettings = document.getElementById('btn-settings');

const drawer      = document.getElementById('settings-drawer');
const backdrop    = document.getElementById('drawer-backdrop');

const sliderChar  = document.getElementById('m-char-slider');
const valChar     = document.getElementById('m-char-val');
const sliderSpeed = document.getElementById('m-speed-slider');
const valSpeed    = document.getElementById('m-speed-val');
const sliderTree  = document.getElementById('m-tree-slider');
const valTree     = document.getElementById('m-tree-val');
const sliderFruit = document.getElementById('m-fruit-slider');
const valFruit    = document.getElementById('m-fruit-val');
const btnRegen    = document.getElementById('m-regen-btn');

// Season icons
const SEASON_ICONS = { Spring: '🌸', Summer: '☀️', Autumn: '🍂', Winter: '❄️' };

// ── HUD update loop ───────────────────────────────────────────────────────────
function updateHud() {
    const si = window.currentSeasonInfo;
    if (si) {
        const icon = SEASON_ICONS[si.name] ?? si.icon ?? '🌍';
        if (elSeasonIcon) elSeasonIcon.textContent = icon;
        if (elSeasonName) elSeasonName.textContent = si.name;
    }

    const chars = window.characters;
    if (chars && elPop) {
        const alive = chars.filter(c => c?.state !== 'dead').length;
        elPop.textContent = alive;
    }

    const wt = window._simWorldTime ?? 0;
    if (elDay) {
        const dayNum = Math.floor(wt / BASE_DAY_DURATION) + 1;
        elDay.textContent = `Day ${dayNum}`;
    }

    // Hide loading once we have characters
    if (elLoading && chars && chars.length > 0) {
        elLoading.style.display = 'none';
    }
}

setInterval(updateHud, 500);

// Expose worldTime so updateHud can read it (world.js doesn't expose it as live binding)
// We patch it via the animate callback if available, otherwise poll from world
let _wtPollHandle = null;
function _startWtPolling() {
    if (_wtPollHandle) return;
    _wtPollHandle = setInterval(() => {
        if (window.__simWorldTimeGetter) {
            window._simWorldTime = window.__simWorldTimeGetter();
        }
    }, 500);
}
_startWtPolling();

// world.js exports worldTime as a const (snapshot at import time).
// We dynamically import world.js to get a live reference via function call.
import('./world.js').then(mod => {
    // worldTime is a number export — it's a live binding in ES modules
    window.__simWorldTimeGetter = () => mod.worldTime;
});

// ── Pause / resume ────────────────────────────────────────────────────────────
function setPaused(paused) {
    window.simulationRunning = !paused;
    if (elPauseIcon)  elPauseIcon.textContent  = paused ? '▶️' : '⏸';
    if (elPauseLabel) elPauseLabel.textContent  = paused ? 'Play' : 'Pause';
    if (btnPause)     btnPause.classList.toggle('active', paused);
}

if (btnPause) {
    btnPause.addEventListener('click', () => {
        setPaused(!!window.simulationRunning); // toggle
    });
}

// ── Speed cycling ─────────────────────────────────────────────────────────────
function applySpeed(idx) {
    speedIdx = idx % SPEED_STEPS.length;
    const mult = SPEED_STEPS[speedIdx];
    window.dayDurationSeconds = BASE_DAY_DURATION / mult;
    if (elSpeedLabel) elSpeedLabel.textContent = `${mult}×`;
}

if (btnSpeed) {
    btnSpeed.addEventListener('click', () => applySpeed(speedIdx + 1));
}

// ── Centre camera ─────────────────────────────────────────────────────────────
if (btnCentre) {
    btnCentre.addEventListener('click', () => focusCameraOnActiveDistrict());
}

// ── Settings drawer ───────────────────────────────────────────────────────────
function openDrawer() {
    drawer?.classList.add('open');
    backdrop?.classList.add('visible');
}

function closeDrawer() {
    drawer?.classList.remove('open');
    backdrop?.classList.remove('visible');
}

if (btnSettings) btnSettings.addEventListener('click', openDrawer);
if (backdrop)    backdrop.addEventListener('click', closeDrawer);

// Swipe-down to close drawer
let _swipeY0 = 0;
drawer?.addEventListener('touchstart', e => { _swipeY0 = e.touches[0].clientY; }, { passive: true });
drawer?.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - _swipeY0 > 60) closeDrawer();
}, { passive: true });

// ── Drawer sliders ────────────────────────────────────────────────────────────
if (sliderChar) {
    sliderChar.addEventListener('input', () => {
        const v = Number(sliderChar.value);
        if (valChar) valChar.textContent = v;
        window.sidebarParams = window.sidebarParams || {};
        window.sidebarParams.charNum = v;
    });
}

if (sliderSpeed) {
    sliderSpeed.addEventListener('input', () => {
        const mult = Number(sliderSpeed.value);
        if (valSpeed) valSpeed.textContent = `${mult}×`;
        window.dayDurationSeconds = BASE_DAY_DURATION / mult;
    });
}

if (sliderTree) {
    sliderTree.addEventListener('input', () => {
        const v = Number(sliderTree.value);
        if (valTree) valTree.textContent = `${Math.round(v * 100)}%`;
        setTreeSpawnRate(v);
    });
}

if (sliderFruit) {
    sliderFruit.addEventListener('input', () => {
        const v = Number(sliderFruit.value);
        if (valFruit) valFruit.textContent = `${Math.round(v * 100)}%`;
        setFruitSpawnRate(v);
    });
}

// ── New World button ──────────────────────────────────────────────────────────
if (btnRegen) {
    btnRegen.addEventListener('click', async () => {
        closeDrawer();
        if (elLoading) elLoading.style.display = 'flex';
        // Apply new char count before regenerating
        window.sidebarParams = window.sidebarParams || {};
        window.sidebarParams.charNum = Number(sliderChar?.value) || 20;
        window.simulationRunning = false;
        if (typeof window.regenerateWorld === 'function') {
            await window.regenerateWorld();
        }
        // Kick off the initial render pass
        window.simulationRunning = false;
        setPaused(true);
        if (elLoading) {
            // Will be hidden by the HUD updater once characters appear
            // Safety fallback
            setTimeout(() => { if (elLoading) elLoading.style.display = 'none'; }, 3000);
        }
    });
}

// ── Initial state: paused (show Play) ─────────────────────────────────────────
setPaused(true);
