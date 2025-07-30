import { generateTerrain, addBlock, removeBlock, findGroundY, isSafeSpot, worldData, BLOCK_TYPES, ITEM_TYPES, blockMaterials, visualBlocks, blockSize, gridSize, maxHeight, clock, characters, worldTime, DAY_DURATION, nextCharacterId, edgeMaterial, updateWorldLighting, onWindowResize, drawMinimap, animate, spawnCharacter, findValidSpawn, toScreenPosition, setWorldObjects, setDEBUG_MODE } from './world.js';
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
