import assert from 'node:assert/strict';
import test from 'node:test';
import { setMaxListeners } from 'node:events';
import { mountStatusRadar } from '../../src/features/analysis/status-radar.js';
import { demoScoreModel } from '../../src/features/analysis/demo-score-data.js';

function mountHarness(t) {
  class Element extends EventTarget {
    constructor(tag) {
      super();
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.style = {
        setProperty(name, value) {
          this[name] = value;
        },
      };
      this.classList = { toggle() {} };
      this.textContent = '';
    }
    append(...nodes) {
      for (const node of nodes) {
        this.children.push(node);
        node.parentElement = this;
      }
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    remove() {
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    scrollIntoView() {}
  }
  const doc = new EventTarget();
  doc.hidden = false;
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (_, tag) => new Element(tag);
  doc.createTextNode = (text) => Object.assign(new Element('#text'), { textContent: text });
  const reduced = Object.assign(new EventTarget(), { matches: true });
  const win = Object.assign(new EventTarget(), { matchMedia: () => reduced });
  const observers = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const NativeAbortController = globalThis.AbortController;
  class Controller extends NativeAbortController {
    constructor() {
      super();
      setMaxListeners(0, this.signal);
    }
  }
  for (const [name, value] of Object.entries({
    document: doc,
    window: win,
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    requestAnimationFrame: () => assert.fail('Reduced-motion mount should settle immediately'),
    cancelAnimationFrame: () => {},
    AbortController: Controller,
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => (old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]));
  }
  const container = new Element('div');
  const button = new Element('button');
  const note = new Element('aside');
  const surface = {
    querySelectorAll: () => [button],
    querySelector: () => note,
  };
  container.closest = () => surface;
  const all = (root, tag) =>
    root.children.flatMap((node) => [...(node.tagName === tag ? [node] : []), ...all(node, tag)]);
  const text = (node) => node.textContent + node.children.map(text).join('');
  return { container, button, observers, all, text };
}

test('actual pyramid mount renders four readings, toggles both ways, and disposes cleanly', (t) => {
  const h = mountHarness(t);
  const report = {};
  const model = demoScoreModel(report);
  const dispose = mountStatusRadar(h.container, report);
  t.after(dispose);
  assert.equal(h.container.dataset.axisCount, '4');
  assert.equal(h.container.dataset.animationState, 'settled');
  assert.deepEqual(
    JSON.parse(h.container.dataset.displayScores),
    model.axes.map((axis) => axis.score),
  );
  assert.deepEqual(
    h.all(h.container, 'dt').map(h.text),
    model.axes.map((axis, index) => `${index + 1}${axis.label}`),
  );
  assert.deepEqual(
    h.all(h.container, 'dd').map(h.text),
    model.axes.map((axis) => String(axis.score)),
  );
  assert.ok(h.all(h.container, 'dd').every((node) => node.dataset.unavailable === 'false'));
  assert.equal(h.button.disabled, false);

  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.container.dataset.previewMode, 'projected');
  assert.equal(h.button.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(
    JSON.parse(h.container.dataset.displayScores),
    model.preview.axes.map((axis) => axis.score),
  );
  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.container.dataset.previewMode, 'current');
  assert.deepEqual(
    JSON.parse(h.container.dataset.displayScores),
    model.axes.map((axis) => axis.score),
  );

  dispose();
  assert.equal(h.container.children.length, 0);
  assert.deepEqual(h.container.dataset, {});
  assert.ok(h.observers.every((observer) => observer.disconnected));
  h.button.dispatchEvent(new Event('click'));
  assert.deepEqual(h.container.dataset, {});
});
