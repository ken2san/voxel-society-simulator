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
        root.add(tier);
    }

    // ── Torso ─────────────────────────────────────────────────────────────────
    const torso = box(4, 6, 4, WHITE);
    torso.position.y = 3 * S;
    root.add(torso);

    // ── Head group ────────────────────────────────────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.y = 9 * S;
    root.add(headGroup);

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
    root.add(leftWing);
    root.add(rightWing);

    // ── Animation ─────────────────────────────────────────────────────────────
    root.userData.updateAnim = (t) => {
        haloGroup.rotation.y = t * 0.65;
        haloGroup.position.y = 7.5 * S + Math.sin(t * 2.2) * 0.25 * S;
        leftWing.rotation.y  =  0.30 + Math.sin(t * 3.2) * 0.38;
        rightWing.rotation.y = -0.30 - Math.sin(t * 3.2) * 0.38;
        headGroup.rotation.z = Math.sin(t * 0.75) * 0.06;
        headGroup.rotation.y = Math.sin(t * 0.40) * 0.05;
    };

    root.userData.roam = { tx: 8, tz: 8, speed: 1.5, phase: 0.0 };
    return root;
}

// ── Reaper ────────────────────────────────────────────────────────────────────
// Chibi-proportioned redesign: big head, cute glowing eyes, robe skirt (angel-
// style tiers), tiny bone hands, compact scythe. Total height ~1.6 world units
// — comparable to a chibi character with a small accessory.
export function buildReaperGroup() {
    const root = new THREE.Group();

    const ROBE   = 0x1e1228;   // deep purple-black
    const TRIM   = 0x7a1828;   // crimson accent
    const BONE   = 0xddd8c0;
    const EYE    = 0xff2424;   // bright red glow
    const SKIN   = 0xbcb09a;   // pale ashy skin
    const HANDLE = 0x2a1208;
    const BLADE  = 0xbcccd0;   // silver-blue

    // ── Robe skirt (3 tiers — bottom-heavy, mirrors angel silhouette) ─────────
    const SKIRT = [[5, 2, 5], [6, 2, 6], [7, 2, 7]];
    for (let i = 0; i < 3; i++) {
        const [sw, sh, sd] = SKIRT[i];
        const tier = box(sw, sh, sd, ROBE);
        tier.position.y = (-2 - i * 2) * S;   // i=0: -2*S, i=1: -4*S, i=2: -6*S
        root.add(tier);
    }

    // ── Robe body (chibi-wide, short — 4w × 5h × 4d) ─────────────────────────
    const body = box(4, 5, 4, ROBE);
    body.position.y = 1.5 * S;   // spans from -1*S to 4*S
    root.add(body);

    // Crimson belt strip
    const belt = box(5, 1, 4.5, TRIM);
    belt.position.y = -0.5 * S;
    root.add(belt);

    // ── Tiny sleeves ──────────────────────────────────────────────────────────
    const sleeveL = box(1.5, 3, 1.5, ROBE);
    sleeveL.position.set(-3.5 * S, 2 * S, 0);
    root.add(sleeveL);
    const sleeveR = box(1.5, 3, 1.5, ROBE);
    sleeveR.position.set(3.5 * S, 2 * S, 0);
    root.add(sleeveR);

    // Bone hands (cute tiny)
    const handL = box(1.2, 0.9, 1.2, BONE);
    handL.position.set(-3.5 * S, 0.3 * S, 0);
    root.add(handL);
    const handR = box(1.2, 0.9, 1.2, BONE);
    handR.position.set(3.5 * S, 0.3 * S, 0);
    root.add(handR);

    // ── Head group (chibi big-head proportions) ───────────────────────────────
    const headGroup = new THREE.Group();
    headGroup.position.y = 7 * S;
    root.add(headGroup);

    // Face skin (two layers, slightly forward so it peeks out of the hood)
    const faceBot = box(4, 2, 3.5, SKIN);
    faceBot.position.set(0, -1.5 * S, 0.6 * S);
    headGroup.add(faceBot);
    const faceMid = box(4, 2, 3.5, SKIN);
    faceMid.position.set(0, 0.5 * S, 0.6 * S);
    headGroup.add(faceMid);

    // Hood (covers top, sides, back — face opening on +Z front)
    const hood = box(6, 6, 5, ROBE);
    hood.position.set(0, 0.5 * S, -0.2 * S);
    headGroup.add(hood);

    // Hood peak (2-step taper — cute little point)
    const peak1 = box(5, 2, 4, ROBE);
    peak1.position.y = 4 * S;
    headGroup.add(peak1);
    const peak2 = box(3.5, 2, 2.5, ROBE);
    peak2.position.y = 6 * S;
    headGroup.add(peak2);

    // Eyes (large cute glowing red — chibi-scale spacing)
    for (const ex of [-1.3, 1.3]) {
        const eye = box(1.5, 1.8, 0.4, EYE, true);
        eye.position.set(ex * S, 0.3 * S, 2.4 * S);
        headGroup.add(eye);
    }
    // Eye highlight (white sparkle, upper-inner corner)
    for (const hx of [-0.6, 1.8]) {
        const hl = box(0.5, 0.5, 0.3, 0xffffff, true);
        hl.position.set(hx * S, 0.9 * S, 2.5 * S);
        headGroup.add(hl);
    }

    // Tiny cute mouth (bone-white, bottom of face)
    const smile = box(2, 0.6, 0.4, BONE);
    smile.position.set(0, -2.1 * S, 2.4 * S);
    headGroup.add(smile);

    // ── Mini scythe (compact — handle 7*S, tight blade arc) ──────────────────
    const scytheGroup = new THREE.Group();
    scytheGroup.position.set(4.8 * S, 0.5 * S, 0);
    root.add(scytheGroup);

    // Handle (7 voxels = 0.7 world units)
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.8 * S, 7 * S, 0.8 * S),
        new THREE.MeshLambertMaterial({ color: HANDLE }),
    );
    handle.position.y = 0;
    scytheGroup.add(handle);

    // Blade (compact 5-point arc)
    const bladePts = [
        [0.5, 3.8], [1.4, 4.4], [2.4, 4.2], [3.0, 3.5], [3.2, 2.5],
    ];
    const bladeMat = new THREE.MeshLambertMaterial({ color: BLADE });
    for (const [bx, by] of bladePts) {
        const bv = new THREE.Mesh(
            new THREE.BoxGeometry(1.4 * S, 1.4 * S, 0.5 * S),
            bladeMat,
        );
        bv.position.set(bx * S, by * S, 0);
        scytheGroup.add(bv);
    }

    // ── Animation ─────────────────────────────────────────────────────────────
    root.userData.updateAnim = (t) => {
        headGroup.rotation.y = Math.sin(t * 0.85) * 0.08;
        headGroup.rotation.z = Math.cos(t * 1.1) * 0.05;
        scytheGroup.rotation.x = Math.sin(t * 1.6) * 0.12;
        scytheGroup.rotation.z = Math.sin(t * 0.9) * 0.06;
    };

    // Scale down uniformly so total height ~1.4 world units (chibi-comparable)
    root.scale.setScalar(0.68);

    root.userData.roam = { tx: 8, tz: 6, speed: 1.0, phase: Math.PI };
    return root;
}
