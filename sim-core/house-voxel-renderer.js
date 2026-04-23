/**
 * house-voxel-renderer.js
 *
 * Voxel-style visual replacements for house block types.
 * Returns THREE.Mesh (walls) or THREE.Group (roofs) with a unique merged
 * geometry per block so disposal via removeVisual() is always safe.
 *
 * API:
 *   buildHouseWallMesh(material, x, y, z, isVisible)   → THREE.Mesh
 *   buildStoneWallMesh(material, x, y, z, isVisible)   → THREE.Mesh
 *   buildHouseRoofGroup(material, x, y, z, isVisible)  → THREE.Group
 *   buildDarkRoofGroup(material, x, y, z, isVisible)   → THREE.Group
 */

import * as THREE from 'three';

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
