/**
 * snow-system.js
 *
 * A lightweight THREE.Points-based snowfall effect.
 * Active only during Winter (season phase 0.75–1.0), with smooth fade-in/out.
 * Respects window.showEffects === false.
 *
 * Design constraints:
 *  - Single draw call: one THREE.Points object, 800 particles.
 *  - No per-frame heap allocation: positions reused via DynamicDrawUsage.
 *  - Particles recycle when they fall below ground, repositioning around camera.
 */

import * as THREE from 'three';

const SNOW_COUNT = 800;
const SPREAD_XZ  = 36;   // particle spawn area ±18 units in X and Z
const SPAWN_Y    = 8;    // height above y=0 where particles spawn
const RECYCLE_Y  = -1;   // recycle below this Y

export function createSnowSystem(scene) {
    const positions = new Float32Array(SNOW_COUNT * 3);
    const speeds    = new Float32Array(SNOW_COUNT);   // fall speed u/s
    const swayOff   = new Float32Array(SNOW_COUNT);   // per-particle sway phase offset

    for (let i = 0; i < SNOW_COUNT; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * SPREAD_XZ;
        positions[i * 3 + 1] = Math.random() * SPAWN_Y;
        positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD_XZ;
        speeds[i]    = 1.0 + Math.random() * 2.4;   // 1.0 – 3.4 u/s
        swayOff[i]   = Math.random() * Math.PI * 2;
    }

    const geo     = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);

    const mat = new THREE.PointsMaterial({
        color:           0xddeeff,
        size:            0.20,
        sizeAttenuation: true,
        transparent:     true,
        opacity:         0.88,
        depthWrite:      false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    scene.add(points);

    let sysTime = 0;

    return {
        /**
         * Call every frame from animate().
         * @param {number} deltaTime   seconds since last frame
         * @param {number} phase       window.currentSeasonInfo.phase (0–1)
         * @param {number} amplitude   season amplitude (0 = seasons off)
         * @param {boolean} effectsOn  window.showEffects !== false
         */
        update(deltaTime, phase, amplitude, effectsOn) {
            // Compute winter intensity: 0 outside winter, 0→1→0 across phase 0.75–1.0
            // Also returns 0 when seasons are disabled (amplitude=0).
            let intensity = 0;
            if (amplitude > 0 && effectsOn) {
                if (phase >= 0.75) {
                    const t = (phase - 0.75) / 0.25;  // 0 → 1 over winter
                    // Bell-curve: peak at t=0.5 (mid-winter), fade edges
                    intensity = Math.min(1, Math.sin(t * Math.PI));
                }
            }

            const visible = intensity > 0.01;
            points.visible = visible;
            mat.opacity = 0.88 * intensity;

            if (!visible) return;

            sysTime += deltaTime;

            // Centre spawn area on camera XZ if available, else world centre
            const camX = (typeof window !== 'undefined' && window._simCamera)
                ? window._simCamera.position.x : 0;
            const camZ = (typeof window !== 'undefined' && window._simCamera)
                ? window._simCamera.position.z : 0;

            const pos = positions;
            for (let i = 0; i < SNOW_COUNT; i++) {
                const i3 = i * 3;

                // Fall
                pos[i3 + 1] -= speeds[i] * deltaTime;

                // Gentle wind sway on X
                pos[i3] += Math.sin(sysTime * 0.7 + swayOff[i]) * 0.010;

                // Recycle to top when below ground
                if (pos[i3 + 1] < RECYCLE_Y) {
                    pos[i3]     = camX + (Math.random() - 0.5) * SPREAD_XZ;
                    pos[i3 + 1] = SPAWN_Y + Math.random() * 2;
                    pos[i3 + 2] = camZ + (Math.random() - 0.5) * SPREAD_XZ;
                }
            }

            posAttr.needsUpdate = true;
        },

        dispose() {
            scene.remove(points);
            geo.dispose();
            mat.dispose();
        },
    };
}
