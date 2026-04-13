import { generateTerrain, addBlock, removeBlock, findGroundY, isSafeSpot, worldData, BLOCK_TYPES, ITEM_TYPES, blockMaterials, visualBlocks, blockSize, gridSize, maxHeight, clock, characters, worldTime, DAY_DURATION, nextCharacterId, edgeMaterial, updateWorldLighting, onWindowResize, drawMinimap, animate, spawnCharacter, findValidSpawn, toScreenPosition, setWorldObjects, setDEBUG_MODE, setTreeSpawnRate, setFruitSpawnRate, setStoneSpawnRate, setCaveSpawnRate, setLeafSpawnRate } from './world.js';
import { Character } from './character.js';
import { PerlinNoise } from './utils.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- Global variables, Three.js initialization, UI events, loops, etc. ---



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

        const renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true });
        renderer.setSize(gameCanvas.width, gameCanvas.height, false);
        renderer.setPixelRatio(window.devicePixelRatio);

        minimapCanvas.width = 96;
        minimapCanvas.height = 96;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(gridSize / 2, 2, gridSize / 2);

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
        // Redraw sidebar if function exists in window
        if (window.renderCharacterList) window.renderCharacterList();
        // Sidebar auto-update interval is managed on sidebar.js side

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

        setupTelemetryManagerPanel();

        // Setup resource generation sliders
        setupResourceSliders();

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

    if (!startBtn || !stopBtn || !downloadBtn || !status) return;

    const renderStatus = () => {
        const telemetry = window.__simTelemetry;
        const sampleCount = telemetry?.samples?.length || 0;
        const eventCount = telemetry?.events?.length || 0;
        const mode = window.simTestMode ? 'running' : 'idle';
        const auto = !!window.simTelemetryConfig?.autoDownloadOnStop;
        status.textContent = `Telemetry ${mode} | samples=${sampleCount} events=${eventCount} | autoDownload=${auto ? 'on' : 'off'}`;
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

    window.setInterval(renderStatus, 1000);
    renderStatus();
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
}

// Function to regenerate the world with new settings
function regenerateWorld() {
    // Clear existing world data and visual blocks
    worldData.clear();

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
        if (pos) spawnCharacter(pos);
    }

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
window.__simTelemetry = {
    startedAt: 0,
    endedAt: 0,
    samples: [],
    events: [],
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
        this.samples.push(sample);
    },
    addEvent(evt) {
        if (!evt) return;
        if (this.events.length >= window.simTelemetryConfig.maxEvents) {
            this.counters.droppedEvents++;
            return;
        }
        this.events.push(evt);
    },
    snapshotMeta() {
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
                movingReplanStallMs: window.movingReplanStallMs,
                pathOccupancyLookahead: window.pathOccupancyLookahead,
                maxActionCooldown: window.maxActionCooldown,
                recoverActionCooldown: window.recoverActionCooldown
            }
        };
    },
    exportObject() {
        return {
            meta: this.snapshotMeta(),
            samples: this.samples,
            events: this.events
        };
    },
    reset() {
        this.startedAt = Date.now();
        this.endedAt = 0;
        this.samples = [];
        this.events = [];
        this.counters = { droppedSamples: 0, droppedEvents: 0 };
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
    const shouldAutoDownload = (opts.autoDownloadOnStop !== undefined)
        ? !!opts.autoDownloadOnStop
        : !!window.simTelemetryConfig.autoDownloadOnStop;
    if (shouldAutoDownload) {
        const prefix = (opts.fileNamePrefix && typeof opts.fileNamePrefix === 'string')
            ? opts.fileNamePrefix.trim()
            : window.simTelemetryConfig.fileNamePrefix;
        const fileName = `${prefix || 'telemetry'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const saved = window.downloadTelemetryJSON(fileName);
        console.log('[Telemetry] auto-downloaded', saved);
        return saved;
    }
    return null;
};

window.getTelemetryJSON = function getTelemetryJSON(pretty = true) {
    return JSON.stringify(window.__simTelemetry.exportObject(), null, pretty ? 2 : 0);
};

window.downloadTelemetryJSON = function downloadTelemetryJSON(fileName = null) {
    const safeName = fileName || `telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const blob = new Blob([window.getTelemetryJSON(true)], { type: 'application/json' });
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
