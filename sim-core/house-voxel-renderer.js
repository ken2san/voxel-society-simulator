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

// ── Wall: 6×5×6 voxel grid → 1.32 × 1.10 × 1.32 units (extends beyond 1-unit block)
const WG   = 6;          // wall grid width & depth
const WGH  = 5;          // wall grid height
const WS   = 0.22;       // wall voxel grid spacing
const WI   = WS * 0.93;  // wall voxel inner size (7% hairline mortar)

// ── Roof: 4-step pyramid, base 7 wide → 1.54 units (overhangs wall, RG must be odd)
const RG   = 7;
const RS   = 0.22;
const RI   = RS * 0.93;

// ── Color palettes ────────────────────────────────────────────────────────────
const WALL_PALETTE = {
    wood:  [0xf0daa8, 0xdcc070, 0xc8a850, 0xa88038, 0xe8cc90, 0xb49060],
    stone: [0xc0d0d8, 0x8fa8b8, 0x607888, 0x3e5060, 0xa0bcc8, 0x506878],
};
const ROOF_PALETTE = {
    wood:  [0xa06030, 0x4a2c18],
    stone: [0x6a7e90, 0x283040],
};
const CHIMNEY_COLOR = {
    wood:  0x3a2010,
    stone: 0x20303e,
};
const DOOR_COLOR = {
    wood:  0x4a2810,
    stone: 0x243040,
};
const WINDOW_COLOR = {
    wood:  0xffee88,   // warm glow
    stone: 0xc8e8ff,   // cool blue-white
};

// Per-face brightness (+X, -X, +Y, -Y, +Z, -Z)
const _FB = [0.88, 0.78, 1.30, 0.40, 1.00, 0.70];

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

function buildVoxelGeo(voxels, innerSize) {
    if (!voxels.length) return new THREE.BufferGeometry();
    const hs = innerSize / 2;
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
// 6×5×6 hollow shell, extends 0.16 units beyond the 1-unit game block.
//
// Front face (iz=0) layout, ix=0..5 left→right, iy=0..4 bottom→top:
//   iy=4: W  W  W  W  W  W
//   iy=3: W  F  F  W  W  W    F=lintel
//   iy=2: W  _  _  W  Wn W    _=door opening, Wn=window
//   iy=1: W  _  _  P  Wn W    P=door post accent
//   iy=0: W  W  W  W  W  W    threshold (no opening at floor)
export function buildHouseWallGroup(type, x, y, z, isVisible) {
    const houseType = type.isStoneWall ? 'stone' : 'wood';
    const palette   = WALL_PALETTE[houseType];
    const doorCol   = DOOR_COLOR[houseType];
    const winCol    = WINDOW_COLOR[houseType];
    const rng       = makeRng(x, y, z);

    const voxels = [];
    for (let ix = 0; ix < WG; ix++) {
        for (let iy = 0; iy < WGH; iy++) {
            for (let iz = 0; iz < WG; iz++) {
                // Hollow shell: skip fully interior voxels
                if (ix > 0 && ix < WG-1 && iy > 0 && iy < WGH-1 && iz > 0 && iz < WG-1) continue;

                // Door opening: front face (iz=0), ix=1,2 (center-left), iy=1,2
                if (iz === 0 && ix >= 1 && ix <= 2 && iy >= 1 && iy <= 2) continue;

                // Determine accent type on front face
                const isDoorLintel = iz === 0 && ix >= 1 && ix <= 2 && iy === 3;
                const isDoorPost   = iz === 0 && ix === 3 && iy >= 1 && iy <= 2;
                const isWindow     = iz === 0 && ix === 4 && iy >= 1 && iy <= 2;

                const color = isDoorLintel || isDoorPost ? doorCol
                            : isWindow                   ? winCol
                            : palette[Math.floor(rng() * palette.length)];

                voxels.push({
                    x: (ix - (WG - 1) / 2) * WS,
                    y: (iy - (WGH - 1) / 2) * WS,
                    z: (iz - (WG - 1) / 2) * WS,
                    color,
                });
            }
        }
    }

    const geo  = buildVoxelGeo(voxels, WI);
    const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);

    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.visible = isVisible;
    return group;
}

// ── Roof builder ──────────────────────────────────────────────────────────────
// 4-step pyramid (7→5→3→1 wide) + 2×2 chimney stack offset to +X+Z corner.
// Total width 1.54 overhangs the 1.32-wide wall.
export function buildHouseRoofGroup(type, x, y, z, isVisible) {
    const houseType  = type.isDarkRoof ? 'stone' : 'wood';
    const [col0, col1] = ROOF_PALETTE[houseType];
    const chimCol      = CHIMNEY_COLOR[houseType];

    const STEPS = (RG + 1) / 2;  // = 4  (requires odd RG)
    const voxels = [];

    // Pyramid
    for (let layer = 0; layer < STEPS; layer++) {
        const size   = RG - layer * 2;
        const py     = (layer - (STEPS - 1) / 2) * RS;
        const offset = (size - 1) / 2;
        for (let ix = 0; ix < size; ix++) {
            for (let iz = 0; iz < size; iz++) {
                const color = ((ix + iz + layer) % 2 === 0) ? col0 : col1;
                voxels.push({ x: (ix - offset) * RS, y: py, z: (iz - offset) * RS, color });
            }
        }
    }

    // Chimney: 2×2 stack, offset toward +X +Z corner, rising above pyramid peak
    const peakY  = ((STEPS - 1) - (STEPS - 1) / 2) * RS;  // top pyramid layer y
    const chimOX = RS * 1.2;
    const chimOZ = RS * 1.2;
    for (let cy = 0; cy < 3; cy++) {
        for (let cx = 0; cx < 2; cx++) {
            for (let cz = 0; cz < 2; cz++) {
                voxels.push({
                    x: chimOX + (cx - 0.5) * RS,
                    y: peakY  + (cy + 1)   * RS,
                    z: chimOZ + (cz - 0.5) * RS,
                    color: chimCol,
                });
            }
        }
    }

    const geo  = buildVoxelGeo(voxels, RI);
    const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);

    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.visible = isVisible;
    return group;
}
