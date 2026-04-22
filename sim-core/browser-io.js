import * as THREE from 'three';

export function createThreeSimulationIO() {
    const createMaterial = (options = {}) => new THREE.MeshLambertMaterial(options);
    const createEdgeMaterial = (options = {}) => new THREE.LineBasicMaterial(options);

    function createBlockVisual({ x = 0, y = 0, z = 0, type = {}, blockSize = 1, material, edgeMaterial, isVisible = true }) {
        let geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
        const variantSeed = Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791));

        if (type.isBed) {
            geometry = new THREE.BoxGeometry(blockSize, blockSize * 0.4, blockSize);
        } else if (type.isStoneWall) {
            geometry = new THREE.BoxGeometry(blockSize * 0.92, blockSize * 1.08, blockSize * 0.92);
        } else if (type.isHouseWall) {
            geometry = new THREE.BoxGeometry(blockSize * 0.9, blockSize * 1.02, blockSize * 0.9);
        } else if (type.isDarkRoof) {
            const longX = (variantSeed % 2) === 0;
            geometry = new THREE.BoxGeometry(
                blockSize * (longX ? 1.45 : 1.15),
                blockSize * 0.22,
                blockSize * (longX ? 1.15 : 1.45)
            );
        } else if (type.isHouseRoof) {
            const roofHeight = [0.72, 0.84, 0.96][variantSeed % 3];
            geometry = new THREE.ConeGeometry(blockSize * 0.8, blockSize * roofHeight, 4);
        }

        const block = new THREE.Mesh(geometry, material);
        let yOffset = 0.5;
        if (type.isBed) yOffset = 0.2;
        else if (type.isDarkRoof) yOffset = blockSize * 0.11;
        else if (type.isHouseRoof) yOffset = 0.4;

        block.position.set(x + 0.5, y + yOffset, z + 0.5);
        if (type.isHouseRoof) block.rotation.y = Math.PI / 4 + ((variantSeed % 4) * (Math.PI / 2));
        if (type.isDarkRoof) block.rotation.y = ((variantSeed % 2) * (Math.PI / 2));
        if (edgeMaterial) {
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(block.geometry), edgeMaterial);
            block.add(edges);
        }
        block.visible = isVisible;
        return block;
    }

    function createCharacterVisuals(character, scene) {
        const m = character.morphology;
        const mesh = new THREE.Group();
        mesh.name = 'Character_' + character.id;
        if (scene && typeof scene.add === 'function') scene.add(mesh);

        // Robe/cloth colour — personality tint applied via updateColorFromPersonality
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xf0f0f4 });
        // Skin colour
        const skinMaterial = new THREE.MeshLambertMaterial({ color: 0xf5c89a });

        function box(w, h, d, mat) {
            const msh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            msh.castShadow = true;
            return msh;
        }

        // ── Torso (stored as `body` for backward compat) ──
        const body = box(m.torsoW, m.torsoH, m.torsoD, bodyMaterial);
        mesh.add(body);

        // ── Pelvis / hips ──
        const pelvis = box(m.pelvisW, m.pelvisH, m.pelvisD, bodyMaterial);
        mesh.add(pelvis);

        // ── Legs: thigh → shin → foot (each as independent group child) ──
        const leftThigh  = box(m.thighW, m.thighH, m.thighD, bodyMaterial);
        const rightThigh = box(m.thighW, m.thighH, m.thighD, bodyMaterial);
        const leftShin   = box(m.shinW,  m.shinH,  m.shinD,  skinMaterial);
        const rightShin  = box(m.shinW,  m.shinH,  m.shinD,  skinMaterial);
        const leftFoot   = box(m.footW,  m.footH,  m.footD,  bodyMaterial);
        const rightFoot  = box(m.footW,  m.footH,  m.footD,  bodyMaterial);
        mesh.add(leftThigh); mesh.add(rightThigh);
        mesh.add(leftShin);  mesh.add(rightShin);
        mesh.add(leftFoot);  mesh.add(rightFoot);

        // ── Arms: upper arm (cloth) + forearm (skin) ──
        const leftArm    = box(m.upperArmW, m.upperArmH, m.upperArmD, bodyMaterial);
        const rightArm   = box(m.upperArmW, m.upperArmH, m.upperArmD, bodyMaterial);
        const leftForearm  = box(m.forearmW, m.forearmH, m.forearmD, skinMaterial);
        const rightForearm = box(m.forearmW, m.forearmH, m.forearmD, skinMaterial);
        mesh.add(leftArm); mesh.add(rightArm);
        mesh.add(leftForearm); mesh.add(rightForearm);

        // ── Angel wings (4 panels behind the torso) ──
        const wingMaterial = new THREE.MeshLambertMaterial({ color: 0xfafafa });
        const leftWingUpper  = box(m.wingUpperW, m.wingUpperH, m.wingUpperD, wingMaterial);
        const rightWingUpper = box(m.wingUpperW, m.wingUpperH, m.wingUpperD, wingMaterial);
        const leftWingLower  = box(m.wingLowerW, m.wingLowerH, m.wingLowerD, wingMaterial);
        const rightWingLower = box(m.wingLowerW, m.wingLowerH, m.wingLowerD, wingMaterial);
        mesh.add(leftWingUpper); mesh.add(rightWingUpper);
        mesh.add(leftWingLower); mesh.add(rightWingLower);

        // ── Head (large chibi square, beige) ──
        const head = box(m.headW, m.headH, m.headD, skinMaterial);
        mesh.add(head);

        const iconAnchor = new THREE.Object3D();
        head.add(iconAnchor);

        // ── Hair (children of head) ──
        const hairMaterial = new THREE.MeshLambertMaterial({ color: 0xb8d400 }); // lime/chartreuse — photo ref
        const hairCapMaterial = new THREE.MeshLambertMaterial({ color: 0xe05068 });
        const hairTop    = box(m.hairTopW, m.hairTopH, m.hairTopD, hairMaterial);
        const hairCapTop = box(m.hairCapW, m.hairCapH, m.hairCapD, hairCapMaterial);
        const hairSideL  = box(m.hairSideW, m.hairSideH, m.hairSideD, hairMaterial);
        const hairSideR  = box(m.hairSideW, m.hairSideH, m.hairSideD, hairMaterial);
        head.add(hairTop); head.add(hairCapTop);
        head.add(hairSideL); head.add(hairSideR);

        // ── Halo (child of head) ──
        const haloMaterial = new THREE.MeshLambertMaterial({ color: 0xf5c830 });
        const halo = box(m.haloW, m.haloH, m.haloD, haloMaterial);
        head.add(halo);

        // ── Eyes + cheeks (children of head) ──
        const eyeMaterial   = new THREE.MeshBasicMaterial({ color: 0x330a0a });
        const cheekMaterial = new THREE.MeshBasicMaterial({ color: 0xe07840 }); // orange blush — photo ref
        const leftEye    = box(m.eyeW, m.eyeH, m.eyeD, eyeMaterial);
        const rightEye   = box(m.eyeW, m.eyeH, m.eyeD, eyeMaterial);
        const leftCheek  = box(m.cheekW, m.cheekH, m.cheekD, cheekMaterial);
        const rightCheek = box(m.cheekW, m.cheekH, m.cheekD, cheekMaterial);
        head.add(leftEye); head.add(rightEye);
        head.add(leftCheek); head.add(rightCheek);

        // Mouth (cute smile)
        const mouth = box(m.mouthW, m.mouthH, m.mouthD,
            new THREE.MeshBasicMaterial({ color: 0xd05070 }));
        head.add(mouth);

        // Eye highlights (sparkle — small white dot upper-inner corner of each eye)
        const eyeHLMat   = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const leftEyeHL  = box(m.eyeHLW, m.eyeHLH, m.eyeHLD, eyeHLMat);
        const rightEyeHL = box(m.eyeHLW, m.eyeHLH, m.eyeHLD, eyeHLMat);
        head.add(leftEyeHL); head.add(rightEyeHL);

        // Eyebrows
        const browMat   = new THREE.MeshBasicMaterial({ color: 0x6a3010 });
        const leftBrow  = box(m.browW, m.browH, m.browD, browMat);
        const rightBrow = box(m.browW, m.browH, m.browD, browMat);
        head.add(leftBrow); head.add(rightBrow);

        // ── Carried item + shadow ──
        const carriedItemMesh = new THREE.Mesh(
            new THREE.BoxGeometry(m.carriedItemSize, m.carriedItemSize, m.carriedItemSize),
            new THREE.MeshLambertMaterial({ color: 0x8B4513 })
        );
        carriedItemMesh.visible = false;
        mesh.add(carriedItemMesh);

        const shadowMesh = new THREE.Mesh(
            new THREE.CircleGeometry(m.shadowRadius, 16),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 })
        );
        shadowMesh.position.set(0, 0.01, 0);
        shadowMesh.rotation.x = -Math.PI / 2;
        mesh.add(shadowMesh);

        let thoughtBubble = null;
        let actionIconDiv = null;
        if (typeof document !== 'undefined' && document.body) {
            thoughtBubble = document.createElement('div');
            thoughtBubble.className = 'thought-bubble';
            thoughtBubble.setAttribute('data-aos', 'zoom-in');
            thoughtBubble.setAttribute('data-aos-duration', '300');
            document.body.appendChild(thoughtBubble);

            actionIconDiv = document.createElement('div');
            actionIconDiv.className = 'action-icon';
            actionIconDiv.style.position = 'fixed';
            actionIconDiv.style.zIndex = 1000;
            actionIconDiv.style.fontSize = '2em';
            actionIconDiv.style.pointerEvents = 'none';
            actionIconDiv.style.transition = 'opacity 0.3s, transform 0.3s';
            actionIconDiv.style.opacity = 0;
            document.body.appendChild(actionIconDiv);
        }

        return {
            mesh,
            bodyMaterial, skinMaterial, hairMaterial, hairCapMaterial,
            body, pelvis,
            leftThigh, rightThigh, leftShin, rightShin, leftFoot, rightFoot,
            leftArm, rightArm, leftForearm, rightForearm,
            leftWingUpper, rightWingUpper, leftWingLower, rightWingLower,
            head, iconAnchor,
            eyeMaterial, leftEye, rightEye, eyeMeshes: [leftEye, rightEye],
            mouth, leftEyeHL, rightEyeHL, leftBrow, rightBrow,
            leftCheek, rightCheek,
            hairTop, hairCapTop, hairSideL, hairSideR,
            halo,
            carriedItemMesh, shadowMesh,
            thoughtBubble, actionIconDiv,
        };
    }

    return {
        createClock: () => new THREE.Clock(),
        createVector3: (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z),
        createColor: (hex = 0x888888) => new THREE.Color(hex),
        createMaterial,
        createEdgeMaterial,
        createBlockVisual,
        createCharacterVisuals,
        updateShadowGeometry(shadowMesh, radius) {
            if (!shadowMesh) return;
            if (shadowMesh.geometry) shadowMesh.geometry.dispose();
            shadowMesh.geometry = new THREE.CircleGeometry(radius, 16);
        },
        toScreenPosition(obj, camera, canvas = null) {
            if (!obj || !camera || obj.visible === false) return null;
            const vector = new THREE.Vector3();
            obj.updateMatrixWorld?.();
            if (obj.matrixWorld) vector.setFromMatrixPosition(obj.matrixWorld);
            else if (typeof obj.getWorldPosition === 'function') obj.getWorldPosition(vector);
            else vector.set(obj.position?.x || 0, obj.position?.y || 0, obj.position?.z || 0);
            vector.project(camera);

            if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) return null;
            if (vector.z < -1 || vector.z > 1) return null;

            // Cache getBoundingClientRect to avoid forced layout reflow every call
            const now = Date.now();
            if (!canvas && typeof document !== 'undefined') {
                canvas = document.getElementById('gameCanvas');
            }
            let rect;
            if (canvas) {
                if (!canvas._cachedRect || now - (canvas._cachedRectTs || 0) > 500) {
                    canvas._cachedRect = canvas.getBoundingClientRect();
                    canvas._cachedRectTs = now;
                }
                rect = canvas._cachedRect;
            } else {
                rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            }
            const x = (vector.x + 1) / 2 * rect.width + rect.left;
            const y = (1 - vector.y) / 2 * rect.height + rect.top;
            const margin = 24;
            if (x < rect.left - margin || x > rect.left + rect.width + margin || y < rect.top - margin || y > rect.top + rect.height + margin) {
                return null;
            }
            return { x, y };
        },
        colorToCssHex(color) {
            return '#' + new THREE.Color(color).getHexString();
        },
        removeVisual(scene, obj) {
            if (scene && obj) scene.remove?.(obj);
            if (obj?.geometry) obj.geometry.dispose();
            if (obj?.material) obj.material.dispose();
            if (obj?.children?.length) {
                obj.children.forEach(child => {
                    if (child?.geometry) child.geometry.dispose();
                    if (child?.material) child.material.dispose();
                });
            }
        },
        getWorldPosition(obj, target = new THREE.Vector3()) {
            if (obj && typeof obj.getWorldPosition === 'function') return obj.getWorldPosition(target);
            return target.set(obj?.position?.x || 0, obj?.position?.y || 0, obj?.position?.z || 0);
        },
        createInstancedCharacterRenderer(scene, maxCount = 200) {
            return createInstancedCharacterRenderer(scene, maxCount);
        }
    };
}

/**
 * InstancedMesh-based voxel character renderer.
 * 27 draw calls — humanoid angel: torso, pelvis, arms×4, legs×6, wings×4,
 * head, hair×4, halo, eyes×2, cheeks×2, shadow.  N characters = same 27 draws.
 */
export function createInstancedCharacterRenderer(scene, maxCount = 200) {
    const _m4group = new THREE.Matrix4();
    const _m4head  = new THREE.Matrix4();
    const _m4world = new THREE.Matrix4();
    const _pos     = new THREE.Vector3();
    const _quat    = new THREE.Quaternion();
    const _scl     = new THREE.Vector3();
    const _dummy   = new THREE.Object3D();
    const _color   = new THREE.Color();

    function makeIM(geo, mat) {
        const im = new THREE.InstancedMesh(geo, mat, maxCount);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        im.count = 0;
        scene.add(im);
        return im;
    }

    const boxGeo    = new THREE.BoxGeometry(1, 1, 1);
    const shadowGeo = new THREE.CircleGeometry(1, 16);
    const mkWhite   = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mkSkin    = () => new THREE.MeshLambertMaterial({ color: 0xffffff }); // setColorAt with skin

    // — Robe/cloth colour (personality tint) —
    const iTorso         = makeIM(boxGeo, mkWhite());
    const iPelvis        = makeIM(boxGeo, mkWhite());
    const iLeftUpperArm  = makeIM(boxGeo, mkWhite());
    const iRightUpperArm = makeIM(boxGeo, mkWhite());
    const iLeftThigh     = makeIM(boxGeo, mkWhite());
    const iRightThigh    = makeIM(boxGeo, mkWhite());
    const iLeftFoot      = makeIM(boxGeo, new THREE.MeshLambertMaterial({ color: 0x111111 })); // black shoes
    const iRightFoot     = makeIM(boxGeo, new THREE.MeshLambertMaterial({ color: 0x111111 })); // black shoes
    const iLeftWingUpper = makeIM(boxGeo, mkWhite());
    const iRightWingUpper= makeIM(boxGeo, mkWhite());
    const iLeftWingLower = makeIM(boxGeo, mkWhite());
    const iRightWingLower= makeIM(boxGeo, mkWhite());

    // — Skin colour (setColorAt with skinMaterial) —
    const iHead          = makeIM(boxGeo, mkSkin());
    const iLeftForearm   = makeIM(boxGeo, mkSkin());
    const iRightForearm  = makeIM(boxGeo, mkSkin());
    const iLeftShin      = makeIM(boxGeo, mkSkin());
    const iRightShin     = makeIM(boxGeo, mkSkin());

    // — Hair colour —
    const iHairTop       = makeIM(boxGeo, mkWhite());
    const iHairSideL     = makeIM(boxGeo, mkWhite());
    const iHairSideR     = makeIM(boxGeo, mkWhite());

    // — Fixed colour (material only, no setColorAt) —
    const iHairCapTop    = makeIM(boxGeo, new THREE.MeshLambertMaterial({ color: 0xe05068 }));
    const iHalo          = makeIM(boxGeo, new THREE.MeshLambertMaterial({ color: 0xf5c830 }));
    const iLeftEye       = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0x330a0a }));
    const iRightEye      = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0x330a0a }));
    const iLeftCheek     = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0xf0a0a0 }));
    const iRightCheek    = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0xf0a0a0 }));
    // Face details: mouth + eye highlights + eyebrows
    const iMouth         = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0xd05070 }));
    const iLeftEyeHL     = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const iRightEyeHL    = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const iLeftBrow      = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0x6a3010 }));
    const iRightBrow     = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0x6a3010 }));
    const iShadow        = makeIM(shadowGeo, new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false,
    }));

    const _allIMs = [
        iTorso, iPelvis,
        iLeftUpperArm, iRightUpperArm, iLeftForearm, iRightForearm,
        iLeftThigh, iRightThigh, iLeftShin, iRightShin, iLeftFoot, iRightFoot,
        iLeftWingUpper, iRightWingUpper, iLeftWingLower, iRightWingLower,
        iHead, iHairTop, iHairSideL, iHairSideR, iHairCapTop,
        iHalo, iLeftEye, iRightEye, iLeftCheek, iRightCheek,
        iMouth, iLeftEyeHL, iRightEyeHL, iLeftBrow, iRightBrow,
        iShadow,
    ];
    // Cloth colour = bodyMaterial (jacket: torso + upper arms only)
    const _robeIMs  = [iTorso, iLeftUpperArm, iRightUpperArm];
    // Skin colour = skinMaterial (head + forearms/hands)
    const _skinIMs  = [iHead, iLeftForearm, iRightForearm];
    // Pants — fixed dark brown
    const _pantsIMs = [iPelvis, iLeftThigh, iRightThigh, iLeftShin, iRightShin];
    // Feet — fixed black (material preset; setColorAt keeps instanceColor buffer in sync)
    const _feetIMs  = [iLeftFoot, iRightFoot];
    // Hair colour = hairMaterial
    const _hairIMs  = [iHairTop, iHairSideL, iHairSideR];

    // Compute world matrix of a direct group child → load pos+quat into _dummy
    function _fromChild(parentM4, child) {
        child.updateMatrix();
        _m4world.multiplyMatrices(parentM4, child.matrix);
        _m4world.decompose(_pos, _quat, _scl);
        _dummy.position.copy(_pos);
        _dummy.quaternion.copy(_quat);
    }
    function _z(im, idx) {
        _dummy.scale.setScalar(0); _dummy.updateMatrix(); im.setMatrixAt(idx, _dummy.matrix);
    }
    // Write a group-child part (pos+quat from parent, scale explicit)
    function _write(im, idx, child, parentM4, sx, sy, sz) {
        if (!child) { _z(im, idx); return; }
        _fromChild(parentM4, child);
        _dummy.scale.set(sx, sy, sz);
        _dummy.updateMatrix();
        im.setMatrixAt(idx, _dummy.matrix);
    }

    return {
        update(characters) {
            const selectedId = (typeof window !== 'undefined' && window.selectedCharacterId != null)
                ? String(window.selectedCharacterId) : '';

            let idx = 0;
            for (const char of characters) {
                if (!char || char.state === 'dead') continue;
                if (!char.body || !char.head || !char.mesh) continue;
                if (selectedId && String(char.id) === selectedId) continue;
                const m = char.morphology;
                if (!m) continue;

                const group = char.mesh;
                group.updateMatrix();
                _m4group.compose(group.position, group.quaternion, group.scale);

                // — Torso —
                _write(iTorso, idx, char.body, _m4group, m.torsoW, m.torsoH, m.torsoD);
                // — Pelvis —
                _write(iPelvis, idx, char.pelvis, _m4group, m.pelvisW, m.pelvisH, m.pelvisD);
                // — Upper arms —
                _write(iLeftUpperArm,  idx, char.leftArm,  _m4group, m.upperArmW, m.upperArmH, m.upperArmD);
                _write(iRightUpperArm, idx, char.rightArm, _m4group, m.upperArmW, m.upperArmH, m.upperArmD);
                // — Forearms —
                _write(iLeftForearm,  idx, char.leftForearm,  _m4group, m.forearmW, m.forearmH, m.forearmD);
                _write(iRightForearm, idx, char.rightForearm, _m4group, m.forearmW, m.forearmH, m.forearmD);
                // — Legs —
                _write(iLeftThigh,  idx, char.leftThigh,  _m4group, m.thighW, m.thighH, m.thighD);
                _write(iRightThigh, idx, char.rightThigh, _m4group, m.thighW, m.thighH, m.thighD);
                _write(iLeftShin,   idx, char.leftShin,   _m4group, m.shinW,  m.shinH,  m.shinD);
                _write(iRightShin,  idx, char.rightShin,  _m4group, m.shinW,  m.shinH,  m.shinD);
                _write(iLeftFoot,   idx, char.leftFoot,   _m4group, m.footW,  m.footH,  m.footD);
                _write(iRightFoot,  idx, char.rightFoot,  _m4group, m.footW,  m.footH,  m.footD);
                // — Wings —
                _z(iLeftWingUpper,  idx); _z(iRightWingUpper, idx); // wings hidden
                _z(iLeftWingLower,  idx); _z(iRightWingLower,  idx);

                // — Head —
                char.head.updateMatrix();
                _m4head.multiplyMatrices(_m4group, char.head.matrix);
                _m4head.decompose(_pos, _quat, _scl);
                _dummy.position.copy(_pos); _dummy.quaternion.copy(_quat);
                _dummy.scale.set(m.headW, m.headH, m.headD);
                _dummy.updateMatrix(); iHead.setMatrixAt(idx, _dummy.matrix);

                // — Head children —
                _write(iHairTop,    idx, char.hairTop,    _m4head, m.hairTopW, m.hairTopH, m.hairTopD);
                _write(iHairCapTop, idx, null, _m4head, 0, 0, 0); // hidden — no stacking
                _write(iHairSideL,  idx, null, _m4head, 0, 0, 0); // hidden — no side panels
                _write(iHairSideR,  idx, null, _m4head, 0, 0, 0); // hidden — no side panels
                _z(iHalo, idx); // halo hidden
                _write(iLeftEye,    idx, char.leftEye,    _m4head, m.eyeW, m.eyeH, m.eyeD);
                _write(iRightEye,   idx, char.rightEye,   _m4head, m.eyeW, m.eyeH, m.eyeD);
                _write(iLeftCheek,  idx, char.leftCheek,  _m4head, m.cheekW, m.cheekH, m.cheekD);
                _write(iRightCheek, idx, char.rightCheek, _m4head, m.cheekW, m.cheekH, m.cheekD);
                _write(iMouth,      idx, null,         _m4head, 0, 0, 0); // hidden
                _write(iLeftEyeHL,  idx, char.leftEyeHL,  _m4head, m.eyeHLW, m.eyeHLH, m.eyeHLD);
                _write(iRightEyeHL, idx, char.rightEyeHL, _m4head, m.eyeHLW, m.eyeHLH, m.eyeHLD);
                _write(iLeftBrow,   idx, char.leftBrow,   _m4head, m.browW, m.browH, m.browD);
                _write(iRightBrow,  idx, char.rightBrow,  _m4head, m.browW, m.browH, m.browD);

                // — Shadow —
                const sr = m.shadowRadius * (char._shadowInstanceScale ?? 1.0);
                _dummy.position.set(group.position.x, 0.01, group.position.z);
                _dummy.rotation.set(-Math.PI / 2, 0, 0);
                _dummy.scale.set(sr, sr, 1);
                _dummy.updateMatrix(); iShadow.setMatrixAt(idx, _dummy.matrix);

                // — Per-instance colours —
                const robeHex = char.bodyMaterial.color.getHex();
                _color.setHex(robeHex);
                for (const im of _robeIMs) im.setColorAt(idx, _color);

                const skinHex = char.skinMaterial ? char.skinMaterial.color.getHex() : 0xf5c89a;
                _color.setHex(skinHex);
                for (const im of _skinIMs) im.setColorAt(idx, _color);

                _color.setHex(char.hairMaterial ? char.hairMaterial.color.getHex() : 0xb8d400);
                for (const im of _hairIMs) im.setColorAt(idx, _color);

                // Pants — fixed dark brown
                _color.setHex(0x6b3515);
                for (const im of _pantsIMs) im.setColorAt(idx, _color);
                // Feet — fixed black
                _color.setHex(0x111111);
                for (const im of _feetIMs) im.setColorAt(idx, _color);

                idx++;
            }

            for (const im of _allIMs) im.count = idx;
            for (const im of _allIMs) im.instanceMatrix.needsUpdate = true;
            for (const im of [..._robeIMs, ..._skinIMs, ..._hairIMs, ..._pantsIMs, ..._feetIMs]) {
                if (im.instanceColor) im.instanceColor.needsUpdate = true;
            }
        }
    };
}
