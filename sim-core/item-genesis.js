/**
 * item-genesis.js
 *
 * Emergent item combination: characters occasionally combine two held items
 * into a new "creation" with a blended 5-dimension vector, the same
 * average+noise+mutation+clamp shape reproduction already uses to blend
 * parents' personality traits (see character.js's _blendTrait). Applying it
 * recursively — creations combining with creations — is where the variety
 * comes from, not from hand-authored recipes.
 *
 * Plain repeated averaging is a random walk of means: variance shrinks each
 * generation, so recursive combination would converge toward one bland
 * average without correction. depthNoise below counters that, and is
 * capped so it also acts as a self-limiting complexity guardrail.
 */

import { ITEM_TYPES } from '../world.js';

export const ITEM_DIMS = ['hardness', 'organicness', 'sharpness', 'luminosity', 'volatility'];

export const BASE_ITEM_VECTORS = {
    WOOD_LOG:   { hardness: 0.35, organicness: 0.90, sharpness: 0.10, luminosity: 0.20, volatility: 0.15 },
    FRUIT_ITEM: { hardness: 0.10, organicness: 0.95, sharpness: 0.05, luminosity: 0.50, volatility: 0.35 },
    STONE_TOOL: { hardness: 0.85, organicness: 0.05, sharpness: 0.55, luminosity: 0.15, volatility: 0.10 },
    // A monolith-flavored find: no economic use, exists purely to be picked
    // up, held, and combined. Sits just under the 'monolith' classification
    // threshold on its own — combining it with anything hardness-leaning
    // pushes it over, so the rarest archetypes stay something that emerges
    // rather than something available on pickup day one.
    CURIO_ITEM: { hardness: 0.95, organicness: 0.05, sharpness: 0.30, luminosity: 0.60, volatility: 0.50 },
};

export const CREATION_ARCHETYPES = {
    unstable:  { icon: '🌀', color: 0xaa33ff, nameParts: ['Twitching', 'Feral', 'Convulsing'] },
    blade:     { icon: '🗡️', color: 0xc0c0c0, nameParts: ['Honed', 'Grim', 'Bright'] },
    radiant:   { icon: '✨', color: 0xffd166, nameParts: ['Gleaming', 'Luminous', 'Warm'] },
    husk:      { icon: '🥀', color: 0x8b5a2b, nameParts: ['Withered', 'Hollow', 'Papery'] },
    monolith:  { icon: '🗿', color: 0x555a66, nameParts: ['Heavy', 'Ancient', 'Cold'] },
    grown:     { icon: '🌱', color: 0x4CAF50, nameParts: ['Living', 'Budding', 'Rooted'] },
    edged:     { icon: '🔪', color: 0x9aa5b1, nameParts: ['Jagged', 'Sharp', 'Notched'] },
    composite: { icon: '🧩', color: 0x8B4513, nameParts: ['Odd', 'Curious', 'Nameless'] },
};

export const MAX_CREATION_DEPTH = 8;

function blendItemDim(a, b, depth) {
    const base = (a + b) / 2 + (Math.random() - 0.5) * 0.12;
    const mutRate = (typeof window !== 'undefined' && window.itemMutationRate !== undefined) ? window.itemMutationRate : 0.12;
    const depthNoise = Math.min(0.5, depth * 0.04);
    const mutated = Math.random() < mutRate
        ? base + (Math.random() - 0.5) * (0.5 + depthNoise)
        : base + (Math.random() - 0.5) * depthNoise;
    return Math.max(0, Math.min(1.6, mutated));
}

export function combineItemVectors(vecA, vecB, depth) {
    const out = {};
    for (const d of ITEM_DIMS) out[d] = blendItemDim(vecA[d] ?? 0.5, vecB[d] ?? 0.5, depth);
    return out;
}

export function classifyCreation(vec) {
    if (vec.volatility > 1.1) return 'unstable';
    if (vec.sharpness > 0.9 && vec.hardness > 0.8) return 'blade';
    if (vec.luminosity > 1.0) return 'radiant';
    if (vec.organicness > 0.85 && vec.hardness < 0.3) return 'husk';
    if (vec.hardness > 1.0) return 'monolith';
    if (vec.organicness > 0.7) return 'grown';
    if (vec.sharpness > 0.6) return 'edged';
    return 'composite';
}

export const generatedItems = new Map(); // id -> { vector, depth, archetype, name, icon, color, parentIds }

export function registerGeneratedItem(vector, depth, parentIds) {
    const id = `CRT_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    const archetype = classifyCreation(vector);
    const { icon, color, nameParts } = CREATION_ARCHETYPES[archetype];
    const name = `${nameParts[depth % nameParts.length]} ${archetype.charAt(0).toUpperCase()}${archetype.slice(1)}`;
    generatedItems.set(id, { vector, depth, archetype, name, icon, color, parentIds });
    if (generatedItems.size > 200) {
        generatedItems.delete(generatedItems.keys().next().value);
    }
    return id;
}

export function isGeneratedItem(value) {
    return typeof value === 'string' && value.startsWith('CRT_');
}

export function getItemVector(id) {
    return BASE_ITEM_VECTORS[id] ?? generatedItems.get(id)?.vector ?? null;
}

export function getItemDepth(id) {
    return BASE_ITEM_VECTORS[id] ? 0 : (generatedItems.get(id)?.depth ?? 0);
}

// Plain, factual name for provenance logging — a base item's real ITEM_TYPES name, a
// creation's real generated name, or a neutral note when its record has aged out of
// generatedItems (200-entry cap). Deliberately no invented emotion or flavor text here;
// see the Chronicle log line in character.js's combineItemsAction for why.
export function getItemDisplayName(id) {
    if (isGeneratedItem(id)) return generatedItems.get(id)?.name ?? 'an unrecorded creation';
    return ITEM_TYPES[id]?.name ?? id;
}
