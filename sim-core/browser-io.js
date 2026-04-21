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

        const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xc68642 });
        bodyMaterial.gradientMap = null;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(m.bodyTopRadius, m.bodyBottomRadius, m.bodyHeight, 8), bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        mesh.add(body);

        const head = new THREE.Mesh(new THREE.CylinderGeometry(m.headRadiusTop, m.headRadiusBottom, m.headHeight, 8), bodyMaterial);
        head.castShadow = true;
        head.receiveShadow = true;
        mesh.add(head);

        const iconAnchor = new THREE.Object3D();
        head.add(iconAnchor);

        const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const eyeGeometry = new THREE.CylinderGeometry(m.eyeRadius, m.eyeRadius, 0.01, 6);
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.rotation.x = Math.PI / 2;
        head.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.rotation.x = Math.PI / 2;
        head.add(rightEye);

        const mouthGeometry = new THREE.CylinderGeometry(m.mouthRadius, m.mouthRadius, 0.01, 6);
        const mouth = new THREE.Mesh(mouthGeometry, eyeMaterial);
        mouth.rotation.x = Math.PI / 2;
        head.add(mouth);

        const armMaterial = new THREE.MeshLambertMaterial({ color: 0xc68642 });
        const armGeometry = new THREE.TorusGeometry(m.armLoopRadius, m.armThickness, 6, 10, Math.PI * 1.2);
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.rotation.z = Math.PI / 2.2;
        body.add(leftArm);

        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.rotation.z = -Math.PI / 2.2;
        body.add(rightArm);

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
            body,
            head,
            iconAnchor,
            eyeMaterial,
            leftEye,
            rightEye,
            eyeMeshes: [leftEye, rightEye],
            mouth,
            leftArm,
            rightArm,
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
 * InstancedMesh-based character renderer.
 * Renders body, head, arms, and shadow as batched GPU draw calls (one per part type)
 * instead of one draw call per character per part (~9× reduction in draw calls).
 *
 * Selected characters are excluded from InstancedMesh and use their individual Three.js
 * meshes (required for emissive selection glow). Parts are hidden via Layer 31.
 */
export function createInstancedCharacterRenderer(scene, maxCount = 200) {
    // --- Reusable math objects (avoid per-frame allocation) ---
    const _m4group  = new THREE.Matrix4();
    const _m4body   = new THREE.Matrix4();
    const _m4world  = new THREE.Matrix4();
    const _pos      = new THREE.Vector3();
    const _quat     = new THREE.Quaternion();
    const _scl      = new THREE.Vector3(); // throwaway decompose target
    const _dummy    = new THREE.Object3D();
    const _color    = new THREE.Color();

    function makeIM(geo, mat) {
        const im = new THREE.InstancedMesh(geo, mat, maxCount);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        im.count = 0;
        scene.add(im);
        return im;
    }

    // Base geometries (normalized: bottomRadius=1, height=1, so per-instance scale encodes size)
    // Average taper ratios derived from morphology formula ranges:
    //   bodyTopRadius  ≈ 0.15–0.25, bodyBottomRadius ≈ 0.20–0.35  → top/bottom ≈ 0.76
    //   headRadiusTop  ≈ 0.12–0.25, headRadiusBottom ≈ 0.14–0.28  → top/bottom ≈ 0.90
    const bodyGeo   = new THREE.CylinderGeometry(0.76, 1.0, 1, 8);
    const headGeo   = new THREE.CylinderGeometry(0.90, 1.0, 1, 8);
    const shadowGeo = new THREE.CircleGeometry(1, 16);
    // TorusGeometry(radius, tube, radialSeg, tubularSeg, arc); tube=0.2 ≈ avg armThickness/armLoopRadius
    const armGeo    = new THREE.TorusGeometry(1, 0.2, 6, 10, Math.PI * 1.2);

    // White base material so per-instance colour multiplies through correctly
    const mkBodyMat = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const iBody     = makeIM(bodyGeo,   mkBodyMat());
    const iHead     = makeIM(headGeo,   mkBodyMat());
    const iLeftArm  = makeIM(armGeo,    mkBodyMat());
    const iRightArm = makeIM(armGeo,    mkBodyMat());
    const iShadow   = makeIM(shadowGeo, new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false
    }));

    return {
        /** Call once per frame, after all char.update() calls, before renderer.render(). */
        update(characters) {
            const selectedId = (typeof window !== 'undefined' && window.selectedCharacterId != null)
                ? String(window.selectedCharacterId) : '';

            let idx = 0;
            for (const char of characters) {
                if (!char || char.state === 'dead') continue;
                if (!char.body || !char.head || !char.leftArm || !char.rightArm || !char.mesh) continue;
                // Selected character keeps individual mesh (needed for emissive glow)
                if (selectedId && String(char.id) === selectedId) continue;
                const m = char.morphology;
                if (!m) continue;

                const group = char.mesh;

                // Group world matrix (group is a root-level scene child → worldMatrix = local)
                group.updateMatrix();
                _m4group.compose(group.position, group.quaternion, group.scale);

                // --- Body (direct child of group) ---
                char.body.updateMatrix();
                _m4body.multiplyMatrices(_m4group, char.body.matrix);
                _m4body.decompose(_pos, _quat, _scl);
                _dummy.position.copy(_pos);
                _dummy.quaternion.copy(_quat);
                _dummy.scale.set(m.bodyBottomRadius, m.bodyHeight, m.bodyBottomRadius);
                _dummy.updateMatrix();
                iBody.setMatrixAt(idx, _dummy.matrix);

                // --- Head (direct child of group) ---
                char.head.updateMatrix();
                _m4world.multiplyMatrices(_m4group, char.head.matrix);
                _m4world.decompose(_pos, _quat, _scl);
                _dummy.position.copy(_pos);
                _dummy.quaternion.copy(_quat);
                _dummy.scale.set(m.headRadiusBottom, m.headHeight, m.headRadiusBottom);
                _dummy.updateMatrix();
                iHead.setMatrixAt(idx, _dummy.matrix);

                // --- Left arm (child of body) ---
                char.leftArm.updateMatrix();
                _m4world.multiplyMatrices(_m4body, char.leftArm.matrix);
                _m4world.decompose(_pos, _quat, _scl);
                _dummy.position.copy(_pos);
                _dummy.quaternion.copy(_quat);
                _dummy.scale.setScalar(m.armLoopRadius);
                _dummy.updateMatrix();
                iLeftArm.setMatrixAt(idx, _dummy.matrix);

                // --- Right arm (child of body) ---
                char.rightArm.updateMatrix();
                _m4world.multiplyMatrices(_m4body, char.rightArm.matrix);
                _m4world.decompose(_pos, _quat, _scl);
                _dummy.position.copy(_pos);
                _dummy.quaternion.copy(_quat);
                _dummy.scale.setScalar(m.armLoopRadius);
                _dummy.updateMatrix();
                iRightArm.setMatrixAt(idx, _dummy.matrix);

                // --- Shadow (flat circle at ground level, scale encodes radius + pulse) ---
                const sr = m.shadowRadius * (char._shadowInstanceScale ?? 1.0);
                _dummy.position.set(group.position.x, 0.01, group.position.z);
                _dummy.rotation.set(-Math.PI / 2, 0, 0);
                _dummy.scale.set(sr, sr, 1);
                _dummy.updateMatrix();
                iShadow.setMatrixAt(idx, _dummy.matrix);

                // --- Per-instance colour: body/head from personality, arms fixed brown ---
                _color.copy(char.bodyMaterial.color);
                iBody.setColorAt(idx, _color);
                iHead.setColorAt(idx, _color);
                _color.setHex(0xc68642);
                iLeftArm.setColorAt(idx, _color);
                iRightArm.setColorAt(idx, _color);

                idx++;
            }

            iBody.count = iHead.count = iLeftArm.count = iRightArm.count = iShadow.count = idx;

            iBody.instanceMatrix.needsUpdate = true;
            iHead.instanceMatrix.needsUpdate = true;
            iLeftArm.instanceMatrix.needsUpdate = true;
            iRightArm.instanceMatrix.needsUpdate = true;
            iShadow.instanceMatrix.needsUpdate = true;

            if (iBody.instanceColor)    iBody.instanceColor.needsUpdate = true;
            if (iHead.instanceColor)    iHead.instanceColor.needsUpdate = true;
            if (iLeftArm.instanceColor) iLeftArm.instanceColor.needsUpdate = true;
            if (iRightArm.instanceColor)iRightArm.instanceColor.needsUpdate = true;
        }
    };
}
