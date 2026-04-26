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
// Compact chibi proportions — slightly narrower skirt, shorter wings, tighter halo.
export function buildAngelGroup() {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group(); // world.js controls root.position.y; bodyGroup holds all mesh
    root.add(bodyGroup);

    const WHITE  = 0xf8f8f8;
    const WHITE2 = 0xeeeef2;
    const SKIN   = 0xffe0c0;
    const HAIR   = 0xf5a662;
    const GOLD   = 0xffd700;
    const RIBBON = 0xdb5a6b;
    const EYE    = 0x882222;
    const CHEEK  = 0xffb2bc;

    // ── Skirt (3 ring tiers — narrowed one voxel each from original) ──────────
    const SKIRT = [[4, 2, 4], [6, 2, 6], [7, 2, 7]];
    for (let i = 0; i < 3; i++) {
        const [sw, sh, sd] = SKIRT[i];
        const tier = box(sw, sh, sd, i === 0 ? WHITE2 : WHITE);
        tier.position.y = (-3 + i * 2) * S;
        bodyGroup.add(tier);
    }

    // ── Torso ─────────────────────────────────────────────────────────────────
    const torso = box(4, 6, 4, WHITE);
    torso.position.y = 3 * S;
    bodyGroup.add(torso);

    // ── Head group ────────────────────────────────────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.y = 9 * S;
    bodyGroup.add(headGroup);

    // Face: 3-layer — all rows same z-depth so forehead is flush (matches sandbox)
    const FACE_ROWS = [
        [5, 2, 5, -2.5],  // chin/lower
        [7, 3, 6,  0.5],  // mid (widest)
        [6, 2, 6,  3.5],  // upper/forehead — same depth as mid, no recession
    ];
    for (const [fw, fh, fd, fy] of FACE_ROWS) {
        const fl = box(fw, fh, fd, SKIN);
        fl.position.y = fy * S;
        headGroup.add(fl);
    }

    // Hair cap (top — compact pom: 7×7, centred in z to wrap over forehead)
    const hairTop = box(7, 2.5, 7, HAIR);
    hairTop.position.y = 5.5 * S;
    headGroup.add(hairTop);

    // Front bangs — hair over forehead, flush with face front (sandbox: z>2, y>=6)
    const bangs = box(6, 2, 2, HAIR);
    bangs.position.set(0, 4.5 * S, 2.3 * S);
    headGroup.add(bangs);

    // Hair sides
    const hairSideL = box(2, 6, 5, HAIR);
    hairSideL.position.set(-4 * S, 2 * S, 0);
    headGroup.add(hairSideL);
    const hairSideR = box(2, 6, 5, HAIR);
    hairSideR.position.set(4 * S, 2 * S, 0);
    headGroup.add(hairSideR);

    // Hair back
    const hairBack = box(6, 6, 2, HAIR);
    hairBack.position.set(0, 2 * S, -4 * S);
    headGroup.add(hairBack);

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

    // ── Halo (rotates independently) — compact: 12 points, radius 3.5 ─────────
    const haloGroup = new THREE.Group();
    haloGroup.position.y = 7.5 * S;
    headGroup.add(haloGroup);

    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const hv = box(1, 0.7, 1, GOLD, true);
        hv.position.set(Math.cos(angle) * 3.5 * S, 0, Math.sin(angle) * 3.5 * S);
        haloGroup.add(hv);
    }

    // ── Wings (5-column triangle — shorter span than original 7-column) ────────
    const leftWing  = new THREE.Group();
    const rightWing = new THREE.Group();
    leftWing.position.set(-2.5 * S, 5 * S, -1 * S);
    rightWing.position.set(2.5 * S, 5 * S, -1 * S);

    const wingMat = new THREE.MeshLambertMaterial({
        color: 0xffffff, transparent: true, opacity: 0.90,
    });
    for (let col = 0; col < 5; col++) {
        for (let row = 0; row < 5 - col; row++) {
            for (let wz = 0; wz < 2; wz++) {
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
    bodyGroup.add(leftWing);
    bodyGroup.add(rightWing);

    // ── Animation ─────────────────────────────────────────────────────────────
    root.userData.updateAnim = (t) => {
        // Z-axis = up/down wing stroke (bird mechanics)
        // leftWing voxels extend in -x: rotation.z negative = tip UP
        // rightWing voxels extend in +x: rotation.z positive = tip UP
        const flap = Math.sin(t * 3.5);   // ~3.5 flaps/sec
        leftWing.rotation.z  = -(0.15 + flap * 0.55);
        rightWing.rotation.z =  (0.15 + flap * 0.55);
        // Sweep wings back on upstroke (fold slightly, natural kinematics)
        const sweep = Math.max(0, flap) * 0.22;
        leftWing.rotation.y  =  sweep;
        rightWing.rotation.y = -sweep;

        // Body lifts when wings push air DOWN (peak on downstroke = flap negative)
        // Uses bodyGroup so it doesn't fight world.js root.position.y interpolation
        bodyGroup.position.y = Math.max(0, -flap) * 0.05;
        // Gentle lean from alternating wing pressure
        bodyGroup.rotation.z = flap * 0.022;

        // Head: two-frequency curiosity (quick alert bird)
        headGroup.rotation.y = Math.sin(t * 0.50) * 0.14 + Math.sin(t * 1.80) * 0.07;
        headGroup.rotation.z = Math.sin(t * 0.75) * 0.09;

        // Halo
        haloGroup.rotation.y = t * 0.65;
        haloGroup.position.y = 7.5 * S + Math.sin(t * 2.2) * 0.25 * S;
    };

    root.userData.roam = { tx: 8, tz: 8, speed: 1.5, phase: 0.0 };
    return root;
}

// ── Reaper ────────────────────────────────────────────────────────────────────
// Pro chibi-voxel design: two-tone robe depth, skull framed by oversized hood,
// asymmetric raised scythe arm, blade arc above head, two golden fangs.
export function buildReaperGroup() {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group(); // world.js controls root; bodyGroup holds all mesh
    root.add(bodyGroup);

    // Two robe tones — standard voxel trick for depth without lighting math
    const ROBE   = 0x1a0f22;   // core shadow robe
    const ROBEF  = 0x2e1840;   // front-face robe (lighter = ambient bounce)
    const TRIM   = 0x8b1c2e;   // crimson accent
    const BONE   = 0xe8e0cc;   // skull / hands
    const TOOTH  = 0xd4a820;   // golden fangs
    const EYE    = 0xff1111;   // hot red glow
    const HANDLE = 0x3a1a0a;   // very dark brown
    const BLADE  = 0xd0dce0;   // cold silver
    const BLADED = 0x8898a0;   // blade inner (darker edge = 2-tone blade form)

    // ── Robe skirt — wider at base, TRIM hem on bottom tier ──────────────────
    const SKIRT = [[5, 2, 5], [6, 2, 6], [8, 2, 7]];
    for (let i = 0; i < 3; i++) {
        const [sw, sh, sd] = SKIRT[i];
        const tier = box(sw, sh, sd, ROBE);
        tier.position.y = (-2 - i * 2) * S;
        bodyGroup.add(tier);
    }
    // Crimson hem strip on bottom tier — grounds the silhouette
    const hem = box(8, 0.8, 0.5, TRIM);
    hem.position.set(0, -7.4 * S, 3.6 * S);
    bodyGroup.add(hem);

    // ── Robe body: taller column + lighter front slab for depth ──────────────
    const body = box(5, 7, 4, ROBE);
    body.position.y = 2 * S;
    bodyGroup.add(body);
    const bodyFront = box(4, 6, 0.6, ROBEF);
    bodyFront.position.set(0, 2.3 * S, 2.3 * S);
    bodyGroup.add(bodyFront);

    // Belt — border ring + central buckle + dangling sash
    const beltF = box(5.5, 1.2, 0.6, TRIM);
    beltF.position.set(0, -0.2 * S, 2.3 * S);
    bodyGroup.add(beltF);
    const beltB = box(5.5, 1.2, 0.6, TRIM);
    beltB.position.set(0, -0.2 * S, -2.3 * S);
    bodyGroup.add(beltB);
    const beltSL = box(0.6, 1.2, 3.5, TRIM);
    beltSL.position.set(-2.8 * S, -0.2 * S, 0);
    bodyGroup.add(beltSL);
    const beltSR = box(0.6, 1.2, 3.5, TRIM);
    beltSR.position.set(2.8 * S, -0.2 * S, 0);
    bodyGroup.add(beltSR);
    // Bone belt buckle (visual anchor at center front)
    const buckle = box(1.4, 1.6, 0.9, BONE);
    buckle.position.set(0, -0.2 * S, 2.7 * S);
    bodyGroup.add(buckle);
    // Dangling sash left-of-center
    const sash = box(1, 3.5, 0.5, TRIM);
    sash.position.set(-1.2 * S, -3 * S, 2.2 * S);
    bodyGroup.add(sash);

    // ── Arms — asymmetric pose (left hangs, right raises for scythe) ──────────
    const armL = box(1.5, 3.5, 1.5, ROBE);
    armL.position.set(-3.5 * S, 2.3 * S, 0);
    bodyGroup.add(armL);
    const handL = box(1.3, 1, 1.3, BONE);
    handL.position.set(-3.5 * S, 0.3 * S, 0);
    bodyGroup.add(handL);

    const armR = box(1.5, 3, 1.5, ROBE);
    armR.position.set(3.5 * S, 3.8 * S, 0);
    bodyGroup.add(armR);
    const handR = box(1.3, 1, 1.3, BONE);
    handR.position.set(3.5 * S, 2 * S, 0);
    bodyGroup.add(handR);

    // ── Head group ────────────────────────────────────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.y = 8.5 * S;
    bodyGroup.add(headGroup);

    // Skull — narrower (4w) than hood width (7w) so face is framed / shadowed
    const skull = box(4, 6, 3, BONE);
    skull.position.set(0, -0.5 * S, 1.2 * S);
    headGroup.add(skull);
    // Hollow cheek shadows (dark robe spots — give skull its concave personality)
    for (const cx of [-1.5, 1.5]) {
        const cheek = box(1, 1.5, 0.6, ROBE);
        cheek.position.set(cx * S, -1.3 * S, 2.8 * S);
        headGroup.add(cheek);
    }

    // Hood — wide back block (7w > skull 4w = skull visibly recessed)
    const hoodBack = box(7, 6, 5, ROBE);
    hoodBack.position.set(0, 0.5 * S, -1.2 * S);
    headGroup.add(hoodBack);
    // Hood side lips — frame face opening, give clean 3/4-view profile
    for (const sx of [-3.6 * S, 3.6 * S]) {
        const lip = box(0.8, 7, 1.5, ROBE);
        lip.position.set(sx, 0.5 * S, 0.9 * S);
        headGroup.add(lip);
    }
    // Brow overhang — casts visual shadow above the eyes
    const brow = box(6, 1.5, 2.8, ROBE);
    brow.position.set(0, 3.2 * S, 0.5 * S);
    headGroup.add(brow);

    // Hood peak — 3-step taper (traditional silhouette, more polished)
    const PEAK = [[6, 2, 4.5], [4.5, 2, 3], [3, 2, 2]];
    for (let i = 0; i < 3; i++) {
        const [pw, ph, pd] = PEAK[i];
        const pk = box(pw, ph, pd, ROBE);
        pk.position.y = (4 + i * 2) * S;
        headGroup.add(pk);
    }

    // Eyes — glowing red, inset behind brow
    for (const ex of [-1.1, 1.1]) {
        const eye = box(1.4, 1.6, 0.5, EYE, true);
        eye.position.set(ex * S, 0.4 * S, 2.5 * S);
        headGroup.add(eye);
    }
    // Highlight dots
    for (const hx of [-0.5, 1.7]) {
        const hl = box(0.45, 0.45, 0.3, 0xffffff, true);
        hl.position.set(hx * S, 0.95 * S, 2.6 * S);
        headGroup.add(hl);
    }
    // Two golden fangs — much more skull personality than a single bar
    for (const tx of [-0.8, 0.8]) {
        const fang = box(0.9, 1.1, 0.5, TOOTH);
        fang.position.set(tx * S, -2.3 * S, 2.5 * S);
        headGroup.add(fang);
    }

    // ── Scythe — blade arc sweeps ABOVE the head (dramatic silhouette) ────────
    const scytheGroup = new THREE.Group();
    scytheGroup.position.set(4 * S, 3.5 * S, 0);   // right hand, raised
    // Pre-tilt: blade leans slightly outward & forward — natural carrying posture
    scytheGroup.rotation.z = -0.25;
    scytheGroup.rotation.y = 0.15;
    bodyGroup.add(scytheGroup);

    // Handle — 10 voxels, extends up and down from hand grip
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.9 * S, 10 * S, 0.9 * S),
        new THREE.MeshLambertMaterial({ color: HANDLE }),
    );
    scytheGroup.add(handle);

    // Blade — 8-point outer arc (clears head height for visual impact)
    const bladeMat  = new THREE.MeshLambertMaterial({ color: BLADE });
    const bladeDMat = new THREE.MeshLambertMaterial({ color: BLADED });
    const bladePts = [
        [0.0, 5.5], [0.8, 6.4], [1.8, 7.0], [2.8, 7.1],
        [3.6, 6.7], [4.2, 5.8], [4.5, 4.7], [4.4, 3.6],
    ];
    for (const [bx, by] of bladePts) {
        const bv = new THREE.Mesh(
            new THREE.BoxGeometry(1.5 * S, 1.5 * S, 0.6 * S),
            bladeMat,
        );
        bv.position.set(bx * S, by * S, 0);
        scytheGroup.add(bv);
    }
    // Inner edge (darker) — 2-tone blade gives form and depth
    const innerPts = [[0.9, 6.2], [1.9, 6.7], [2.8, 6.6], [3.6, 6.0], [4.1, 5.1]];
    for (const [bx, by] of innerPts) {
        const bv = new THREE.Mesh(
            new THREE.BoxGeometry(0.9 * S, 0.9 * S, 0.5 * S),
            bladeDMat,
        );
        bv.position.set(bx * S, by * S, 0.05 * S);
        scytheGroup.add(bv);
    }

    // ── Animation ─────────────────────────────────────────────────────────────
    root.userData.updateAnim = (t) => {
        // 1. Heavy hover sway — large creature with mass, slow and deliberate
        bodyGroup.rotation.z = Math.sin(t * 0.8) * 0.055;
        bodyGroup.position.y = Math.sin(t * 0.9 + 0.5) * 0.04; // independent of world float

        // 2. Head: predatory survey — slow sweep + occasional glance + forward stalk tilt
        //    rotation.x = bird-of-prey forward lean; reads as focus / menace
        headGroup.rotation.y = Math.sin(t * 0.45) * 0.16 + Math.sin(t * 1.3) * 0.04;
        headGroup.rotation.x = -0.06 + Math.sin(t * 0.55) * 0.08;
        headGroup.rotation.z = Math.sin(t * 0.80) * 0.035;

        // 3. Scythe: heavy pendulum — slower freq, larger arc, axial wobble for mass
        scytheGroup.rotation.z = -0.25 + Math.sin(t * 0.9) * 0.18;
        scytheGroup.rotation.y =  0.15 + Math.sin(t * 1.3) * 0.06;
    };

    // Slower than angel, phase π apart — they bob out of sync in the world
    root.scale.setScalar(0.72);

    root.userData.roam = { tx: 8, tz: 6, speed: 1.0, phase: Math.PI };
    return root;
}
