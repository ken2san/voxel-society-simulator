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

const VS   = 0.235;   // mini-voxel size
const GRID = 4;       // voxels per axis per block

// ── Color palettes ────────────────────────────────────────────────────────────
const WALL_PALETTE = {
    wood:  [0xd8c39a, 0xc9b38a, 0xcfb990, 0xe0cba2, 0xb8a070],
    stone: [0x7b8a94, 0x6e7d87, 0x8a9aa4, 0x5e6d78, 0x8fa0ac],
};
const ROOF_PALETTE = {
    wood:  [0x6b4a2f, 0x5a3d26],   // checkerboard pair
    stone: [0x46515e, 0x3a444f],
};

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
    const hs = VS / 2;
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
            const fd = _FD[f];
            for (let v = 0; v < 4; v++) {
                const [fx, fy, fz] = fd.c[v];
                const vi = vB + f * 4 + v;
                const pi = vi * 3;
                pos[pi]   = fx * hs + px;  pos[pi+1] = fy * hs + py;  pos[pi+2] = fz * hs + pz;
                nrm[pi]   = fd.n[0];       nrm[pi+1] = fd.n[1];       nrm[pi+2] = fd.n[2];
                col[pi]   = cr;            col[pi+1] = cg;             col[pi+2] = cb;
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
// 4×4×4 hollow shell: only voxels on the outer surface of the cube.
// Uses seeded RNG for deterministic colour variation.
export function buildHouseWallGroup(type, x, y, z, isVisible) {
    const houseType = type.isStoneWall ? 'stone' : 'wood';
    const palette   = WALL_PALETTE[houseType];
    const rng       = makeRng(x, y, z);

    const voxels = [];
    for (let ix = 0; ix < GRID; ix++) {
        for (let iy = 0; iy < GRID; iy++) {
            for (let iz = 0; iz < GRID; iz++) {
                // Only outer shell
                if (ix > 0 && ix < GRID-1 && iy > 0 && iy < GRID-1 && iz > 0 && iz < GRID-1) continue;
                const color = palette[Math.floor(rng() * palette.length)];
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


// ── Geometry merger (each call produces a unique geometry — safe to dispose) ─

/**
 * @param {Array<{x,y,z,w,h,d}>} entries  Boxes in group-local space.
 * @returns {THREE.BufferGeometry}
 */
function mergeBoxEntries(entries) {
    const FACES = [
        { n: [ 1,0,0], v: [[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1],[ 1,-1, 1]] },
        { n: [-1,0,0], v: [[-1,-1, 1],[-1, 1, 1],[-1, 1,-1],[-1,-1,-1]] },
        { n: [ 0,1,0], v: [[-1, 1,-1],[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1]] },
        { n: [ 0,-1,0],v: [[-1,-1, 1],[-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1]] },
        { n: [ 0,0,1], v: [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1]] },
        { n: [ 0,0,-1],v: [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1]] },
    ];
    const IDX = [0,1,2,0,2,3];
    const n = entries.length;
    const posArr  = new Float32Array(n * 24 * 3);
    const normArr = new Float32Array(n * 24 * 3);
    const idxArr  = new Uint32Array(n * 36);

    for (let i = 0; i < n; i++) {
        const { x: px, y: py, z: pz, w, h, d } = entries[i];
        const hw = w / 2, hh = h / 2, hd = d / 2;
        const vBase = i * 24;
        for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            for (let v = 0; v < 4; v++) {
                const [fx, fy, fz] = face.v[v];
                const vi = vBase + f * 4 + v;
                const pi = vi * 3;
                posArr[pi]     = fx * hw + px;
                posArr[pi + 1] = fy * hh + py;
                posArr[pi + 2] = fz * hd + pz;
                normArr[pi]     = face.n[0];
                normArr[pi + 1] = face.n[1];
                normArr[pi + 2] = face.n[2];
            }
        }
        const iBase = i * 36;
        for (let f = 0; f < 6; f++) {
            const vFBase = vBase + f * 4;
            for (let k = 0; k < 6; k++) idxArr[iBase + f * 6 + k] = vFBase + IDX[k];
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(normArr, 3));
    geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
    return geo;
}

// ── Brick/stone patterns (group-local coords, centered at 0,0,0) ─────────────

// 8 sandy bricks, 3-row staggered pattern (row 1 has 2 visible bricks)
const HOUSE_WALL_BRICKS = (() => {
    const BW = 0.27, BH = 0.22, BD = 0.21;
    return [
        { x: -0.27, y: -0.22, z: 0, w: BW, h: BH, d: BD },
        { x:  0,    y: -0.22, z: 0, w: BW, h: BH, d: BD },
        { x:  0.27, y: -0.22, z: 0, w: BW, h: BH, d: BD },
        { x: -0.135,y:  0,    z: 0, w: BW, h: BH, d: BD },
        { x:  0.135,y:  0,    z: 0, w: BW, h: BH, d: BD },
        { x: -0.27, y:  0.22, z: 0, w: BW, h: BH, d: BD },
        { x:  0,    y:  0.22, z: 0, w: BW, h: BH, d: BD },
        { x:  0.27, y:  0.22, z: 0, w: BW, h: BH, d: BD },
    ];
})();

// 8 chunkier stone blocks
const STONE_WALL_BLOCKS = (() => {
    const SW = 0.30, SH = 0.24, SD = 0.23;
    return [
        { x: -0.30, y: -0.24, z: 0, w: SW, h: SH, d: SD },
        { x:  0,    y: -0.24, z: 0, w: SW, h: SH, d: SD },
        { x:  0.30, y: -0.24, z: 0, w: SW, h: SH, d: SD },
        { x: -0.15, y:  0,    z: 0, w: SW, h: SH, d: SD },
        { x:  0.15, y:  0,    z: 0, w: SW, h: SH, d: SD },
        { x: -0.30, y:  0.24, z: 0, w: SW, h: SH, d: SD },
        { x:  0,    y:  0.24, z: 0, w: SW, h: SH, d: SD },
        { x:  0.30, y:  0.24, z: 0, w: SW, h: SH, d: SD },
    ];
})();

// ── Wall builders ─────────────────────────────────────────────────────────────

export function buildHouseWallMesh(material, x, y, z, isVisible) {
    const geo  = mergeBoxEntries(HOUSE_WALL_BRICKS);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.visible = isVisible;
    return mesh;
}

export function buildStoneWallMesh(material, x, y, z, isVisible) {
    const geo  = mergeBoxEntries(STONE_WALL_BLOCKS);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.visible = isVisible;
    return mesh;
}

// ── Roof builders (Group of 3 stepped layers) ─────────────────────────────────
// Group is positioned at block base (x+0.5, y, z+0.5).
// Children have local Y so layers stack into a pyramid.
// block.position.y + 0.28 (smoke offset) lands in lower pyramid zone — fine.

function buildRoofGroup(layers, material, x, y, z, isVisible, rotY) {
    const group = new THREE.Group();
    for (const { ly, w, h, d } of layers) {
        const geo  = mergeBoxEntries([{ x: 0, y: ly, z: 0, w, h, d }]);
        const mesh = new THREE.Mesh(geo, material);
        group.add(mesh);
    }
    group.rotation.y = rotY;
    group.position.set(x + 0.5, y, z + 0.5);
    group.visible = isVisible;
    return group;
}

// Warm-toned house roof: taller pyramid (3 layers)
const HOUSE_ROOF_LAYERS = [
    { ly: 0.10, w: 0.86, h: 0.16, d: 0.86 },
    { ly: 0.28, w: 0.58, h: 0.18, d: 0.58 },
    { ly: 0.50, w: 0.26, h: 0.20, d: 0.26 },
];

// Dark stone roof: squatter, broader pyramid
const DARK_ROOF_LAYERS = [
    { ly: 0.08, w: 0.92, h: 0.13, d: 0.92 },
    { ly: 0.23, w: 0.64, h: 0.14, d: 0.64 },
    { ly: 0.38, w: 0.30, h: 0.15, d: 0.30 },
];

export function buildHouseRoofGroup(material, x, y, z, isVisible, variantSeed) {
    const rotY = (variantSeed % 4) * (Math.PI / 2);
    return buildRoofGroup(HOUSE_ROOF_LAYERS, material, x, y, z, isVisible, rotY);
}

export function buildDarkRoofGroup(material, x, y, z, isVisible, variantSeed) {
    const rotY = (variantSeed % 2) * (Math.PI / 2);
    return buildRoofGroup(DARK_ROOF_LAYERS, material, x, y, z, isVisible, rotY);
}
