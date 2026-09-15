/**
 * ambient-creatures.js
 *
 * Ambient bird flock that circles lazily above the world.
 * Pure visual — no simulation state, no needs, no AI.
 * Birds fly in overlapping elliptical orbits at varying heights.
 *
 * Design constraints:
 *  - 7 birds × 5 meshes = 35 draw objects (reuse materials across all birds).
 *  - No per-frame heap allocation: positions/rotations updated in-place.
 *  - Lazy-init in animate() so scene is guaranteed to exist.
 *  - Respects window.showEffects === false.
 */

import * as THREE from 'three';

const BIRD_COUNT = 7;

// Silhouette palette: a few subtle colour variants for visual variety
const BIRD_COLORS = [
    0x2a2a3a,  // dark blue-grey (most common)
    0x3a2a2a,  // dark brown
    0x2a3a2a,  // dark green-grey
];

// Shared materials (created once, reused across all bird instances)
let _sharedMat = null;
function getBirdMat() {
    if (!_sharedMat) {
        _sharedMat = BIRD_COLORS.map(c => new THREE.MeshLambertMaterial({ color: c }));
    }
    return _sharedMat;
}

/**
 * Build a tiny bird Group.
 * Body is oriented along Z (forward axis = +Z).
 * Wings extend in ±X, rotate around Z pivot for flapping.
 *
 * @param {THREE.Material} mat
 * @returns {{ group, leftPivot, rightPivot }}
 */
function buildBirdMesh(mat) {
    const group = new THREE.Group();

    // Body: elongated along Z (forward direction)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.18), mat);
    group.add(body);

    // Head: small box at front of body
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), mat);
    head.position.set(0, 0.025, 0.11);
    group.add(head);

    // Tail: flat sliver at rear
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.07), mat);
    tail.position.set(0, -0.015, -0.13);
    group.add(tail);

    // Wing geometry (shared between left/right)
    const wingGeo = new THREE.BoxGeometry(0.14, 0.025, 0.08);

    // Left wing pivot at (-0.06, 0, 0)  → wing extends further in -X
    const leftPivot = new THREE.Group();
    leftPivot.position.set(-0.06, 0, 0);
    const leftWing = new THREE.Mesh(wingGeo, mat);
    leftWing.position.set(-0.07, 0, 0);  // offset from pivot center outward
    leftPivot.add(leftWing);
    group.add(leftPivot);

    // Right wing pivot at (+0.06, 0, 0)  → wing extends in +X
    const rightPivot = new THREE.Group();
    rightPivot.position.set(0.06, 0, 0);
    const rightWing = new THREE.Mesh(wingGeo, mat);
    rightWing.position.set(0.07, 0, 0);
    rightPivot.add(rightWing);
    group.add(rightPivot);

    return { group, leftPivot, rightPivot };
}

/**
 * @param {THREE.Scene} scene
 * @param {number} worldSize   the visible district's footprint (DISTRICT_CELL_SIZE,
 *                              e.g. 16) — NOT the total (possibly tiled-bigger) world,
 *                              since birds should stay within whichever one district
 *                              is currently being watched.
 * @param {number} [centerX]   active district center, defaults to worldSize/2
 * @param {number} [centerZ]
 */
export function createBirdSystem(scene, worldSize, centerX = worldSize / 2, centerZ = worldSize / 2) {
    const mats = getBirdMat();
    const birds = [];

    for (let i = 0; i < BIRD_COUNT; i++) {
        const mat = mats[i % mats.length];
        const { group, leftPivot, rightPivot } = buildBirdMesh(mat);

        // Orbit params: birds spread across the district in loose clusters
        const orbitRadius  = 3.5 + Math.random() * 5.5;   // 3.5–9 units from orbit center
        const orbitSpeed   = (0.18 + Math.random() * 0.22) * (Math.random() < 0.5 ? 1 : -1);  // CW or CCW
        const orbitPhase   = Math.random() * Math.PI * 2;
        const height       = 5.5 + Math.random() * 4.5;   // y 5.5–10
        const bobFreq      = 0.8 + Math.random() * 0.6;   // gentle altitude sine
        const bobAmp       = 0.18 + Math.random() * 0.18;
        const flapFreq     = 3.2 + Math.random() * 2.4;   // wing beats per second
        const flapAmp      = 0.55 + Math.random() * 0.25; // flap angle (radians)
        // Orbit center offset: spread across the district, biased toward middle.
        // Stored separately from oCx/oCz so recenter() can re-anchor the whole
        // flock to a new district center while preserving each bird's relative
        // spot in the flock.
        const offX = (Math.random() - 0.5) * worldSize * 0.7;
        const offZ = (Math.random() - 0.5) * worldSize * 0.7;
        const oCx = centerX + offX;
        const oCz = centerZ + offZ;

        // Stagger time so birds don't all flap in sync
        const t0 = Math.random() * 50;

        group.visible = true;
        scene.add(group);

        birds.push({ group, leftPivot, rightPivot, orbitRadius, orbitSpeed, orbitPhase, height, bobFreq, bobAmp, flapFreq, flapAmp, offX, offZ, oCx, oCz, t: t0 });
    }

    return {
        // Re-anchors the whole flock to a new district center (called on
        // district switch) — each bird keeps its offset within the flock, so
        // they move together rather than popping to identical positions.
        recenter(centerX, centerZ) {
            for (const b of birds) {
                b.oCx = centerX + b.offX;
                b.oCz = centerZ + b.offZ;
            }
        },
        update(deltaTime) {
            // Respect showEffects flag
            const show = typeof window === 'undefined' || window.showEffects !== false;

            for (const b of birds) {
                b.group.visible = show;
                if (!show) continue;

                b.t += deltaTime;
                const angle = b.t * b.orbitSpeed + b.orbitPhase;

                // Position along elliptical orbit
                const px = b.oCx + Math.cos(angle) * b.orbitRadius;
                const pz = b.oCz + Math.sin(angle) * b.orbitRadius;
                const py = b.height + Math.sin(b.t * b.bobFreq) * b.bobAmp;
                b.group.position.set(px, py, pz);

                // Face direction of travel.
                // With body along Z: group.rotation.y = angle gives correct heading
                // (velocity tangent is (-sin(a), 0, cos(a)) which is the +Z direction at rotation y=angle)
                b.group.rotation.y = angle;

                // Wing flap: both wings go up/down together.
                // leftPivot.rotation.z = +amp → left tip goes up (right-hand rule around Z, at x<0)
                // rightPivot.rotation.z = -amp → right tip goes up
                const flap = Math.sin(b.t * b.flapFreq) * b.flapAmp;
                b.leftPivot.rotation.z  =  flap;
                b.rightPivot.rotation.z = -flap;
            }
        },

        dispose() {
            for (const b of birds) {
                scene.remove(b.group);
                b.group.traverse(obj => {
                    if (obj.isMesh) {
                        obj.geometry?.dispose();
                        // materials are shared — do not dispose here
                    }
                });
            }
            birds.length = 0;
            if (_sharedMat) {
                _sharedMat.forEach(m => m.dispose());
                _sharedMat = null;
            }
        },
    };
}
