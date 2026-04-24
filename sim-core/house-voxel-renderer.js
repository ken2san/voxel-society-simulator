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

// ── Wall: 5×5×5 voxel grid → 0.91 × 0.91 × 0.91 units (fits within 1-unit block)
// span = (WG-1)*WS + WI = 4*0.185 + 0.172 = 0.912u < 1.0u ✓
const WG   = 5;          // wall grid width & depth
const WGH  = 5;          // wall grid height
const WS   = 0.185;      // wall voxel grid spacing
const WI   = WS * 0.93;  // wall voxel inner size (7% hairline mortar)

// ── Roof: gabled 5-wide → 0.986u (hairline overhang, eave effect)
// span = (RG-1)*RS + RI = 4*0.20 + 0.186 = 0.986u ≈ 1.0u ✓
const RG   = 5;
const RS   = 0.20;
const RI   = RS * 0.93;

// Roof Y offset: shift roof group down so its bottom voxel sits flush on the wall top.
// wallTop (from wall group centre) = (WGH-1)/2*WS + WI/2
// roofBot (from roof group centre) = -(STEPS-1)/2*RS - RI/2  where STEPS=(RG+1)/2
// gap to close = 1.0 (adjacent grid cells) + roofBot - wallTop  → shift by negative of that
const ROOF_Y_SHIFT = (WGH - 1) / 2 * WS + WI / 2   // wall top rel. to wall centre  = 0.456
                   + (RG  - 1) / 4 * RS + RI / 2   // negated roof bottom           = 0.293
                   - 1.0;                           // one grid-unit gap             = -0.251

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
// 5×5×5 hollow shell (0.91u, fits within 1 game unit).
//
// Front face (iz=0) layout, ix=0..4 left→right, iy=0..4 bottom→top:
//   iy=4: W  W  W  W  W   (top)
//   iy=3: W  F  F  W  W   F=door lintel accent
//   iy=2: W  _  _  Wn W   _=door opening, Wn=window glow
//   iy=1: W  _  _  Wn W   _=door opening, Wn=window glow
//   iy=0: W  W  W  W  W   (threshold)
export function buildHouseWallGroup(type, x, y, z, isVisible) {
    const houseType = type.isStoneWall ? 'stone' : 'wood';
    const pal       = WALL_PALETTE[houseType];
    const doorCol   = DOOR_COLOR[houseType];
    const winCol    = WINDOW_COLOR[houseType];
    const rng       = makeRng(x, y, z);

    const voxels = [];
    for (let ix = 0; ix < WG; ix++) {
        for (let iy = 0; iy < WGH; iy++) {
            for (let iz = 0; iz < WG; iz++) {
                // Hollow shell
                if (ix > 0 && ix < WG-1 && iy > 0 && iy < WGH-1 && iz > 0 && iz < WG-1) continue;

                // Door opening: front face, ix=1,2, iy=1,2
                if (iz === 0 && ix >= 1 && ix <= 2 && iy >= 1 && iy <= 2) continue;

                // Feature voxels on front face
                const isDoorLintel = iz === 0 && ix >= 1 && ix <= 2 && iy === 3;
                const isWindow     = iz === 0 && ix === 3 && iy >= 1 && iy <= 2;

                let color;
                if (isDoorLintel) {
                    color = doorCol;
                } else if (isWindow) {
                    color = winCol;
                } else {
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
// GABLED ROOF: tapers in X only (5→3→1), full depth in Z.
// Total width 0.986u ≈ 1u (hairline eave overhang beyond 0.91u wall).
export function buildHouseRoofGroup(type, x, y, z, isVisible) {
    const houseType    = type.isDarkRoof ? 'stone' : 'wood';
    const [col0, col1] = ROOF_PALETTE[houseType];
    const chimCol      = CHIMNEY_COLOR[houseType];

    const STEPS  = (RG + 1) / 2;   // = 3  (RG=5, must be odd)
    const DEPTH  = RG;              // 5 — full Z depth per layer
    const voxels = [];

    // Gabled layers: width 5 → 3 → 1
    for (let layer = 0; layer < STEPS; layer++) {
        const w    = RG - layer * 2;
        const py   = (layer - (STEPS - 1) / 2) * RS;
        const xOff = (w - 1) / 2;
        const zOff = (DEPTH - 1) / 2;
        for (let ix = 0; ix < w; ix++) {
            for (let iz = 0; iz < DEPTH; iz++) {
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

    // Chimney: 2×2 grey, on the ridge (top layer), near +Z end
    const ridgeY = ((STEPS - 1) - (STEPS - 1) / 2) * RS;
    const chimZc = ((DEPTH - 1) / 2 - 1) * RS;
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
    group.position.set(x + 0.5, y + 0.5 + ROOF_Y_SHIFT, z + 0.5);
    group.visible = isVisible;
    return group;
}

// ── BED block: voxel mattress with pillow and wooden frame ────────────────────
// Bed sits low in the block (isBed: BoxGeometry height = 0.4u).
// BVS=0.12, frame is 7 wide × 11 long × 3 tall; mattress fill above frame.
// Total height: 3*BVS = 0.36u (frame) + 1 voxel padding → 0.48u from bottom → fits ✓
const BVS = 0.12;
const BVI = BVS * 0.93;

// Colour constants
const BED_FRAME  = [0x5d4037, 0x4e342e, 0x6d4c41];  // dark wood
const BED_MATT   = [0xf5f5dc, 0xfdf5e6, 0xfffacd, 0xfaebd7]; // warm cream mattress
const BED_SHEET  = [0xdce8f5, 0xc8ddf0, 0xbfd3ed];  // pale blue sheet
const BED_PILLOW = [0xffffff, 0xf0f0f0, 0xf8f8f8];  // white pillow

export function buildBedGroup(type, x, y, z, isVisible) {
    const rng    = makeRng(x, y, z);
    const voxels = [];

    // Layout in voxel grid (grid coordinates):
    //   X: -3..+3 (7 wide  = 7*BVS = 0.84u → centred)
    //   Z: -5..+5 (11 long = 11*BVS = 1.32u → truncated to 1u, fits since BVS small)
    //   Y: -4 = group centre offset to sit near block bottom
    // group.position.y = y+0.5, so block bottom is at y+0.0 = group centre −0.5
    // We want bed top ~0.38u → top voxel at group local Y = −0.12u → iy = −0.12/BVS ≈ −1

    const WX = 3;   // half-width  in voxels
    const LZ = 5;   // half-length in voxels
    const BASE_Y = -4; // bottom of frame in voxel grid (−4*BVS = −0.48u from centre)

    // Wooden frame: perimeter + floor, 2 voxels tall
    for (let iy = BASE_Y; iy <= BASE_Y + 1; iy++) {
        for (let ix = -WX; ix <= WX; ix++) {
            for (let iz = -LZ; iz <= LZ; iz++) {
                const onEdge = Math.abs(ix) === WX || Math.abs(iz) === LZ;
                if (!onEdge) continue;
                const col = BED_FRAME[Math.floor(rng() * BED_FRAME.length)];
                voxels.push({ x: ix * BVS, y: iy * BVS, z: iz * BVS, color: col });
            }
        }
    }

    // Headboard: +2 voxels tall at z = +LZ end
    for (let iy = BASE_Y + 2; iy <= BASE_Y + 4; iy++) {
        for (let ix = -WX; ix <= WX; ix++) {
            const col = BED_FRAME[Math.floor(rng() * BED_FRAME.length)];
            voxels.push({ x: ix * BVS, y: iy * BVS, z: LZ * BVS, color: col });
        }
    }

    // Mattress fill (inside frame, one layer above frame floor)
    const MATT_Y = BASE_Y + 2;
    for (let ix = -(WX-1); ix <= WX-1; ix++) {
        for (let iz = -(LZ-1); iz <= LZ-1; iz++) {
            // Bottom half: cream mattress
            const mCol = BED_MATT[Math.floor(rng() * BED_MATT.length)];
            voxels.push({ x: ix * BVS, y: MATT_Y * BVS, z: iz * BVS, color: mCol });
            // Top layer: sheet (blue-tinted)
            const sCol = iz < LZ - 2
                ? BED_SHEET[Math.floor(rng() * BED_SHEET.length)]
                : BED_MATT[Math.floor(rng() * BED_MATT.length)]; // foot: bare mattress
            voxels.push({ x: ix * BVS, y: (MATT_Y + 1) * BVS, z: iz * BVS, color: sCol });
        }
    }

    // Pillow: 3 wide × 2 deep, at head end (z = +LZ-1 to +LZ-2)
    const PIL_Y = MATT_Y + 2;
    for (let ix = -1; ix <= 1; ix++) {
        for (let iz = LZ - 3; iz <= LZ - 1; iz++) {
            const col = BED_PILLOW[Math.floor(rng() * BED_PILLOW.length)];
            voxels.push({ x: ix * BVS, y: PIL_Y * BVS, z: iz * BVS, color: col });
        }
    }

    const geo   = buildVoxelGeo(voxels, BVI);
    const mat   = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh  = new THREE.Mesh(geo, mat);

    const group = new THREE.Group();
    group.add(mesh);
    // Shift down so the bed sits at block bottom (same offset as original isBed yOffset=0.2)
    group.position.set(x + 0.5, y + 0.2, z + 0.5);
    group.visible = isVisible;
    return group;
}
