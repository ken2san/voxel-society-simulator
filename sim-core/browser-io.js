import * as THREE from 'three';

export function createThreeSimulationIO() {
    const createMaterial = (options = {}) => new THREE.MeshLambertMaterial(options);
    const createEdgeMaterial = (options = {}) => new THREE.LineBasicMaterial(options);

    function createBlockVisual({ x = 0, y = 0, z = 0, type = {}, blockSize = 1, material, edgeMaterial, isVisible = true }) {
        let geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);

        if (type.isBed) {
            geometry = new THREE.BoxGeometry(blockSize, blockSize * 0.4, blockSize);
        } else if (type.isHouseWall) {
            geometry = new THREE.BoxGeometry(blockSize * 0.9, blockSize, blockSize * 0.9);
        } else if (type.isHouseRoof) {
            geometry = new THREE.ConeGeometry(blockSize * 0.7, blockSize * 0.8, 4);
        }

        const block = new THREE.Mesh(geometry, material);
        let yOffset = 0.5;
        if (type.isBed) yOffset = 0.2;
        else if (type.isHouseRoof) yOffset = 0.4;

        block.position.set(x + 0.5, y + yOffset, z + 0.5);
        if (type.isHouseRoof) block.rotation.y = Math.PI / 4;
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
        const body = new THREE.Mesh(new THREE.CylinderGeometry(m.bodyTopRadius, m.bodyBottomRadius, m.bodyHeight, 32), bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        mesh.add(body);

        const head = new THREE.Mesh(new THREE.CylinderGeometry(m.headRadiusTop, m.headRadiusBottom, m.headHeight, 24), bodyMaterial);
        head.castShadow = true;
        head.receiveShadow = true;
        mesh.add(head);

        const iconAnchor = new THREE.Object3D();
        head.add(iconAnchor);

        const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const eyeGeometry = new THREE.CylinderGeometry(m.eyeRadius, m.eyeRadius, 0.01, 12);
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.rotation.x = Math.PI / 2;
        head.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.rotation.x = Math.PI / 2;
        head.add(rightEye);

        const mouthGeometry = new THREE.CylinderGeometry(m.mouthRadius, m.mouthRadius, 0.01, 12);
        const mouth = new THREE.Mesh(mouthGeometry, eyeMaterial);
        mouth.rotation.x = Math.PI / 2;
        head.add(mouth);

        const armMaterial = new THREE.MeshLambertMaterial({ color: 0xc68642 });
        const armGeometry = new THREE.TorusGeometry(m.armLoopRadius, m.armThickness, 10, 24, Math.PI * 1.2);
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
            new THREE.CircleGeometry(m.shadowRadius, 32),
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
            shadowMesh.geometry = new THREE.CircleGeometry(radius, 32);
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

            let rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            if (!canvas && typeof document !== 'undefined') {
                canvas = document.getElementById('gameCanvas');
            }
            if (canvas && typeof canvas.getBoundingClientRect === 'function') {
                rect = canvas.getBoundingClientRect();
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
        }
    };
}
