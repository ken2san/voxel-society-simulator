import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { VoxelCrowdRenderer } from '../sim-core/voxel-crowd-renderer.js';

// The browser selects the voxel-capable golem skin before creating the renderer.
globalThis.window = { ACTIVE_SKIN_ID: 'golem' };

function character(id, x = 0) {
    const mesh = new THREE.Group();
    const body = new THREE.Object3D();
    const head = new THREE.Object3D();
    mesh.add(body, head);
    mesh.position.x = x;
    return { id, mesh, body, head, state: 'idle', morphology: { shadowRadius: 0.3 } };
}

function fixture(t, capacity = 4) {
    const scene = new THREE.Scene();
    const renderer = new VoxelCrowdRenderer(scene, capacity);
    const meshes = [...scene.children];
    assert.ok(meshes.length > 1, 'Exercise body geometry as well as shadows');
    t.after(() => renderer.dispose());
    return { renderer, scene, meshes };
}

function counts(meshes, count) {
    for (const mesh of meshes) assert.equal(mesh.count, count);
}

function matrix(mesh, slot) {
    const value = new THREE.Matrix4();
    mesh.getMatrixAt(slot, value);
    return value.elements;
}

test('draws only visible living characters and skips unchanged uploads', t => {
    const { renderer, meshes } = fixture(t, 200);
    counts(meshes, 0);
    const visible = character(1, 5);
    const hidden = character(2);
    hidden.mesh.visible = false;
    const dead = character(3);
    dead.state = 'dead';
    renderer.update([null, hidden, dead, { id: 4 }, visible]);
    counts(meshes, 1);
    const versions = meshes.map(mesh => mesh.instanceMatrix.version);
    renderer.update([visible]);
    assert.deepEqual(meshes.map(mesh => mesh.instanceMatrix.version), versions);
    visible.mesh.position.x = 7;
    renderer.update([visible]);
    assert.equal(matrix(meshes[0], 0)[12], 7);
    assert.ok(meshes.every((mesh, i) => mesh.instanceMatrix.version > versions[i]));
});

test('shrinking and restoring a district refreshes reused slots', t => {
    const { renderer, meshes } = fixture(t);
    const a = character(1, 1);
    const b = character(2, 2);
    renderer.update([a, b]);
    const versions = meshes.map(mesh => mesh.instanceMatrix.version);
    b.mesh.visible = false;
    renderer.update([a, b]);
    counts(meshes, 1);
    assert.deepEqual(meshes.map(mesh => mesh.instanceMatrix.version), versions);
    renderer.update([]);
    counts(meshes, 0);
    assert.equal(renderer._slotOwners.length, 0);
    // Only Y changes: ownership invalidation must still refresh the old slot.
    a.mesh.position.y = 3;
    renderer.update([a]);
    counts(meshes, 1);
    assert.ok(Math.abs(matrix(meshes[0], 0)[13] - 3.01) < 1e-5);
});

test('reordering and replacing a character with the same ID refreshes matrices', t => {
    const { renderer, meshes } = fixture(t);
    const a = character(1, 1);
    const b = character(2, 2);
    renderer.update([a, b]);
    renderer.update([b, a]);
    assert.equal(matrix(meshes[0], 0)[12], 2);
    assert.equal(matrix(meshes[0], 1)[12], 1);
    const replacement = character(2, 2);
    replacement.mesh.position.y = 4;
    renderer.update([replacement, a]);
    assert.ok(Math.abs(matrix(meshes[0], 0)[13] - 4.01) < 1e-5);
});

test('caps rendering and retained references at allocated capacity', t => {
    const { renderer, meshes } = fixture(t, 2);
    const population = Array.from({ length: 50 }, (_, id) => character(id, id));
    renderer.update(population);
    counts(meshes, 2);
    assert.equal(renderer._slotOwners.length, 2);
    renderer.update(population.slice(20));
    counts(meshes, 2);
    assert.equal(matrix(meshes[0], 0)[12], 20);
    assert.equal(matrix(meshes[0], 1)[12], 21);
});

test('disposal releases instance buffers, geometry, materials, and scene references', () => {
    const scene = new THREE.Scene();
    const renderer = new VoxelCrowdRenderer(scene, 2);
    renderer.update([character(1)]);
    const disposed = [];
    for (const mesh of scene.children) {
        for (const resource of [mesh, mesh.geometry, mesh.material]) {
            resource.addEventListener('dispose', () => disposed.push(resource));
        }
    }
    const expected = scene.children.length * 3;
    renderer.dispose();
    assert.equal(new Set(disposed).size, expected);
    assert.equal(scene.children.length, 0);
    assert.equal(renderer._slotOwners.length, 0);
});
