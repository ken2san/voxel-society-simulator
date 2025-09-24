import { generateTerrain, addBlock, removeBlock, findGroundY, isSafeSpot, worldData, BLOCK_TYPES, ITEM_TYPES, blockMaterials, visualBlocks, blockSize, gridSize, maxHeight, clock, characters, worldTime, DAY_DURATION, nextCharacterId, edgeMaterial, updateWorldLighting, onWindowResize, drawMinimap, animate, spawnCharacter, findValidSpawn, toScreenPosition, setWorldObjects, setDEBUG_MODE, setTreeSpawnRate, setFruitSpawnRate, setStoneSpawnRate, setCaveSpawnRate, setLeafSpawnRate } from './world.js';
import { Character } from './character.js';
import { PerlinNoise } from './utils.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- グローバル変数・Three.js初期化・UIイベント・ループなど ---



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

        // --- 調査用: relationships, affinity, groupId/role のログ出力 ---
        console.log('=== relationships size ===');
        characters.forEach(c => console.log(`id:${c.id} relSize:${c.relationships.size}`));
        console.log('=== affinity values ===');
        characters.forEach(c => console.log(`id:${c.id} affinities:`, Array.from(c.relationships.values())));
        // グループ検出も一度呼んでgroupId/roleを確認
        Character.detectGroupsAndElectLeaders(characters);
        console.log('=== groupId/role ===');
        characters.forEach(c => console.log(`id:${c.id} groupId:${c.groupId} role:${c.role}`));

        // Make characters array available globally for sidebar.js
        window.characters = characters;
        // サイドバーを再描画（関数がwindowにあれば）
        if (window.renderCharacterList) window.renderCharacterList();
        // サイドバーの自動更新intervalはsidebar.js側で管理

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

        animate();
    } catch (error) { console.error("Initialization Error:", error); }
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

// --- デバッグ用: いつでもグループ状態を確認できるグローバル関数 ---
window.logGroupStatus = function() {
    Character.detectGroupsAndElectLeaders(characters);
    console.log('=== groupId/role (on demand) ===');
    characters.forEach(c => console.log(`id:${c.id} groupId:${c.groupId} role:${c.role}`));
};

// Global runtime tuning defaults (can be overridden in DevTools)
window.pathValidateLookahead = window.pathValidateLookahead || 8;
window.recentDigAllowAfterBfsFailCount = window.recentDigAllowAfterBfsFailCount || 1;
