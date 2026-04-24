/**
 * well-renderer.js
 *
 * Builds a decorative stone-and-wood village well Three.Group.
 * Local origin is at the bottom-centre of the stone base.
 * Caller positions the group at (x+0.5, groundY+1.0, z+0.5) in world space.
 *
 * Layout (Y from bottom):
 *   0.00–0.36  stone ring (4 layers × 0.09u), 3×3 footprint hollow in centre
 *   0.36–0.91  two wooden posts at ±0.28 on X
 *   0.91       crossbeam
 *   hanging     rope + bucket centered between posts
 */

import * as THREE from 'three';

const STONE_COLORS = [0x78909c, 0x607d8b, 0x90a4ae, 0x546e7a, 0x8fa5b5];
const WOOD_COLORS  = [0x5d4037, 0x4e342e, 0x6d4c41, 0x795548];

export function buildWellGroup(phase = 0) {
    const group = new THREE.Group();

    // Seeded RNG so each well looks slightly unique
    let _s = ((Math.abs(phase * 9973) | 0) + 12345) >>> 0 | 1;
    const rng = () => {
        _s ^= _s << 13; _s ^= _s >> 17; _s ^= _s << 5;
        return (_s >>> 0) / 4294967295;
    };

    // ── Stone base: 3×3 ring, 4 layers high ──────────────────────────────────
    const SW = 0.27;   // stone block width in X/Z
    const SH = 0.09;   // stone layer height
    const STONE_LAYERS = 4;

    for (let sy = 0; sy < STONE_LAYERS; sy++) {
        for (let sx = 0; sx < 3; sx++) {
            for (let sz = 0; sz < 3; sz++) {
                if (sx === 1 && sz === 1) continue;  // hollow centre
                const col = STONE_COLORS[Math.floor(rng() * STONE_COLORS.length)];
                const geo = new THREE.BoxGeometry(SW - 0.012, SH - 0.008, SW - 0.012);
                const mat = new THREE.MeshLambertMaterial({ color: col });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(
                    (sx - 1) * SW,
                    sy * SH + SH / 2,
                    (sz - 1) * SW
                );
                group.add(mesh);
            }
        }
    }

    const wallTop = STONE_LAYERS * SH;  // 0.36

    // ── Wooden posts ──────────────────────────────────────────────────────────
    const POST_H  = 0.55;
    const POST_W  = 0.07;
    const POST_X  = 0.28;
    const postGeo = new THREE.BoxGeometry(POST_W, POST_H, POST_W);
    for (const side of [-1, 1]) {
        const mat  = new THREE.MeshLambertMaterial({ color: WOOD_COLORS[Math.floor(rng() * WOOD_COLORS.length)] });
        const post = new THREE.Mesh(postGeo, mat);
        post.position.set(side * POST_X, wallTop + POST_H / 2, 0);
        group.add(post);
    }

    const postTop = wallTop + POST_H;  // 0.91

    // ── Crossbeam ─────────────────────────────────────────────────────────────
    const beamGeo = new THREE.BoxGeometry(POST_X * 2 + POST_W, 0.065, 0.065);
    const beamMat = new THREE.MeshLambertMaterial({ color: WOOD_COLORS[Math.floor(rng() * WOOD_COLORS.length)] });
    const beam    = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, postTop - 0.033, 0);
    group.add(beam);

    // ── Rope ──────────────────────────────────────────────────────────────────
    const ROPE_LEN = 0.34;
    const ropeGeo  = new THREE.CylinderGeometry(0.012, 0.012, ROPE_LEN, 5);
    const ropeMat  = new THREE.MeshLambertMaterial({ color: 0xc8a870 });
    const rope     = new THREE.Mesh(ropeGeo, ropeMat);
    rope.position.set(0, postTop - 0.033 - ROPE_LEN / 2, 0);
    group.add(rope);

    // ── Bucket ────────────────────────────────────────────────────────────────
    const bucketGeo = new THREE.BoxGeometry(0.10, 0.10, 0.10);
    const bucketMat = new THREE.MeshLambertMaterial({ color: WOOD_COLORS[Math.floor(rng() * WOOD_COLORS.length)] });
    const bucket    = new THREE.Mesh(bucketGeo, bucketMat);
    bucket.position.set(0, postTop - 0.033 - ROPE_LEN - 0.05, 0);
    group.add(bucket);

    return group;
}
