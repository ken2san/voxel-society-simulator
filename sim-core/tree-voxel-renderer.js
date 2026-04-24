/**
 * tree-voxel-renderer.js
 *
 * Renders WOOD, LEAF, FRUIT, STONE, GRASS, and DIRT block types as voxelchar05-style meshes.
 * All blocks fit within the standard 1 game-unit cube.
 *
 * WOOD  → bark-textured cylindrical trunk slice   (WVS=0.14, R=2.5, 7 tall → 0.98u)
 * LEAF  → fuzzy green sphere cluster              (LVS=0.12, R=4.0        → 0.96u)
 * FRUIT → mini berry bush: stem + rounded crown   (FVS=0.10, R=3.5, cy=+1 → 0.90u)
 * STONE → craggy surface boulder                  (SVS=0.13, R=3.8        → 0.99u)
 * GRASS → vertex-colour box + 4 thin grass blades (single merged mesh, near-zero cost)
 * DIRT  → vertex-colour box with soil striation   (single merged mesh, near-zero cost)
 *
 * GRASS/DIRT deliberately avoid mini-voxel subdivision: terrain blocks are the
 * most numerous in the world and must stay at ≤1 mesh per block.
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

// Stone: grey palette with subtle variation + rare mineral streak
const STONE_BASE  = [0x78909c, 0x607d8b, 0x90a4ae, 0x546e7a, 0x8fa5b5];
const STONE_DARK  = [0x455a64, 0x37474f, 0x4a5f6e];
const STONE_VEIN  = [0xb0bec5, 0xcfd8dc, 0xeceff1];  // quartz/feldspar highlight

// Grass: green top + warm tan sides
const GRASS_TOP   = [0x4caf50, 0x43a047, 0x388e3c, 0x66bb6a, 0x558b2f];
const GRASS_SIDE  = [0x795548, 0x6d4c41, 0x8d6e63, 0x7b5e4e];
const GRASS_BLADE = [0x2e7d32, 0x388e3c, 0x1b5e20, 0x43a047];  // thin blade quads

// Dirt: warm brown with darker striation
const DIRT_BASE   = [0x966c4a, 0x8b5e3c, 0xa07850, 0x7a4f35, 0xb08060];
const DIRT_DARK   = [0x6d4c3a, 0x5d3d2a, 0x7a5040];  // darker soil pockets

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

// ── STONE block: craggy surface boulder ──────────────────────────────────────
// SVS=0.13, rough sphere R=3.8 with chipped faces, sits on block bottom half
// Sphere bottom at -R = -3.8 voxels → -0.494u from centre → rock sits on ground ✓
// Sphere top at +R = +0.494u from centre → 0.994u total → within 1u ✓
// Rare vein (bright) voxels (~3%) for mineral sparkle
const SVS = 0.13;
const SVI = SVS * 0.93;

export function buildStoneGroup(type, x, y, z, isVisible) {
    const rng    = makeRng(x, y, z);
    const voxels = [];
    // Slight position variety – shift the boulder left/right/forward/back a little
    const offX = (rng() - 0.5) * 0.12;
    const offZ = (rng() - 0.5) * 0.12;

    const R = 3.8;
    // Squash the sphere slightly vertically (looks more rock-like, less ball-like)
    const SY = 0.78;

    for (let iy = -4; iy <= 4; iy++) {
        for (let ix = -5; ix <= 5; ix++) {
            for (let iz = -5; iz <= 5; iz++) {
                const d = Math.sqrt(ix * ix + (iy / SY) * (iy / SY) + iz * iz);
                if (d >= R) continue;

                // Chip out ~8% of voxels for rough, craggy surface
                if (d > R - 1.0 && rng() > 0.60) continue;
                if (rng() > 0.95) continue;

                let col;
                if (rng() < 0.03) {
                    // Mineral vein highlight
                    col = STONE_VEIN[Math.floor(rng() * STONE_VEIN.length)];
                } else if (d > R - 1.5) {
                    // Outer shell: darker (shadow side exposed)
                    col = STONE_DARK[Math.floor(rng() * STONE_DARK.length)];
                } else {
                    col = STONE_BASE[Math.floor(rng() * STONE_BASE.length)];
                }
                voxels.push({ x: ix * SVS + offX, y: iy * SVS, z: iz * SVS + offZ, color: col });
            }
        }
    }

    return makeGroup(voxels, SVI, x, y, z, isVisible);
}

// ── GRASS block: vertex-coloured box + thin grass blades ─────────────────────
// Cost: 1 merged mesh = 1 box (6 faces) + 4 blade quads = 10 quads total.
// Per-vertex face colours: top=green, sides=tan/brown, bottom=dark.
// Grass blades: 2 crossing quads (1u tall, 0.6u wide) placed near top.
// RNG-seeded colours ensure no two adjacent blocks look identical.
export function buildGrassGroup(type, x, y, z, isVisible, hasBlock) {
    const rng = makeRng(x, y, z);

    // ── Box geometry with per-face vertex colours ──
    // 6 faces × 4 vertices, faces in same order as _FD: +X, -X, +Y, -Y, +Z, -Z
    const FACE_COLORS = [
        GRASS_SIDE[Math.floor(rng() * GRASS_SIDE.length)],  // +X
        GRASS_SIDE[Math.floor(rng() * GRASS_SIDE.length)],  // -X
        GRASS_TOP [Math.floor(rng() * GRASS_TOP.length)],   // +Y (top)
        0x4a3020,                                            // -Y (bottom, hidden)
        GRASS_SIDE[Math.floor(rng() * GRASS_SIDE.length)],  // +Z
        GRASS_SIDE[Math.floor(rng() * GRASS_SIDE.length)],  // -Z
    ];
    const hs = 0.5;
    const posArr = new Float32Array(6 * 4 * 3);
    const nrmArr = new Float32Array(6 * 4 * 3);
    const colArr = new Float32Array(6 * 4 * 3);
    const idxArr = new Uint32Array(6 * 6);

    for (let f = 0; f < 6; f++) {
        const fd  = _FD[f];
        const bri = _FB[f];
        const c   = FACE_COLORS[f];
        const cr  = Math.min(1, ((c >> 16) & 0xff) / 255 * bri);
        const cg  = Math.min(1, ((c >>  8) & 0xff) / 255 * bri);
        const cb  = Math.min(1, ( c        & 0xff) / 255 * bri);
        for (let v = 0; v < 4; v++) {
            const [fx, fy, fz] = fd.c[v];
            const vi = f * 4 + v;
            const pi = vi * 3;
            posArr[pi]   = fx * hs;  posArr[pi+1] = fy * hs;  posArr[pi+2] = fz * hs;
            nrmArr[pi]   = fd.n[0];  nrmArr[pi+1] = fd.n[1];  nrmArr[pi+2] = fd.n[2];
            colArr[pi]   = cr;       colArr[pi+1] = cg;        colArr[pi+2] = cb;
        }
        const iB = f * 6;
        const vB = f * 4;
        for (let k = 0; k < 6; k++) idxArr[iB + k] = vB + _FI[k];
    }

    const boxGeo = new THREE.BufferGeometry();
    boxGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    boxGeo.setAttribute('normal',   new THREE.BufferAttribute(nrmArr, 3));
    boxGeo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
    boxGeo.setIndex(new THREE.BufferAttribute(idxArr, 1));

    const mat  = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(boxGeo, mat);

    // ── Grass blades: 2 crossing quads, double-sided ──
    // Only place blades with 60% probability to avoid visual clutter on dense terrain
    const bladeMat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.3,
    });

    const BLADE_PROB = 0.60;
    const blades = [];
    if (rng() < BLADE_PROB) {
        // 2 crossing quad planes, each 0.55u wide × 0.35u tall, centred at top face
        const bw = 0.275;  // half-width
        const bh = 0.35;   // full height (above top face centre = y=+0.5)
        const bCol = GRASS_BLADE[Math.floor(rng() * GRASS_BLADE.length)];
        const bcr  = ((bCol >> 16) & 0xff) / 255;
        const bcg  = ((bCol >>  8) & 0xff) / 255;
        const bcb  = ( bCol        & 0xff) / 255;

        for (let q = 0; q < 2; q++) {
            const angle = (q === 0 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.4;
            const cos = Math.cos(angle) * bw;
            const sin = Math.sin(angle) * bw;
            // 4 verts: bottom-left, bottom-right, top-right, top-left
            const yBot = 0.5;             // sits on top of box
            const yTop = 0.5 + bh;
            // Slight splay at top (0.8× width at tip) for natural look
            const spread = 0.8;
            const bpa = new Float32Array([
                -cos,       yBot, -sin,
                 cos,       yBot,  sin,
                 cos*spread, yTop,  sin*spread,
                -cos*spread, yTop, -sin*spread,
            ]);
            const bca = new Float32Array([
                bcr, bcg, bcb,  bcr, bcg, bcb,
                bcr * 1.1, bcg * 1.1, bcb * 0.9,  // tip slightly brighter/yellower
                bcr * 1.1, bcg * 1.1, bcb * 0.9,
            ].map(v => Math.min(1, v)));
            const bna = new Float32Array(12).fill(0);
            for (let i = 1; i < 12; i += 3) bna[i] = 1;  // approximate upward normal
            const bia = new Uint16Array([0,1,2, 0,2,3]);

            const bg = new THREE.BufferGeometry();
            bg.setAttribute('position', new THREE.BufferAttribute(bpa, 3));
            bg.setAttribute('normal',   new THREE.BufferAttribute(bna, 3));
            bg.setAttribute('color',    new THREE.BufferAttribute(bca, 3));
            bg.setIndex(new THREE.BufferAttribute(bia, 1));
            blades.push(new THREE.Mesh(bg, bladeMat));
        }
    }

    const group = new THREE.Group();
    group.add(mesh);
    blades.forEach(b => group.add(b));
    // ── Step ledges: thin slab where this block is one step above a lower neighbor ──
    if (typeof hasBlock === 'function') {
        // SH: ledge height, SD: ledge depth (outward), EPS: z-fight avoidance gap
        const SH = 0.35, SD = 0.16, EPS = 0.006;
        const sc = GRASS_SIDE[1];
        const stepMat = new THREE.MeshLambertMaterial({
            color: new THREE.Color(((sc>>16)&0xff)/255*0.65, ((sc>>8)&0xff)/255*0.65, (sc&0xff)/255*0.65)
        });
        // py: bottom of slab is at local -0.5+EPS to avoid z-fight with lower block top
        // px/pz: inner face is at ±0.5+EPS to avoid z-fight with current block face
        const W = 1.0 - EPS * 2; // slightly narrower to avoid corner z-fighting
        const pyC = -0.5 + EPS + SH / 2;
        const stepDirs = [
            { dx:  1, dz:  0, gw: SD, gh: SH, gd: W, px:  0.5 + EPS + SD/2, py: pyC, pz: 0 },
            { dx: -1, dz:  0, gw: SD, gh: SH, gd: W, px: -0.5 - EPS - SD/2, py: pyC, pz: 0 },
            { dx:  0, dz:  1, gw: W, gh: SH, gd: SD, px: 0, py: pyC, pz:  0.5 + EPS + SD/2 },
            { dx:  0, dz: -1, gw: W, gh: SH, gd: SD, px: 0, py: pyC, pz: -0.5 - EPS - SD/2 },
        ];
        for (const { dx, dz, gw, gh, gd, px, py, pz } of stepDirs) {
            if (!hasBlock(x + dx, y, z + dz) && hasBlock(x + dx, y - 1, z + dz)) {
                const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), stepMat);
                stepMesh.position.set(px, py, pz);
                group.add(stepMesh);
            }
        }
    }
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.visible = isVisible;
    return group;
}

// ── DIRT block: vertex-coloured box with soil striation ───────────────────────
// Single box mesh, no extra geometry. Side/top faces get slightly randomised
// warm brown colours; darker horizontal "striation" bands at top and sides.
export function buildDirtGroup(type, x, y, z, isVisible, hasBlock) {
    const rng = makeRng(x, y, z);

    const FACE_COLORS = [
        DIRT_BASE[Math.floor(rng() * DIRT_BASE.length)],   // +X
        DIRT_BASE[Math.floor(rng() * DIRT_BASE.length)],   // -X
        DIRT_BASE[Math.floor(rng() * DIRT_BASE.length)],   // +Y
        DIRT_DARK[Math.floor(rng() * DIRT_DARK.length)],   // -Y (bottom)
        DIRT_BASE[Math.floor(rng() * DIRT_BASE.length)],   // +Z
        DIRT_BASE[Math.floor(rng() * DIRT_BASE.length)],   // -Z
    ];
    const hs = 0.5;
    const posArr = new Float32Array(6 * 4 * 3);
    const nrmArr = new Float32Array(6 * 4 * 3);
    const colArr = new Float32Array(6 * 4 * 3);
    const idxArr = new Uint32Array(6 * 6);

    for (let f = 0; f < 6; f++) {
        const fd  = _FD[f];
        const bri = _FB[f];
        const c   = FACE_COLORS[f];
        // Striation: 20% chance to darken individual vertex on side faces
        for (let v = 0; v < 4; v++) {
            const usesDark = (f !== 2 && f !== 3 && rng() < 0.20);
            const dc = usesDark ? DIRT_DARK[Math.floor(rng() * DIRT_DARK.length)] : c;
            const cr = Math.min(1, ((dc >> 16) & 0xff) / 255 * bri);
            const cg = Math.min(1, ((dc >>  8) & 0xff) / 255 * bri);
            const cb = Math.min(1, ( dc        & 0xff) / 255 * bri);
            const [fx, fy, fz] = fd.c[v];
            const vi = f * 4 + v;
            const pi = vi * 3;
            posArr[pi]   = fx * hs;  posArr[pi+1] = fy * hs;  posArr[pi+2] = fz * hs;
            nrmArr[pi]   = fd.n[0];  nrmArr[pi+1] = fd.n[1];  nrmArr[pi+2] = fd.n[2];
            colArr[pi]   = cr;       colArr[pi+1] = cg;        colArr[pi+2] = cb;
        }
        const iB = f * 6;
        const vB = f * 4;
        for (let k = 0; k < 6; k++) idxArr[iB + k] = vB + _FI[k];
    }

    const geo  = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(nrmArr, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
    geo.setIndex(new THREE.BufferAttribute(idxArr, 1));

    const mat   = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh  = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.add(mesh);
    // ── Step ledges ──
    if (typeof hasBlock === 'function') {
        const SH = 0.35, SD = 0.16, EPS = 0.006;
        const sc = DIRT_BASE[0];
        const stepMat = new THREE.MeshLambertMaterial({
            color: new THREE.Color(((sc>>16)&0xff)/255*0.60, ((sc>>8)&0xff)/255*0.60, (sc&0xff)/255*0.60)
        });
        const W = 1.0 - EPS * 2;
        const pyC = -0.5 + EPS + SH / 2;
        const stepDirs = [
            { dx:  1, dz:  0, gw: SD, gh: SH, gd: W, px:  0.5 + EPS + SD/2, py: pyC, pz: 0 },
            { dx: -1, dz:  0, gw: SD, gh: SH, gd: W, px: -0.5 - EPS - SD/2, py: pyC, pz: 0 },
            { dx:  0, dz:  1, gw: W, gh: SH, gd: SD, px: 0, py: pyC, pz:  0.5 + EPS + SD/2 },
            { dx:  0, dz: -1, gw: W, gh: SH, gd: SD, px: 0, py: pyC, pz: -0.5 - EPS - SD/2 },
        ];
        for (const { dx, dz, gw, gh, gd, px, py, pz } of stepDirs) {
            if (!hasBlock(x + dx, y, z + dz) && hasBlock(x + dx, y - 1, z + dz)) {
                const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), stepMat);
                stepMesh.position.set(px, py, pz);
                group.add(stepMesh);
            }
        }
    }
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.visible = isVisible;
    return group;
}
