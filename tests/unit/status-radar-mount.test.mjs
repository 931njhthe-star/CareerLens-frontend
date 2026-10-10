import assert from 'node:assert/strict';
import test from 'node:test';
import { setMaxListeners } from 'node:events';
import { mountStatusRadar } from '../../src/features/analysis/status-radar.js';
import { demoScoreModel } from '../../src/features/analysis/demo-score-data.js';
import { scorePyramidPalette } from '../../src/shared/design/selected-theme.js';

function mountHarness(t, { reducedMotion = true } = {}) {
  let measurements = 0;
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
    getBoundingClientRect() {
      measurements++;
      return { width: 10 + this.textContent.length * 12, height: 23, left: 0, top: 0 };
    }
    scrollIntoView() {}
  }
  const doc = new EventTarget();
  doc.hidden = false;
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (_, tag) => new Element(tag);
  doc.createTextNode = (text) => Object.assign(new Element('#text'), { textContent: text });
  const reduced = Object.assign(new EventTarget(), { matches: reducedMotion });
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
  const frames = new Map();
  let frameId = 0;
  let now = 0;
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
    requestAnimationFrame: (callback) => {
      assert.equal(reducedMotion, false, 'Reduced-motion mount should settle immediately');
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
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
  return {
    container,
    button,
    observers,
    all,
    text,
    measurements: () => measurements,
    advance(count) {
      for (let index = 0; index < count; index++) {
        const pending = [...frames.values()];
        frames.clear();
        now += 50;
        pending.forEach((callback) => callback(now));
      }
    },
  };
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
    model.axes.map((axis) => axis.label),
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
  assert.equal(h.button.textContent, '기본 도형으로 돌아가기');
  assert.equal(h.all(h.container, 'dl')[0].style.visibility, 'hidden');
  assert.equal(h.all(h.container, 'dl')[0].getAttribute('aria-hidden'), 'true');
  assert.deepEqual(
    h.all(h.container, 'dd').map(h.text),
    model.axes.map((axis) => String(axis.score)),
  );
  assert.deepEqual(
    JSON.parse(h.container.dataset.displayScores),
    model.preview.axes.map((axis) => axis.score),
  );
  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.container.dataset.previewMode, 'current');
  assert.equal(h.all(h.container, 'dl')[0].style.visibility, '');
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

test('preview readings stay hidden throughout the return morph and restore exact baseline values', (t) => {
  const h = mountHarness(t, { reducedMotion: false });
  const report = {};
  const baseline = demoScoreModel(report).axes.map((axis) => String(axis.score));
  const dispose = mountStatusRadar(h.container, report);
  t.after(dispose);
  const readings = h.all(h.container, 'dl')[0];
  h.advance(40);
  h.button.dispatchEvent(new Event('click'));
  h.advance(15);
  assert.equal(readings.style.visibility, 'hidden');
  h.button.dispatchEvent(new Event('click'));
  h.advance(15);
  assert.equal(h.container.dataset.animationState, 'morphing');
  assert.equal(readings.style.visibility, 'hidden');
  assert.deepEqual(h.all(h.container, 'dd').map(h.text), baseline);
  h.advance(25);
  assert.equal(h.container.dataset.animationState, 'settled');
  assert.equal(readings.style.visibility, '');
  assert.deepEqual(h.all(h.container, 'dd').map(h.text), baseline);
  dispose();
});

test('crystal fallback and color transitions use the selected blue palette', (t) => {
  const h = mountHarness(t);
  const dispose = mountStatusRadar(h.container, {});
  t.after(dispose);
  const colors = (hex) =>
    `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ')})`;
  const polygons = h.all(h.container, 'polygon');
  assert.equal(h.all(h.container, 'svg')[0].style.background, scorePyramidPalette.background);
  assert.equal(polygons[0].getAttribute('fill'), scorePyramidPalette.glass);
  assert.equal(h.all(h.container, 'path')[0].getAttribute('stroke'), scorePyramidPalette.edge);
  assert.equal(polygons[4].getAttribute('fill'), colors(scorePyramidPalette.base));
  h.button.dispatchEvent(new Event('click'));
  assert.equal(polygons[4].getAttribute('fill'), colors(scorePyramidPalette.projected));
  assert.equal(
    h.container.children[0].style['--pyramid-value'],
    colors(scorePyramidPalette.projected),
  );
  assert.match(h.text(h.container), /변화 예시 · 하늘색/);
  assert.doesNotMatch(h.text(h.container), /금색|붉은색/);
  dispose();
});

test('full axis labels stay inside a narrow canvas without overlaps across a full rotation', (t) => {
  const h = mountHarness(t);
  const report = {};
  const dispose = mountStatusRadar(h.container, report);
  t.after(dispose);
  const labels = h
    .all(h.container, 'span')
    .filter((node) => node.className === 'score-pyramid__vertex');
  const scene = h.all(h.container, 'div').find((node) => node.className === 'score-pyramid__scene');
  assert.deepEqual(
    labels.map(h.text),
    demoScoreModel(report).axes.map((axis) => axis.label),
  );
  h.observers[0].callback([{ contentRect: { width: 264, height: 280 } }]);
  const measurements = h.measurements();
  for (let index = 0; index < 33; index++) {
    const key = new Event('keydown');
    key.key = 'ArrowRight';
    scene.dispatchEvent(key);
    const boxes = labels.map((label) => {
      const [, x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(label.style.transform);
      return { x: +x, y: +y, width: 10 + label.textContent.length * 12, height: 23 };
    });
    boxes.forEach((box, a) => {
      assert.ok(box.x >= 8 && box.x + box.width <= 256);
      assert.ok(box.y >= 8 && box.y + box.height <= 272);
      boxes.slice(a + 1).forEach((other) => {
        assert.ok(
          box.x + box.width <= other.x ||
            other.x + other.width <= box.x ||
            box.y + box.height <= other.y ||
            other.y + other.height <= box.y,
        );
      });
    });
  }
  assert.equal(h.measurements(), measurements, 'Rotation must reuse cached label dimensions');
  dispose();
});
