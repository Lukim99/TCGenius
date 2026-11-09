const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/paradise.js'), 'utf8');

// Exercise the real browser renderer without starting the server or touching the DB.
function renderer() {
    const painted = [], deleted = [], images = [], listeners = {}, errors = [];
    let textureId = 0;
    const gl = new Proxy({
        createTexture: () => ({ id: ++textureId }),
        deleteTexture: texture => deleted.push(texture),
        getShaderParameter: () => true,
        getProgramParameter: () => true
    }, { get: (object, key) => object[key] || (() => {}) });
    const gradient = { addColorStop() {} };
    const context = vm.createContext({ fontsReady: true, devicePixelRatio: 2,
        document: { createElement: () => ({ getContext: () => ({ createRadialGradient: () => gradient, fillRect() {} }) }) },
        Image: class { constructor() { images.push(this); } },
        fatal: message => errors.push(message),
        paintCard(choice, icon, w, h) { painted.push({ choice, ready: !!icon?.ready, w, h }); return { width: w, height: h }; }
    });
    vm.runInContext(source.slice(source.indexOf('    class CorridorGL {'), source.indexOf('    let renderer;')) + '\nthis.CorridorGL = CorridorGL;', context);
    const instance = new context.CorridorGL({ width: 800, height: 1200, getContext: () => gl, addEventListener: (name, fn) => { listeners[name] = fn; } });
    return { instance, context, painted, deleted, images, listeners, errors };
}
const choice = (id, iconUrl) => ({ id, iconUrl, name: id, desc: 'Current effect', floors: 5, rarity: 'gold' });

test('unchanged cards survive unrelated background and reward image loads', () => {
    const r = renderer(), a = choice('a', '/a.webp'), b = choice('b', '/b.webp');
    const first = r.instance.card(a, 300, 500), second = r.instance.card(b, 300, 500);
    for (let i = 0; i < 120; i++) {
        assert.equal(r.instance.card({ ...a }, 300, 500), first);
        assert.equal(r.instance.card({ ...b }, 300, 500), second);
    }
    r.instance.image('/background.webp').image.onload();
    r.instance.image('/reward.webp').image.onload();
    assert.equal(r.instance.card(a, 300, 500), first);
    assert.equal(r.instance.card(b, 300, 500), second);
    assert.equal(r.painted.length, 2);
    assert.equal(r.deleted.length, 0);
});

test('loading a card icon only refreshes cards using that icon', () => {
    const r = renderer(), a = choice('a', '/shared.webp'), b = choice('b', '/other.webp'), c = choice('c', '/shared.webp');
    const first = r.instance.card(a, 300, 500), second = r.instance.card(b, 300, 500), third = r.instance.card(c, 300, 500);
    r.instance.image('/shared.webp').image.onload();
    assert.deepEqual(r.deleted, [first.tex, third.tex]);
    assert.notEqual(r.instance.card(a, 300, 500), first);
    assert.notEqual(r.instance.card(c, 300, 500), third);
    assert.equal(r.instance.card(b, 300, 500), second);
    assert.equal(r.painted.length, 5);
    assert.ok(r.painted.slice(-2).every(card => card.ready));
});

test('card text, warnings, size, density and font readiness still refresh correctly', () => {
    const r = renderer(), a = choice('a');
    r.context.fontsReady = false;
    assert.equal(r.instance.card(a, 300, 500), null);
    assert.equal(r.painted.length, 0);
    r.context.fontsReady = true;
    let current = r.instance.card(a, 300, 500);
    for (const update of [{ desc: 'Changed effect' }, { name: 'New name' }, { floors: -2 }, { powerWarning: true }]) {
        Object.assign(a, update);
        const next = r.instance.card(a, 300, 500);
        assert.notEqual(next, current); current = next;
    }
    const count = r.painted.length;
    r.context.devicePixelRatio = 3;
    assert.equal(r.instance.card(a, 300, 500), current, 'density above the existing 2x cap does not change pixels');
    assert.equal(r.painted.length, count);
    r.context.devicePixelRatio = 1;
    assert.notEqual(r.instance.card(a, 300, 500), current);
    assert.equal(r.instance.cards.size, 1);
    current = r.instance.card(a, 300, 500);
    assert.notEqual(r.instance.card(a, 280, 460), current);
    assert.equal(r.instance.cards.size, 1);
    r.instance.clearCards();
    assert.equal(r.instance.cards.size, 0);
    assert.equal(r.deleted.length, r.painted.length);
});

test('WebGL context loss still prevents default recovery and shows the saved-exploration message', () => {
    const r = renderer(); let prevented = false;
    r.listeners.webglcontextlost({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /새로고침/);
});

function controls() {
    const writes = [], elements = [];
    const controls = { children: elements, append: button => elements.push(button), get lastElementChild() { return elements.at(-1); } };
    const document = { createElement() {
        const button = { style: { set cssText(value) { writes.push(['style', value]); } },
            setAttribute: (name, value) => writes.push([name, value]),
            remove() { elements.splice(elements.indexOf(buttonProxy), 1); }
        };
        const buttonProxy = new Proxy(button, { set(object, key, value) {
            if (['disabled', 'onclick', 'onfocus'].includes(key)) writes.push([key, value]);
            object[key] = value; return true;
        } });
        return buttonProxy;
    } };
    const context = vm.createContext({ controls, document, regions: [], inputMode: 'keyboard', keyboardCard: -1, state: { run: { choices: [{ name: 'Alpha' }, { name: 'Beta' }] } } });
    vm.runInContext(source.slice(source.indexOf('    function syncRegions()'), source.indexOf('    function frame(')), context);
    return { context, elements, writes, sync(regions) { context.regions = regions; context.syncRegions(); } };
}
const region = (label, fn = () => {}) => ({ x: 10, y: 20, w: 150, h: 40, label, fn, disabled: false });

test('stable controls have no repeated DOM or handler writes but always call the newest action', () => {
    const c = controls(); let calls = 0, receiver, received;
    c.sync([region('Alpha', () => { calls++; })]);
    const button = c.elements[0], onclick = button.onclick, onfocus = button.onfocus;
    const count = c.writes.length;
    for (let i = 0; i < 120; i++) c.sync([region('Alpha', function (event) { calls += 2; receiver = this; received = event; })]);
    assert.equal(c.writes.length, count);
    assert.equal(button.onclick, onclick); assert.equal(button.onfocus, onfocus);
    const event = {}; button.onclick(event);
    assert.equal(calls, 2); assert.equal(receiver, button); assert.equal(received, event);
    button.onfocus(); assert.equal(c.context.keyboardCard, 0);
});

test('labels, disabled state and moving hit areas update independently without replacing focused buttons', () => {
    const c = controls(); c.sync([region('Alpha'), region('Other')]);
    const first = c.elements[0]; c.writes.length = 0;
    c.sync([{ ...region('Beta'), disabled: true, x: 25, y: 30 }]);
    assert.equal(c.elements.length, 1); assert.equal(c.elements[0], first);
    assert.deepEqual(c.writes.map(([name]) => name), ['aria-label', 'disabled', 'style']);
    assert.equal(first.disabled, true);
    assert.match(c.writes.find(([name]) => name === 'style')[1], /left:25px;top:30px/);
    first.onfocus(); assert.equal(c.context.keyboardCard, 1);
    c.context.inputMode = 'pointer'; c.context.keyboardCard = -1;
    first.onfocus(); assert.equal(c.context.keyboardCard, -1);
    c.writes.length = 0; c.sync([{ ...region('Beta'), x: 25, y: 30 }]);
    assert.deepEqual(c.writes.map(([name]) => name), ['disabled']);
    assert.equal(first.disabled, false);
    c.sync([]); assert.equal(c.elements.length, 0);
});

test('visibility only writes on state changes, including repeated overlays', () => {
    const context = vm.createContext({});
    const helper = source.match(/    function setHidden\(node, hidden\) \{[^\n]+/)[0];
    vm.runInContext(helper, context);
    let hidden = false, writes = 0;
    const node = { get hidden() { return hidden; }, set hidden(value) { hidden = value; writes++; } };
    for (let i = 0; i < 120; i++) context.setHidden(node, false);
    assert.equal(writes, 0);
    for (let i = 0; i < 120; i++) context.setHidden(node, true);
    assert.equal(writes, 1);
    context.setHidden(node, false); assert.equal(writes, 2);
});
