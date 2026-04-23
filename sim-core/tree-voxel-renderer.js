/**
 * tree-voxel-renderer.js
 *
 * Renders WOOD, LEAF, and FRUIT block types as voxelchar05-style mini-voxel meshes.
 * All blocks fit within the standard 1 game-unit cube.
 *
 * WOOD  → bark-textured cylindrical trunk slice   (WVS=0.14, R=2.5, 7 tall → 0.98u)
 * LEAF  → fuzzy green sphere cluster              (LVS=0.12, R=4.0        → 0.96u)
 * FRUIT → mini berry bush: stem + rounded crown   (FVS=0.10, R=3.5, cy=+1 → 0.90u)
 *
 * Geometry is built identically to house-voxel-renderer (merged BufferGeometry,
 * per-vertex RGB, face-brightness array). RNG is seeded per grid position for
 * deterministic, position-stable appearance.
 */

import * as THREE from 'three';

// ── Per-face brightness (+X, -X, +Y, -Y, +Z, -Z) ─────────────────────────────
const _FB = [0.88, 0.78, 1.30, 0.40, 1.00, 0.70];

// ── Colour palettes (voxelchar05-inspired) ─────────────────────────────────────
const BARK_BASE = [0x5d4037, 0x4e342e, 0x6d4c41, 0x795548, 0x3e2723];
const BARK_EDGE = [0x3e2723, 0x2d1f14, 0x4e342e];

const LEAF_COLORS = [0x2e7d32, 0x388e3c, 0x1b5e20, 0x43a047, 0x33691e, 0x558b2f];

const FRUIT_BARK  = [0x6d4c41, 0x5d4037, 0x4e342e];
const BERRY_COLORS = [0xe53935, 0xd32f2f, 0xc62828, 0xff7043, 0xf4511e];
const BERRY_HL    = 0xff8a80;  // highlight voxel

// ── Seeded RNG (xorshift, same as house-voxel-renderer) ───────────────────────
function makeRng(x, y, z) {
    let s = (Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 1) >>> 0;
    return () => {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        return (s >>> 0) / 4294967295;
    };
}

// ── Geometry builder (identical to house-voxel-renderer.js) ───────────────────
const _FD = [
    { n: [ 1,0,0], c: [[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1],[ 1,-1, 1]] },
    { n: [-1,0,0], c: [[-1,-1, 1],[-1, 1, 1],[-1, 1,-1],[-1,-1,-1]] },
    { n: [ 0,1,0], c: [[-1, 1,-1],[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1]] },
    { n: [ 0,-1,0],c: [[-1,-1, 1],[-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1]] },
    { n: [ 0,0, 1],c: [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1]] },
    { n: [ 0,0,-1],c: [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1]] },
];
const _FI = [0,1,2,0,2,3];

function buildVoxelGeo(voxels, innerSize) {
    if (!voxels.length) return new THREE.BufferGeometry();
    const hs = innerSize / 2;
    const n  = voxels.length;
    const pos = new Float32Array(n * 24 * 3);
    const nrm = new Float32Array(n * 24 * 3);
    const col = new Float32Array(n * 24 * 3);
    const idx = new Uint32Array(n * 36);

    for (let i = 0; i < n; i++) {
        const { x: px, y: py, z: pz, color: c } = voxels[i];
        const cr = ((c >> 16) & 0xff) / 255;
        const cg = ((c >>  8) & 0xff) / 255;
        const cb = ( c        & 0xff) / 255;
        const vB = i * 24;
        for (let f = 0; f < 6; f++) {
            const fd  = _FD[f];
            const bri = _FB[f];
            const fr  = Math.min(1, cr * bri);
            const fg  = Math.min(1, cg * bri);
            const fb  = Math.min(1, cb * bri);
            for (let v = 0; v < 4; v++) {
                const [fx, fy, fz] = fd.c[v];
                const vi = vB + f * 4 + v;
                const pi = vi * 3;
                pos[pi]   = fx * hs + px;  pos[pi+1] = fy * hs + py;  pos[pi+2] = fz * hs + pz;
                nrm[pi]   = fd.n[0];       nrm[pi+1] = fd.n[1];       nrm[pi+2] = fd.n[2];
                col[pi]   = fr;            col[pi+1] = fg;             col[pi+2] = fb;
            }
        }
        const iB = i * 36;
        for (let f = 0; f < 6; f++) {
            const vFB = vB + f * 4;
            for (let k = 0; k < 6; k++) idx[iB + f*6 + k] = vFB + _FI[k];
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
}

function makeGroup(voxels, innerSize, x, y, z, isVisible) {
    const geo   = buildVoxelGeo(voxels, innerSize);
    const mat   = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh  = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.visible = isVisible;
    return group;
}

// ── WOOD block: cylindrical bark trunk section ────────────────────────────────
// WVS=0.14, R=2.5 → diameter ~0.70u, 7 voxels tall → 0.98u height
const WVS = 0.14;
const WVI = WVS * 0.93;

export function buildWoodGroup(type, x, y, z, isVisible) {
    const rng    = makeRng(x, y, z);
    const voxels = [];
    const R      = 2.5;

    for (let iy = -3; iy <= 3; iy++) {
        for (let ix = -3; ix <= 3; ix++) {
            for (let iz = -3; iz <= 3; iz++) {
                const d = Math.sqrt(ix * ix + iz * iz);
                if (d > R) continue;
                if (rng() < 0.04) continue;  // 4% random chip-out for texture

                const atEdge = d > R - 0.9;
                const palette = atEdge ? BARK_EDGE : BARK_BASE;
                const col = palette[Math.floor(rng() * palette.length)];
                voxels.push({ x: ix * WVS, y: iy * WVS, z: iz * WVS, color: col });
            }
        }
    }

    return makeGroup(voxels, WVI, x, y, z, isVisible);
}

// ── LEAF block: fuzzy green sphere cluster ────────────────────────────────────
// LVS=0.12, R=4.0 → ±0.48u total → fills block
// ~70% fill density; edge voxels thinned for natural look.
// World ambient animation (sway) is applied externally via group.position / group.rotation.
const LVS = 0.12;
const LVI = LVS * 0.93;

export function buildLeafGroup(type, x, y, z, isVisible) {
    const rng    = makeRng(x, y, z);
    const voxels = [];
    const R      = 4.0;

    for (let iy = -4; iy <= 4; iy++) {
        for (let ix = -4; ix <= 4; ix++) {
            for (let iz = -4; iz <= 4; iz++) {
                const d = Math.sqrt(ix * ix + iy * iy + iz * iz);
                if (d >= R) continue;

                // Feather outer shell
                if (d > R - 1.2 && rng() > 0.50) continue;
                // Random gaps for leaf spacing (~20%)
                if (rng() > 0.80) continue;

                const col = LEAF_COLORS[Math.floor(rng() * LEAF_COLORS.length)];
                voxels.push({ x: ix * LVS, y: iy * LVS, z: iz * LVS, color: col });
            }
        }
    }

    return makeGroup(voxels, LVI, x, y, z, isVisible);
}

// ── FRUIT block: mini berry bush ──────────────────────────────────────────────
// FVS=0.10, trunk stem y=-4..0 (0.50u below centre), crown sphere R=3.5 at cy=+1
// Top: (1+3.5)*0.10 = +0.45u from centre = block top 0.95u → within bounds ✓
// Width: ±3.5*0.10 = ±0.35u → 0.70u wide ✓
const FVS = 0.10;
const FVI = FVS * 0.93;

export function buildFruitGroup(type, x, y, z, isVisible) {
    const rng    = makeRng(x, y, z);
    const voxels = [];

    // Stem: single-voxel column, y=-4..0 (bottom of block to group centre)
    for (let iy = -4; iy <= 0; iy++) {
        const col = FRUIT_BARK[Math.floor(rng() * FRUIT_BARK.length)];
        voxels.push({ x: 0, y: iy * FVS, z: 0, color: col });
    }

    // Crown: sphere R=3.5 centred at cy=+1 (0.10u above group centre)
    const CY = 1;
    const CR = 3.5;

    for (let iy = -4; iy <= 4; iy++) {
        for (let ix = -4; ix <= 4; ix++) {
            for (let iz = -4; iz <= 4; iz++) {
                const d = Math.sqrt(ix * ix + iy * iy + iz * iz);
                if (d >= CR) continue;

                // Feather outer shell
                if (d > CR - 1.2 && rng() > 0.55) continue;
                // Random gaps (~15%)
                if (rng() > 0.85) continue;

                const worldY = iy + CY;

                // Outer shell → small chance to become a berry instead of leaf
                const isSurface = d > CR - 1.5 && iy >= -1;
                if (isSurface && rng() < 0.10) {
                    // Berry voxel
                    const berryCol = (rng() < 0.12)
                        ? BERRY_HL
                        : BERRY_COLORS[Math.floor(rng() * BERRY_COLORS.length)];
                    voxels.push({ x: ix * FVS, y: worldY * FVS, z: iz * FVS, color: berryCol });
                } else {
                    const col = LEAF_COLORS[Math.floor(rng() * LEAF_COLORS.length)];
                    voxels.push({ x: ix * FVS, y: worldY * FVS, z: iz * FVS, color: col });
                }
            }
        }
    }

    return makeGroup(voxels, FVI, x, y, z, isVisible);
}
