import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVoxelGeometry } from '../sim-core/voxel-geometry.js';

test('empty voxel input produces empty geometry', () => {
    const geometry = buildVoxelGeometry([], 1);
    assert.equal(geometry.index, null);
    assert.deepEqual(Object.keys(geometry.attributes), []);
    geometry.dispose();
});

test('voxel boxes preserve bounds, outward winding, normals, and face shading', () => {
    const geometry = buildVoxelGeometry([{ x: 2, y: -3, z: 4, color: 0xffffff }], 0.5);
    geometry.computeBoundingBox();
    assert.deepEqual(geometry.boundingBox.min.toArray(), [1.75, -3.25, 3.75]);
    assert.deepEqual(geometry.boundingBox.max.toArray(), [2.25, -2.75, 4.25]);
    const { position, normal, color } = geometry.attributes;
    assert.equal(position.count, 24);
    assert.equal(geometry.index.count, 36);
    const brightness = [0.88, 0.78, 1, 0.40, 1, 0.70];
    for (let face = 0; face < 6; face++) {
        assert.ok(Math.abs(color.getX(face * 4) - brightness[face]) < 1e-6);
    }
    for (let i = 0; i < geometry.index.count; i += 3) {
        const [a, b, c] = Array.from(geometry.index.array.slice(i, i + 3));
        const xyz = index => [position.getX(index), position.getY(index), position.getZ(index)];
        const pa = xyz(a), pb = xyz(b), pc = xyz(c);
        const u = pb.map((v, j) => v - pa[j]);
        const v = pc.map((value, j) => value - pa[j]);
        const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        assert.ok(cross[0]*normal.getX(a) + cross[1]*normal.getY(a) + cross[2]*normal.getZ(a) > 0);
    }
    geometry.dispose();
});

test('each result owns its buffers and later boxes use their own vertices', () => {
    const voxels = [{ x: 0, y: 0, z: 0, color: 0xff0000 }, { x: 2, y: 0, z: 0, color: 0x0000ff }];
    const first = buildVoxelGeometry(voxels, 1);
    const second = buildVoxelGeometry(voxels, 1);
    assert.equal(first.attributes.position.count, 48);
    assert.ok(Array.from(first.index.array.slice(36)).every(i => i >= 24 && i < 48));
    assert.equal(first.attributes.color.getZ(24), Math.fround(0.88));
    first.attributes.position.array.fill(0);
    assert.notDeepEqual(first.attributes.position.array, second.attributes.position.array);
    first.dispose();
    second.dispose();
});
