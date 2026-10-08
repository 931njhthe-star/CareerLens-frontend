import { pyramidAxes, pyramidPreview, pyramidTransition } from './status-radar-data.js';

const mounts = new WeakMap();
const NS = 'http://www.w3.org/2000/svg';
const VERTICES = [
  [0, 1.28, 0],
  [0, -1.28 / 3, 1.28 * Math.sqrt(8 / 9)],
  [-1.28 * Math.sqrt(2 / 3), -1.28 / 3, -1.28 * Math.sqrt(2 / 9)],
  [1.28 * Math.sqrt(2 / 3), -1.28 / 3, -1.28 * Math.sqrt(2 / 9)],
];
const FACES = [
  [0, 2, 1],
  [0, 3, 2],
  [0, 1, 3],
  [1, 2, 3],
];
const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [2, 3],
  [3, 1],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svg(tag, attributes = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

/** A perspective fallback also preserves exact values when WebGL is unavailable. */
function fallbackScene() {
  const root = svg('svg', {
    viewBox: '0 0 340 310',
    'aria-hidden': 'true',
    class: 'score-pyramid__fallback',
  });
  const faces = FACES.map(() => svg('polygon', { class: 'score-pyramid__fallback-value' }));
  const wire = svg('path', {
    fill: 'none',
    stroke: '#aeb7a4',
    'stroke-width': '.8',
    opacity: '.7',
  });
  root.append(...faces, wire);
  return {
    root,
    draw(scores, colorMix, yaw, pitch, zoom, showValues = true) {
      const project = ([x, y, z], scale = 1) => {
        x *= scale;
        y *= scale;
        z *= scale;
        const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
        const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
        const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
        const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
        const perspective = 5.6 / (5.6 - depth);
        return {
          x: 170 + rx * 90 * zoom * perspective,
          y: 153 - ry * 90 * zoom * perspective,
          depth,
        };
      };
      const outer = VERTICES.map((v) => project(v));
      const points = showValues ? VERTICES.map((v, i) => project(v, scores[i] / 100)) : [];
      const blendColor = (from, to) =>
        `rgb(${from.map((value, i) => Math.round(value + (to[i] - value) * colorMix)).join(' ')})`;
      wire.setAttribute(
        'd',
        EDGES.map(([a, b]) => `M${outer[a].x},${outer[a].y}L${outer[b].x},${outer[b].y}`).join(' '),
      );
      faces.forEach((face, index) => {
        face.style.display = showValues ? '' : 'none';
        if (!showValues) return;
        face.setAttribute(
          'points',
          FACES[index].map((i) => `${points[i].x},${points[i].y}`).join(' '),
        );
        face.setAttribute('fill', blendColor([222, 183, 98], [231, 119, 115]));
        face.setAttribute('fill-opacity', String(0.12 + index * 0.035));
        face.setAttribute('stroke', blendColor([230, 196, 125], [237, 153, 144]));
        face.setAttribute('stroke-width', '.8');
      });
      return outer.map((p) => ({ x: p.x / 340, y: p.y / 310, depth: p.depth }));
    },
  };
}

/** Replaces the old chart in-place. Camera tools never occupy the report surface. */
export function mountStatusRadar(container, report) {
  mounts.get(container)?.();
  const axes = pyramidAxes(report);
  const preview = pyramidPreview(report);
  const abort = new AbortController();
  const { signal } = abort;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = element('div', 'score-pyramid');
  const scene = element('div', 'score-pyramid__scene');
  const canvas = element('canvas', 'score-pyramid__canvas');
  canvas.setAttribute('aria-hidden', 'true');
  scene.tabIndex = 0;
  scene.setAttribute('role', 'img');
  scene.setAttribute(
    'aria-label',
    '시연용 점수이며 실제 평가와 무관합니다. 투명 삼각뿔의 네 꼭짓점은 각 항목의 100점입니다. 마우스 이동으로 시점, 휠로 크기를 조절할 수 있습니다. 키보드 방향키도 사용할 수 있습니다. 점수는 바로 아래에 표시됩니다.',
  );
  const fallback = fallbackScene();
  scene.append(fallback.root, canvas);
  const labels = axes.map((axis, index) => {
    const label = element('span', 'score-pyramid__vertex', String(index + 1));
    label.setAttribute('aria-hidden', 'true');
    scene.append(label);
    return label;
  });
  const readings = element('dl', 'score-pyramid__readings');
  const values = axes.map((axis, index) => {
    const row = element('div', 'score-pyramid__reading');
    const name = element('dt');
    name.append(
      element('span', 'score-pyramid__axis-number', String(index + 1)),
      document.createTextNode(axis.label),
    );
    const value = element(
      'dd',
      '',
      axis.normalized === null ? '미산정' : `${Math.round(axis.normalized)}`,
    );
    value.dataset.unavailable = String(axis.normalized === null);
    row.append(name, value);
    readings.append(row);
    return value;
  });
  const status = element('p', 'score-pyramid__status', '시연 시작 점수 · 금색');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(scene, readings, status);
  container.replaceChildren(root);
  container.dataset.axisCount = String(axes.length);
  container.dataset.radarScores = JSON.stringify(axes.map((axis) => axis.normalized));

  const surface = container.closest('[data-resume-score-card]') || container;
  const buttons = [...surface.querySelectorAll('[data-preview-improvement]')];
  let disposed = false,
    renderer,
    lost = false,
    visible = true,
    printing = false,
    frameId = 0,
    previous = null;
  let width = 340,
    height = 310,
    clock = 0,
    started = 0,
    duration = 1.6,
    colorMix = 0,
    colorFrom = 0,
    colorTo = 0;
  const complete = axes.length === 4 && axes.every((axis) => axis.normalized !== null);
  const baseline = axes.map((axis) => axis.normalized);
  let from = complete ? baseline.map(() => 0) : [...baseline],
    to = [...baseline],
    current = [...from],
    projected = false;
  let yaw = -0.6,
    hover = false,
    targetX = 0,
    targetY = 0,
    offsetX = 0,
    offsetY = 0,
    zoom = 1,
    zoomTarget = 1;
  scene.hidden = axes.length !== 4;
  root.dataset.complete = String(complete);
  if (!complete)
    status.textContent =
      axes.length === 4
        ? '미산정 항목이 있어 기준선만 표시합니다. 확인된 점수는 아래에서 볼 수 있습니다.'
        : '표시할 평가 항목이 없습니다.';

  function draw() {
    if (axes.length !== 4) return;
    const progress = reduced.matches || printing ? 1 : Math.min(1, (clock - started) / duration);
    current = complete ? pyramidTransition(from, to, progress) : [...baseline];
    colorMix = pyramidTransition([colorFrom], [colorTo], progress)[0];
    const rotation = printing ? -0.6 : yaw + offsetX;
    const pitch = printing ? 0.08 : 0.08 + offsetY;
    let positions;
    if (renderer && !lost && !printing) {
      positions = renderer.render(current, colorMix, rotation, pitch, zoom);
    } else {
      positions = fallback
        .draw(current, colorMix, rotation, pitch, zoom, complete)
        .map((p) => ({ ...p, x: p.x * width, y: p.y * height }));
    }
    const placed = [];
    labels.forEach((label, index) => {
      const point = positions[index];
      if (!point) return;
      const x = Math.max(12, Math.min(width - 12, point.x + 10));
      let y = Math.max(12, Math.min(height - 12, point.y - 9));
      for (const previous of placed)
        if (Math.abs(previous.x - x) < 18 && Math.abs(previous.y - y) < 18) y += 19;
      placed.push({ x, y });
      label.style.transform = `translate(${x}px, ${y}px)`;
      label.style.opacity = String(index === 0 ? 1 : 0.8);
    });
    values.forEach((node, index) => {
      node.textContent =
        axes[index].normalized === null ? '미산정' : String(Math.round(current[index]));
    });
    root.style.setProperty(
      '--pyramid-value',
      `rgb(${Math.round(222 + (231 - 222) * colorMix)} ${Math.round(183 + (119 - 183) * colorMix)} ${Math.round(98 + (115 - 98) * colorMix)})`,
    );
    container.dataset.animationState = !complete || progress >= 1 ? 'settled' : 'morphing';
    container.dataset.previewMode = projected ? 'projected' : 'current';
    container.dataset.displayScores = JSON.stringify(current);
  }
  function stop() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    previous = null;
  }
  function frame(now) {
    frameId = 0;
    if (disposed || !visible || document.hidden || printing) return;
    const dt = previous === null ? 0 : Math.min((now - previous) / 1000, 0.05);
    previous = now;
    clock += dt;
    if (!reduced.matches) yaw += dt * 0.085 * (hover ? 0 : 1);
    const ease = 1 - Math.exp(-dt * 5);
    offsetX += (targetX - offsetX) * ease;
    offsetY += (targetY - offsetY) * ease;
    zoom += (zoomTarget - zoom) * ease;
    draw();
    if (!reduced.matches && complete) frameId = requestAnimationFrame(frame);
  }
  function resume() {
    if (disposed || !visible || document.hidden || printing) return;
    if (reduced.matches || !complete) {
      stop();
      offsetX = targetX;
      offsetY = targetY;
      zoom = zoomTarget;
      draw();
    } else if (!frameId) frameId = requestAnimationFrame(frame);
  }
  function changePreview() {
    if (!preview || !complete) return;
    draw();
    projected = !projected;
    from = [...current];
    to = projected ? preview.axes.map((axis) => axis.normalized) : [...baseline];
    colorFrom = colorMix;
    colorTo = projected ? 1 : 0;
    started = clock;
    duration = 1.8;
    status.textContent = projected ? '시연 변화 점수 · 붉은색' : '시연 시작 점수 · 금색';
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(projected));
      button.textContent = projected ? '시연 시작 점수로 돌아가기' : '점수 변화 시연 보기';
    }
    surface.querySelector('[data-improvement-note]')?.classList.toggle('is-previewing', projected);
    draw();
    resume();
    scene.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'instant' : 'smooth' });
  }
  buttons.forEach((button) => {
    button.disabled = !preview || !complete;
    button.addEventListener('click', changePreview, { signal });
  });
  scene.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return;
      const bounds = scene.getBoundingClientRect();
      hover = true;
      targetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 1.3;
      targetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.5;
      resume();
    },
    { signal },
  );
  scene.addEventListener(
    'pointerleave',
    () => {
      hover = false;
      targetX = 0;
      targetY = 0;
      resume();
    },
    { signal },
  );
  scene.addEventListener(
    'wheel',
    (event) => {
      // Keep report scrolling available at the zoom limits and do not intercept pinch-to-zoom.
      if (event.ctrlKey) return;
      const next = Math.max(0.85, Math.min(1.16, zoomTarget - event.deltaY * 0.00065));
      if (next === zoomTarget) return;
      event.preventDefault();
      zoomTarget = next;
      resume();
    },
    { signal, passive: false },
  );
  scene.addEventListener(
    'keydown',
    (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-'].includes(event.key))
        return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') yaw -= 0.2;
      if (event.key === 'ArrowRight') yaw += 0.2;
      if (event.key === 'ArrowUp') targetY = Math.max(-0.4, targetY - 0.1);
      if (event.key === 'ArrowDown') targetY = Math.min(0.4, targetY + 0.1);
      if (event.key === '+') zoomTarget = Math.min(1.16, zoomTarget + 0.05);
      if (event.key === '-') zoomTarget = Math.max(0.85, zoomTarget - 0.05);
      resume();
    },
    { signal },
  );
  const resize = new ResizeObserver(([entry]) => {
    width = Math.max(1, entry.contentRect.width);
    height = Math.max(1, entry.contentRect.height);
    renderer?.resize(width, height);
    draw();
  });
  resize.observe(scene);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? resume() : stop();
  });
  visibility.observe(container);
  document.addEventListener(
    'visibilitychange',
    () => {
      document.hidden ? stop() : resume();
    },
    { signal },
  );
  reduced.addEventListener(
    'change',
    () => {
      stop();
      resume();
    },
    { signal },
  );
  window.addEventListener(
    'beforeprint',
    () => {
      printing = true;
      stop();
      root.dataset.printing = 'true';
      draw();
    },
    { signal },
  );
  window.addEventListener(
    'afterprint',
    () => {
      printing = false;
      delete root.dataset.printing;
      resume();
    },
    { signal },
  );
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      lost = true;
      root.dataset.renderer = 'fallback';
      draw();
    },
    { signal },
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      lost = false;
      root.dataset.renderer = 'webgl';
      resume();
    },
    { signal },
  );
  root.dataset.renderer = 'fallback';
  if (complete)
    import('./matching-eye.js')
      .then(({ ScorePyramidRenderer }) => {
        if (disposed) return;
        try {
          renderer = new ScorePyramidRenderer(canvas);
          renderer.resize(width, height);
          root.dataset.renderer = 'webgl';
          draw();
          resume();
        } catch {
          renderer?.dispose();
          renderer = undefined;
          root.dataset.renderer = 'fallback';
        }
      })
      .catch(() => {
        /* The visible perspective fallback already contains all scores. */
      });
  draw();
  resume();
  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    abort.abort();
    resize.disconnect();
    visibility.disconnect();
    renderer?.dispose();
    root.remove();
    if (mounts.get(container) === dispose) {
      mounts.delete(container);
      for (const key of [
        'axisCount',
        'radarScores',
        'animationState',
        'previewMode',
        'displayScores',
      ])
        delete container.dataset[key];
    }
  }
  mounts.set(container, dispose);
  return dispose;
}
