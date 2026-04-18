function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

export function createVector3(x = 0, y = 0, z = 0) {
    return {
        x: Number(x) || 0,
        y: Number(y) || 0,
        z: Number(z) || 0,
        set(nx = 0, ny = 0, nz = 0) {
            this.x = Number(nx) || 0;
            this.y = Number(ny) || 0;
            this.z = Number(nz) || 0;
            return this;
        },
        copy(other) {
            return this.set(other?.x, other?.y, other?.z);
        },
        clone() {
            return createVector3(this.x, this.y, this.z);
        },
        add(other) {
            this.x += Number(other?.x) || 0;
            this.y += Number(other?.y) || 0;
            this.z += Number(other?.z) || 0;
            return this;
        },
        sub(other) {
            this.x -= Number(other?.x) || 0;
            this.y -= Number(other?.y) || 0;
            this.z -= Number(other?.z) || 0;
            return this;
        },
        multiplyScalar(scalar = 1) {
            const n = Number(scalar) || 0;
            this.x *= n;
            this.y *= n;
            this.z *= n;
            return this;
        },
        lengthSq() {
            return (this.x * this.x) + (this.y * this.y) + (this.z * this.z);
        },
        length() {
            return Math.sqrt(this.lengthSq());
        },
        normalize() {
            const len = this.length();
            if (len > 1e-8) this.multiplyScalar(1 / len);
            return this;
        },
        project() {
            return this;
        },
        setFromMatrixPosition(matrixLike) {
            if (matrixLike && typeof matrixLike === 'object') {
                this.copy(matrixLike.position || matrixLike);
            }
            return this;
        }
    };
}

export function toVector3(value) {
    if (value && typeof value.clone === 'function' && typeof value.x === 'number') {
        return value.clone();
    }
    return createVector3(value?.x, value?.y, value?.z);
}

export function gridToWorldPosition(pos, yOffset = 0.5) {
    return createVector3(
        (Number(pos?.x) || 0) + 0.5,
        (Number(pos?.y) || 0) + yOffset,
        (Number(pos?.z) || 0) + 0.5
    );
}

export function createColor(hex = 0x888888) {
    const color = {
        value: Number(hex) || 0,
        set(hex = 0x888888) {
            this.value = Number(hex) || 0;
            return this;
        },
        setRGB(r = 0, g = 0, b = 0) {
            const rr = clampByte((Number(r) || 0) * 255);
            const gg = clampByte((Number(g) || 0) * 255);
            const bb = clampByte((Number(b) || 0) * 255);
            this.value = (rr << 16) | (gg << 8) | bb;
            return this;
        },
        getHexString() {
            return (this.value >>> 0).toString(16).padStart(6, '0');
        },
        clone() {
            return createColor(this.value);
        },
        lerpColors(from, to, alpha = 0) {
            const t = Math.max(0, Math.min(1, Number(alpha) || 0));
            const fromValue = Number(from?.value ?? from) || 0;
            const toValue = Number(to?.value ?? to) || 0;
            const fr = (fromValue >> 16) & 255;
            const fg = (fromValue >> 8) & 255;
            const fb = fromValue & 255;
            const tr = (toValue >> 16) & 255;
            const tg = (toValue >> 8) & 255;
            const tb = toValue & 255;
            this.value = (
                (clampByte(fr + (tr - fr) * t) << 16) |
                (clampByte(fg + (tg - fg) * t) << 8) |
                clampByte(fb + (tb - fb) * t)
            );
            return this;
        }
    };
    return color;
}

function createScale(x = 1, y = 1, z = 1) {
    return {
        x, y, z,
        set(nx = 1, ny = 1, nz = 1) {
            this.x = Number(nx) || 0;
            this.y = Number(ny) || 0;
            this.z = Number(nz) || 0;
            return this;
        }
    };
}

function createMaterial(options = {}) {
    const material = {
        color: createColor(options.color ?? 0x888888),
        transparent: !!options.transparent,
        opacity: options.opacity ?? 1,
        gradientMap: null,
        dispose() {},
        clone() {
            return createMaterial({
                color: this.color?.value ?? options.color,
                transparent: this.transparent,
                opacity: this.opacity
            });
        }
    };
    return material;
}

function createNode(type = 'Object3D', name = '') {
    return {
        type,
        name,
        visible: true,
        children: [],
        parent: null,
        geometry: { dispose() {} },
        material: createMaterial(),
        position: createVector3(),
        rotation: { x: 0, y: 0, z: 0 },
        scale: createScale(),
        add(child) {
            if (!child) return child;
            this.children.push(child);
            child.parent = this;
            return child;
        },
        remove(child) {
            if (!child) return;
            this.children = this.children.filter(entry => entry !== child);
            if (child.parent === this) child.parent = null;
        },
        updateMatrixWorld() {},
        getWorldPosition(target = createVector3()) {
            return target.copy(this.position);
        }
    };
}

function createPseudoDomElement() {
    return {
        style: {},
        className: '',
        textContent: '',
        innerHTML: '',
        parentNode: null,
        setAttribute() {},
        appendChild(child) {
            if (child) child.parentNode = this;
        },
        removeChild(child) {
            if (child && child.parentNode === this) child.parentNode = null;
        },
        focus() {}
    };
}

function createHeadlessCharacterVisuals(character, scene) {
    const mesh = createNode('Group', `Character_${character?.id ?? 'unknown'}`);
    const body = createNode('Mesh', 'Body');
    const head = createNode('Mesh', 'Head');
    const leftEye = createNode('Mesh', 'LeftEye');
    const rightEye = createNode('Mesh', 'RightEye');
    const mouth = createNode('Mesh', 'Mouth');
    const leftArm = createNode('Mesh', 'LeftArm');
    const rightArm = createNode('Mesh', 'RightArm');
    const carriedItemMesh = createNode('Mesh', 'CarriedItem');
    carriedItemMesh.visible = false;
    const shadowMesh = createNode('Mesh', 'Shadow');
    const iconAnchor = createNode('Object3D', 'IconAnchor');

    mesh.add(body);
    mesh.add(head);
    mesh.add(carriedItemMesh);
    mesh.add(shadowMesh);
    head.add(iconAnchor);
    head.add(leftEye);
    head.add(rightEye);
    head.add(mouth);
    body.add(leftArm);
    body.add(rightArm);

    if (scene && typeof scene.add === 'function') {
        scene.add(mesh);
    }

    return {
        mesh,
        body,
        head,
        iconAnchor,
        eyeMaterial: createMaterial({ color: 0x222222 }),
        leftEye,
        rightEye,
        eyeMeshes: [leftEye, rightEye],
        mouth,
        leftArm,
        rightArm,
        bodyMaterial: createMaterial({ color: 0xc68642 }),
        carriedItemMesh,
        shadowMesh,
        thoughtBubble: createPseudoDomElement(),
        actionIconDiv: createPseudoDomElement()
    };
}

function createFallbackClock() {
    let lastTs = Date.now();
    return {
        getDelta() {
            const now = Date.now();
            const delta = Math.max(0, (now - lastTs) / 1000);
            lastTs = now;
            return delta;
        }
    };
}

function removeVisual(scene, obj) {
    if (scene && obj && typeof scene.remove === 'function') scene.remove(obj);
    if (obj?.geometry?.dispose) obj.geometry.dispose();
    if (obj?.material?.dispose) obj.material.dispose();
    if (Array.isArray(obj?.children)) {
        obj.children.forEach(child => {
            if (child?.geometry?.dispose) child.geometry.dispose();
            if (child?.material?.dispose) child.material.dispose();
        });
    }
}

function createHeadlessIO() {
    return {
        createClock: createFallbackClock,
        createVector3,
        createColor,
        createMaterial,
        createEdgeMaterial: createMaterial,
        createBlockVisual({ x = 0, y = 0, z = 0, type = {} }) {
            const node = createNode('Mesh', type?.name || 'Block');
            node.position.set(x + 0.5, y + 0.5, z + 0.5);
            return node;
        },
        createCharacterVisuals: createHeadlessCharacterVisuals,
        updateShadowGeometry(shadowMesh, radius) {
            if (shadowMesh) shadowMesh.radius = Number(radius) || 0;
        },
        toScreenPosition() {
            return null;
        },
        colorToCssHex(color) {
            return `#${createColor(Number(color?.value ?? color) || 0).getHexString()}`;
        },
        removeVisual,
        getWorldPosition(obj, target = createVector3()) {
            if (obj && typeof obj.getWorldPosition === 'function') return obj.getWorldPosition(target);
            return target.copy(obj?.position || obj || { x: 0, y: 0, z: 0 });
        }
    };
}

let simulationIO = createHeadlessIO();

export function getSimulationIO() {
    return simulationIO;
}

export function setSimulationIO(overrides = {}) {
    simulationIO = { ...createHeadlessIO(), ...overrides };
    return simulationIO;
}

export function createHeadlessSimulationIO() {
    return createHeadlessIO();
}
