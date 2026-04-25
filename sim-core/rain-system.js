/**
 * rain-system.js
 *
 * Lightweight THREE.Points-based rainfall effect.
 * Active during Spring (phase 0.0–0.25) and Summer (0.25–0.50) with
 * random rain-event windows. Each rain event lasts 30–90 s sim-time.
 * Exposes window._isRaining (boolean) so AI and sound can react.
 *
 * Design constraints (same as snow-system.js):
 *  - Single draw call: one THREE.Points object, 1200 streaked particles.
 *  - No per-frame heap allocation: positions reused via DynamicDrawUsage.
 *  - Particles recycle when they fall below ground.
 *  - Respects window.showEffects === false.
 */

import * as THREE from 'three';
import { playSound } from './sound-system.js';

const RAIN_COUNT = 1200;
const SPREAD_XZ  = 40;
const SPAWN_Y    = 10;
const RECYCLE_Y  = -1;
const FALL_SPEED = 8.0;   // u/s — rain falls much faster than snow
const WIND_X     = 1.2;   // slight horizontal drift

// Rain event config (wall-clock seconds so tabs don't drift)
const EVENT_MIN_S  = 30;
const EVENT_MAX_S  = 90;
const PAUSE_MIN_S  = 60;
const PAUSE_MAX_S  = 180;

// Thunder: strikes occur 8–30 s apart once rain is established (intensity > 0.6)
const THUNDER_MIN_S = 8;
const THUNDER_MAX_S = 30;

export function createRainSystem(scene) {
    const positions = new Float32Array(RAIN_COUNT * 3);
    const speeds    = new Float32Array(RAIN_COUNT);

    for (let i = 0; i < RAIN_COUNT; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * SPREAD_XZ;
        positions[i * 3 + 1] = Math.random() * SPAWN_Y;
        positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD_XZ;
        speeds[i] = FALL_SPEED * (0.85 + Math.random() * 0.3);
    }

    const geo     = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);

    const mat = new THREE.PointsMaterial({
        color:           0xaaccff,
        size:            0.13,
        sizeAttenuation: true,
        transparent:     true,
        opacity:         0.55,
        depthWrite:      false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    scene.add(points);

    // Rain event state
    let eventActive  = false;
    let eventTimer   = PAUSE_MIN_S + Math.random() * (PAUSE_MAX_S - PAUSE_MIN_S);
    let intensity    = 0;   // current rendered opacity 0→1
    let sysTime      = 0;

    // Thunder state
    let thunderTimer = THUNDER_MIN_S + Math.random() * (THUNDER_MAX_S - THUNDER_MIN_S);
    // window._thunderFlash: 0=none, 0→1 peak, decays each frame; read by world.js sky blend

    return {
        /**
         * @param {number}  deltaTime   seconds since last frame
         * @param {number}  phase       window.currentSeasonInfo.phase (0–1)
         * @param {number}  amplitude   season amplitude (0 = seasons off)
         * @param {boolean} effectsOn   window.showEffects !== false
         */
        update(deltaTime, phase, amplitude, effectsOn) {
            sysTime += deltaTime;
            eventTimer -= deltaTime;

            // Rain only in Spring (0–0.25) and Summer (0.25–0.50)
            const seasonOk = amplitude > 0 && phase < 0.50;

            // Toggle events
            if (eventTimer <= 0) {
                eventActive = !eventActive;
                if (eventActive) {
                    eventTimer = EVENT_MIN_S + Math.random() * (EVENT_MAX_S - EVENT_MIN_S);
                } else {
                    eventTimer = PAUSE_MIN_S + Math.random() * (PAUSE_MAX_S - PAUSE_MIN_S);
                }
            }

            const shouldRain = eventActive && seasonOk && effectsOn;

            // Expose rain state globally so AI and sound can read it cheaply
            if (typeof window !== 'undefined') window._isRaining = shouldRain;

            // ── Thunder ─────────────────────────────────────────────────────
            // Only when rain is well-established (intensity > 0.6).
            // Decay any existing flash regardless of rain state.
            if (typeof window !== 'undefined') {
                const prevFlash = window._thunderFlash || 0;
                if (prevFlash > 0.01) {
                    window._thunderFlash = prevFlash - deltaTime * 6; // flash fades over ~0.17 s
                } else {
                    window._thunderFlash = 0;
                }
            }
            if (shouldRain && intensity > 0.6) {
                thunderTimer -= deltaTime;
                if (thunderTimer <= 0) {
                    thunderTimer = THUNDER_MIN_S + Math.random() * (THUNDER_MAX_S - THUNDER_MIN_S);
                    // Visual flash
                    if (typeof window !== 'undefined') window._thunderFlash = 1.0;
                    // Sound (gated by soundEnabled inside playSound)
                    playSound('thunder');
                }
            } else {
                // Drift timer when not raining so first strike after rain starts isn't instant
                thunderTimer = Math.max(
                    thunderTimer,
                    THUNDER_MIN_S + Math.random() * (THUNDER_MAX_S - THUNDER_MIN_S) * 0.5
                );
            }

            // Fade intensity
            const targetIntensity = shouldRain ? 1 : 0;
            intensity += (targetIntensity - intensity) * Math.min(1, deltaTime * 1.2);

            const visible = intensity > 0.02;
            points.visible = visible;
            mat.opacity    = 0.55 * intensity;

            if (!visible) return;

            const camX = (typeof window !== 'undefined' && window._simCamera)
                ? window._simCamera.position.x : 0;
            const camZ = (typeof window !== 'undefined' && window._simCamera)
                ? window._simCamera.position.z : 0;

            const pos = positions;
            for (let i = 0; i < RAIN_COUNT; i++) {
                pos[i * 3]     += WIND_X * deltaTime;
                pos[i * 3 + 1] -= speeds[i] * deltaTime;

                if (pos[i * 3 + 1] < RECYCLE_Y) {
                    pos[i * 3]     = camX + (Math.random() - 0.5) * SPREAD_XZ;
                    pos[i * 3 + 1] = SPAWN_Y + Math.random() * 2;
                    pos[i * 3 + 2] = camZ + (Math.random() - 0.5) * SPREAD_XZ;
                }
            }
            posAttr.needsUpdate = true;
        },

        dispose() {
            scene.remove(points);
            geo.dispose();
            mat.dispose();
            if (typeof window !== 'undefined') window._isRaining = false;
        },
    };
}
