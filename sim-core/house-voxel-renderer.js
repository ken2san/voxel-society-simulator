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

// ── Color palettes (voxelchar04-style) ───────────────────────────────────────
// Wall: white/cream base + ~12% brick accent
const WALL_PALETTE = {
    wood:  { base: [0xecf0f1, 0xe8e0d4, 0xf5f0e8, 0xddd8cc], brick: 0xc0392b },
    stone: { base: [0xa0b4c4, 0x8a9aa8, 0xb4c4d4, 0x7a8a98], brick: 0x607868 },
};
// Roof: dark navy checkerboard (voxelchar04: 0x2c3e50 / 0x1a252f)
const ROOF_PALETTE = {
    wood:  [0x2c3e50, 0x1a252f],
    stone: [0x3a4a5a, 0x25333e],
};
// Chimney: medium grey (voxelchar04: 0x95a5a6)
const CHIMNEY_COLOR = {
    wood:  0x95a5a6,
    stone: 0x607888,
};
// Door: grey slab (voxelchar04: 0x7f8c8d)
const DOOR_COLOR = {
    wood:  0x7f8c8d,
    stone: 0x354050,
};
// Window: warm yellow glow (voxelchar04: 0xf1c40f)
const WINDOW_COLOR = {
    wood:  0xf1c40f,
    stone: 0xc8e8ff,
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
// 6×5×6 hollow shell (1.32 × 1.10 × 1.32 units).
// White/cream base with ~12% random brick-red accents (voxelchar04-style).
//
// Front face (iz=0) features:
//   iy=4: full wall row (top)
//   iy=3: wall + door lintel accent above opening
//   iy=2: door opening (ix=1,2) + window glow (ix=4)
//   iy=1: door opening (ix=1,2) + window glow (ix=4)
//   iy=0: full wall row (threshold)
export function buildHouseWallGroup(type, x, y, z, isVisible) {
    const houseType = type.isStoneWall ? 'stone' : 'wood';
    const pal       = WALL_PALETTE[houseType];   // { base: [...], brick }
    const doorCol   = DOOR_COLOR[houseType];
    const winCol    = WINDOW_COLOR[houseType];
    const rng       = makeRng(x, y, z);

    const voxels = [];
    for (let ix = 0; ix < WG; ix++) {
        for (let iy = 0; iy < WGH; iy++) {
            for (let iz = 0; iz < WG; iz++) {
                // Hollow shell
                if (ix > 0 && ix < WG-1 && iy > 0 && iy < WGH-1 && iz > 0 && iz < WG-1) continue;

                // Door opening: front face, center 2 cols, rows 1-2
                if (iz === 0 && ix >= 1 && ix <= 2 && iy >= 1 && iy <= 2) continue;

                // Feature voxels on front face
                const isDoorLintel = iz === 0 && ix >= 1 && ix <= 2 && iy === 3;
                const isWindow     = iz === 0 && ix >= 4 && iy >= 1 && iy <= 2;

                let color;
                if (isDoorLintel) {
                    color = doorCol;
                } else if (isWindow) {
                    color = winCol;
                } else {
                    // White base + 12% brick accent
                    const r = rng();
                    color = r < 0.12 ? pal.brick : pal.base[Math.floor(rng() * pal.base.length)];
                }

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
// GABLED ROOF (voxelchar04-style): tapers in X only, full depth in Z.
// 4 layers from bottom:
//   layer 0: 7 wide × 7 deep  (base, eave)
//   layer 1: 5 wide × 7 deep
//   layer 2: 3 wide × 7 deep
//   layer 3: 1 wide × 7 deep  (ridge line running front-to-back)
// Dark navy checkerboard (voxelchar04: 0x2c3e50 / 0x1a252f).
// Chimney: 2×2 grey stack sits on the ridge near one end.
export function buildHouseRoofGroup(type, x, y, z, isVisible) {
    const houseType    = type.isDarkRoof ? 'stone' : 'wood';
    const [col0, col1] = ROOF_PALETTE[houseType];
    const chimCol      = CHIMNEY_COLOR[houseType];

    const STEPS = 4;
    const BASE_W = RG;          // 7 — width at base (X)
    const DEPTH  = RG;          // 7 — full depth (Z, unchanged per layer)
    const voxels = [];

    // Gabled layers
    for (let layer = 0; layer < STEPS; layer++) {
        const w    = BASE_W - layer * 2;          // 7 → 5 → 3 → 1
        const py   = (layer - (STEPS - 1) / 2) * RS;
        const xOff = (w - 1) / 2;
        const zOff = (DEPTH - 1) / 2;
        for (let ix = 0; ix < w; ix++) {
            for (let iz = 0; iz < DEPTH; iz++) {
                // Checkerboard on X+Z+layer (matching voxelchar04: (x+z+y)%2)
                const color = ((ix + iz + layer) % 2 === 0) ? col0 : col1;
                voxels.push({
                    x: (ix - xOff) * RS,
                    y: py,
                    z: (iz - zOff) * RS,
                    color,
                });
            }
        }
    }

    // Chimney: 2×2 grey, on the ridge (layer 3 = top), offset to one end
    const ridgeY = ((STEPS - 1) - (STEPS - 1) / 2) * RS;  // = 1.5 * RS
    const chimZc = ((DEPTH - 1) / 2 - 1.5) * RS;          // near +Z end of ridge
    for (let cy = 0; cy < 3; cy++) {
        for (let cx = 0; cx < 2; cx++) {
            for (let cz = 0; cz < 2; cz++) {
                voxels.push({
                    x: (cx - 0.5) * RS,
                    y: ridgeY + (cy + 1) * RS,
                    z: chimZc  + (cz - 0.5) * RS,
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
