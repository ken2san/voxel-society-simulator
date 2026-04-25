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

// ── Foundation palette (buried under wall, darker/earthier than wall) ────────
// One voxel layer below wall bottom (iy=-1), slightly wider footprint (FW=WG+2=7).
// world-y = (y+0.5) + (-1 - (WGH-1)/2)*WS = y+0.5 - 0.555 = y-0.055
// → just below the terrain surface, so it looks like the wall grows from the earth.
const FOUND_PALETTE = {
    wood:  [0x6e5c44, 0x5c4a34, 0x7c6a52, 0x4e3c2a],  // dark earthy sandstone
    stone: [0x3a4a58, 0x2e3d4a, 0x485868, 0x364454],  // dark blue-grey ashlar
};

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
    const winVoxels = [];  // window voxels rendered unlit (MeshBasicMaterial)

    // ── Foundation layer: sunk into terrain to anchor the building visually ───
    // iy=-1 → vy = (-1-(WGH-1)/2)*WS = -3*0.185 = -0.555 from group centre
    // world-y = (y+0.5)-0.555 = y-0.055 (just below the terrain surface)
    // FW = WG+2 = 7 → overhangs wall by one voxel on each side (flair effect)
    const foundPal = FOUND_PALETTE[houseType];
    const FW      = WG + 2;
    const foundY  = ((-1) - (WGH - 1) / 2) * WS;  // -0.555
    for (let fx = 0; fx < FW; fx++) {
        for (let fz = 0; fz < FW; fz++) {
            const vx = (fx - (FW - 1) / 2) * WS;
            const vz = (fz - (FW - 1) / 2) * WS;
            voxels.push({ x: vx, y: foundY, z: vz, color: foundPal[Math.floor(rng() * foundPal.length)] });
        }
    }

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

                const vx = (ix - (WG - 1) / 2) * WS;
                const vy = (iy - (WGH - 1) / 2) * WS;
                const vz = (iz - (WG - 1) / 2) * WS;

                if (isWindow) {
                    // Window goes into a separate unlit array so it always glows
                    winVoxels.push({ x: vx, y: vy, z: vz, color: winCol });
                } else {
                    let color;
                    if (isDoorLintel) {
                        color = doorCol;
                    } else {
                        const r = rng();
                        color = r < 0.12 ? pal.brick : pal.base[Math.floor(rng() * pal.base.length)];
                    }
                    voxels.push({ x: vx, y: vy, z: vz, color });
                }
            }
        }
    }

    const geo  = buildVoxelGeo(voxels, WI);
    const mat  = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);

    const group = new THREE.Group();
    group.add(mesh);

    // Window glow mesh: MeshBasicMaterial (unlit) so it stays bright at night
    if (winVoxels.length > 0) {
        const wGeo = buildVoxelGeo(winVoxels, WI);
        const wMat = new THREE.MeshBasicMaterial({ vertexColors: true });
        group.add(new THREE.Mesh(wGeo, wMat));
    }
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

// ── CHARGE STONE block: golem energy-charge crystal pedestal ─────────────────
// A low stone base with purple crystal spires and teal rune accents.
// CSV=0.13, base footprint 7×7 (2 layers tall); spires rise 6 voxels above base.
// Total height: ~8*CSV = 1.04u → capped at block top → fits ✓
const CSV = 0.13;
const CVI = CSV * 0.92;

// Colour constants
const CS_BASE   = [0x3d2f4e, 0x4a3a5c, 0x56437a];  // dark stone base
const CS_MAIN   = [0x7b4fcf, 0x8b5fd8, 0x6a3fbf];  // purple crystal body
const CS_BRIGHT = [0xb08aff, 0xc4a8ff, 0xa07aef];  // bright crystal tip
const CS_RUNE   = [0x44ddff, 0x66eeff, 0x22ccee];  // teal rune accent

export function buildBedGroup(type, x, y, z, isVisible) {
    const rng    = makeRng(x, y, z);
    const voxels = [];

    // Stone base platform: 7×7 footprint, 2 layers tall
    // BASE_Y = -4 → bottom of platform at y_local = -4*CSV = -0.52u from group centre
    // group.position.y = y+0.2, so platform bottom ≈ y+0.2-0.52 = y-0.32 (buried slightly)
    const BASE_Y = -4;

    // Outer anchor ring: 9×9, one layer deeper than main base.
    // world-y = y+0.2 + (BASE_Y-1)*CSV = y+0.2-0.65 = y-0.45 (deeper underground)
    // Wider than the base to create an earth-anchor "root" feel.
    for (let ix = -4; ix <= 4; ix++) {
        for (let iz = -4; iz <= 4; iz++) {
            if (Math.abs(ix) <= 3 && Math.abs(iz) <= 3) continue; // skip inner (covered by main base)
            const col = CS_BASE[Math.floor(rng() * CS_BASE.length)];
            voxels.push({ x: ix * CSV, y: (BASE_Y - 1) * CSV, z: iz * CSV, color: col });
        }
    }

    for (let iy = BASE_Y; iy <= BASE_Y + 1; iy++) {
        for (let ix = -3; ix <= 3; ix++) {
            for (let iz = -3; iz <= 3; iz++) {
                const col = CS_BASE[Math.floor(rng() * CS_BASE.length)];
                voxels.push({ x: ix * CSV, y: iy * CSV, z: iz * CSV, color: col });
            }
        }
    }

    // Rune cross on platform top surface
    const RUNE_Y = BASE_Y + 2;
    for (let ix = -2; ix <= 2; ix++) {
        const col = CS_RUNE[Math.floor(rng() * CS_RUNE.length)];
        voxels.push({ x: ix * CSV, y: RUNE_Y * CSV, z: 0, color: col });
    }
    for (let iz = -2; iz <= 2; iz++) {
        const col = CS_RUNE[Math.floor(rng() * CS_RUNE.length)];
        voxels.push({ x: 0, y: RUNE_Y * CSV, z: iz * CSV, color: col });
    }

    // Center spire: 7 voxels tall, tapers at tip
    const SPIRE_BASE = BASE_Y + 3;
    for (let iy = SPIRE_BASE; iy <= SPIRE_BASE + 6; iy++) {
        const tipFrac = (iy - SPIRE_BASE) / 6;
        const col = tipFrac > 0.55
            ? CS_BRIGHT[Math.floor(rng() * CS_BRIGHT.length)]
            : CS_MAIN[Math.floor(rng() * CS_MAIN.length)];
        voxels.push({ x: 0, y: iy * CSV, z: 0, color: col });
        // Widen base of spire (first 2 levels)
        if (iy <= SPIRE_BASE + 1) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const c = CS_MAIN[Math.floor(rng() * CS_MAIN.length)];
                    voxels.push({ x: dx * CSV, y: iy * CSV, z: dz * CSV, color: c });
                }
            }
        }
    }

    // Two smaller flanking spires
    const FLANK_COORDS = [[-2, -1], [2, 1]];
    for (const [fx, fz] of FLANK_COORDS) {
        for (let iy = SPIRE_BASE; iy <= SPIRE_BASE + 3; iy++) {
            const tipFrac = (iy - SPIRE_BASE) / 3;
            const col = tipFrac > 0.5
                ? CS_BRIGHT[Math.floor(rng() * CS_BRIGHT.length)]
                : CS_MAIN[Math.floor(rng() * CS_MAIN.length)];
            voxels.push({ x: fx * CSV, y: iy * CSV, z: fz * CSV, color: col });
        }
    }

    const geo   = buildVoxelGeo(voxels, CVI);
    const mat   = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh  = new THREE.Mesh(geo, mat);

    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(x + 0.5, y + 0.2, z + 0.5);
    group.visible = isVisible;
    return group;
}
