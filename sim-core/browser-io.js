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

        // Robe body material — white/ivory, personality colour applied via updateColorFromPersonality
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });

        // --- Body rows (3 stacked voxel boxes = fluffy robe effect) ---
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(m.bodyRow1W, m.bodyRow1H, m.bodyDepth),
            bodyMaterial
        );
        body.castShadow = true;
        mesh.add(body);

        const bodyRow2 = new THREE.Mesh(
            new THREE.BoxGeometry(m.bodyRow2W, m.bodyRow2H, m.bodyDepth * 0.96),
            bodyMaterial
        );
        bodyRow2.castShadow = true;
        mesh.add(bodyRow2);

        const bodyRow3 = new THREE.Mesh(
            new THREE.BoxGeometry(m.bodyRow3W, m.bodyRow3H, m.bodyDepth * 0.88),
            bodyMaterial
        );
        bodyRow3.castShadow = true;
        mesh.add(bodyRow3);

        // --- Head (large boxy, beige skin) ---
        const skinMaterial = new THREE.MeshLambertMaterial({ color: 0xf5c89a });
        const head = new THREE.Mesh(
            new THREE.BoxGeometry(m.headW, m.headH, m.headD),
            skinMaterial
        );
        head.castShadow = true;
        mesh.add(head);

        const iconAnchor = new THREE.Object3D();
        head.add(iconAnchor);

        // --- Hair (orange/salmon voxels, children of head) ---
        const hairMaterial = new THREE.MeshLambertMaterial({ color: 0xe87040 });
        const hairTop = new THREE.Mesh(
            new THREE.BoxGeometry(m.hairTopW, m.hairTopH, m.hairTopD),
            hairMaterial
        );
        head.add(hairTop);

        const hairSideL = new THREE.Mesh(
            new THREE.BoxGeometry(m.hairSideW, m.hairSideH, m.hairSideD),
            hairMaterial
        );
        head.add(hairSideL);

        const hairSideR = new THREE.Mesh(
            new THREE.BoxGeometry(m.hairSideW, m.hairSideH, m.hairSideD),
            hairMaterial
        );
        head.add(hairSideR);

        // --- Halo (flat golden box, child of head) ---
        const haloMaterial = new THREE.MeshLambertMaterial({ color: 0xf5c830 });
        const halo = new THREE.Mesh(
            new THREE.BoxGeometry(m.haloW, m.haloH, m.haloD),
            haloMaterial
        );
        head.add(halo);

        // --- Eyes (dark red flat boxes, children of head) ---
        const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x8b1010 });
        const leftEye = new THREE.Mesh(
            new THREE.BoxGeometry(m.eyeW, m.eyeH, m.eyeD),
            eyeMaterial
        );
        head.add(leftEye);

        const rightEye = new THREE.Mesh(
            new THREE.BoxGeometry(m.eyeW, m.eyeH, m.eyeD),
            eyeMaterial
        );
        head.add(rightEye);

        // --- Cheeks (pink blush, children of head) ---
        const cheekMaterial = new THREE.MeshBasicMaterial({ color: 0xf0a0a0 });
        const leftCheek = new THREE.Mesh(
            new THREE.BoxGeometry(m.cheekW, m.cheekH, m.cheekD),
            cheekMaterial
        );
        head.add(leftCheek);

        const rightCheek = new THREE.Mesh(
            new THREE.BoxGeometry(m.cheekW, m.cheekH, m.cheekD),
            cheekMaterial
        );
        head.add(rightCheek);

        // --- Mouth (stub kept for animation compatibility) ---
        const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x8b1010 });
        const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.02), mouthMaterial);
        mouth.visible = false;
        head.add(mouth);

        // --- Wings (white box stubs, replace arms as direct group children) ---
        const wingMaterial = new THREE.MeshLambertMaterial({ color: 0xf8f8f8 });
        const leftArm = new THREE.Mesh(
            new THREE.BoxGeometry(m.wingW, m.wingH, m.wingD),
            wingMaterial
        );
        mesh.add(leftArm);

        const rightArm = new THREE.Mesh(
            new THREE.BoxGeometry(m.wingW, m.wingH, m.wingD),
            wingMaterial
        );
        mesh.add(rightArm);

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
            bodyMaterial,
            body, bodyRow2, bodyRow3,
            skinMaterial, hairMaterial,
            head, iconAnchor,
            eyeMaterial, leftEye, rightEye,
            eyeMeshes: [leftEye, rightEye],
            mouth,
            leftArm, rightArm,       // wings
            leftCheek, rightCheek,
            hairTop, hairSideL, hairSideR,
            halo,
            carriedItemMesh,
            shadowMesh,
            thoughtBubble,
            actionIconDiv,
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
 * 15 draw calls total (body×3, head, hair×3, halo, eyes×2, cheeks×2, wings×2, shadow),
 * all GPU-instanced — N characters at any population costs the same 15 draw calls.
 */
export function createInstancedCharacterRenderer(scene, maxCount = 200) {
    // Reusable math objects — avoids per-frame allocation
    const _m4group = new THREE.Matrix4();
    const _m4body  = new THREE.Matrix4();
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

    // Unit box + circle geometries — per-instance scale encodes actual dimensions
    const boxGeo    = new THREE.BoxGeometry(1, 1, 1);
    const shadowGeo = new THREE.CircleGeometry(1, 16);

    const mkWhite = () => new THREE.MeshLambertMaterial({ color: 0xffffff });

    // Personality-coloured (white base + setColorAt per frame)
    const iBodyRow1  = makeIM(boxGeo, mkWhite());
    const iBodyRow2  = makeIM(boxGeo, mkWhite());
    const iBodyRow3  = makeIM(boxGeo, mkWhite());
    const iHead      = makeIM(boxGeo, mkWhite());
    const iHairTop   = makeIM(boxGeo, mkWhite());
    const iHairSideL = makeIM(boxGeo, mkWhite());
    const iHairSideR = makeIM(boxGeo, mkWhite());
    const iLeftWing  = makeIM(boxGeo, mkWhite());
    const iRightWing = makeIM(boxGeo, mkWhite());

    // Fixed-colour (material colour only, no setColorAt)
    const iHalo      = makeIM(boxGeo, new THREE.MeshLambertMaterial({ color: 0xf5c830 }));
    const iLeftEye   = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0x8b1010 }));
    const iRightEye  = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0x8b1010 }));
    const iLeftCheek = makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0xf0a0a0 }));
    const iRightCheek= makeIM(boxGeo, new THREE.MeshBasicMaterial({ color: 0xf0a0a0 }));
    const iShadow    = makeIM(shadowGeo, new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false
    }));

    const _allIMs    = [iBodyRow1, iBodyRow2, iBodyRow3, iHead, iHairTop, iHairSideL, iHairSideR,
                        iHalo, iLeftEye, iRightEye, iLeftCheek, iRightCheek, iLeftWing, iRightWing, iShadow];
    const _colorIMs  = [iBodyRow1, iBodyRow2, iBodyRow3, iHead, iHairTop, iHairSideL, iHairSideR, iLeftWing, iRightWing];

    // Compute world matrix of child (child of parentM4) and load into _dummy pos/quat
    function _fromChild(parentM4, child) {
        child.updateMatrix();
        _m4world.multiplyMatrices(parentM4, child.matrix);
        _m4world.decompose(_pos, _quat, _scl);
        _dummy.position.copy(_pos);
        _dummy.quaternion.copy(_quat);
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

                // --- Body rows (direct children of group) ---
                char.body.updateMatrix();
                _m4body.multiplyMatrices(_m4group, char.body.matrix);
                _m4body.decompose(_pos, _quat, _scl);
                _dummy.position.copy(_pos); _dummy.quaternion.copy(_quat);
                _dummy.scale.set(m.bodyRow1W, m.bodyRow1H, m.bodyDepth);
                _dummy.updateMatrix();
                iBodyRow1.setMatrixAt(idx, _dummy.matrix);

                if (char.bodyRow2) {
                    _fromChild(_m4group, char.bodyRow2);
                    _dummy.scale.set(m.bodyRow2W, m.bodyRow2H, m.bodyDepth * 0.96);
                    _dummy.updateMatrix();
                    iBodyRow2.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iBodyRow2.setMatrixAt(idx, _dummy.matrix); }

                if (char.bodyRow3) {
                    _fromChild(_m4group, char.bodyRow3);
                    _dummy.scale.set(m.bodyRow3W, m.bodyRow3H, m.bodyDepth * 0.88);
                    _dummy.updateMatrix();
                    iBodyRow3.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iBodyRow3.setMatrixAt(idx, _dummy.matrix); }

                // --- Head (direct child of group) ---
                char.head.updateMatrix();
                _m4head.multiplyMatrices(_m4group, char.head.matrix);
                _m4head.decompose(_pos, _quat, _scl);
                _dummy.position.copy(_pos); _dummy.quaternion.copy(_quat);
                _dummy.scale.set(m.headW, m.headH, m.headD);
                _dummy.updateMatrix();
                iHead.setMatrixAt(idx, _dummy.matrix);

                // --- Hair (children of head) ---
                if (char.hairTop) {
                    _fromChild(_m4head, char.hairTop);
                    _dummy.scale.set(m.hairTopW, m.hairTopH, m.hairTopD);
                    _dummy.updateMatrix(); iHairTop.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iHairTop.setMatrixAt(idx, _dummy.matrix); }

                if (char.hairSideL) {
                    _fromChild(_m4head, char.hairSideL);
                    _dummy.scale.set(m.hairSideW, m.hairSideH, m.hairSideD);
                    _dummy.updateMatrix(); iHairSideL.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iHairSideL.setMatrixAt(idx, _dummy.matrix); }

                if (char.hairSideR) {
                    _fromChild(_m4head, char.hairSideR);
                    _dummy.scale.set(m.hairSideW, m.hairSideH, m.hairSideD);
                    _dummy.updateMatrix(); iHairSideR.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iHairSideR.setMatrixAt(idx, _dummy.matrix); }

                // --- Halo (child of head) ---
                if (char.halo) {
                    _fromChild(_m4head, char.halo);
                    _dummy.scale.set(m.haloW, m.haloH, m.haloD);
                    _dummy.updateMatrix(); iHalo.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iHalo.setMatrixAt(idx, _dummy.matrix); }

                // --- Eyes (children of head) ---
                if (char.leftEye) {
                    _fromChild(_m4head, char.leftEye);
                    _dummy.scale.set(m.eyeW, m.eyeH, m.eyeD);
                    _dummy.updateMatrix(); iLeftEye.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iLeftEye.setMatrixAt(idx, _dummy.matrix); }

                if (char.rightEye) {
                    _fromChild(_m4head, char.rightEye);
                    _dummy.scale.set(m.eyeW, m.eyeH, m.eyeD);
                    _dummy.updateMatrix(); iRightEye.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iRightEye.setMatrixAt(idx, _dummy.matrix); }

                // --- Cheeks (children of head) ---
                if (char.leftCheek) {
                    _fromChild(_m4head, char.leftCheek);
                    _dummy.scale.set(m.cheekW, m.cheekH, m.cheekD);
                    _dummy.updateMatrix(); iLeftCheek.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iLeftCheek.setMatrixAt(idx, _dummy.matrix); }

                if (char.rightCheek) {
                    _fromChild(_m4head, char.rightCheek);
                    _dummy.scale.set(m.cheekW, m.cheekH, m.cheekD);
                    _dummy.updateMatrix(); iRightCheek.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iRightCheek.setMatrixAt(idx, _dummy.matrix); }

                // --- Wings / arms (direct children of group) ---
                if (char.leftArm) {
                    _fromChild(_m4group, char.leftArm);
                    _dummy.scale.set(m.wingW, m.wingH, m.wingD);
                    _dummy.updateMatrix(); iLeftWing.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iLeftWing.setMatrixAt(idx, _dummy.matrix); }

                if (char.rightArm) {
                    _fromChild(_m4group, char.rightArm);
                    _dummy.scale.set(m.wingW, m.wingH, m.wingD);
                    _dummy.updateMatrix(); iRightWing.setMatrixAt(idx, _dummy.matrix);
                } else { _dummy.scale.setScalar(0); _dummy.updateMatrix(); iRightWing.setMatrixAt(idx, _dummy.matrix); }

                // --- Shadow ---
                const sr = m.shadowRadius * (char._shadowInstanceScale ?? 1.0);
                _dummy.position.set(group.position.x, 0.01, group.position.z);
                _dummy.rotation.set(-Math.PI / 2, 0, 0);
                _dummy.scale.set(sr, sr, 1);
                _dummy.updateMatrix();
                iShadow.setMatrixAt(idx, _dummy.matrix);

                // --- Per-instance colours ---
                _color.copy(char.bodyMaterial.color);
                iBodyRow1.setColorAt(idx, _color);
                iBodyRow2.setColorAt(idx, _color);
                iBodyRow3.setColorAt(idx, _color);
                iLeftWing.setColorAt(idx, _color);
                iRightWing.setColorAt(idx, _color);

                _color.setHex(char.skinMaterial ? char.skinMaterial.color.getHex() : 0xf5c89a);
                iHead.setColorAt(idx, _color);

                _color.setHex(char.hairMaterial ? char.hairMaterial.color.getHex() : 0xe87040);
                iHairTop.setColorAt(idx, _color);
                iHairSideL.setColorAt(idx, _color);
                iHairSideR.setColorAt(idx, _color);

                idx++;
            }

            for (const im of _allIMs) im.count = idx;
            for (const im of _allIMs) im.instanceMatrix.needsUpdate = true;
            for (const im of _colorIMs) { if (im.instanceColor) im.instanceColor.needsUpdate = true; }
        }
    };
}

