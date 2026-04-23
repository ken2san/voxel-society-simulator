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
        // All pivot Y positions derived directly from voxelchar01.html grid coords × VS.
        // voxelchar01 structure (absolute Y in angel-space, grid units):
        //   leg stumps: y=0..1  (direct children of angel root)
        //   bodyGroup:  y=5     (pivot), body spans y=0..9 local → abs y=5..14
        //   leftWing:   y=10    (direct child of angel root)
        //   headGroup:  y=15    (pivot), face sphere center at local y=3.5 → abs y=18.5
        //   haloGroup:  headGroup local y=12 → abs y=27
        const VS = 0.055;

        // Feet: 1-voxel stump, legs at x=±1 (= ±VS) as in voxelchar01
        const footH = VS, footW = VS, footD = VS, legSpacingX = VS;
        // Shin + thigh + pelvis fill gap from foot-top (1*VS) to body-bottom (5*VS)
        // 0.055+0.11+VS+VS = 0.275 = 5*VS ✓
        const shinH  = 0.11,  shinW  = 0.10, shinD  = 0.10;
        const thighH = VS,    thighW = 0.12, thighD = 0.11;
        const pelvisH = VS,   pelvisW = 0.60, pelvisD = 0.32; // minimal pivot, wide skirt

        // bodyBottom = 5*VS = 0.275 (= voxelchar01 bodyGroup absolute y × VS)
        // torsoH = 9*VS = 0.495 (body box spans y=0..9 of bodyGroup = 9 units)
        const torsoH = 9 * VS, torsoW = 4 * VS, torsoD = 4 * VS;
        const footCenterY   = footH / 2;
        const shinCenterY   = footH + shinH / 2;
        const thighCenterY  = footH + shinH + thighH / 2;
        const pelvisCenterY = footH + shinH + thighH + pelvisH / 2;
        const bodyBottom    = footH + shinH + thighH + pelvisH;    // 0.275 = 5*VS ✓
        const torsoCenterY  = bodyBottom + torsoH / 2;             // 0.5225 = 9.5*VS ✓
        const bodyTop       = bodyBottom + torsoH;                 // 0.77 = 14*VS ✓

        // Arms (mostly hidden under dress)
        const upperArmH = 0.18, upperArmW = 0.13, upperArmD = 0.13;
        const forearmH  = 0.12, forearmW  = 0.11, forearmD  = 0.10;
        const armSpacingX     = torsoW / 2 + upperArmW / 2 - 0.01;
        const upperArmCenterY = bodyTop - upperArmH / 2 - 0.01;
        const forearmCenterY  = upperArmCenterY - upperArmH / 2 - forearmH / 2;

        // Head: face sphere center at headGroup local y=3.5 → abs y=18.5 → 18.5*VS
        //   headCenterY = bodyTop + neckGap + headH/2 must equal 18.5*VS = 1.0175
        //   → neckGap = 0.5*VS, headH = 8*VS gives: 0.77+0.0275+0.22 = 1.0175 ✓
        const headW = 8 * VS, headH = 8 * VS, headD = 7 * VS;
        const neckGap = 0.5 * VS;
        const headCenterY = bodyTop + neckGap + headH / 2;         // 1.0175 = 18.5*VS ✓

        // Hair pom (IM mesh hidden when VoxelCrowdRenderer active; voxels in 'head')
        const hairTopH = 0.34, hairTopW = 0.58, hairTopD = 0.46;
        const hairTopLocalY = headH / 2 + hairTopH / 2;
        const hairCapW = 0.001, hairCapH = 0.001, hairCapD = 0.001, hairCapLocalY = 0;
        const hairSideW = 0.001, hairSideH = 0.001, hairSideD = 0.001;
        const hairSideLocalX = 0, hairSideLocalY = 0;

        // Halo: haloGroup at headGroup local y=12 → abs y=27 → 27*VS=1.485
        //   head-local: (27-18.5)*VS = 8.5*VS = 0.4675
        const haloW = 0.52, haloH = 0.04, haloD = 0.52;
        const haloLocalY = 8.5 * VS;                               // 0.4675

        // Eyes / cheeks (IM mesh hidden; face voxels in 'head')
        const eyeW = headW * 0.24, eyeH = headH * 0.24, eyeD = 0.028;
        const eyeLocalX = 2 * VS, eyeLocalY = 0, eyeLocalZ = headD / 2 + eyeD / 2;
        const cheekW = headW * 0.22, cheekH = headH * 0.14, cheekD = 0.022;
        const cheekLocalX = 3 * VS, cheekLocalY = -0.5 * VS, cheekLocalZ = headD / 2 + cheekD / 2;
        const mouthW = 0.001, mouthH = 0.001, mouthD = 0.001, mouthY = 0, mouthLocalZ = headD / 2;
        const eyeHLW = 0.001, eyeHLH = 0.001, eyeHLD = 0.001;
        const eyeHLLocalX = 0, eyeHLLocalY = 0, eyeHLLocalZ = headD / 2;
        const browW = 0.001, browH = 0.001, browD = 0.001;
        const browLocalX = 0, browLocalY = 0, browLocalZ = headD / 2;

        // Wings: leftWing.position.set(-2, 10, -2) in voxelchar01
        //   wingUpperLocalX = 2*VS, wingUpperLocalY = 10*VS = 0.55, wingZ = -2*VS
        const wingZ = -2 * VS;
        const wingUpperW = 8 * VS, wingUpperH = 8 * VS, wingUpperD = VS;
        const wingUpperLocalX = 2 * VS;
        const wingUpperLocalY = 10 * VS;                           // 0.55 = abs y=10 ✓
        const wingLowerW = 5 * VS, wingLowerH = 5 * VS, wingLowerD = VS;
        const wingLowerLocalX = 2 * VS;
        const wingLowerLocalY = 10 * VS;

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
    // Faithful port of voxcelchar01.html's voxel data.
    // All positions are in PART-LOCAL coordinates (relative to each part mesh center).
    // Scale: 1 voxcelchar01 grid unit × VS = our world unit.
    // Per-part origin offsets chosen to center the voxel cluster on the part pivot.
    voxelSize: 0.055,

    collectVoxels() {
        const VS  = 0.055;
        const vox = [];
        // push(grid_x, grid_y, grid_z, color, part)
        // coords are multiplied by VS so they match the sim's world scale
        const push = (x, y, z, color, part) =>
            vox.push({ x: x * VS, y: y * VS, z: z * VS, color, part });

        const C = {
            hair:   0xf5a662,
            skin:   0xffe0bd,
            eye:    0x880000,
            cheek:  0xffb2bc,
            dress:  0xffffff,
            halo:   0xffd700,
            ribbon: 0xdb5a6b,
        };

        // ── HEAD-LOCAL ─────────────────────────────────────────────────────
        // voxcelchar01 headGroup origin → pivot = face-sphere center (0, 3.5, 0)
        // Offset applied: y -= 3.5

        // Face sphere: dist from (0, 3.5, 0) < 5
        for (let x=-4; x<=3; x++) for (let y=0; y<=7; y++) for (let z=-3; z<=3; z++) {
            if (Math.sqrt(x*x + (y-3.5)*(y-3.5) + z*z) < 5) {
                push(x, y - 3.5, z, C.skin, 'head');
            }
        }

        // Hair shell: dist from (0, 4, 0) in range 4.5..6.5, front window open.
        // Front hair detail included in same loop to avoid duplicates.
        for (let x=-5; x<=4; x++) for (let y=-1; y<=9; y++) for (let z=-4; z<=4; z++) {
            const d = Math.sqrt(x*x + (y-4)*(y-4) + z*z);
            const inShell = d >= 4.5 && d < 6.5;
            const inFront = z > 2 && y >= 6 && y <= 8 && x > -4 && x < 3;
            if (!inShell && !inFront) continue;
            // Exclude front-face window from shell
            if (inShell && z > 1.5 && y < 6 && x > -3 && x < 2) continue;
            push(x, y - 3.5, z, C.hair, 'head');
        }

        // Ribbon headband (voxcelchar01: y=7..8, z=0)
        for (let x=-5; x<=4; x++) for (let y=7; y<=8; y++) {
            push(x, y - 3.5, 0, C.ribbon, 'head');
        }

        // Eyes: placed 1 voxel past face surface (z=5) so they show above skin
        push(-2,  3 - 3.5, 5, C.eye, 'head');
        push(-2,  4 - 3.5, 5, C.eye, 'head');
        push( 1,  3 - 3.5, 5, C.eye, 'head');
        push( 1,  4 - 3.5, 5, C.eye, 'head');

        // Cheeks
        push(-3,  2 - 3.5, 4, C.cheek, 'head');
        push( 2,  2 - 3.5, 4, C.cheek, 'head');

        // ── HALO-LOCAL ─────────────────────────────────────────────────────
        // voxcelchar01: 24 voxels at radius=6, y=0 in haloGroup (natural center)
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            push(Math.cos(a) * 6, 0, Math.sin(a) * 6, C.halo, 'halo');
        }

        // ── BODY-LOCAL (torso + skirt) ─────────────────────────────────────
        // Both torso and skirt are children of voxelchar01's bodyGroup (y=5 abs).
        // body pivot = torsoCenterY = 9.5*VS = 4.5 units from bodyGroup bottom.
        // local y = (bodyGroup_local_y - 4.5) × VS.

        // Torso core: 4×10×4 box (x=-2..1, y=0..9, z=-2..1 of bodyGroup)
        for (let x=-2; x<=1; x++) for (let y=0; y<10; y++) for (let z=-2; z<=1; z++) {
            push(x + 0.5, y - 4.5, z + 0.5, C.dress, 'body');
        }

        // Skirt rings: 3 ring layers at bodyGroup y=0, 2, 4
        // moved to 'body' part so they align with the torso (same bodyGroup origin)
        for (let layer = 0; layer < 3; layer++) {
            const r = 4 + layer;
            const h = layer * 2;  // bodyGroup-local y: 0, 2, 4
            for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
                const d = Math.sqrt(x*x + z*z);
                if (d <= r && d > r - 2) push(x, h - 4.5, z, C.dress, 'body');
            }
        }

        // ── PELVIS-LOCAL — empty (skirt merged into body above) ────────────

        // ── WING-LOCAL ──────────────────────────────────────────────────────
        // voxcelchar01: right-triangle, i=0..7, j=0..7-i
        // Upper wings: centroid ≈ (2.5, 2.5) → offset by (-2.5, -2.5)
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8 - i; j++) {
            push(-i + 2.5, j - 2.5, 0, C.dress, 'wingUL');
            push( i - 2.5, j - 2.5, 0, C.dress, 'wingUR');
        }
        // Lower wings (smaller panel, i=0..4)
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5 - i; j++) {
            push(-i + 1.5, j - 1.5, 0, C.dress, 'wingLL');
            push( i - 1.5, j - 1.5, 0, C.dress, 'wingLR');
        }

        // ── ARMS: dress sleeves ─────────────────────────────────────────────
        for (let y=-2; y<=2; y++) for (let x=-1; x<=1; x++) for (let z=-1; z<=1; z++) {
            push(x, y, z, C.dress, 'armL');
            push(x, y, z, C.dress, 'armR');
        }

        // ── FOREARMS: skin ──────────────────────────────────────────────────
        for (let y=-1; y<=2; y++) for (let x=-1; x<=1; x++) {
            push(x, y, 0, C.skin, 'forearmL');
            push(x, y, 0, C.skin, 'forearmR');
        }

        // ── LEGS / SHINS / FEET: match voxelchar01 exactly ─────────────────
        // voxelchar01 legs: addVoxel(±1, 0, 0) and addVoxel(±1, 1, 0) directly on angel.
        // foot pivot = (±legSpacingX, footCenterY=VS/2) → foot-local y = angel_y - 0.5
        push(0, -0.5, 0, C.skin, 'footL');   // angel y=0 → local y=-VS/2
        push(0,  0.5, 0, C.skin, 'footL');   // angel y=1 → local y=+VS/2
        push(0, -0.5, 0, C.skin, 'footR');
        push(0,  0.5, 0, C.skin, 'footR');
        // shin/thigh: single marker voxel (hidden under dress)
        push(0, 0, 0, C.skin, 'legL');   push(0, 0, 0, C.skin, 'legR');
        push(0, 0, 0, C.skin, 'shinL');  push(0, 0, 0, C.skin, 'shinR');

        return vox;
    },
});
