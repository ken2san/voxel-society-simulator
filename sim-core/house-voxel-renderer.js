/**
 * house-voxel-renderer.js
 *
 * Renders house block types as voxelchar04-style mini-voxel meshes.
 * Each block is a Three.Group with its own private materials (safe to dispose).
 *
 * HOUSE_WALL / STONE_WALL → 4×4×4 hollow shell of coloured mini-voxels
 * HOUSE_ROOF / DARK_ROOF  → 4-step stepped pyramid (4→3→2→1 wide)
 *
 * VS = 0.235  →  4 voxels × 0.235 = 0.94 ≈ 1 game-unit per block
 */

import * as THREE from 'three';

const VS       = 0.235;        // grid spacing: 4 × 0.235 ≈ 0.94 per block
const VS_INNER = VS * 0.96;    // actual voxel size (4% gap = hairline mortar, no see-through)
const GRID     = 4;

// ── Color palettes ───────────────────────────────────────────────────────────────
const WALL_PALETTE = {
    wood:  [0xf0daa8, 0xdcc070, 0xc8a850, 0xa88038, 0xe8cc90, 0xb49060],
    stone: [0xc0d0d8, 0x8fa8b8, 0x607888, 0x3e5060, 0xa0bcc8, 0x506878],
};
const ROOF_PALETTE = {
    wood:  [0xa06030, 0x4a2c18],
    stone: [0x6a7e90, 0x283040],
};
// Door frame: dark contrasting accent on the front face
const DOOR_FRAME = {
    wood:  0x4a2810,   // dark timber
    stone: 0x243040,   // dark slate
};

// Per-face brightness multipliers: top bright, bottom dark, sides varied
const _FB = [0.90, 0.80, 1.30, 0.45, 1.00, 0.75];  // matches _FD order

// ── Deterministic per-block RNG (xorshift, seeded by position) ────────────────
function makeRng(x, y, z) {
    let s = (Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 1) >>> 0;
    return () => {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        return (s >>> 0) / 4294967295;
    };
}

// ── Geometry builder: merged boxes with per-vertex RGB colour ─────────────────
const _FD = [
    { n: [ 1,0,0], c: [[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1],[ 1,-1, 1]] },
    { n: [-1,0,0], c: [[-1,-1, 1],[-1, 1, 1],[-1, 1,-1],[-1,-1,-1]] },
    { n: [ 0,1,0], c: [[-1, 1,-1],[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1]] },
    { n: [ 0,-1,0],c: [[-1,-1, 1],[-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1]] },
    { n: [ 0,0, 1],c: [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1]] },
    { n: [ 0,0,-1],c: [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1]] },
];
const _FI = [0,1,2,0,2,3];

function buildVoxelGeo(voxels) {
    if (!voxels.length) return new THREE.BufferGeometry();
    const hs = VS_INNER / 2;   // smaller than grid spacing → visible mortar gaps
    const n  = voxels.length;
    const pos  = new Float32Array(n * 24 * 3);
    const nrm  = new Float32Array(n * 24 * 3);
    const col  = new Float32Array(n * 24 * 3);
    const idx  = new Uint32Array(n * 36);

    for (let i = 0; i < n; i++) {
        const { x: px, y: py, z: pz, color: c } = voxels[i];
        const cr = ((c >> 16) & 0xff) / 255;
        const cg = ((c >>  8) & 0xff) / 255;
        const cb = ( c        & 0xff) / 255;
        const vB = i * 24;
        for (let f = 0; f < 6; f++) {
            const fd  = _FD[f];
            const bri = _FB[f];  // face brightness
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

// ── Wall builder ──────────────────────────────────────────────────────────────
// 4×4×4 outer shell with a door opening on the −Z face (iz=0).
//
// Front face (iz=0) layout (iy 0=bottom, 3=top):
//   [ W  .  .  W ]  iy=3  (top: full)
//   [ W  F  F  W ]  iy=2  (lintel + side posts)
//   [ P  _  _  P ]  iy=1  (door side posts; _ = opening)
//   [ P  _  _  P ]  iy=0  (door side posts; _ = opening)
//
//  W=wall, F=door-frame accent, P=post accent, _=door opening (no voxel)
export function buildHouseWallGroup(type, x, y, z, isVisible) {
    const houseType  = type.isStoneWall ? 'stone' : 'wood';
    const palette    = WALL_PALETTE[houseType];
    const frameColor = DOOR_FRAME[houseType];
    const rng        = makeRng(x, y, z);

    const voxels = [];
    for (let ix = 0; ix < GRID; ix++) {
        for (let iy = 0; iy < GRID; iy++) {
            for (let iz = 0; iz < GRID; iz++) {
                // Only outer shell
                if (ix > 0 && ix < GRID-1 && iy > 0 && iy < GRID-1 && iz > 0 && iz < GRID-1) continue;

                // Door opening: front face, inner 2 columns, lower 2 rows
                if (iz === 0 && ix >= 1 && ix <= 2 && iy <= 1) continue;

                // Door frame voxels on front face: lintel (iy=2, inner) + side posts (iy≤2, outer cols)
                const isFrame = iz === 0 && (
                    (iy === 2 && ix >= 1 && ix <= 2) ||   // lintel above door
                    (iy <= 2 && (ix === 0 || ix === 3))   // door-side posts
                );

                const color = isFrame
                    ? frameColor
                    : palette[Math.floor(rng() * palette.length)];

                voxels.push({
                    x: (ix - 1.5) * VS,
                    y: (iy - 1.5) * VS,
                    z: (iz - 1.5) * VS,
                    color,
                });
            }
        }
    }

    const geo  = buildVoxelGeo(voxels);
    const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);

    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.visible = isVisible;
    return group;
}

// ── Roof builder ──────────────────────────────────────────────────────────────
// 4-step pyramid: layers 4×4, 3×3, 2×2, 1×1 bottom-to-top.
// Checkerboard (ix+iz+layer)%2 between the 2 palette colours.
export function buildHouseRoofGroup(type, x, y, z, isVisible) {
    const houseType = type.isDarkRoof ? 'stone' : 'wood';
    const [col0, col1] = ROOF_PALETTE[houseType];

    const voxels = [];
    for (let layer = 0; layer < GRID; layer++) {
        const size   = GRID - layer;          // 4 → 3 → 2 → 1
        const py     = (layer - 1.5) * VS;    // evenly spaced in 1-unit block
        const offset = (size - 1) / 2;
        for (let ix = 0; ix < size; ix++) {
            for (let iz = 0; iz < size; iz++) {
                const color = ((ix + iz + layer) % 2 === 0) ? col0 : col1;
                voxels.push({
                    x: (ix - offset) * VS,
                    y: py,
                    z: (iz - offset) * VS,
                    color,
                });
            }
        }
    }

    const geo  = buildVoxelGeo(voxels);
    const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);

    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.visible = isVisible;
    return group;
}
