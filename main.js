import { generateTerrain, addBlock, removeBlock, findGroundY, isSafeSpot, worldData, BLOCK_TYPES, ITEM_TYPES, blockMaterials, visualBlocks, blockSize, gridSize, maxHeight, clock, characters, worldTime, DAY_DURATION, nextCharacterId, edgeMaterial, updateWorldLighting, onWindowResize, drawMinimap, animate, spawnCharacter, findValidSpawn, toScreenPosition, setWorldObjects, setDEBUG_MODE, setTreeSpawnRate, setFruitSpawnRate, setStoneSpawnRate, setCaveSpawnRate, setLeafSpawnRate, setDistrictMode, setActiveDistrict, refreshRenderResources, resetWorldSpatialIndex, resetFrameTimingAfterVisibilityChange, stabilizeCameraAfterVisibilityChange } from './world.js';
import { Character } from './character.js';
import { PerlinNoise } from './utils.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { setSimulationIO } from './sim-core/interfaces.js';
import { createThreeSimulationIO } from './sim-core/browser-io.js';

// --- Global variables, Three.js initialization, UI events, loops, etc. ---

setSimulationIO(createThreeSimulationIO());
refreshRenderResources();

function applyInitialAgeSpread(targetChars = characters) {
    Character.applyInitialAgeSpread(targetChars);
}

if (typeof window !== 'undefined') {
    window.applyInitialAgeSpread = applyInitialAgeSpread;

    if (!window.__visibilityResumeGuardInstalled && typeof document !== 'undefined') {
        window.__visibilityResumeGuardInstalled = true;
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                const resumePass = () => {
                    onWindowResize();
                    resetFrameTimingAfterVisibilityChange();
                    stabilizeCameraAfterVisibilityChange();
                };
                requestAnimationFrame(() => {
                    resumePass();
                    requestAnimationFrame(resumePass);
                });
                if (window.__resumeViewStabilizeTimer) clearTimeout(window.__resumeViewStabilizeTimer);
                window.__resumeViewStabilizeTimer = setTimeout(() => {
                    resumePass();
                    window.__resumeViewStabilizeTimer = null;
                }, 180);
            }
        });
    }
}

async function init() {
    try {
        // Setup canvas and context
        const gameCanvas = document.getElementById('gameCanvas');
        const minimapCanvas = document.getElementById('minimapCanvas');
        const minimapCtx = minimapCanvas.getContext('2d');
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);

        gameCanvas.width = gameCanvas.offsetWidth;
        gameCanvas.height = gameCanvas.offsetHeight;

        const camera = new THREE.PerspectiveCamera(75, gameCanvas.width / gameCanvas.height, 0.1, 1000);
        camera.position.set(gridSize * 1.2, gridSize * 1.1, gridSize * 1.2);

        const renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true, powerPreference: 'high-performance' });
        renderer.setSize(gameCanvas.width, gameCanvas.height, false);
        // Cap HiDPI rendering so Retina screens do not quadruple the pixel workload
        // once the observed population becomes large.
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));

        minimapCanvas.width = 96;
        minimapCanvas.height = 96;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(gridSize / 2, 2, gridSize / 2);

        window.focusCharacterInView = function focusCharacterInView(charOrId, opts = {}) {
            const targetChar = typeof charOrId === 'object'
                ? charOrId
                : characters.find(c => String(c?.id) === String(charOrId));
            if (!targetChar?.mesh || !controls || !camera) return false;

            const focusPos = targetChar.mesh.position.clone();
            const desiredTarget = new THREE.Vector3(focusPos.x, Math.max(1.5, focusPos.y + 1.2), focusPos.z);
            const offset = camera.position.clone().sub(controls.target);
            const desiredDistance = Math.min(Math.max(offset.length() * 0.78, 6), 14);
            const clampedOffset = offset.length() > 0.001
                ? offset.clone().setLength(desiredDistance)
                : new THREE.Vector3(7, 7, 7);

            const desiredCameraPos = desiredTarget.clone().add(clampedOffset);
            const startTarget = controls.target.clone();
            const startPos = camera.position.clone();
            const duration = Math.max(120, Math.min(320, Number(opts.durationMs) || 220));
            const startedAt = performance.now();

            function step(now) {
                const t = Math.min(1, (now - startedAt) / duration);
                const eased = 1 - Math.pow(1 - t, 3);
                controls.target.lerpVectors(startTarget, desiredTarget, eased);
                camera.position.lerpVectors(startPos, desiredCameraPos, eased);
                controls.update();
                if (t < 1) {
                    window.__focusCharacterAnim = requestAnimationFrame(step);
                }
            }

            if (window.__focusCharacterAnim) cancelAnimationFrame(window.__focusCharacterAnim);
            window.__focusCharacterAnim = requestAnimationFrame(step);
            return true;
        };

        const ambientLight = new THREE.AmbientLight(0xcccccc);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
        directionalLight.position.set(50, 50, 50).normalize();
        scene.add(directionalLight);

        setWorldObjects({
            scene, camera, renderer, controls, ambientLight, directionalLight,
            gameCanvas, minimapCanvas, minimapCtx
        });



        generateTerrain();
        // Spawn 10 characters (await each for correct timing)
        for (let i = 0; i < 10; i++) {
            await spawnCharacter(findValidSpawn());
        }
        // Randomize initial ages to reduce synchronized cohort die-off.
        // Spread is controlled by initialAgeMaxRatio (0 = all age 0, 1 = up to full lifespan).
        applyInitialAgeSpread(characters);
        // Initialize relationships after all characters are created

        Character.initializeAllRelationships(characters);

        // --- For investigation: relationships, affinity, groupId/role log output ---
        console.log('=== relationships size ===');
        characters.forEach(c => console.log(`id:${c.id} relSize:${c.relationships.size}`));
        console.log('=== affinity values ===');
        characters.forEach(c => console.log(`id:${c.id} affinities:`, Array.from(c.relationships.values())));
        // Call group detection once to verify groupId/role
        Character.detectGroupsAndElectLeaders(characters);
        console.log('=== groupId/role ===');
        characters.forEach(c => console.log(`id:${c.id} groupId:${c.groupId} role:${c.role}`));

        // Make characters array available globally for sidebar.js
        window.characters = characters;
        if (typeof window.resetPopulationStats === 'function') {
            window.resetPopulationStats(characters.length);
        }
        // Redraw sidebar if function exists in window
        if (window.renderCharacterList) window.renderCharacterList();
        // Sidebar auto-update interval is managed on sidebar.js side

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        let pointerDownPos = null;
        const clickDragThreshold = 6;

        const selectCharacterFromCanvasEvent = (event) => {
            if (!renderer?.domElement || !camera || !Array.isArray(characters) || !window.selectCharacterById) return;
            const rect = renderer.domElement.getBoundingClientRect();
            pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(pointer, camera);

            const hitTargets = characters
                .filter(char => char?.mesh?.visible !== false)
                .map(char => char.mesh);
            const hits = raycaster.intersectObjects(hitTargets, true);
            const hit = hits.find(entry => entry?.object);
            if (!hit) return;

            let targetObject = hit.object;
            while (targetObject?.parent && !String(targetObject.name || '').startsWith('Character')) {
                targetObject = targetObject.parent;
            }

            const selected = characters.find(char => char?.mesh === targetObject || char?.mesh?.uuid === targetObject?.uuid);
            if (selected) {
                window.selectCharacterById(selected.id);
            }
        };

        renderer.domElement.addEventListener('pointerdown', (event) => {
            pointerDownPos = { x: event.clientX, y: event.clientY };
        });
        renderer.domElement.addEventListener('pointerup', (event) => {
            if (!pointerDownPos) return;
            const dx = event.clientX - pointerDownPos.x;
            const dy = event.clientY - pointerDownPos.y;
            pointerDownPos = null;
            if (Math.hypot(dx, dy) > clickDragThreshold) return;
            selectCharacterFromCanvasEvent(event);
        });

        window.addEventListener('resize', onWindowResize);
        const msgBoxBtn = document.getElementById('messageBoxCloseBtn');
        if (msgBoxBtn) msgBoxBtn.addEventListener('click', () => document.getElementById('messageBox').classList.add('hidden'));
        const debugToggle = document.getElementById('debugToggle');
        if (debugToggle) debugToggle.addEventListener('change', (e) => {
            setDEBUG_MODE(e.target.checked);
            window.DEBUG_MODE = e.target.checked;
        });
        // Initialize window.DEBUG_MODE on load to match toggle state
        if (debugToggle) {
            window.DEBUG_MODE = debugToggle.checked;
            setDEBUG_MODE(debugToggle.checked);
        }

        // Setup resource generation sliders
        setupResourceSliders();

        // Restore persisted tuning preset if available
        if (typeof window.loadSimulatorSettingsLocal === 'function') {
            window.loadSimulatorSettingsLocal({ persist: false, silent: true });
        }
        // Workspace preset overrides local preset when available.
        // If the file is missing, keep booting with defaults and emit one clear warning.
        if (typeof window.loadSimulatorSettingsWorkspace === 'function') {
            const workspaceLoaded = await window.loadSimulatorSettingsWorkspace({ persist: false, silent: true });
            if (!workspaceLoaded) {
                console.warn('[Settings] Workspace preset file was not loaded; continuing with built-in/default settings.');
            }
        }
        // Re-apply after settings load so the active slider/workspace value actually takes effect.
        applyInitialAgeSpread(characters);
        setDistrictMode(Number(window.sidebarParams?.districtMode) || 1);
        setActiveDistrict(Number(window.sidebarParams?.activeDistrictIndex) || 0);
        if (window.renderCharacterList) window.renderCharacterList();

        setupTelemetryManagerPanel();

        animate();
    } catch (error) { console.error("Initialization Error:", error); }
}

function setupTelemetryManagerPanel() {
    const modal = document.getElementById('debugControlModal');
    const openBtn = document.getElementById('debugPanelOpenBtn');
    const closeBtn = document.getElementById('debugPanelCloseBtn');
    const startBtn = document.getElementById('telemetryStartBtn');
    const stopBtn = document.getElementById('telemetryStopBtn');
    const downloadBtn = document.getElementById('telemetryDownloadBtn');
    const autoToggle = document.getElementById('telemetryAutoDownloadToggle');
    const status = document.getElementById('telemetryStatus');
    const settingsSaveLocalBtn = document.getElementById('settingsSaveLocalBtn');
    const settingsExportBtn = document.getElementById('settingsExportBtn');
    const settingsImportBtn = document.getElementById('settingsImportBtn');
    const settingsLoadWorkspaceBtn = document.getElementById('settingsLoadWorkspaceBtn');
    const settingsImportFileInput = document.getElementById('settingsImportFileInput');
    const settingsStatus = document.getElementById('settingsStatus');

    if (!startBtn || !stopBtn || !downloadBtn || !status) return;

    const renderStatus = () => {
        const telemetry = window.__simTelemetry;
        const sampleCount = telemetry?.samples?.length || telemetry?.archivedMeta?.sampleCount || 0;
        const eventCount = telemetry?.events?.length || telemetry?.archivedMeta?.eventCount || 0;
        const mode = window.simTestMode ? 'running' : (telemetry?.archivedJSON ? 'stopped/saved' : 'idle');
        const auto = !!window.simTelemetryConfig?.autoDownloadOnStop;
        status.textContent = `Telemetry ${mode} | samples=${sampleCount} events=${eventCount} | autoDownload=${auto ? 'on' : 'off'}`;
    };

    const setSettingsStatus = (message) => {
        if (settingsStatus) settingsStatus.textContent = message;
    };

    const openModal = () => {
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.inert = false;
        modal.setAttribute('aria-hidden', 'false');
        renderStatus();
        if (closeBtn) {
            window.requestAnimationFrame(() => closeBtn.focus());
        }
    };

    const closeModal = () => {
        if (!modal) return;
        if (modal.contains(document.activeElement) && openBtn) {
            openBtn.focus();
        }
        modal.inert = true;
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.add('hidden');
    };

    if (openBtn) {
        openBtn.addEventListener('click', openModal);
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeModal();
    });

    if (autoToggle) {
        autoToggle.checked = !!window.simTelemetryConfig.autoDownloadOnStop;
        autoToggle.addEventListener('change', (e) => {
            window.simTelemetryConfig.autoDownloadOnStop = !!e.target.checked;
            renderStatus();
        });
    }

    startBtn.addEventListener('click', () => {
        window.startTelemetryTest({
            autoDownloadOnStop: !!window.simTelemetryConfig.autoDownloadOnStop
        });
        renderStatus();
    });

    stopBtn.addEventListener('click', () => {
        window.stopTelemetryTest({
            autoDownloadOnStop: !!window.simTelemetryConfig.autoDownloadOnStop
        });
        renderStatus();
    });

    downloadBtn.addEventListener('click', () => {
        window.downloadTelemetryJSON();
        renderStatus();
    });

    if (settingsSaveLocalBtn) {
        settingsSaveLocalBtn.addEventListener('click', () => {
            const ok = window.saveSimulatorSettingsLocal?.();
            setSettingsStatus(ok ? `Saved local preset at ${new Date().toLocaleTimeString()}` : 'Local save failed');
        });
    }

    if (settingsExportBtn) {
        settingsExportBtn.addEventListener('click', () => {
            const fileName = window.exportSimulatorSettingsJSON?.();
            setSettingsStatus(fileName ? `Exported ${fileName}` : 'Export failed');
        });
    }

    if (settingsLoadWorkspaceBtn) {
        settingsLoadWorkspaceBtn.addEventListener('click', async () => {
            try {
                const loaded = await window.loadSimulatorSettingsWorkspace?.({ persist: true, silent: false });
                if (loaded) {
                    const path = window.__simSettingsWorkspaceFile || 'sim-settings.workspace.json';
                    setSettingsStatus(`Loaded workspace preset (${path})`);
                    renderStatus();
                } else {
                    setSettingsStatus('Workspace preset not found');
                }
            } catch (err) {
                console.error('[Settings] workspace load failed', err);
                setSettingsStatus('Workspace preset load failed');
            }
        });
    }

    if (settingsImportBtn && settingsImportFileInput) {
        settingsImportBtn.addEventListener('click', () => settingsImportFileInput.click());
        settingsImportFileInput.addEventListener('change', async (e) => {
            const file = e.target?.files?.[0];
            if (!file) return;
            try {
                await window.importSimulatorSettingsFromFile?.(file, { persist: true });
                setSettingsStatus(`Imported ${file.name}`);
                renderStatus();
            } catch (err) {
                console.error('[Settings] import failed', err);
                setSettingsStatus('Import failed (invalid JSON or schema)');
            } finally {
                settingsImportFileInput.value = '';
            }
        });
    }

    window.setInterval(renderStatus, 1000);
    renderStatus();
    setSettingsStatus('Settings preset ready');
}

function main() {
    const checkReady = () => {
        const gameCanvasElement = document.getElementById('gameCanvas');
        if (typeof THREE !== 'undefined' && gameCanvasElement && gameCanvasElement.clientWidth > 0) {
            init();
        } else {
            requestAnimationFrame(checkReady);
        }
    };
    if (document.readyState === 'complete' || (document.readyState !== 'loading' && !document.documentElement.doScroll)) {
         checkReady();
    } else {
        document.addEventListener('DOMContentLoaded', checkReady);
    }
}
main();

// Setup resource generation sliders
function setupResourceSliders() {
    const treeSlider = document.getElementById('treeSlider');
    const leafSlider = document.getElementById('leafSlider');
    const fruitSlider = document.getElementById('fruitSlider');
    const stoneSlider = document.getElementById('stoneSlider');
    const caveSlider = document.getElementById('caveSlider');
    const regenerateButton = document.getElementById('regenerateButton');

    const treeValue = document.getElementById('treeValue');
    const leafValue = document.getElementById('leafValue');
    const fruitValue = document.getElementById('fruitValue');
    const stoneValue = document.getElementById('stoneValue');
    const caveValue = document.getElementById('caveValue');

    const clampFromSlider = (slider, rawValue) => {
        if (!slider) return Number(rawValue);
        const min = Number(slider.min);
        const max = Number(slider.max);
        let value = Number(rawValue);
        if (!Number.isFinite(value)) value = Number(slider.value);
        return Math.max(min, Math.min(max, value));
    };

    // Update display values
    function updateSliderValues() {
        if (treeValue) treeValue.textContent = Math.round(treeSlider.value * 100) + '%';
        if (leafValue) leafValue.textContent = Math.round(leafSlider.value * 100) + '%';
        if (fruitValue) fruitValue.textContent = Math.round(fruitSlider.value * 100) + '%';
        if (stoneValue) stoneValue.textContent = Math.round(stoneSlider.value * 100) + '%';
        if (caveValue) caveValue.textContent = Math.round(caveSlider.value * 100) + '%';
    }

    // Tree slider
    if (treeSlider) {
        treeSlider.addEventListener('input', (e) => {
            setTreeSpawnRate(parseFloat(e.target.value));
            updateSliderValues();
        });
    }

    // Leaf slider
    if (leafSlider) {
        leafSlider.addEventListener('input', (e) => {
            setLeafSpawnRate(parseFloat(e.target.value));
            updateSliderValues();
        });
    }

    // Fruit slider
    if (fruitSlider) {
        fruitSlider.addEventListener('input', (e) => {
            setFruitSpawnRate(parseFloat(e.target.value));
            updateSliderValues();
        });
    }

    // Stone slider
    if (stoneSlider) {
        stoneSlider.addEventListener('input', (e) => {
            setStoneSpawnRate(parseFloat(e.target.value));
            updateSliderValues();
        });
    }

    // Cave slider
    if (caveSlider) {
        caveSlider.addEventListener('input', (e) => {
            setCaveSpawnRate(parseFloat(e.target.value));
            updateSliderValues();
        });
    }

    // Regenerate world button
    if (regenerateButton) {
        regenerateButton.addEventListener('click', () => {
            regenerateWorld();
        });
    }

    // Initialize display values
    updateSliderValues();

    window.getResourceGenerationSettings = () => ({
        treeSpawnRate: treeSlider ? Number(treeSlider.value) : null,
        leafSpawnRate: leafSlider ? Number(leafSlider.value) : null,
        fruitSpawnRate: fruitSlider ? Number(fruitSlider.value) : null,
        stoneSpawnRate: stoneSlider ? Number(stoneSlider.value) : null,
        caveSpawnRate: caveSlider ? Number(caveSlider.value) : null
    });

    window.applyResourceGenerationSettings = (settings = {}) => {
        if (treeSlider && settings.treeSpawnRate !== undefined) {
            const value = clampFromSlider(treeSlider, settings.treeSpawnRate);
            treeSlider.value = String(value);
            setTreeSpawnRate(value);
        }
        if (leafSlider && settings.leafSpawnRate !== undefined) {
            const value = clampFromSlider(leafSlider, settings.leafSpawnRate);
            leafSlider.value = String(value);
            setLeafSpawnRate(value);
        }
        if (fruitSlider && settings.fruitSpawnRate !== undefined) {
            const value = clampFromSlider(fruitSlider, settings.fruitSpawnRate);
            fruitSlider.value = String(value);
            setFruitSpawnRate(value);
        }
        if (stoneSlider && settings.stoneSpawnRate !== undefined) {
            const value = clampFromSlider(stoneSlider, settings.stoneSpawnRate);
            stoneSlider.value = String(value);
            setStoneSpawnRate(value);
        }
        if (caveSlider && settings.caveSpawnRate !== undefined) {
            const value = clampFromSlider(caveSlider, settings.caveSpawnRate);
            caveSlider.value = String(value);
            setCaveSpawnRate(value);
        }
        updateSliderValues();
    };
}

// Function to regenerate the world with new settings
async function regenerateWorld() {
    // Clear existing world data and visual blocks
    worldData.clear();
    resetWorldSpatialIndex();

    // Remove all visual blocks from scene
    for (const [key, block] of visualBlocks) {
        if (block && block.parent) {
            block.parent.remove(block);
            if (block.geometry) block.geometry.dispose();
            if (block.material) block.material.dispose();
        }
    }
    visualBlocks.clear();

    // Clear all characters
    for (const char of characters) {
        if (char.dispose) char.dispose();
    }
    characters.length = 0;
    window.characters = characters;

    // Regenerate terrain with new settings
    generateTerrain();

    // Spawn new characters
    for (let i = 0; i < 8; i++) {
        const pos = findValidSpawn();
        if (pos) await spawnCharacter(pos);
    }
    // Randomize initial ages to reduce synchronized die-off using the active slider value.
    applyInitialAgeSpread(characters);

    // Update sidebar if available
    if (window.renderCharacterList) window.renderCharacterList();

    console.log('World regenerated with new resource settings');
}

// --- For debugging: Global function to check group status anytime ---
window.logGroupStatus = function() {
    Character.detectGroupsAndElectLeaders(characters);
    console.log('=== groupId/role (on demand) ===');
    characters.forEach(c => console.log(`id:${c.id} groupId:${c.groupId} role:${c.role}`));
};

// Global runtime tuning defaults (can be overridden in DevTools)
window.pathValidateLookahead = window.pathValidateLookahead || 8;
window.recentDigAllowAfterBfsFailCount = window.recentDigAllowAfterBfsFailCount || 1;

// Telemetry test environment helpers
window.simTestMode = window.simTestMode || false;
window.simTelemetryConfig = {
    sampleIntervalMs: 1000,
    maxSamples: 120000,
    maxEvents: 50000,
    autoDownloadOnStop: false,
    fileNamePrefix: 'telemetry'
};
window.__simSettingsStorageKey = 'voxel-society.settings.v1';
window.__simSettingsWorkspaceFile = 'sim-settings.workspace.json';

window.exportSimulatorSettingsObject = function exportSimulatorSettingsObject() {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: {
            sidebarParams: { ...(window.sidebarParams || {}) },
            telemetryConfig: { ...(window.simTelemetryConfig || {}) },
            resourceGeneration: (typeof window.getResourceGenerationSettings === 'function')
                ? window.getResourceGenerationSettings()
                : {},
            debug: {
                debugMode: !!window.DEBUG_MODE
            }
        }
    };
};

window.downloadSimulatorSettingsJSON = function downloadSimulatorSettingsJSON(fileName = null) {
    const safeName = fileName || `sim-settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const content = JSON.stringify(window.exportSimulatorSettingsObject(), null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return safeName;
};

window.exportSimulatorSettingsJSON = function exportSimulatorSettingsJSON(fileName = null) {
    return window.downloadSimulatorSettingsJSON(fileName);
};

window.applySimulatorSettingsObject = function applySimulatorSettingsObject(payload, opts = {}) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Settings payload must be an object');
    }
    const settings = (payload.settings && typeof payload.settings === 'object') ? payload.settings : payload;

    if (settings.sidebarParams && typeof settings.sidebarParams === 'object') {
        window.sidebarParams = {
            ...(window.sidebarParams || {}),
            ...settings.sidebarParams
        };
        if (typeof window.renderCharacterDetail === 'function') {
            window.renderCharacterDetail();
        }
    }

    if (settings.telemetryConfig && typeof settings.telemetryConfig === 'object') {
        const next = { ...(window.simTelemetryConfig || {}) };
        if (settings.telemetryConfig.sampleIntervalMs !== undefined) {
            next.sampleIntervalMs = Math.max(200, Number(settings.telemetryConfig.sampleIntervalMs) || next.sampleIntervalMs);
        }
        if (settings.telemetryConfig.maxSamples !== undefined) {
            next.maxSamples = Math.max(1000, Number(settings.telemetryConfig.maxSamples) || next.maxSamples);
        }
        if (settings.telemetryConfig.maxEvents !== undefined) {
            next.maxEvents = Math.max(1000, Number(settings.telemetryConfig.maxEvents) || next.maxEvents);
        }
        if (settings.telemetryConfig.autoDownloadOnStop !== undefined) {
            next.autoDownloadOnStop = !!settings.telemetryConfig.autoDownloadOnStop;
        }
        if (settings.telemetryConfig.fileNamePrefix !== undefined && String(settings.telemetryConfig.fileNamePrefix).trim()) {
            next.fileNamePrefix = String(settings.telemetryConfig.fileNamePrefix).trim();
        }
        window.simTelemetryConfig = next;
    }

    if (settings.resourceGeneration && typeof settings.resourceGeneration === 'object' && typeof window.applyResourceGenerationSettings === 'function') {
        window.applyResourceGenerationSettings(settings.resourceGeneration);
    }

    if (settings.debug && typeof settings.debug === 'object' && settings.debug.debugMode !== undefined) {
        const debugMode = !!settings.debug.debugMode;
        const debugToggle = document.getElementById('debugToggle');
        if (debugToggle) debugToggle.checked = debugMode;
        window.DEBUG_MODE = debugMode;
        setDEBUG_MODE(debugMode);
    }

    if (opts.persist !== false) {
        window.saveSimulatorSettingsLocal();
    }

    return true;
};

window.saveSimulatorSettingsLocal = function saveSimulatorSettingsLocal() {
    try {
        localStorage.setItem(window.__simSettingsStorageKey, JSON.stringify(window.exportSimulatorSettingsObject()));
        return true;
    } catch (err) {
        console.error('[Settings] local save failed', err);
        return false;
    }
};

window.loadSimulatorSettingsLocal = function loadSimulatorSettingsLocal(opts = {}) {
    try {
        const raw = localStorage.getItem(window.__simSettingsStorageKey);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        window.applySimulatorSettingsObject(parsed, { persist: opts.persist !== undefined ? opts.persist : false });
        return true;
    } catch (err) {
        if (!opts.silent) console.error('[Settings] local load failed', err);
        return false;
    }
};

window.importSimulatorSettingsFromFile = async function importSimulatorSettingsFromFile(file, opts = {}) {
    if (!file) throw new Error('No file selected');
    const text = await file.text();
    const parsed = JSON.parse(text);
    window.applySimulatorSettingsObject(parsed, { persist: opts.persist !== false });
    return true;
};

window.loadSimulatorSettingsWorkspace = async function loadSimulatorSettingsWorkspace(opts = {}) {
    const filePath = (opts.filePath && String(opts.filePath).trim())
        ? String(opts.filePath).trim()
        : window.__simSettingsWorkspaceFile;
    const bust = Date.now();
    const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;

    try {
        const res = await fetch(`${normalized}?v=${bust}`, { cache: 'no-store' });
        if (!res.ok) {
            if (!opts.silent) {
                throw new Error(`Workspace settings not found: ${filePath} (HTTP ${res.status})`);
            }
            return false;
        }

        const contentType = String(res.headers.get('content-type') || '').toLowerCase();
        const text = await res.text();
        if (contentType.includes('text/html') || /^\s*</.test(text)) {
            if (!opts.silent) {
                console.warn(`[Settings] workspace preset at ${filePath} returned HTML instead of JSON; skipping.`);
            }
            return false;
        }

        const parsed = JSON.parse(text);
        window.applySimulatorSettingsObject(parsed, { persist: opts.persist !== false });
        return true;
    } catch (err) {
        if (!opts.silent) {
            console.error('[Settings] workspace load failed', err);
        }
        return false;
    }
};

window.resetPopulationStats = function resetPopulationStats(initialCount = 0) {
    const base = Math.max(0, Number(initialCount) || 0);
    window.__simPopulationStats = {
        startedAt: Date.now(),
        initialPopulation: base,
        births: 0,
        deaths: 0,
        deathsByCause: {
            starvation: 0,
            old_age: 0,
            unknown: 0
        },
        latestBirth: null,
        latestDeath: null
    };
    // Reset unified event log and sidebar-derived trend histories on a fresh simulation run.
    window.__eventLog = [];
    window.__maxGenSeen = 0;
    window.__deathRecords = [];
    window.__phaseHistory = [];
    window.__populationPulseHistory = [];
    window.__populationMetricHistory = [];
    window.characterHistory = {};
    if (window.__selectedCharacterMarker) {
        window.__selectedCharacterMarker.style.opacity = '0';
    }
    return window.__simPopulationStats;
};

window.getPopulationStats = function getPopulationStats() {
    if (!window.__simPopulationStats) {
        return window.resetPopulationStats(Array.isArray(window.characters) ? window.characters.length : 0);
    }
    return window.__simPopulationStats;
};

// --- Unified Event Log ---
// Single store for all timeline events (society narrative + birth/death).
// Max 60 entries; newest-first (unshift). Keep the legacy __societyChronicle
// alias in sync so the left sidebar chronicle and the bottom timeline read
// the same source of truth.
if (!window.__eventLog) {
    window.__eventLog = Array.isArray(window.__societyChronicle) ? window.__societyChronicle : [];
}
window.__societyChronicle = window.__eventLog;
window.logChronicleEvent = function logChronicleEvent(icon, text, kind) {
    const entry = { t: Date.now(), icon, text, kind: kind || 'event' };
    window.__eventLog.unshift(entry);
    if (window.__eventLog.length > 60) window.__eventLog.pop();
    window.__societyChronicle = window.__eventLog;
    return entry;
};

window.recordPopulationBirth = function recordPopulationBirth(payload = {}) {
    const stats = window.getPopulationStats();
    stats.births += 1;
    stats.latestBirth = {
        t: Date.now(),
        ...payload
    };
    // Generation milestone: log first birth of each new generation.
    const gen = Number(payload.generation || 0);
    if (gen > 0 && typeof window.logChronicleEvent === 'function') {
        if (!window.__maxGenSeen || gen > window.__maxGenSeen) {
            const prevGen = window.__maxGenSeen || 0;
            window.__maxGenSeen = gen;
            window.logChronicleEvent('👶', `Generation ${gen} first birth`, 'new_gen');

            // Generation Summary: compute stats for the generation that just ended (prevGen)
            if (prevGen > 0 && Array.isArray(window.__deathRecords) && window.__deathRecords.length > 0) {
                const cohort = window.__deathRecords.filter(r => r.generation === prevGen);
                if (cohort.length > 0) {
                    const avgAge = (cohort.reduce((s, r) => s + r.ageAtDeath, 0) / cohort.length).toFixed(0);
                    const starvCount = cohort.filter(r => r.cause === 'starvation').length;
                    const starvPct = Math.round(100 * starvCount / cohort.length);
                    const traitAvg = {};
                    const traitKeys = ['bravery', 'diligence', 'sociality', 'curiosity', 'resourcefulness', 'resilience'];
                    for (const k of traitKeys) {
                        const vals = cohort.map(r => r.traits?.[k]).filter(v => v != null);
                        if (vals.length > 0) traitAvg[k] = (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2);
                    }
                    const topTrait = traitKeys.reduce((best, k) => traitAvg[k] > (traitAvg[best] ?? 0) ? k : best, traitKeys[0]);
                    const summaryText = `Gen${prevGen} closed — ${cohort.length} died · avg ${avgAge}s · ${starvPct}% starved · top trait: ${topTrait}=${traitAvg[topTrait]}`;
                    window.logChronicleEvent('📊', summaryText, 'gen_summary');
                }
            }
        }
    }
    return stats;
};

function normalizeDeathCause(cause) {
    const normalized = String(cause || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!normalized) return 'unknown';
    if (normalized === 'starvation' || normalized === 'starved' || normalized.includes('starv')) return 'starvation';
    if (normalized === 'old_age' || normalized === 'oldage' || normalized === 'old') return 'old_age';
    return 'unknown';
}

window.recordPopulationDeath = function recordPopulationDeath(payload = {}) {
    const stats = window.getPopulationStats();
    stats.deaths += 1;
    const rawCause = payload && typeof payload.cause === 'string' ? payload.cause : 'unknown';
    const cause = normalizeDeathCause(rawCause);
    if (stats.deathsByCause[cause] === undefined) stats.deathsByCause[cause] = 0;
    stats.deathsByCause[cause] += 1;
    stats.latestDeath = {
        t: Date.now(),
        ...payload,
        cause
    };
    if (typeof window.logChronicleEvent === 'function') {
        const id = payload.id !== undefined ? `#${payload.id}` : '';
        const gen = payload.generation !== undefined ? ` G${payload.generation}` : '';
        const age = payload.age !== undefined ? `, ${Math.round(Number(payload.age) || 0)}s` : '';
        const causeLabel = cause.replace(/_/g, ' ');
        window.logChronicleEvent('💀', `Died ${id}${gen}${age} — ${causeLabel}`, 'death');
    }
    return stats;
};

window.__simTelemetry = {
    startedAt: 0,
    endedAt: 0,
    samples: [],
    worldSamples: [],
    events: [],
    archivedJSON: '',
    archivedMeta: null,
    counters: {
        droppedSamples: 0,
        droppedEvents: 0
    },
    addSample(sample) {
        if (!sample) return;
        if (this.samples.length >= window.simTelemetryConfig.maxSamples) {
            this.counters.droppedSamples++;
            return;
        }
        if (!this._profiledIds) this._profiledIds = new Set();
        const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
        const compact = {
            t: sample.t,
            id: sample.id,
            state: sample.state,
            action: sample.action || null,
            groupId: sample.groupId || null,
            generation: Number(sample.generation || 0),
            isChild: !!sample.isChild,
            lifeStage: sample.lifeStage ?? (sample.isChild ? 'child' : 'adult'),
            age: round2(sample.age),
            lifespan: Number(sample.lifespan || 0),
            lifeRatio: round2(sample.lifeRatio),
            pos: sample.pos ? {
                x: Number(sample.pos.x || 0),
                y: Number(sample.pos.y || 0),
                z: Number(sample.pos.z || 0)
            } : undefined,
            target: sample.target ? {
                x: Number(sample.target.x || 0),
                y: Number(sample.target.y || 0),
                z: Number(sample.target.z || 0)
            } : null,
            pathLen: Number(sample.pathLen || 0),
            actionCooldown: round2(sample.actionCooldown),
            microPause: round2(sample.microPause),
            blockedRetry: Number(sample.blockedRetry || 0),
            bfsFailCount: Number(sample.bfsFailCount || 0),
            moveDistance: round2(sample.moveDistance),
            nearEnemy: !!sample.nearEnemy,
            needs: sample.needs ? {
                hunger: round2(sample.needs.hunger),
                energy: round2(sample.needs.energy),
                safety: round2(sample.needs.safety),
                social: round2(sample.needs.social)
            } : undefined,
            social: sample.social ? {
                relationshipCount: Number(sample.social.relationshipCount || 0),
                avgAffinity: round2(sample.social.avgAffinity),
                groupSize: Number(sample.social.groupSize || 1),
                bondedCount: Number(sample.social.bondedCount || 0),
                allyCount: Number(sample.social.allyCount || 0),
                nearbySupport: Number(sample.social.nearbySupport || 0),
                supportScore: round2(sample.social.supportScore)
            } : undefined,
            home: sample.home ? {
                hasHome: !!sample.home.hasHome,
                distance: sample.home.distance != null ? Number(sample.home.distance) : null
            } : undefined,
            inventory: sample.inventory ? {
                count: Number(sample.inventory.count || 0),
                hasTool: !!sample.inventory.hasTool,
                hasWood: !!sample.inventory.hasWood
            } : undefined,
            decisionPressure: sample.decisionPressure ? {
                lowHunger: !!sample.decisionPressure.lowHunger,
                lowEnergy: !!sample.decisionPressure.lowEnergy,
                stallLike: !!sample.decisionPressure.stallLike
            } : undefined,
            foodSeekFailed: !!sample.foodSeekFailed,
            foodSeekBlocked: !!sample.foodSeekBlocked,
        };
        if (!this._profiledIds.has(compact.id) && sample.personality) {
            compact.personality = {
                bravery: round2(sample.personality.bravery),
                diligence: round2(sample.personality.diligence),
                sociality: round2(sample.personality.sociality),
                curiosity: round2(sample.personality.curiosity),
                resourcefulness: round2(sample.personality.resourcefulness),
                resilience: round2(sample.personality.resilience)
            };
            this._profiledIds.add(compact.id);
        }
        this.samples.push(compact);
    },
    addWorldSample(sample) {
        if (!sample) return;
        // world samples cap at 1/10 of maxSamples to keep file size reasonable
        const cap = Math.ceil(window.simTelemetryConfig.maxSamples / 10);
        if (this.worldSamples.length >= cap) return;
        this.worldSamples.push(sample);
    },
    addEvent(evt) {
        if (!evt) return;
        if (evt.kind === 'action-transition') {
            const getAction = (value) => {
                const part = String(value || '').split('|').pop();
                return (!part || part === '-') ? null : part;
            };
            const fromAction = getAction(evt.from);
            const toAction = getAction(evt.to ?? evt.action);
            const importantActions = new Set(['COLLECT_FOOD', 'EAT', 'REST', 'SOCIALIZE', 'BUILD_HOME', 'DIG', 'FLEE', 'ATTACK', 'REPRODUCE']);
            if (fromAction === toAction && (toAction === 'WANDER' || toAction === null)) return;
            if (!importantActions.has(fromAction) && !importantActions.has(toAction)) return;
        }
        if (this.events.length >= window.simTelemetryConfig.maxEvents) {
            this.counters.droppedEvents++;
            return;
        }
        const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
        const compact = {
            ...evt,
            actionCooldown: evt.actionCooldown !== undefined ? round2(evt.actionCooldown) : evt.actionCooldown,
            microPause: evt.microPause !== undefined ? round2(evt.microPause) : evt.microPause,
            age: evt.age !== undefined ? round2(evt.age) : evt.age
        };
        if (evt.needs) {
            compact.needs = {
                hunger: round2(evt.needs.hunger),
                energy: round2(evt.needs.energy),
                safety: round2(evt.needs.safety),
                social: round2(evt.needs.social)
            };
        }
        this.events.push(compact);
    },
    snapshotMeta() {
        const popBase = window.getPopulationStats ? window.getPopulationStats() : null;
        const chars = Array.isArray(window.characters) ? window.characters : [];
        const alive = chars.filter(c => c && c.state !== 'dead');
        const getStage = (c) => c?.getLifeStage ? c.getLifeStage() : (c?.isChild ? 'child' : 'adult');
        const stageCounts = { child: 0, young: 0, adult: 0, elder: 0 };
        for (const c of alive) {
            const stage = getStage(c);
            if (stageCounts[stage] !== undefined) stageCounts[stage] += 1;
        }
        const children = stageCounts.child;
        const currentPopulation = {
            totalTracked: chars.length,
            alive: alive.length,
            children,
            adults: stageCounts.young + stageCounts.adult + stageCounts.elder,
            stageCounts,
            maxGeneration: chars.reduce((m, c) => Math.max(m, Number(c?.generation || 0)), 0)
        };
        const population = popBase
            ? {
                ...popBase,
                deathsByCause: { ...(popBase.deathsByCause || {}) },
                current: currentPopulation
            }
            : null;
        return {
            startedAt: this.startedAt,
            endedAt: this.endedAt,
            durationMs: (this.endedAt || Date.now()) - (this.startedAt || Date.now()),
            sampleCount: this.samples.length,
            eventCount: this.events.length,
            counters: { ...this.counters },
            config: { ...window.simTelemetryConfig },
            runtime: {
                aiMode: window.aiMode,
                hungerEmergencyThreshold: window.hungerEmergencyThreshold,
                energyEmergencyThreshold: window.energyEmergencyThreshold,
                hungerDecayRate: window.hungerDecayRate,
                activeEnergyDrainRate: window.activeEnergyDrainRate,
                unsafeNightSafetyDecayRate: window.unsafeNightSafetyDecayRate,
                daytimeSafetyRecoveryRate: window.daytimeSafetyRecoveryRate,
                restEnergyRecoveryRate: window.restEnergyRecoveryRate,
                characterLifespan: window.characterLifespan,
                socialThreshold: window.socialThreshold,
                groupAffinityThreshold: window.groupAffinityThreshold,
                homeBuildingPriority: window.homeBuildingPriority,
                homeReturnHungerLevel: window.homeReturnHungerLevel,
                explorationBaseRate: window.explorationBaseRate,
                explorationMinRate: window.explorationMinRate,
                explorationMaxRate: window.explorationMaxRate,
                explorationAdaptBoost: window.explorationAdaptBoost,
                explorationForagePenalty: window.explorationForagePenalty,
                explorationRestPenalty: window.explorationRestPenalty,
                socialAdaptationBoost: window.socialAdaptationBoost,
                socialForagePenalty: window.socialForagePenalty,
                socialRestPenalty: window.socialRestPenalty,
                lowPrioritySocialOffset: window.lowPrioritySocialOffset,
                perceptionRange: window.perceptionRange,
                reproductionCooldownSeconds: window.reproductionCooldownSeconds,
                pairReproductionCooldownSeconds: window.pairReproductionCooldownSeconds,
                initialAffinityMin: window.initialAffinityMin,
                initialAffinityMax: window.initialAffinityMax,
                affinityIncreaseRate: window.affinityIncreaseRate,
                affinityDecayRate: window.affinityDecayRate,
                socialNeedRecovery: window.socialNeedRecovery,
                socialNeedDecayRate: window.socialNeedDecayRate,
                supportComfortRecoveryRate: window.supportComfortRecoveryRate,
                supportGroupComfortScale: window.supportGroupComfortScale,
                supportNightSafetyAllyBonus: window.supportNightSafetyAllyBonus,
                supportNightSafetyBondedBonus: window.supportNightSafetyBondedBonus,
                bondPersistence: window.bondPersistence,
                acquaintanceAffinityThreshold: window.acquaintanceAffinityThreshold,
                allyAffinityThreshold: window.allyAffinityThreshold,
                bondedAffinityThreshold: window.bondedAffinityThreshold,
                nearbySupportRadius: window.nearbySupportRadius,
                supportGroupBonus: window.supportGroupBonus,
                supportAllyPresenceBonus: window.supportAllyPresenceBonus,
                supportBondedWeight: window.supportBondedWeight,
                supportAllyWeight: window.supportAllyWeight,
                supportNearbyWeight: window.supportNearbyWeight,
                supportTopAffinityWeight: window.supportTopAffinityWeight,
                socialPressureFoodWeight: window.socialPressureFoodWeight,
                socialPressureHousingWeight: window.socialPressureHousingWeight,
                socialPressureTimeWeight: window.socialPressureTimeWeight,
                socialPressureSupportWeight: window.socialPressureSupportWeight,
                socialPressureStabilityWeight: window.socialPressureStabilityWeight,
                opportunityPressureWeight: window.opportunityPressureWeight,
                opportunitySupportWeight: window.opportunitySupportWeight,
                opportunityStabilityWeight: window.opportunityStabilityWeight,
                opportunityConflictWeight: window.opportunityConflictWeight,
                opportunityPopulationWeight: window.opportunityPopulationWeight,
                opportunityFoodWeight: window.opportunityFoodWeight,
                maxAffinity: window.maxAffinity,
                autoRecoverStall: window.autoRecoverStall,
                movingReplanStallMs: window.movingReplanStallMs,
                pathOccupancyLookahead: window.pathOccupancyLookahead,
                recentDigCooldownMs: window.recentDigCooldownMs,
                digActionCooldown: window.digActionCooldown,
                worldReservationTTL: window.worldReservationTTL,
                maxActionCooldown: window.maxActionCooldown,
                recoverActionCooldown: window.recoverActionCooldown,
                // ecology & social params added in recent sessions
                seasonCycleSeconds: window.seasonCycleSeconds,
                seasonAmplitude: window.seasonAmplitude,
                fruitRegenIntervalSeconds: window.fruitRegenIntervalSeconds,
                initialAgeMaxRatio: window.initialAgeMaxRatio,
                minReproductionAgeRatio: window.minReproductionAgeRatio,
                affinityFloor: window.affinityFloor,
                isolationPenalty: window.isolationPenalty,
                traitAffinityCapReduction: window.traitAffinityCapReduction,
                districtMode: window.districtMode,
                activeDistrictIndex: window.activeDistrictIndex
            },
            population
        };
    },
    exportObject() {
        return {
            meta: this.snapshotMeta(),
            samples: this.samples,
            worldSamples: this.worldSamples,
            events: this.events
        };
    },
    archiveSnapshot(pretty = false) {
        const payload = this.exportObject();
        this.archivedMeta = payload.meta;
        this.archivedJSON = JSON.stringify(payload, null, pretty ? 2 : 0);
        return this.archivedJSON;
    },
    clearLiveData() {
        this.samples = [];
        this.worldSamples = [];
        this.events = [];
        this._profiledIds = new Set();
    },
    clearArchive() {
        this.archivedJSON = '';
        this.archivedMeta = null;
    },
    reset() {
        this.startedAt = Date.now();
        this.endedAt = 0;
        this.samples = [];
        this.worldSamples = [];
        this.events = [];
        this.archivedJSON = '';
        this.archivedMeta = null;
        this.counters = { droppedSamples: 0, droppedEvents: 0 };
        this._profiledIds = new Set();
    }
};

window.startTelemetryTest = function startTelemetryTest(opts = {}) {
    if (opts.sampleIntervalMs !== undefined) {
        window.simTelemetryConfig.sampleIntervalMs = Math.max(200, Number(opts.sampleIntervalMs) || 1000);
    }
    if (opts.maxSamples !== undefined) {
        window.simTelemetryConfig.maxSamples = Math.max(1000, Number(opts.maxSamples) || 120000);
    }
    if (opts.maxEvents !== undefined) {
        window.simTelemetryConfig.maxEvents = Math.max(1000, Number(opts.maxEvents) || 50000);
    }
    if (opts.autoDownloadOnStop !== undefined) {
        window.simTelemetryConfig.autoDownloadOnStop = !!opts.autoDownloadOnStop;
    }
    if (opts.fileNamePrefix !== undefined && typeof opts.fileNamePrefix === 'string' && opts.fileNamePrefix.trim()) {
        window.simTelemetryConfig.fileNamePrefix = opts.fileNamePrefix.trim();
    }
    window.__simTelemetry.reset();
    window.simTestMode = true;
    console.log('[Telemetry] started', window.__simTelemetry.snapshotMeta());
};

window.stopTelemetryTest = function stopTelemetryTest(opts = {}) {
    window.simTestMode = false;
    window.__simTelemetry.endedAt = Date.now();
    console.log('[Telemetry] stopped', window.__simTelemetry.snapshotMeta());

    // Preserve one exportable snapshot while releasing the heavier live object graph.
    window.__simTelemetry.archiveSnapshot(false);
    window.__simTelemetry.clearLiveData();

    const shouldAutoDownload = (opts.autoDownloadOnStop !== undefined)
        ? !!opts.autoDownloadOnStop
        : !!window.simTelemetryConfig.autoDownloadOnStop;
    if (shouldAutoDownload) {
        const prefix = (opts.fileNamePrefix && typeof opts.fileNamePrefix === 'string')
            ? opts.fileNamePrefix.trim()
            : window.simTelemetryConfig.fileNamePrefix;
        const fileName = `${prefix || 'telemetry'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const saved = window.downloadTelemetryJSON(fileName, { clearArchive: true });
        console.log('[Telemetry] auto-downloaded and released buffers', saved);
        return saved;
    }
    return null;
};

window.getTelemetryJSON = function getTelemetryJSON(pretty = false) {
    const telemetry = window.__simTelemetry;
    if (!window.simTestMode && telemetry.archivedJSON) {
        if (!pretty) return telemetry.archivedJSON;
        try {
            return JSON.stringify(JSON.parse(telemetry.archivedJSON), null, 2);
        } catch (err) {
            console.warn('[Telemetry] archived snapshot parse failed; rebuilding export.', err);
        }
    }
    return JSON.stringify(telemetry.exportObject(), null, pretty ? 2 : 0);
};

window.downloadTelemetryJSON = function downloadTelemetryJSON(fileName = null, opts = {}) {
    const safeName = fileName || `telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const blob = new Blob([window.getTelemetryJSON(false)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (!window.simTestMode && opts.clearArchive !== false) {
        window.__simTelemetry.clearArchive();
    }
    return safeName;
};
