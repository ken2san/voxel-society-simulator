// Minimal extraction of AI decision helpers from character.js
// This module exports helper functions used by Character for AI decisions.

export function chooseClosestTarget(candidates, fromPos) {
    if (!candidates || candidates.length === 0) return null;
    let minDist = Infinity; let best = null;
    for (const c of candidates) {
        const dist = Math.abs(c.x - fromPos.x) + Math.abs((c.y||0) - fromPos.y) + Math.abs(c.z - fromPos.z);
        if (dist < minDist) { minDist = dist; best = c; }
    }
    return best;
}

export function simpleNeedsPriority(needs) {
    // returns action priority list by need severity (lower value -> higher priority)
    if (!needs) return [];
    const arr = Object.keys(needs).map(k => ({ key: k, val: needs[k] }));
    arr.sort((a,b) => a.val - b.val);
    return arr.map(x => x.key);
}

export default { chooseClosestTarget, simpleNeedsPriority };
