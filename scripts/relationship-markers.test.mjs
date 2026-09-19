import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRelationshipMarkers, clearRelationshipMarkers } from '../ui/relationship-markers.js';

// Minimal DOM double for identity, attribute, and removal checks without a new dependency.
function fixture() {
    let created = 0;
    const doc = { createElement, createElementNS: (_namespace, tag) => createElement(tag) };
    function createElement(tag) {
        created++;
        return {
            tag, ownerDocument: doc, children: [], style: {}, attributes: {}, parentNode: null,
            setAttribute(key, value) { this.attributes[key] = value; },
            removeAttribute(key) { delete this.attributes[key]; },
            appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; },
            remove() {
                if (this.parentNode) {
                    const siblings = this.parentNode.children;
                    siblings.splice(siblings.indexOf(this), 1);
                    this.parentNode = null;
                }
            },
            replaceChildren() { for (const child of [...this.children]) child.remove(); },
        };
    }
    return { layer: createElement('div'), created: () => created };
}

const tie = (id, relationshipClass = 'ally', pos = { x: 20, y: 30 }) => ({
    other: { id, getScreenPosition: () => pos }, relationshipClass, affinity: 80, distance: 3,
});
const render = (layer, ties, source = { x: 10, y: 20 }) =>
    renderRelationshipMarkers(layer, source, { ties }, { width: 800, height: 600 });

test('movement updates existing nodes without creating replacement DOM', () => {
    const { layer, created } = fixture();
    render(layer, [tie(1), tie(2)]);
    const svg = layer.children[0], badge = layer.children[1], line = svg.children[0];
    const initialCount = created();
    for (let i = 0; i < 100; i++) render(layer, [tie(1, 'ally', { x: i, y: 50 }), tie(2)]);
    assert.equal(created(), initialCount);
    assert.equal(layer.children[0], svg);
    assert.equal(layer.children[1], badge);
    assert.equal(svg.children[0], line);
    assert.equal(line.attributes.x2, '99');
    assert.equal(badge.style.left, '99px');
});

test('slot reuse refreshes identity and removes obsolete dashed styling', () => {
    const { layer } = fixture();
    render(layer, [tie(1)]);
    const line = layer.children[0].children[0];
    assert.equal(line.attributes['stroke-dasharray'], '6 5');
    render(layer, [tie(5, 'bonded')]);
    assert.equal(line.attributes['stroke-dasharray'], undefined);
    assert.equal(line.attributes.stroke, '#ec4899');
    assert.equal(layer.children[1].textContent, '❤ 5');
    assert.equal(layer.children[0].children[1].attributes.r, '11');
});

test('offscreen ties, deselection, and layer replacement leave no stale markers', () => {
    const { layer } = fixture();
    render(layer, [tie(1), tie(2)]);
    const removedBadge = layer.children[2];
    render(layer, [tie(1), tie(2, 'ally', null)]);
    assert.equal(layer.children.length, 2);
    assert.equal(layer.children[0].children.length, 2);
    assert.equal(removedBadge.parentNode, null);
    render(layer, []);
    assert.equal(layer.children.length, 1);
    assert.equal(layer.children[0].children.length, 0);
    clearRelationshipMarkers(layer);
    clearRelationshipMarkers(layer);
    assert.equal(layer.children.length, 0);
    render(layer, [tie(3)]);
    assert.equal(layer.children[1].textContent, '🤝 3');
    const other = fixture().layer;
    render(other, [tie(4)]);
    assert.equal(other.children[1].textContent, '🤝 4');
    assert.equal(layer.children[1].textContent, '🤝 3');
});
