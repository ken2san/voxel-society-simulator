/**
 * character-skins.js — Character Skin Registry
 *
 * Each skin defines:
 *   id             {string}
 *   name           {string}
 *   createMorphology(traits) → morphologyObject
 *   applyColors(character)   → void   (sets bodyMaterial/skinMaterial/hairMaterial)
 *   im             {object}  — IM renderer config:
 *     showHalo       {bool}   render halo ring
 *     showWings      {bool}   render wing panels
 *     showHairSides  {bool}   render hair-side curtain panels
 *     showNose       {bool}   render nose block (mouth IM slot)
 *     pelvisColor    {hex}    pelvis belt/skirt colour
 *     pantsColor     {hex}    thighs + shins colour
 *     feetColor      {hex}    feet colour
 *
 * Usage:
 *   window.ACTIVE_SKIN_ID = 'angel';   // set before sim starts
 *   import { refreshAllCharacterSkins } from './character-skins.js';
 *   refreshAllCharacterSkins();         // apply to existing characters
 */

const _registry = new Map();

export function registerSkin(skin) {
    _registry.set(skin.id, skin);
}

export function getActiveSkin() {
    const id = (typeof window !== 'undefined' && window.ACTIVE_SKIN_ID) || 'chibi';
    return _registry.get(id) || _registry.get('chibi') || null;
}

export function getSkinIds() { return [..._registry.keys()]; }

/** Re-apply the active skin to all existing characters (call after changing window.ACTIVE_SKIN_ID). */
export function refreshAllCharacterSkins() {
    if (typeof window === 'undefined' || !Array.isArray(window.characters)) return;
    const skin = getActiveSkin();
    if (!skin) return;
    for (const char of window.characters) {
        if (!char || char.state === 'dead') continue;
        if (typeof char.createMorphologyProfile === 'function') {
            char.morphology = char.createMorphologyProfile(char.appearanceProfile);
            if (typeof char.applyMorphologyToMeshes === 'function') char.applyMorphologyToMeshes();
            char._armRestY     = char.morphology?.upperArmCenterY ?? 0.660;
            char._forearmRestY = char.morphology?.forearmCenterY  ?? 0.505;
        }
        skin.applyColors(char);
    }
}

// ── Shared morphology return builder ───────────────────────────────────────────
function _buildReturn(p) {
    return {
        torsoH: p.torsoH, torsoW: p.torsoW, torsoD: p.torsoD,
        torsoCenterY: p.torsoCenterY, bodyBottom: p.bodyBottom, bodyTop: p.bodyTop,
        pelvisH: p.pelvisH, pelvisW: p.pelvisW, pelvisD: p.pelvisD, pelvisCenterY: p.pelvisCenterY,
        thighH: p.thighH, thighW: p.thighW, thighD: p.thighD, thighCenterY: p.thighCenterY,
        shinH: p.shinH, shinW: p.shinW, shinD: p.shinD, shinCenterY: p.shinCenterY,
        footH: p.footH, footW: p.footW, footD: p.footD, footCenterY: p.footCenterY,
        legSpacingX: p.legSpacingX,
        upperArmH: p.upperArmH, upperArmW: p.upperArmW, upperArmD: p.upperArmD,
        upperArmCenterY: p.upperArmCenterY,
        forearmH: p.forearmH, forearmW: p.forearmW, forearmD: p.forearmD,
        forearmCenterY: p.forearmCenterY,
        armSpacingX: p.armSpacingX,
        headW: p.headW, headH: p.headH, headD: p.headD,
        neckGap: p.neckGap, headCenterY: p.headCenterY,
        hairTopW: p.hairTopW, hairTopH: p.hairTopH, hairTopD: p.hairTopD, hairTopLocalY: p.hairTopLocalY,
        hairCapW: p.hairCapW, hairCapH: p.hairCapH, hairCapD: p.hairCapD, hairCapLocalY: p.hairCapLocalY,
        hairSideH: p.hairSideH, hairSideW: p.hairSideW, hairSideD: p.hairSideD,
        hairSideLocalX: p.hairSideLocalX, hairSideLocalY: p.hairSideLocalY,
        haloW: p.haloW, haloH: p.haloH, haloD: p.haloD, haloLocalY: p.haloLocalY,
        eyeW: p.eyeW, eyeH: p.eyeH, eyeD: p.eyeD,
        eyeLocalX: p.eyeLocalX, eyeLocalY: p.eyeLocalY, eyeLocalZ: p.eyeLocalZ,
        cheekW: p.cheekW, cheekH: p.cheekH, cheekD: p.cheekD,
        cheekLocalX: p.cheekLocalX, cheekLocalY: p.cheekLocalY, cheekLocalZ: p.cheekLocalZ,
        mouthW: p.mouthW, mouthH: p.mouthH, mouthD: p.mouthD,
        mouthY: p.mouthY, mouthLocalZ: p.mouthLocalZ,
        eyeHLW: p.eyeHLW, eyeHLH: p.eyeHLH, eyeHLD: p.eyeHLD,
        eyeHLLocalX: p.eyeHLLocalX, eyeHLLocalY: p.eyeHLLocalY, eyeHLLocalZ: p.eyeHLLocalZ,
        browW: p.browW, browH: p.browH, browD: p.browD,
        browLocalX: p.browLocalX, browLocalY: p.browLocalY, browLocalZ: p.browLocalZ,
        wingZ: p.wingZ,
        wingUpperW: p.wingUpperW, wingUpperH: p.wingUpperH, wingUpperD: p.wingUpperD,
        wingUpperLocalX: p.wingUpperLocalX, wingUpperLocalY: p.wingUpperLocalY,
        wingLowerW: p.wingLowerW, wingLowerH: p.wingLowerH, wingLowerD: p.wingLowerD,
        wingLowerLocalX: p.wingLowerLocalX, wingLowerLocalY: p.wingLowerLocalY,
        shadowRadius: p.shadowRadius, carriedItemSize: p.carriedItemSize,
        carriedItemY: p.carriedItemY, carriedItemZ: p.carriedItemZ,
        // Legacy aliases
        bodyHeight: p.bodyTop,
        bodyRow1Y: p.torsoCenterY, bodyRow1H: p.torsoH, bodyRow1W: p.torsoW, bodyDepth: p.torsoD,
        bodyRow2Y: null, bodyRow3Y: null, bodyRow4Y: null, bodyRow5Y: null,
        headHeight: p.headH,
        eyeRadius: Math.min(p.eyeW, p.eyeH) / 2,
        eyeSpacing: p.eyeLocalX,
        eyeY: p.eyeLocalY,
        faceZ: p.eyeLocalZ,
        mouthRadius: 0.02,
        wingW: p.wingUpperW, wingH: p.wingUpperH, wingD: p.wingUpperD,
        wingLocalX: p.wingUpperLocalX, wingLocalY: p.wingUpperLocalY,
    };
}

// ── Chibi skin — lime jacket, massive pom hair, orange nose ────────────────────
registerSkin({
    id: 'chibi',
    name: 'Chibi',

    createMorphology(_traits) {
        const footH = 0.10, footW = 0.20, footD = 0.24, legSpacingX = 0.09;
        const shinH  = 0.18, shinW  = 0.14, shinD  = 0.13;
        const thighH = 0.16, thighW = 0.16, thighD = 0.14;
        const pelvisH = 0.10, pelvisW = 0.36, pelvisD = 0.22;
        const torsoH  = 0.22, torsoW  = 0.42, torsoD  = 0.24;
        const footCenterY   = footH / 2;
        const shinCenterY   = footH + shinH / 2;
        const thighCenterY  = footH + shinH + thighH / 2;
        const pelvisCenterY = footH + shinH + thighH + pelvisH / 2;
        const bodyBottom    = footH + shinH + thighH + pelvisH;
        const torsoCenterY  = bodyBottom + torsoH / 2;
        const bodyTop       = bodyBottom + torsoH;
        const upperArmH = 0.18, upperArmW = 0.14, upperArmD = 0.14;
        const forearmH  = 0.13, forearmW  = 0.12, forearmD  = 0.11;
        const armSpacingX     = torsoW / 2 + upperArmW / 2 - 0.02;
        const upperArmCenterY = bodyTop - upperArmH / 2 - 0.01;
        const forearmCenterY  = upperArmCenterY - upperArmH / 2 - forearmH / 2;
        const headW = 0.36, headH = 0.30, headD = 0.32, neckGap = 0.02;
        const headCenterY = bodyTop + neckGap + headH / 2;
        const hairTopH = 0.46, hairTopW = 0.76, hairTopD = 0.54;
        const hairTopLocalY = headH / 2 + hairTopH / 2 - hairTopH * 0.08;
        const hairCapW = 0.001, hairCapH = 0.001, hairCapD = 0.001, hairCapLocalY = 0;
        const hairSideW = 0.001, hairSideH = 0.001, hairSideD = 0.001;
        const hairSideLocalX = 0, hairSideLocalY = 0;
        const haloW = 0.001, haloH = 0.001, haloD = 0.001, haloLocalY = 0;
        const eyeW = headW * 0.265, eyeH = headH * 0.300, eyeD = 0.028;
        const eyeLocalX = headW * 0.228, eyeLocalY = headH * 0.080, eyeLocalZ = headD / 2 + eyeD / 2;
        const mouthW = headW * 0.170, mouthH = headH * 0.190, mouthD = 0.040;
        const mouthY = eyeLocalY - eyeH * 0.80 - mouthH * 0.50;
        const mouthLocalZ = headD / 2 + mouthD / 2;
        const cheekW = 0.001, cheekH = 0.001, cheekD = 0.001;
        const cheekLocalX = 0, cheekLocalY = 0, cheekLocalZ = headD / 2;
        const eyeHLW = 0.001, eyeHLH = 0.001, eyeHLD = 0.001;
        const eyeHLLocalX = 0, eyeHLLocalY = 0, eyeHLLocalZ = headD / 2;
        const browW = 0.001, browH = 0.001, browD = 0.001;
        const browLocalX = 0, browLocalY = 0, browLocalZ = headD / 2;
        const wingZ = 0;
        const wingUpperW = 0.001, wingUpperH = 0.001, wingUpperD = 0.001;
        const wingUpperLocalX = 0, wingUpperLocalY = 0;
        const wingLowerW = 0.001, wingLowerH = 0.001, wingLowerD = 0.001;
        const wingLowerLocalX = 0, wingLowerLocalY = 0;
        const shadowRadius = 0.28, carriedItemSize = 0.26;
        const carriedItemY = headCenterY + headH * 0.32, carriedItemZ = headD / 2 + 0.08;
        return _buildReturn({ footH, footW, footD, legSpacingX, shinH, shinW, shinD, thighH, thighW, thighD, pelvisH, pelvisW, pelvisD, torsoH, torsoW, torsoD, footCenterY, shinCenterY, thighCenterY, pelvisCenterY, bodyBottom, torsoCenterY, bodyTop, upperArmH, upperArmW, upperArmD, forearmH, forearmW, forearmD, armSpacingX, upperArmCenterY, forearmCenterY, headW, headH, headD, neckGap, headCenterY, hairTopW, hairTopH, hairTopD, hairTopLocalY, hairCapW, hairCapH, hairCapD, hairCapLocalY, hairSideH: hairSideH, hairSideW, hairSideD, hairSideLocalX, hairSideLocalY, haloW, haloH, haloD, haloLocalY, eyeW, eyeH, eyeD, eyeLocalX, eyeLocalY, eyeLocalZ, cheekW, cheekH, cheekD, cheekLocalX, cheekLocalY, cheekLocalZ, mouthW, mouthH, mouthD, mouthY, mouthLocalZ, eyeHLW, eyeHLH, eyeHLD, eyeHLLocalX, eyeHLLocalY, eyeHLLocalZ, browW, browH, browD, browLocalX, browLocalY, browLocalZ, wingZ, wingUpperW, wingUpperH, wingUpperD, wingUpperLocalX, wingUpperLocalY, wingLowerW, wingLowerH, wingLowerD, wingLowerLocalX, wingLowerLocalY, shadowRadius, carriedItemSize, carriedItemY, carriedItemZ });
    },

    applyColors(char) {
        if (char.bodyMaterial) char.bodyMaterial.color.setHex(0xd0e000); // lime jacket
        if (char.skinMaterial) char.skinMaterial.color.setHex(0xf5b878); // warm peach
        if (char.hairMaterial) char.hairMaterial.color.setHex(0xd0e000); // lime pom
    },

    im: {
        showHalo:      false,
        showWings:     false,
        showHairSides: false,
        showNose:      true,
        pelvisColor:   0x3d5000, // dark olive belt
        pantsColor:    0x6b3515, // dark brown pants
        feetColor:     0x111111, // black shoes
    },
});

// ── Angel skin — adapted from voxcelchar01.html ────────────────────────────────
// White dress, orange pom hair, gold halo, white wings, pink cheeks, skin feet.
// Proportions adjusted for the grid world (total height ~1.5 units).
registerSkin({
    id: 'angel',
    name: 'Angel',

    createMorphology(_traits) {
        // Feet — skin-coloured stumps below dress
        const footH = 0.10, footW = 0.16, footD = 0.18, legSpacingX = 0.07;
        // Legs — narrow, hidden under dress
        const shinH  = 0.12, shinW  = 0.13, shinD  = 0.12;
        const thighH = 0.14, thighW = 0.14, thighD = 0.13;
        // Dress: pelvis = wide hem, torso = bodice (tapers up)
        const pelvisH = 0.12, pelvisW = 0.56, pelvisD = 0.28;
        const torsoH  = 0.26, torsoW  = 0.44, torsoD  = 0.24;
        const footCenterY   = footH / 2;
        const shinCenterY   = footH + shinH / 2;
        const thighCenterY  = footH + shinH + thighH / 2;
        const pelvisCenterY = footH + shinH + thighH + pelvisH / 2;
        const bodyBottom    = footH + shinH + thighH + pelvisH;
        const torsoCenterY  = bodyBottom + torsoH / 2;
        const bodyTop       = bodyBottom + torsoH;
        // Arms — white sleeves + skin forearms
        const upperArmH = 0.18, upperArmW = 0.13, upperArmD = 0.13;
        const forearmH  = 0.12, forearmW  = 0.11, forearmD  = 0.10;
        const armSpacingX     = torsoW / 2 + upperArmW / 2 - 0.015;
        const upperArmCenterY = bodyTop - upperArmH / 2 - 0.01;
        const forearmCenterY  = upperArmCenterY - upperArmH / 2 - forearmH / 2;
        // Head
        const headW = 0.34, headH = 0.30, headD = 0.30, neckGap = 0.02;
        const headCenterY = bodyTop + neckGap + headH / 2;
        // Hair — orange pom (same shape logic as chibi but smaller — halo is the crown feature)
        const hairTopH = 0.34, hairTopW = 0.58, hairTopD = 0.46;
        const hairTopLocalY = headH / 2 + hairTopH / 2;
        const hairCapW = 0.001, hairCapH = 0.001, hairCapD = 0.001, hairCapLocalY = 0;
        const hairSideW = 0.001, hairSideH = 0.001, hairSideD = 0.001;
        const hairSideLocalX = 0, hairSideLocalY = 0;
        // Halo — gold ring floating above hair (IM: thin flat slab)
        const haloW = 0.52, haloH = 0.04, haloD = 0.52;
        const haloLocalY = headH / 2 + hairTopH + 0.08; // well above pom
        // Eyes — dark red (from voxcelchar01: 0x880000)
        const eyeW = headW * 0.24, eyeH = headH * 0.28, eyeD = 0.028;
        const eyeLocalX = headW * 0.230, eyeLocalY = headH * 0.080, eyeLocalZ = headD / 2 + eyeD / 2;
        // Cheeks — pink blush (from voxcelchar01: 0xffb2bc ≈ IM material 0xf0a0a0)
        const cheekW = headW * 0.22, cheekH = headH * 0.14, cheekD = 0.022;
        const cheekLocalX = headW * 0.32;
        const cheekLocalY = eyeLocalY - eyeH * 0.80 - cheekH * 0.50;
        const cheekLocalZ = headD / 2 + cheekD / 2;
        // Nose — hidden (angel face has cheeks instead)
        const mouthW = 0.001, mouthH = 0.001, mouthD = 0.001, mouthY = 0, mouthLocalZ = headD / 2;
        const eyeHLW = 0.001, eyeHLH = 0.001, eyeHLD = 0.001;
        const eyeHLLocalX = 0, eyeHLLocalY = 0, eyeHLLocalZ = headD / 2;
        const browW = 0.001, browH = 0.001, browD = 0.001;
        const browLocalX = 0, browLocalY = 0, browLocalZ = headD / 2;
        // Wings — large white panels behind torso
        const wingZ = -(torsoD / 2 + 0.02);
        const wingUpperW = 0.34, wingUpperH = 0.28, wingUpperD = 0.08;
        const wingUpperLocalX = torsoW / 2 + wingUpperW / 2 - 0.06;
        const wingUpperLocalY = torsoCenterY + torsoH * 0.15;
        const wingLowerW = 0.28, wingLowerH = 0.22, wingLowerD = 0.08;
        const wingLowerLocalX = torsoW / 2 + wingLowerW / 2 - 0.04;
        const wingLowerLocalY = torsoCenterY - torsoH * 0.10;
        const shadowRadius = 0.34, carriedItemSize = 0.26;
        const carriedItemY = headCenterY + headH * 0.32, carriedItemZ = headD / 2 + 0.08;
        return _buildReturn({ footH, footW, footD, legSpacingX, shinH, shinW, shinD, thighH, thighW, thighD, pelvisH, pelvisW, pelvisD, torsoH, torsoW, torsoD, footCenterY, shinCenterY, thighCenterY, pelvisCenterY, bodyBottom, torsoCenterY, bodyTop, upperArmH, upperArmW, upperArmD, forearmH, forearmW, forearmD, armSpacingX, upperArmCenterY, forearmCenterY, headW, headH, headD, neckGap, headCenterY, hairTopW, hairTopH, hairTopD, hairTopLocalY, hairCapW, hairCapH, hairCapD, hairCapLocalY, hairSideH: hairSideH, hairSideW, hairSideD, hairSideLocalX, hairSideLocalY, haloW, haloH, haloD, haloLocalY, eyeW, eyeH, eyeD, eyeLocalX, eyeLocalY, eyeLocalZ, cheekW, cheekH, cheekD, cheekLocalX, cheekLocalY, cheekLocalZ, mouthW, mouthH, mouthD, mouthY, mouthLocalZ, eyeHLW, eyeHLH, eyeHLD, eyeHLLocalX, eyeHLLocalY, eyeHLLocalZ, browW, browH, browD, browLocalX, browLocalY, browLocalZ, wingZ, wingUpperW, wingUpperH, wingUpperD, wingUpperLocalX, wingUpperLocalY, wingLowerW, wingLowerH, wingLowerD, wingLowerLocalX, wingLowerLocalY, shadowRadius, carriedItemSize, carriedItemY, carriedItemZ });
    },

    applyColors(char) {
        if (char.bodyMaterial) char.bodyMaterial.color.setHex(0xfcfcfc); // white dress
        if (char.skinMaterial) char.skinMaterial.color.setHex(0xffe0bd); // warm skin
        if (char.hairMaterial) char.hairMaterial.color.setHex(0xf5a662); // orange hair
    },

    im: {
        showHalo:      true,
        showWings:     true,
        showHairSides: false,
        showNose:      false,
        pelvisColor:   0xfcfcfc, // dress hem (same white as bodice)
        pantsColor:    0xfcfcfc, // legs hidden under dress
        feetColor:     0xffe0bd, // skin stumps
    },

    // ── Voxel geometry definition (for VoxelCrowdRenderer) ───────────────
    // All positions are in PART-LOCAL coordinates (relative to each part mesh center).
    // VoxelCrowdRenderer maps part names → character mesh pivots and applies the
    // part's world matrix as the instance matrix.  The geometry encodes all voxel
    // offsets from that pivot.
    voxelSize: 0.055,

    collectVoxels() {
        const VS  = 0.055;
        const vox = [];
        const add = (x, y, z, color, part) => vox.push({ x, y, z, color, part });
        const d3  = (dx, dy, dz) => Math.sqrt(dx*dx + dy*dy + dz*dz);

        const C = {
            hair:   0xf5a662,
            skin:   0xffe0bd,
            eye:    0x660000,
            cheek:  0xffb2bc,
            dress:  0xf0f0ff,
            halo:   0xffd700,
            ribbon: 0xdb5a6b,
        };

        // ── HEAD-LOCAL (relative to head mesh center at (0,0,0)) ──────────
        // head: headW=0.34, headH=0.30, headD=0.30

        // Face: skin-coloured sphere (r=0.17), with eye-socket cutouts
        for (let xi=-3;xi<=3;xi++) for (let yi=-3;yi<=3;yi++) for (let zi=-3;zi<=3;zi++) {
            const x=xi*VS, y=yi*VS, z=zi*VS;
            if (d3(x,y,z) < 0.17) {
                if (z > 0.09 && Math.abs(x) > 0.04 && Math.abs(x) < 0.13 && y > -0.01 && y < 0.12) continue;
                add(x, y, z, C.skin, 'head');
            }
        }

        // Hair: orange sphere shell centred at (0, 0.07, 0), inner r=0.17, outer r=0.30
        // Front-face window kept open so eyes are visible
        for (let xi=-5;xi<=5;xi++) for (let yi=-3;yi<=7;yi++) for (let zi=-5;zi<=5;zi++) {
            const x=xi*VS, y=yi*VS, z=zi*VS;
            const d = d3(x, y-0.07, z);
            if (d >= 0.17 && d < 0.30) {
                if (z > 0.09 && y > -0.03 && y < 0.14 && Math.abs(x) < 0.11) continue;
                add(x, y, z, C.hair, 'head');
            }
        }

        // Ribbon headband: ring at y=0.13 between face and hair (r 0.13–0.27)
        for (let xi=-5;xi<=5;xi++) for (let zi=-5;zi<=5;zi++) {
            const x=xi*VS, z=zi*VS, r=d3(x,0,z);
            if (r >= 0.13 && r < 0.27) add(x, 0.13, z, C.ribbon, 'head');
        }

        // Eyes (dark red — 2 voxels each, just in front of face surface)
        const ez = 0.17;
        add(-0.08, 0.04, ez, C.eye, 'head'); add(-0.08, 0.09, ez, C.eye, 'head');
        add( 0.08, 0.04, ez, C.eye, 'head'); add( 0.08, 0.09, ez, C.eye, 'head');

        // Cheeks (pink blush)
        add(-0.12, -0.02, 0.14, C.cheek, 'head');
        add( 0.12, -0.02, 0.14, C.cheek, 'head');

        // ── HALO-LOCAL (relative to halo mesh center, child of head) ─────
        // haloLocalY=0.57 above head center → ring of 24 gold voxels at r=0.22
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            add(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22, C.halo, 'halo');
        }

        // ── BODY-LOCAL (relative to torso mesh center) ────────────────────
        // torso: 0.44 × 0.26 × 0.24  →  fill 9 × 5 × 5 grid
        for (let xi=-4;xi<=4;xi++) for (let yi=-2;yi<=2;yi++) for (let zi=-2;zi<=2;zi++) {
            add(xi*VS, yi*VS, zi*VS, C.dress, 'body');
        }

        // ── PELVIS-LOCAL (relative to pelvis mesh center) ─────────────────
        // Wide skirt hem: two flat circles at y=-0.04 and y=0  (pelvisW/2=0.28)
        for (let xi=-5;xi<=5;xi++) for (let zi=-5;zi<=5;zi++) {
            const x=xi*VS, z=zi*VS;
            if (d3(x,0,z) < 0.27) {
                add(x, -0.04, z, C.dress, 'pelvis');
                add(x,  0.00, z, C.dress, 'pelvis');
            }
        }

        // ── ARM-LOCAL (relative to upper arm mesh centers, left + right) ──
        // Dress sleeves: upperArmW=0.13, upperArmH=0.18, upperArmD=0.13
        for (let yi=-2;yi<=2;yi++) for (let xi=-1;xi<=1;xi++) for (let zi=-1;zi<=1;zi++) {
            add(xi*VS, yi*VS, zi*VS, C.dress, 'armL');
            add(xi*VS, yi*VS, zi*VS, C.dress, 'armR');
        }

        // ── FOREARM-LOCAL (relative to forearm mesh centers) ──────────────
        // Skin forearms: forearmW=0.11, forearmH=0.12, forearmD=0.10
        for (let yi=-1;yi<=2;yi++) for (let xi=-1;xi<=1;xi++) for (let zi=-1;zi<=1;zi++) {
            add(xi*VS, yi*VS, zi*VS, C.skin, 'forearmL');
            add(xi*VS, yi*VS, zi*VS, C.skin, 'forearmR');
        }

        // ── WING-LOCAL (relative to wing mesh centers, behind torso) ──────
        // Triangular upper wings (wider at top, tapering down)
        for (let yi=-2;yi<=2;yi++) {
            const halfX = 0.14 * (1 - Math.max(0, -yi) * 0.12);
            for (let xi=-3;xi<=3;xi++) {
                if (Math.abs(xi*VS) <= halfX + VS*0.5) {
                    add(xi*VS, yi*VS, 0, C.dress, 'wingUL');
                    add(xi*VS, yi*VS, 0, C.dress, 'wingUR');
                }
            }
        }
        // Smaller lower wings
        for (let yi=-2;yi<=1;yi++) {
            const halfX = 0.11 * (1 - Math.max(0, -yi) * 0.18);
            for (let xi=-2;xi<=2;xi++) {
                if (Math.abs(xi*VS) <= halfX + VS*0.5) {
                    add(xi*VS, yi*VS, 0, C.dress, 'wingLL');
                    add(xi*VS, yi*VS, 0, C.dress, 'wingLR');
                }
            }
        }

        // ── LEGS (minimal — hidden inside dress) ──────────────────────────
        for (let yi=-1;yi<=1;yi++) {
            add(0, yi*VS, 0, C.dress, 'legL');
            add(0, yi*VS, 0, C.dress, 'legR');
        }

        // ── SHINS & FEET (skin — peeking below dress hem) ─────────────────
        add(0, 0, 0, C.skin, 'shinL');
        add(0, 0, 0, C.skin, 'shinR');
        for (let xi=-1;xi<=1;xi++) for (let zi=-1;zi<=1;zi++) {
            add(xi*VS, 0, zi*VS, C.skin, 'footL');
            add(xi*VS, 0, zi*VS, C.skin, 'footR');
        }

        return vox;
    },
});
