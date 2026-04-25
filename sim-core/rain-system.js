/**
 * rain-system.js
 *
 * Two types of rainfall:
 *  - 'heavy'   土砂降り: dense fast drops, high wind, thunder, grey sky.
 *              Characters with homes retreat indoors (~70% chance).
 *  - 'drizzle' しっとり雨: sparse slow drops, minimal wind, no thunder, soft blue-grey sky.
 *              Only the most timid characters go inside (~25% chance).
 *
 * Exposes:
 *   window._isRaining  boolean
 *   window._rainType   'heavy' | 'drizzle' | null
 *   window._thunderFlash  0–1 per-frame flash magnitude (world.js reads this)
 *
 * Design: single draw call (one THREE.Points), material params are updated
 * per-frame to match current type — no second geometry needed.
 */

import * as THREE from 'three';
import { playSound } from './sound-system.js';

const RAIN_COUNT = (typeof window !== 'undefined' && window.__mobileOptimized) ? 500 : 1200;
const SPREAD_XZ  = 40;
const SPAWN_Y    = 10;
const RECYCLE_Y  = -1;

// Base fall speed; multiplied per-type each frame
const BASE_SPEED = 8.0;

// Event durations (seconds)
const HEAVY_MIN_S   = 20;  const HEAVY_MAX_S   = 60;   // shorter, intense
const DRIZZLE_MIN_S = 60;  const DRIZZLE_MAX_S = 150;  // longer, gentle
const PAUSE_MIN_S   = 60;  const PAUSE_MAX_S   = 180;

// Thunder timing (heavy only)
const THUNDER_MIN_S = 8;
const THUNDER_MAX_S = 30;

// Per-type visual parameters
const TYPE_PARAMS = {
    heavy: {
        size:         0.14,
        opacityScale: 0.60,
        speedMul:     1.00,
        windX:        1.40,
        color:        0x99bbee,  // steely blue-grey
    },
    drizzle: {
        size:         0.07,
        opacityScale: 0.28,
        speedMul:     0.32,
        windX:        0.20,
        color:        0xddeeff,  // soft pale blue
    },
};

export function createRainSystem(scene) {
    const positions = new Float32Array(RAIN_COUNT * 3);
    const speeds    = new Float32Array(RAIN_COUNT);  // per-particle speed base

    for (let i = 0; i < RAIN_COUNT; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * SPREAD_XZ;
        positions[i * 3 + 1] = Math.random() * SPAWN_Y;
        positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD_XZ;
        speeds[i] = BASE_SPEED * (0.85 + Math.random() * 0.30);
    }

    const geo     = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);

    const mat = new THREE.PointsMaterial({
        color:           0x99bbee,
        size:            0.14,
        sizeAttenuation: true,
        transparent:     true,
        opacity:         0,
        depthWrite:      false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    scene.add(points);

    // Event state
    let eventActive  = false;
    let currentType  = null;   // 'heavy' | 'drizzle' | null
    let eventTimer   = PAUSE_MIN_S + Math.random() * (PAUSE_MAX_S - PAUSE_MIN_S);
    let intensity    = 0;      // 0→1 fade
    let sysTime      = 0;

    // Thunder state (heavy only)
    let thunderTimer = THUNDER_MIN_S + Math.random() * (THUNDER_MAX_S - THUNDER_MIN_S);

    return {
        update(deltaTime, phase, amplitude, effectsOn) {
            sysTime += deltaTime;
            eventTimer -= deltaTime;

            // Active during Spring (0–0.25) and Summer (0.25–0.50)
            const seasonOk = amplitude > 0 && phase < 0.50;

            // Toggle event on/off; pick type when turning on
            if (eventTimer <= 0) {
                eventActive = !eventActive;
                if (eventActive) {
                    // 60% heavy, 40% drizzle
                    currentType = Math.random() < 0.60 ? 'heavy' : 'drizzle';
                    eventTimer  = currentType === 'heavy'
                        ? HEAVY_MIN_S   + Math.random() * (HEAVY_MAX_S   - HEAVY_MIN_S)
                        : DRIZZLE_MIN_S + Math.random() * (DRIZZLE_MAX_S - DRIZZLE_MIN_S);
                } else {
                    currentType = null;
                    eventTimer  = PAUSE_MIN_S + Math.random() * (PAUSE_MAX_S - PAUSE_MIN_S);
                }
            }

            const shouldRain = eventActive && seasonOk && effectsOn;
            const activeType = shouldRain ? currentType : null;

            // Publish globals
            if (typeof window !== 'undefined') {
                window._isRaining = shouldRain;
                window._rainType  = activeType;
            }

            // ── Thunder (heavy only) ──────────────────────────────────────
            if (typeof window !== 'undefined') {
                const prevFlash = window._thunderFlash || 0;
                window._thunderFlash = prevFlash > 0.01
                    ? prevFlash - deltaTime * 6   // fades in ~0.17 s
                    : 0;
            }
            if (shouldRain && currentType === 'heavy' && intensity > 0.60) {
                thunderTimer -= deltaTime;
                if (thunderTimer <= 0) {
                    thunderTimer = THUNDER_MIN_S + Math.random() * (THUNDER_MAX_S - THUNDER_MIN_S);
                    if (typeof window !== 'undefined') window._thunderFlash = 1.0;
                    playSound('thunder');
                }
            } else if (!shouldRain || currentType !== 'heavy') {
                // Ensure first post-start strike isn't immediate
                thunderTimer = Math.max(
                    thunderTimer,
                    THUNDER_MIN_S + Math.random() * (THUNDER_MAX_S - THUNDER_MIN_S) * 0.5
                );
            }

            // ── Fade intensity ────────────────────────────────────────────
            const targetIntensity = shouldRain ? 1 : 0;
            intensity += (targetIntensity - intensity) * Math.min(1, deltaTime * 1.0);

            const visible = intensity > 0.02;
            points.visible = visible;

            if (!visible) return;

            // ── Update material to match current type ─────────────────────
            const p = TYPE_PARAMS[currentType || 'drizzle'];
            mat.size    = p.size;
            mat.opacity = p.opacityScale * intensity;
            mat.color.setHex(p.color);

            const windX    = p.windX;
            const speedMul = p.speedMul;

            // ── Particle movement ─────────────────────────────────────────
            const camX = (typeof window !== 'undefined' && window._simCamera)
                ? window._simCamera.position.x : 0;
            const camZ = (typeof window !== 'undefined' && window._simCamera)
                ? window._simCamera.position.z : 0;

            const pos = positions;
            for (let i = 0; i < RAIN_COUNT; i++) {
                pos[i * 3]     += windX * deltaTime;
                pos[i * 3 + 1] -= speeds[i] * speedMul * deltaTime;

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
            if (typeof window !== 'undefined') {
                window._isRaining = false;
                window._rainType  = null;
            }
        },
    };
}
