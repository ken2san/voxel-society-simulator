/**
 * special-entities.js
 *
 * Builds decorative "angel" and "reaper" Three.Group objects sized for the
 * game world (~2 units tall, VOXEL_SIZE = 0.10).
 *
 * Both groups expose:
 *   group.userData.updateAnim(worldTime) — per-frame animation hook
 *   group.userData.roam                  — { tx, tz, speed } mutable by world.js
 *
 * Angel appears when child count ≥ threshold (default 10).
 * Reaper appears when elder count ≥ threshold (default 10).
 */

import * as THREE from 'three';

const S = 0.10; // voxel size — 20 voxels = 2.0 world units

// ── Shared geometry cache (not cloned, safe because positions differ) ─────────
const _BOX = new THREE.BoxGeometry(S, S, S);

function vox(color, unlit = false) {
    const mat = unlit
        ? new THREE.MeshBasicMaterial({ color })
        : new THREE.MeshLambertMaterial({ color });
    return new THREE.Mesh(_BOX, mat);
}

function box(w, h, d, color, unlit = false) {
    const geo = new THREE.BoxGeometry(w * S, h * S, d * S);
    const mat = unlit
        ? new THREE.MeshBasicMaterial({ color })
        : new THREE.MeshLambertMaterial({ color });
    return new THREE.Mesh(geo, mat);
}

// ── Angel ─────────────────────────────────────────────────────────────────────
// Palette matches sandbox voxelchar01: white dress, orange hair, gold halo.
export function buildAngelGroup() {
    const root = new THREE.Group();

    // ── Dress / body ──────────────────────────────────────────────────────────
    const WHITE  = 0xf8f8f8;
    const WHITE2 = 0xeeeef2;
    const SKIN   = 0xffe0c0;
    const HAIR   = 0xf5a662;
    const GOLD   = 0xffd700;
    const EYE    = 0x882222;

    // Skirt (3 widening tiers from bottom)
    for (let i = 0; i < 3; i++) {
        const w = 5 + i * 2;
        const d = 4 + i;
        const tier = box(w, 2, d, i === 0 ? WHITE2 : WHITE);
        tier.position.y = (-4 + i * 2) * S;
        root.add(tier);
    }

    // Torso
    const torso = box(4, 6, 3, WHITE);
    torso.position.y = 3 * S;
    root.add(torso);

    // ── Head group (pivots for animation) ─────────────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.y = 9 * S;  // atop torso
    root.add(headGroup);

    const face = box(5, 5, 4, SKIN);
    headGroup.add(face);

    // Hair cap (orange, slightly wider + taller than face)
    const hairCap = box(6, 2.5, 5.5, HAIR);
    hairCap.position.y = 3 * S;
    headGroup.add(hairCap);

    // Hair sides
    const hairSideL = box(1.5, 4, 4, HAIR);
    hairSideL.position.set(-3.3 * S, -0.5 * S, 0);
    headGroup.add(hairSideL);
    const hairSideR = box(1.5, 4, 4, HAIR);
    hairSideR.position.set(3.3 * S, -0.5 * S, 0);
    headGroup.add(hairSideR);

    // Eyes (unlit)
    for (const ex of [-1.3, 1.3]) {
        const eye = box(1, 1, 0.4, EYE, true);
        eye.position.set(ex * S, 0, 2.2 * S);
        headGroup.add(eye);
    }

    // ── Halo group (rotates independently) ────────────────────────────────────
    const haloGroup = new THREE.Group();
    haloGroup.position.y = 4.8 * S;
    headGroup.add(haloGroup);

    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const hv = box(1, 0.8, 1, GOLD, true);
        hv.position.set(Math.cos(angle) * 4 * S, 0, Math.sin(angle) * 4 * S);
        haloGroup.add(hv);
    }

    // ── Wings ─────────────────────────────────────────────────────────────────
    // Each wing: 6-column triangle of thin voxel boxes, positioned left/right of torso.
    const wingMat = new THREE.MeshLambertMaterial({
        color: 0xffffff, transparent: true, opacity: 0.88,
    });
    const leftWing  = new THREE.Group();
    const rightWing = new THREE.Group();
    leftWing.position.set(-2.5 * S, 6 * S, -1 * S);
    rightWing.position.set(2.5 * S, 6 * S, -1 * S);

    for (let col = 0; col < 6; col++) {
        for (let row = 0; row < 6 - col; row++) {
            const geo = new THREE.BoxGeometry(S, S, 0.4 * S);
            const lv = new THREE.Mesh(geo, wingMat);
            lv.position.set(-(col + 0.5) * S, row * S, 0);
            leftWing.add(lv);
            const rv = new THREE.Mesh(geo, wingMat);
            rv.position.set((col + 0.5) * S, row * S, 0);
            rightWing.add(rv);
        }
    }
    root.add(leftWing);
    root.add(rightWing);

    // ── Animation ─────────────────────────────────────────────────────────────
    root.userData.updateAnim = (t) => {
        haloGroup.rotation.y = t * 0.65;
        haloGroup.position.y = 4.8 * S + Math.sin(t * 2.2) * 0.05 * S * 5;
        leftWing.rotation.y  =  0.30 + Math.sin(t * 3.2) * 0.38;
        rightWing.rotation.y = -0.30 - Math.sin(t * 3.2) * 0.38;
        headGroup.rotation.z = Math.sin(t * 0.75) * 0.06;
        headGroup.rotation.y = Math.sin(t * 0.40) * 0.05;
    };

    root.userData.roam = { tx: 8, tz: 8, speed: 1.5, phase: 0.0 };
    return root;
}

// ── Reaper ────────────────────────────────────────────────────────────────────
// Palette matches sandbox voxelchar02: black robe, bone skull, red eyes, silver scythe.
// Proportions: body 8v tall, headGroup at 5.5 S, hood 6v + 3-step peak ≈ 22 S total.
export function buildReaperGroup() {
    const root = new THREE.Group();

    const ROBE   = 0x1c1c1c;
    const BELT   = 0x7a1515;
    const BONE   = 0xdddccc;
    const EYE    = 0xff1111;
    const HANDLE = 0x4a1a1a;
    const BLADE  = 0xcccccc;

    // ── Robe body (8 voxels tall, spans −4 S … +4 S) ─────────────────────────
    const body = box(5, 8, 3, ROBE);
    body.position.y = 0;
    root.add(body);

    // Ragged hem detail
    for (let xi = -2; xi <= 2; xi++) {
        if (Math.random() > 0.4) {
            const shred = box(1, 1.5, 2.5, ROBE);
            shred.position.set(xi * S, -5 * S, 0);
            root.add(shred);
        }
    }

    // Belt (dark red band)
    const belt = box(6, 1.2, 3.5, BELT);
    belt.position.y = -0.5 * S;
    root.add(belt);

    // Belt tie (dangling)
    const tie = box(1.5, 3, 0.8, BELT);
    tie.position.set(-2 * S, -3 * S, 1.8 * S);
    root.add(tie);

    // ── Head group (5.5 S above root; body top is at 4 S) ─────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.y = 5.5 * S;
    root.add(headGroup);

    // Hood (outer robe shell — 6 voxels tall)
    const hood = box(6, 6, 4, ROBE);
    hood.position.y = 0;
    headGroup.add(hood);

    // Hood peak (pointed top — 3 narrowing steps)
    for (let step = 0; step < 3; step++) {
        const w = 5.5 - step * 1.5;   // 5.5 → 4.0 → 2.5
        const d = 3.5 - step;          // 3.5 → 2.5 → 1.5
        const peak = box(w, 2, d, ROBE);
        peak.position.y = (3.5 + step * 2) * S;
        headGroup.add(peak);
    }

    // Skull face (bone, set into front of hood)
    const skull = box(4, 4.5, 2.5, BONE);
    skull.position.set(0, -1 * S, 1.7 * S);
    headGroup.add(skull);

    // Cheekbones
    for (const ex of [-2, 2]) {
        const cheek = box(1.5, 1, 1, BONE);
        cheek.position.set(ex * S, -1.8 * S, 2.1 * S);
        headGroup.add(cheek);
    }

    // Eyes (red, unlit — always glow)
    for (const ex of [-1.4, 1.4]) {
        const eye = box(1.4, 1.4, 0.4, EYE, true);
        eye.position.set(ex * S, -0.2 * S, 2.8 * S);
        headGroup.add(eye);
    }

    // ── Scythe (held at right side) ───────────────────────────────────────────
    const scytheGroup = new THREE.Group();
    scytheGroup.position.set(3.5 * S, 1.5 * S, 0);
    root.add(scytheGroup);

    // Handle (14 voxels tall — proportionate to character height)
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.9 * S, 14 * S, 0.9 * S),
        new THREE.MeshLambertMaterial({ color: HANDLE }),
    );
    handle.position.y = 1 * S;
    scytheGroup.add(handle);

    // Blade (curved arc along upper handle)
    const bladePts = [
        [0.5, 7.0, 1], [1.5, 7.5, 1], [2.5, 7.3, 1], [3.2, 6.7, 1],
        [3.8, 5.7, 1], [4.0, 4.5, 1], [3.8, 3.5, 1], [2.8, 2.8, 1],
    ];
    const bladeMat = new THREE.MeshLambertMaterial({ color: BLADE, roughness: 0.3, metalness: 0.7 });
    for (const [bx, by] of bladePts) {
        const bv = new THREE.Mesh(new THREE.BoxGeometry(1.6 * S, 1.6 * S, 0.6 * S), bladeMat);
        bv.position.set(bx * S, by * S, 0);
        scytheGroup.add(bv);
    }
    // Blade inner edge (silver highlight)
    const bladePtsInner = [
        [1, 7.3, 0.6], [2, 7.0, 0.6], [3, 6.2, 0.6], [3.6, 5.0, 0.6],
    ];
    for (const [bx, by] of bladePtsInner) {
        const bv = new THREE.Mesh(new THREE.BoxGeometry(S, S, 0.3 * S), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        bv.position.set(bx * S, by * S, 0);
        scytheGroup.add(bv);
    }

    // ── Animation ─────────────────────────────────────────────────────────────
    root.userData.updateAnim = (t) => {
        headGroup.rotation.y = Math.sin(t * 0.85) * 0.06;
        headGroup.rotation.z = Math.cos(t * 1.1) * 0.03;
        scytheGroup.rotation.x = Math.sin(t * 1.6) * 0.09;
        scytheGroup.rotation.z = Math.sin(t * 0.9) * 0.04;
    };

    root.userData.roam = { tx: 8, tz: 6, speed: 1.0, phase: Math.PI };
    return root;
}
