'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = new Map();
const timers = new Map();
let timerId = 0;
const document = {
    activeElement: null,
    fullscreenElement: {},
    getElementById: id => elements.get(id),
    createTextNode: text => ({ textContent: text }),
    createElement(tag) {
        const listeners = new Map();
        const element = {
            tag, style: {}, children: [], disabled: false, value: '',
            setAttribute() {},
            appendChild(child) { this.children.push(child); return child; },
            addEventListener(type, handler) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(handler);
            },
            focus() { document.activeElement = this; },
            dispatch(type) {
                const event = { stopped: false, defaultPrevented: false,
                    stopPropagation() { this.stopped = true; },
                    preventDefault() { this.defaultPrevented = true; } };
                for (const handler of listeners.get(type) || []) handler(event);
                return event;
            }
        };
        Object.defineProperty(element, 'id', { set(id) { elements.set(id, element); } });
        return element;
    }
};
const window = {
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }
};
let source = fs.readFileSync(path.join(__dirname, '../Jellyfin.Plugin.Partyline/Web/partyline.js'), 'utf8');
// Expose the actual composer functions without starting API polling or changing production exports.
source = source.slice(0, source.indexOf("    if (document.readyState === 'loading')")) +
    'window.test = { createComposer, setComposerBusy, scheduleComposerCollapse }; })();';
vm.runInNewContext(source, { document, window });
const composer = window.test.createComposer();
composer.style.display = 'flex';
const input = elements.get('partylineInput');

for (const type of ['wheel', 'keydown', 'keypress', 'keyup', 'pointerdown', 'mousedown', 'click', 'dblclick']) {
    const event = composer.dispatch(type);
    assert.equal(event.stopped, true, `${type} must not reach player controls`);
    assert.equal(event.defaultPrevented, false, `${type} must retain normal chat behavior`);
}

input.focus();
for (let send = 0; send < 3; send++) {
    window.test.setComposerBusy(true);
    assert.equal(input.disabled, false, 'sending must not disable the focused textarea');
    assert.equal(input.readOnly, true);
    assert.equal(document.activeElement, input);
    window.test.setComposerBusy(false);
    assert.equal(input.readOnly, false);
}
window.test.scheduleComposerCollapse();
assert.equal(timers.size, 0, 'focused composer must not auto-collapse');
document.activeElement = null;
window.test.scheduleComposerCollapse();
assert.equal(timers.size, 1, 'collapse should resume when focus leaves');
input.focus();
for (const callback of timers.values()) callback();
assert.equal(composer.style.display, 'flex', 'a stale timer must not hide the focused composer');
console.log('Chat input focus, auto-collapse, and player event isolation passed.');
