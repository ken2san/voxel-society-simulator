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
 *
 * Proportions are faithful to sandbox/voxelchar01.html and voxelchar02.html.
 * Key fix: all Z-depth values now match sandbox W:D ratios so the models
 * look properly 3D from every angle (not flat when viewed from the side).
 */

import * as THREE from 'three';

const S = 0.10; // voxel size — 20 voxels = 2.0 world units

// ── Geometry helper ───────────────────────────────────────────────────────────
function box(w, h, d, color, unlit = false) {
    const geo = new THREE.BoxGeometry(w * S, h * S, d * S);
    const mat = unlit
        ? new THREE.MeshBasicMaterial({ color })
        : new THREE.MeshLambertMaterial({ color });
    return new THREE.Mesh(geo, mat);
}

// ── Angel ─────────────────────────────────────────────────────────────────────
// Faithful to sandbox/voxelchar01.html:
//   – head: sphere r≈5 → 3-layer stacked boxes, hair cap + sides + back (3D)
//   – body core: 4w × 7h × 4d  (square cross-section, not a slab)
//   – skirt: equal W×D per tier  → circular footprint from above
//   – wings: 2-voxel thick in Z  → visible edge when viewed from side
//   – halo: 14-point ring (unlit gold)
//   – ribbon headband + pink cheeks (match sandbox palette)
export function buildAngelGroup() {
    const root = new THREE.Group();

    const WHITE  = 0xf8f8f8;
    const WHITE2 = 0xeeeef2;
    const SKIN   = 0xffe0c0;
    const HAIR   = 0xf5a662;
    const GOLD   = 0xffd700;
    const RIBBON = 0xdb5a6b;
    const EYE    = 0x882222;
    const CHEEK  = 0xffb2bc;

    // ── Skirt (3 ring tiers — W = D so footprint is square, not a flat slab) ──
    // sandbox rings r=4,5,6 → diameter 8,10,12; game: 5,7,9 × 5,7,9
    const SKIRT = [[5, 2, 5], [7, 2, 7], [9, 2, 9]];
    for (let i = 0; i < 3; i++) {
        const [sw, sh, sd] = SKIRT[i];
        const tier = box(sw, sh, sd, i === 0 ? WHITE2 : WHITE);
        tier.position.y = (-4 + i * 2) * S;
        root.add(tier);
    }

    // ── Torso (sandbox: x=-2..1 = 4w, z=-2..1 = 4d → square cross-section) ──
    const torso = box(4, 7, 4, WHITE);
    torso.position.y = 3.5 * S;
    root.add(torso);

    // ── Head group ────────────────────────────────────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.y = 10 * S;
    root.add(headGroup);

    // Face: 3-layer sphere approximation (sandbox: sphere r≈5 → 8w×8h×8d)
    // W and D are nearly equal to give a round appearance from any angle.
    const FACE_ROWS = [
        [5, 2, 4, -2.5],  // chin/lower
        [7, 3, 6,  0.5],  // mid (widest)
        [6, 2, 5,  3.5],  // upper/forehead
    ];
    for (const [fw, fh, fd, fy] of FACE_ROWS) {
        const fl = box(fw, fh, fd, SKIN);
        fl.position.y = fy * S;
        headGroup.add(fl);
    }

    // Hair cap (top — sandbox: shell r=4.5..6.5, roughly 8w×8d top)
    const hairTop = box(8, 2.5, 8, HAIR);
    hairTop.position.y = 5.5 * S;
    headGroup.add(hairTop);

    // Hair sides (fall down — 6 deep in Z so visible from side)
    const hairSideL = box(2, 5.5, 6, HAIR);
    hairSideL.position.set(-4.5 * S, 0, 0);
    headGroup.add(hairSideL);
    const hairSideR = box(2, 5.5, 6, HAIR);
    hairSideR.position.set(4.5 * S, 0, 0);
    headGroup.add(hairSideR);

    // Hair back (visible from side and rear)
    const hairBack = box(7, 7, 2, HAIR);
    hairBack.position.set(0, 0.5 * S, -4 * S);
    headGroup.add(hairBack);

    // Ribbon / headband (sandbox: row y=7..8)
    const ribbon = box(9, 1.5, 1, RIBBON);
    ribbon.position.y = 4.5 * S;
    headGroup.add(ribbon);

    // Cheeks (sandbox: pink, outside lower face)
    for (const ex of [-2.8, 2.8]) {
        const cheek = box(1.2, 1, 0.5, CHEEK);
        cheek.position.set(ex * S, -1.5 * S, 3.2 * S);
        headGroup.add(cheek);
    }

    // Eyes (unlit, sandbox: x=±1..2, y=3..4, z=3)
    for (const ex of [-1.5, 1.5]) {
        const eye = box(1.2, 1.5, 0.5, EYE, true);
        eye.position.set(ex * S, 0.5 * S, 3.3 * S);
        headGroup.add(eye);
    }

    // ── Halo (rotates independently) ──────────────────────────────────────────
    const haloGroup = new THREE.Group();
    haloGroup.position.y = 6.5 * S;
    headGroup.add(haloGroup);

    for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        const hv = box(1, 0.7, 1, GOLD, true);
        hv.position.set(Math.cos(angle) * 4.5 * S, 0, Math.sin(angle) * 4.5 * S);
        haloGroup.add(hv);
    }

    // ── Wings (triangle, 2 voxels thick in Z → visible from side) ─────────────
    // sandbox: triangle at z=0 only, but we add wz=0..1 so the edge reads in side view
    const leftWing  = new THREE.Group();
    const rightWing = new THREE.Group();
    leftWing.position.set(-2.5 * S, 5.5 * S, -1 * S);
    rightWing.position.set(2.5 * S, 5.5 * S, -1 * S);

    const wingMat = new THREE.MeshLambertMaterial({
        color: 0xffffff, transparent: true, opacity: 0.90,
    });
    for (let col = 0; col < 7; col++) {
        for (let row = 0; row < 7 - col; row++) {
            for (let wz = 0; wz < 2; wz++) {  // 2 layers thick in Z
                const gL = new THREE.BoxGeometry(S, S, S);
                const lv = new THREE.Mesh(gL, wingMat);
                lv.position.set(-(col + 0.5) * S, row * S, wz * S);
                leftWing.add(lv);
                const gR = new THREE.BoxGeometry(S, S, S);
                const rv = new THREE.Mesh(gR, wingMat);
                rv.position.set((col + 0.5) * S, row * S, wz * S);
                rightWing.add(rv);
            }
        }
    }
    root.add(leftWing);
    root.add(rightWing);

    // ── Animation ─────────────────────────────────────────────────────────────
    root.userData.updateAnim = (t) => {
        haloGroup.rotation.y = t * 0.65;
        haloGroup.position.y = 6.5 * S + Math.sin(t * 2.2) * 0.25 * S;
        leftWing.rotation.y  =  0.30 + Math.sin(t * 3.2) * 0.38;
        rightWing.rotation.y = -0.30 - Math.sin(t * 3.2) * 0.38;
        headGroup.rotation.z = Math.sin(t * 0.75) * 0.06;
        headGroup.rotation.y = Math.sin(t * 0.40) * 0.05;
    };

    root.userData.roam = { tx: 8, tz: 8, speed: 1.5, phase: 0.0 };
    return root;
}

// ── Reaper ────────────────────────────────────────────────────────────────────
// Faithful to sandbox/voxelchar02.html:
//   – robe body: sandbox x=-5..5=11w, z=-3..3=7d → W:D=11:7; game 5w×5d (square)
//   – belt: 4-plate perimeter ring (matches sandbox border loop at x=±6, z=±4)
//   – sleeve arms: left+right sticking out in X, bone hands (visible from side)
//   – hood: sandbox x=-6..6=13w, z=-4..4=9d → game 7w×7d (square)
//   – hood peak: 3-step taper, width and depth narrow together
//   – skull: protrudes slightly from hood front face (mimics sandbox hollow)
//   – scythe: long handle + curved blade attached near right sleeve
export function buildReaperGroup() {
    const root = new THREE.Group();

    const ROBE   = 0x1c1c1c;
    const BELT   = 0x7a1515;
    const BONE   = 0xdddccc;
    const EYE    = 0xff1111;
    const HANDLE = 0x4a1a1a;
    const BLADE  = 0xcccccc;

    // ── Robe body (sandbox z=-3..3 = 7d; game: 5w × 5d for square cross-section)
    const body = box(5, 8, 5, ROBE);
    body.position.y = 0;
    root.add(body);

    // Ragged hem
    for (let xi = -2; xi <= 2; xi++) {
        if (Math.random() > 0.4) {
            const shred = box(1, 1.5, 5, ROBE);
            shred.position.set(xi * S, -5 * S, 0);
            root.add(shred);
        }
    }

    // ── Belt (sandbox: border ring at x=±6, z=±4 → 4 thin plates around body)
    const beltF = box(6, 1.5, 1, BELT);
    beltF.position.set(0, -0.5 * S, 3 * S);
    root.add(beltF);
    const beltB = box(6, 1.5, 1, BELT);
    beltB.position.set(0, -0.5 * S, -3 * S);
    root.add(beltB);
    const beltL = box(1, 1.5, 5, BELT);
    beltL.position.set(-3.5 * S, -0.5 * S, 0);
    root.add(beltL);
    const beltR = box(1, 1.5, 5, BELT);
    beltR.position.set(3.5 * S, -0.5 * S, 0);
    root.add(beltR);
    // Dangling tie
    const tie = box(1.5, 3, 1, BELT);
    tie.position.set(-1.5 * S, -3.5 * S, 3 * S);
    root.add(tie);

    // ── Sleeve arms (sandbox: x=±6..7, y=-2..-6, z=-1..0)
    // Give them depth in Z so they're visible from the side
    const sleeveL = box(2, 5, 2, ROBE);
    sleeveL.position.set(-4 * S, -1.5 * S, 0);
    root.add(sleeveL);
    const sleeveR = box(2, 5, 2, ROBE);
    sleeveR.position.set(4 * S, -1.5 * S, 0);
    root.add(sleeveR);
    // Bone hands (sandbox: x=±6, y=-7..-8, z=0..1)
    const handL = box(1.5, 1, 2, BONE);
    handL.position.set(-4 * S, -4.5 * S, 0);
    root.add(handL);
    const handR = box(1.5, 1, 2, BONE);
    handR.position.set(4 * S, -4.5 * S, 0);
    root.add(handR);

    // ── Head group ────────────────────────────────────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.y = 5.5 * S;
    root.add(headGroup);

    // Hood outer shell (sandbox: 13w × 10h × 9d; game: 7w × 7h × 7d square)
    const hood = box(7, 7, 7, ROBE);
    hood.position.y = 0;
    headGroup.add(hood);

    // Hood peak: 3-step taper (sandbox widthLimit=6-(y-7), depthLimit=4-(y-7))
    // steps: [w, h, d] narrowing together
    const PEAK = [[6, 2, 5.5], [4.5, 2, 4], [3, 2, 2.5]];
    for (let step = 0; step < 3; step++) {
        const [pw, ph, pd] = PEAK[step];
        const peak = box(pw, ph, pd, ROBE);
        peak.position.y = (4 + step * 2) * S;
        headGroup.add(peak);
    }

    // Skull face (sandbox: 9w × 7h × 4d inset at hood front face)
    // Slightly protrudes to be visible (mimics sandbox hollow window)
    const skull = box(5, 5, 4, BONE);
    skull.position.set(0, -0.5 * S, 2 * S);  // front face at 4*S, hood front at 3.5*S
    headGroup.add(skull);

    // Cheekbones
    for (const ex of [-2.5, 2.5]) {
        const cheek = box(1.5, 1.2, 1.5, BONE);
        cheek.position.set(ex * S, -2 * S, 3 * S);
        headGroup.add(cheek);
    }

    // Eyes (red, unlit — always glow; sandbox: z=2 front face)
    for (const ex of [-1.4, 1.4]) {
        const eye = box(1.4, 1.4, 0.5, EYE, true);
        eye.position.set(ex * S, 0, 4.1 * S);
        headGroup.add(eye);
    }

    // ── Scythe (attached near right sleeve — sandbox leftArm x=6..7)
    const scytheGroup = new THREE.Group();
    scytheGroup.position.set(5.5 * S, 1.5 * S, 0);
    root.add(scytheGroup);

    // Handle (14 voxels tall)
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.9 * S, 14 * S, 0.9 * S),
        new THREE.MeshLambertMaterial({ color: HANDLE }),
    );
    handle.position.y = 1 * S;
    scytheGroup.add(handle);

    // Blade (curved arc — sandbox bladeCurve pattern)
    const bladePts = [
        [0.5, 7.0], [1.5, 7.5], [2.5, 7.3], [3.2, 6.7],
        [3.8, 5.7], [4.0, 4.5], [3.8, 3.5], [2.8, 2.8],
    ];
    const bladeMat = new THREE.MeshLambertMaterial({ color: BLADE, roughness: 0.3, metalness: 0.7 });
    for (const [bx, by] of bladePts) {
        const bv = new THREE.Mesh(new THREE.BoxGeometry(1.6 * S, 1.6 * S, 0.6 * S), bladeMat);
        bv.position.set(bx * S, by * S, 0);
        scytheGroup.add(bv);
    }
    // Blade inner highlight
    const bladePtsInner = [[1, 7.3], [2, 7.0], [3, 6.2], [3.6, 5.0]];
    for (const [bx, by] of bladePtsInner) {
        const bv = new THREE.Mesh(
            new THREE.BoxGeometry(S, S, 0.3 * S),
            new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
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
