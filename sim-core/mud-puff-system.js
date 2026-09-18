/**
 * mud-puff-system.js
 *
 * Ambient-only visual effect born from a feature-ideation exchange with Codex,
 * scoped down from an earlier "lingering footprint trail" idea to this: while
 * it's raining, and for a short grace period after it stops, characters
 * walking on wet ground (dirt/grass) occasionally kick up a small puff at
 * their feet. Puffs are brief, undirected, and carry no per-character
 * identity — the point is a deniable, ambiguous trace ("did two people meet
 * here, or just pass through a moment apart?"), not a readable footprint
 * trail. Never influences movement, AI, or terrain — pure decoration, same
 * spirit as snow/rain.
 *
 * Pool-of-meshes pattern mirrors world.js's house-smoke ambient effect (a
 * handful of individually-faded MeshBasicMaterial spheres) rather than a
 * single instanced Points buffer — the simplest way to give each puff its
 * own independent fade without a custom shader, and cheap at this scale
 * (MAX_PUFFS is intentionally small).
 */

import * as THREE from 'three';

const MAX_PUFFS = 24;
const PUFF_LIFETIME = 1.6; // seconds
const SPAWN_CHANCE_PER_CHECK = 0.12;
const WET_GRACE_SECONDS = 25; // ground still counts as "wet" this long after rain stops

export function createMudPuffSystem(scene) {
    const pool = [];
    for (let i = 0; i < MAX_PUFFS; i++) {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0x8a7358, transparent: true, opacity: 0, depthWrite: false })
        );
        mesh.visible = false;
        scene.add(mesh);
        pool.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0 });
    }

    let wetTimer = 0;

    function spawnAt(x, y, z) {
        // Reuse a dead slot, or steal whichever active puff is closest to dying.
        let slot = pool.find(p => p.life <= 0);
        if (!slot) slot = pool.reduce((oldest, p) => (p.life < oldest.life ? p : oldest), pool[0]);
        slot.life = PUFF_LIFETIME;
        slot.mesh.position.set(
            x + (Math.random() - 0.5) * 0.3,
            y + 0.05,
            z + (Math.random() - 0.5) * 0.3
        );
        slot.vx = (Math.random() - 0.5) * 0.15;
        slot.vy = 0.25 + Math.random() * 0.15;
        slot.vz = (Math.random() - 0.5) * 0.15;
        slot.mesh.scale.setScalar(0.6 + Math.random() * 0.3);
        slot.mesh.visible = true;
    }

    return {
        // isGroundWetAt(gridPos) -> boolean, supplied by world.js (has worldData/BLOCK_TYPES in scope)
        update(deltaTime, characters, isRaining, isGroundWetAt) {
            wetTimer = isRaining ? WET_GRACE_SECONDS : Math.max(0, wetTimer - deltaTime);
            const groundCouldBeWet = isRaining || wetTimer > 0;

            if (groundCouldBeWet && Array.isArray(characters)) {
                for (const c of characters) {
                    if (!c || c.state !== 'moving' || !c.mesh) continue;
                    if (Math.random() > SPAWN_CHANCE_PER_CHECK) continue;
                    if (!isGroundWetAt(c.gridPos)) continue;
                    spawnAt(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z);
                }
            }

            for (const p of pool) {
                if (p.life <= 0) continue;
                p.life -= deltaTime;
                if (p.life <= 0) {
                    p.mesh.visible = false;
                    continue;
                }
                const t = 1 - p.life / PUFF_LIFETIME;
                p.mesh.position.x += p.vx * deltaTime;
                p.mesh.position.y += p.vy * deltaTime;
                p.mesh.position.z += p.vz * deltaTime;
                p.mesh.material.opacity = 0.35 * (1 - t);
                p.mesh.scale.setScalar(0.6 + t * 0.5);
            }
        },

        dispose() {
            for (const p of pool) {
                scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
            }
            pool.length = 0;
        },
    };
}
