/**
 * voxel-crowd-renderer.js
 *
 * Replaces the box-per-part InstancedMesh renderer with a voxel-mesh renderer.
 * Each character skin defines collectVoxels() → [{x,y,z,color,part}, ...] in
 * part-local coordinates (relative to the corresponding mesh pivot).
 *
 * Architecture:
 *   - Group voxels by (color, part) pair → one merged BufferGeometry per group
 *   - One InstancedMesh per (color, part), size = maxCount
 *   - Per frame: for each dirty character, write the part's world matrix as the
 *     instance matrix.  The merged geometry already encodes all voxel offsets.
 *   - Dirty detection: position / state change + animating-state flag.
 *
 * Result: ~4 000 setMatrixAt/frame for 200 characters (vs 32-part-box: 6 400).
 * Full per-part animation preserved (arms swing, head bobs, wings move, etc.)
 */

import * as THREE from 'three';
import { getActiveSkin } from '../character-skins.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const ZERO_M4 = new THREE.Matrix4().makeScale(0, 0, 0);

/** States that animate every frame (arms swing, head bob, etc.) */
const ANIM_STATES = new Set(['moving', 'socializing', 'working']);

// ── Part → character mesh accessor ───────────────────────────────────────────
const PART_MESH = {
    head:     c => c.head,
    body:     c => c.body,
    pelvis:   c => c.pelvis,
    armL:     c => c.leftArm,
    armR:     c => c.rightArm,
    forearmL: c => c.leftForearm,
    forearmR: c => c.rightForearm,
    legL:     c => c.leftThigh,
    legR:     c => c.rightThigh,
    shinL:    c => c.leftShin,
    shinR:    c => c.rightShin,
    footL:    c => c.leftFoot,
    footR:    c => c.rightFoot,
    wingUL:   c => c.leftWingUpper,
    wingUR:   c => c.rightWingUpper,
    wingLL:   c => c.leftWingLower,
    wingLR:   c => c.rightWingLower,
    halo:     c => c.halo,   // child of head
};

/** Parts that are children of char.head (not direct children of char.mesh) */
const HEAD_CHILD_PARTS = new Set(['halo']);

// ── Minimal manual box-geometry merger ────────────────────────────────────────
// Avoids an external three/addons dependency while staying 100% inline.
function mergeBoxes(positions, vs) {
    if (!positions.length) {
        return new THREE.BufferGeometry();
    }
    const hs = vs / 2;

    // 6 faces × 4 vertices. Vertices are CCW when seen from outside.
    const FACES = [
        { n: [ 1, 0, 0], c: [[ hs,-hs,-hs], [ hs, hs,-hs], [ hs, hs, hs], [ hs,-hs, hs]] },
        { n: [-1, 0, 0], c: [[-hs,-hs, hs], [-hs, hs, hs], [-hs, hs,-hs], [-hs,-hs,-hs]] },
        { n: [ 0, 1, 0], c: [[-hs, hs,-hs], [-hs, hs, hs], [ hs, hs, hs], [ hs, hs,-hs]] },
        { n: [ 0,-1, 0], c: [[-hs,-hs, hs], [-hs,-hs,-hs], [ hs,-hs,-hs], [ hs,-hs, hs]] },
        { n: [ 0, 0, 1], c: [[-hs,-hs, hs], [ hs,-hs, hs], [ hs, hs, hs], [-hs, hs, hs]] },
        { n: [ 0, 0,-1], c: [[ hs,-hs,-hs], [-hs,-hs,-hs], [-hs, hs,-hs], [ hs, hs,-hs]] },
    ];
    const FACE_IDX = [0, 1, 2, 0, 2, 3];

    const n       = positions.length;
    const posArr  = new Float32Array(n * 24 * 3);
    const normArr = new Float32Array(n * 24 * 3);
    const idxArr  = new Uint32Array(n * 36);

    for (let i = 0; i < n; i++) {
        const { x: px, y: py, z: pz } = positions[i];
        const vBase = i * 24;

        for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            for (let v = 0; v < 4; v++) {
                const p = face.c[v];
                const vi = vBase + f * 4 + v;
                const pi = vi * 3;
                posArr[pi]     = p[0] + px;
                posArr[pi + 1] = p[1] + py;
                posArr[pi + 2] = p[2] + pz;
                normArr[pi]     = face.n[0];
                normArr[pi + 1] = face.n[1];
                normArr[pi + 2] = face.n[2];
            }
        }

        const iBase = i * 36;
        for (let f = 0; f < 6; f++) {
            const vFaceBase = vBase + f * 4;
            for (let fi = 0; fi < 6; fi++) idxArr[iBase + f * 6 + fi] = vFaceBase + FACE_IDX[fi];
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(normArr, 3));
    geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
    return geo;
}

// ── VoxelCrowdRenderer ────────────────────────────────────────────────────────
export class VoxelCrowdRenderer {
    constructor(scene, maxCount = 200) {
        this._scene    = scene;
        this._max      = maxCount;
        this._groups   = [];  // [{part, im}]
        this._slotMap  = new Map();  // charId → slotIdx
        this._prevPos  = Array.from({ length: maxCount },
            () => ({ x: NaN, z: NaN, state: '__none' }));

        // Pre-allocated reusable objects — never allocate in the hot path
        this._d   = new THREE.Object3D();
        this._m4c = new THREE.Matrix4();  // char root world matrix
        this._m4h = new THREE.Matrix4();  // head world matrix
        this._m4p = new THREE.Matrix4();  // current part world matrix
        this._v3  = new THREE.Vector3();
        this._q   = new THREE.Quaternion();
        this._s1  = new THREE.Vector3(1, 1, 1);

        // Shadow IM (circle, always-on)
        const shadowGeo = new THREE.CircleGeometry(1, 12);
        const shadowMat = new THREE.MeshBasicMaterial({
            color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false,
        });
        this._shadowIM = new THREE.InstancedMesh(shadowGeo, shadowMat, maxCount);
        this._shadowIM.frustumCulled = false;
        this._shadowIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < maxCount; i++) this._shadowIM.setMatrixAt(i, ZERO_M4);
        this._shadowIM.instanceMatrix.needsUpdate = true;
        scene.add(this._shadowIM);

        this._build();
    }

    // ── Build IMs from active skin ─────────────────────────────────────────
    _build() {
        const skin = getActiveSkin();
        if (!skin?.collectVoxels) return;

        const voxels = skin.collectVoxels();
        const vs     = skin.voxelSize ?? 0.055;

        // Group by (color, part)
        const byKey = new Map();
        for (const { x, y, z, color, part } of voxels) {
            const k = `${color}|${part}`;
            if (!byKey.has(k)) byKey.set(k, { color, part, positions: [] });
            byKey.get(k).positions.push({ x, y, z });
        }

        for (const { color, part, positions } of byKey.values()) {
            const geo = mergeBoxes(positions, vs);
            const mat = new THREE.MeshLambertMaterial({ color });
            const im  = new THREE.InstancedMesh(geo, mat, this._max);
            im.frustumCulled = false;
            im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            for (let i = 0; i < this._max; i++) im.setMatrixAt(i, ZERO_M4);
            im.instanceMatrix.needsUpdate = true;
            this._scene.add(im);
            this._groups.push({ part, im });
        }
    }

    // ── Per-frame update ────────────────────────────────────────────────────
    update(characters) {
        if (!this._groups.length && !this._shadowIM) return;

        const selId = (typeof window !== 'undefined' && window.selectedCharacterId != null)
            ? String(window.selectedCharacterId) : '';

        let slot        = 0;
        const toUpdate  = [];

        for (const char of characters) {
            if (!char || char.state === 'dead') continue;
            if (String(char.id) === selId) continue;
            if (!char.mesh || !char.body || !char.head) continue;

            const prev = this._prevPos[slot];
            const px   = char.mesh.position.x;
            const pz   = char.mesh.position.z;
            const st   = char.state;

            // Detect dirty: position changed, state changed, or actively animating
            const isDirty = !this._slotMap.has(char.id)
                || this._slotMap.get(char.id) !== slot
                || px !== prev.x || pz !== prev.z
                || st !== prev.state
                || ANIM_STATES.has(st);

            if (isDirty) toUpdate.push({ char, slot });

            this._slotMap.set(char.id, slot);
            prev.x = px; prev.z = pz; prev.state = st;
            slot++;
        }

        const activeCount = slot;

        // Write dirty characters
        for (const { char, slot } of toUpdate) {
            this._writeChar(char, slot);
        }

        // Zero out slots beyond active count
        for (let i = activeCount; i < this._max; i++) {
            for (const { im } of this._groups) im.setMatrixAt(i, ZERO_M4);
            this._shadowIM.setMatrixAt(i, ZERO_M4);
        }

        // Mark GPU buffers dirty
        for (const { im } of this._groups) {
            im.count = this._max;
            im.instanceMatrix.needsUpdate = true;
        }
        this._shadowIM.count = this._max;
        this._shadowIM.instanceMatrix.needsUpdate = true;
    }

    // ── Write one character's part matrices ─────────────────────────────────
    _writeChar(char, slot) {
        // Char root world matrix (char.mesh is direct child of scene → local = world)
        char.mesh.updateMatrix();
        this._m4c.copy(char.mesh.matrix);

        // Head world matrix (needed for head-child parts like halo)
        char.head.updateMatrix();
        this._m4h.multiplyMatrices(this._m4c, char.head.matrix);

        const d = this._d;

        for (const { part, im } of this._groups) {
            const getMesh = PART_MESH[part];
            const partMesh = getMesh ? getMesh(char) : null;

            if (!partMesh) {
                im.setMatrixAt(slot, ZERO_M4);
                continue;
            }

            partMesh.updateMatrix();

            if (HEAD_CHILD_PARTS.has(part) || partMesh.parent === char.head) {
                // Part is a child of head → head world matrix × part local matrix
                this._m4p.multiplyMatrices(this._m4h, partMesh.matrix);
            } else {
                // Direct child of char.mesh → char world matrix × part local matrix
                this._m4p.multiplyMatrices(this._m4c, partMesh.matrix);
            }

            // Decompose to extract position + rotation, then recompose with scale=1
            // (the part BoxMesh has a non-unit scale encoding the box dimensions, which
            //  we do NOT want — our geometry already has the correct voxel sizes baked in)
            this._m4p.decompose(this._v3, this._q, this._s1);
            d.position.copy(this._v3);
            d.quaternion.copy(this._q);
            d.scale.setScalar(1);
            d.updateMatrix();
            im.setMatrixAt(slot, d.matrix);
        }

        // Shadow
        const m = char.morphology;
        if (m) {
            d.position.set(char.mesh.position.x, 0.01, char.mesh.position.z);
            d.rotation.set(-Math.PI / 2, 0, 0);
            d.scale.set(m.shadowRadius, m.shadowRadius, 1);
            d.updateMatrix();
            this._shadowIM.setMatrixAt(slot, d.matrix);
        }
    }

    // ── Dispose (for skin hot-swap) ─────────────────────────────────────────
    dispose() {
        for (const { im } of this._groups) {
            im.geometry.dispose();
            im.material.dispose();
            this._scene.remove(im);
        }
        this._shadowIM.geometry.dispose();
        this._shadowIM.material.dispose();
        this._scene.remove(this._shadowIM);
        this._groups   = [];
        this._slotMap.clear();
    }
}
