/**
 * campfire-renderer.js
 *
 * Builds a decorative campfire Three.Group at local origin (bottom-centre).
 * Caller positions the group at (x+0.5, groundY+1.0, z+0.5) in world space.
 *
 * group.userData.updateFire(worldTime) → animates flames + PointLight flicker.
 * Cost per frame: 3 scale writes + 1 intensity write (negligible).
 */

import * as THREE from 'three';

export function buildCampfireGroup(phase = 0) {
    const group = new THREE.Group();

    // ── Logs: 3 crossed cylinders lying on their sides ───────────────────────
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a2e12 });
    const logGeo = new THREE.CylinderGeometry(0.038, 0.048, 0.46, 6);
    for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(logGeo, logMat);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (i * Math.PI) / 3;
        log.position.y = 0.04;
        group.add(log);
    }

    // ── Embers: small MeshBasicMaterial boxes (unlit → always glowing) ───────
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff4500 });
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const ember = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.055), emberMat);
        ember.position.set(Math.cos(a) * 0.055, 0.06, Math.sin(a) * 0.055);
        group.add(ember);
    }

    // ── Flames: 3 crossing PlaneGeometry quads (MeshBasicMaterial, unlit) ────
    const flamePlanes = [];
    const flameCols = [0xff7000, 0xffaa00, 0xffe040];
    for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: flameCols[i],
            transparent: true,
            opacity: 0.86,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.30), mat);
        flame.rotation.y = (i * Math.PI) / 3;
        flame.position.y = 0.22;
        group.add(flame);
        flamePlanes.push(flame);
    }

    // ── Warm PointLight ───────────────────────────────────────────────────────
    const light = new THREE.PointLight(0xff8c30, 1.1, 7.0);
    light.position.set(0, 0.45, 0);
    group.add(light);

    // ── Flicker update ────────────────────────────────────────────────────────
    group.userData.updateFire = (t) => {
        const f = 0.80 + 0.20 * (
            Math.sin(t * 7.3  + phase) * 0.6 +
            Math.sin(t * 13.1 + phase * 1.7) * 0.4
        );
        for (let i = 0; i < flamePlanes.length; i++) {
            const fl = flamePlanes[i];
            fl.scale.y = f * (0.90 + 0.22 * Math.sin(t * 5.1 + i * 2.1 + phase));
            fl.scale.x = 0.88 + 0.14 * Math.sin(t * 8.7 + i * 3.3);
            fl.position.y = 0.22 + 0.03 * Math.sin(t * 6.2 + i * 1.7);
        }
        light.intensity = f * 1.1;
    };

    return group;
}
