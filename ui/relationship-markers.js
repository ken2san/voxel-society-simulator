/** Reusable scene-overlay DOM. Simulation snapshots remain owned by callers. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const layers = new WeakMap();

export function getRelationshipBadgeMeta(relationshipClass) {
    if (relationshipClass === 'bonded') return { icon: '❤', bg: 'rgba(190,24,93,0.88)', border: '#f9a8d4', stroke: '#ec4899' };
    if (relationshipClass === 'ally') return { icon: '🤝', bg: 'rgba(30,64,175,0.88)', border: '#93c5fd', stroke: '#3b82f6' };
    if (relationshipClass === 'acquaintance') return { icon: '•', bg: 'rgba(8,145,178,0.82)', border: '#67e8f9', stroke: '#06b6d4' };
    return { icon: '•', bg: 'rgba(51,65,85,0.84)', border: '#cbd5e1', stroke: '#94a3b8' };
}

export function clearRelationshipMarkers(layer) {
    if (!layer) return;
    layer.replaceChildren();
    layers.delete(layer);
}

export function renderRelationshipMarkers(layer, sourcePos, snapshot, viewport) {

    let state = layers.get(layer);
    const doc = layer.ownerDocument;
    if (!state) {
        const svg = doc.createElementNS(SVG_NS, 'svg');
        svg.style.position = 'fixed';
        svg.style.inset = '0';
        svg.style.overflow = 'visible';
        layer.appendChild(svg);
        state = { svg, entries: [] };
        layers.set(layer, state);
    }
    const { svg, entries } = state;
    svg.setAttribute('width', String(viewport.width || 0));
    svg.setAttribute('height', String(viewport.height || 0));
    let count = 0;

    (snapshot?.ties || []).forEach(tie => {
        if (!tie?.other || typeof tie.other.getScreenPosition !== 'function') return;
        const pos = tie.other.getScreenPosition();
        if (!pos) return;
        const meta = getRelationshipBadgeMeta(tie.relationshipClass);

        let entry = entries[count++];
        if (!entry) {
            entry = {
                line: doc.createElementNS(SVG_NS, 'line'),
                halo: doc.createElementNS(SVG_NS, 'circle'),
                badge: doc.createElement('div'),
            };
            entries.push(entry);
            svg.appendChild(entry.line);
            svg.appendChild(entry.halo);
            layer.appendChild(entry.badge);
        }
        const { line, halo, badge } = entry;
        line.setAttribute('x1', String(sourcePos.x));
        line.setAttribute('y1', String(sourcePos.y - 10));
        line.setAttribute('x2', String(pos.x));
        line.setAttribute('y2', String(pos.y - 6));
        line.setAttribute('stroke', meta.stroke);
        line.setAttribute('stroke-width', String((1.5 + Math.max(0, tie.affinity - 40) / 30).toFixed(2)));
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('opacity', String(Math.max(0.32, Math.min(0.9, tie.affinity / 100))));
        line.removeAttribute('stroke-dasharray');
        if (tie.relationshipClass === 'ally' || tie.relationshipClass === 'acquaintance') {
            line.setAttribute('stroke-dasharray', tie.relationshipClass === 'ally' ? '6 5' : '3 5');
        }

        halo.setAttribute('cx', String(pos.x));
        halo.setAttribute('cy', String(pos.y - 6));
        halo.setAttribute('r', String(tie.relationshipClass === 'bonded' ? 11 : 9));
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', meta.stroke);
        halo.setAttribute('stroke-width', '2');
        halo.setAttribute('opacity', '0.45');

        badge.style.position = 'fixed';
        badge.style.left = `${pos.x}px`;
        badge.style.top = `${pos.y - 28}px`;
        badge.style.transform = 'translate(-50%, -50%)';
        badge.style.padding = '2px 7px';
        badge.style.borderRadius = '999px';
        badge.style.background = meta.bg;
        badge.style.border = `1px solid ${meta.border}`;
        badge.style.color = '#fff';
        badge.style.fontSize = '11px';
        badge.style.fontWeight = '700';
        badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
        badge.textContent = `${meta.icon} ${tie.other.id}`;
        badge.title = `${tie.relationshipClass} · affinity ${Math.round(tie.affinity)} · dist ${tie.distance}`;

    });

    // Keep only visible ties; never retain character objects or departed markers.
    while (entries.length > count) {
        const { line, halo, badge } = entries.pop();
        line.remove();
        halo.remove();
        badge.remove();
    }
}
