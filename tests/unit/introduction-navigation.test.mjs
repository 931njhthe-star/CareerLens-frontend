import test from 'node:test';
import assert from 'node:assert/strict';
import { shell, renderPrimaryNav } from '../../src/shared/components/ui.js';
import { introductionPage } from '../../src/pages/introduction.js';
import {
  bindIntroduction,
  INTRODUCTION_DURATION_MS,
} from '../../src/features/introduction/intro.js';

test('global navigation has four stable destinations and one matching current page', () => {
  for (const [page, current] of [
    ['intro', 'intro'],
    ['resume', 'resume'],
    ['job', 'job'],
    ['opportunities', 'job'],
    ['questions', 'practice'],
    ['result', 'practice'],
  ]) {
    const markup = renderPrimaryNav(page);
    const links = [...markup.matchAll(/<a href="#\/(\w+)"([^>]*)>([^<]+)<\/a>/g)];
    assert.deepEqual(
      links.map((link) => [link[1], link[3]]),
      [
        ['intro', '소개'],
        ['resume', '이력서'],
        ['job', '채용공고'],
        ['practice', '모의 지원'],
      ],
    );
    assert.deepEqual(
      links.filter((link) => link[2].includes('aria-current="page"')).map((link) => link[1]),
      [current],
    );
    assert.ok(!markup.includes('희망 직무'));
  }
});

test('workflow indicator stays outside the header and maps posting browsing to step two', () => {
  const draft = { resume_text: '경력', career_target: { role_id: 'developer' } };
  for (const [page, activeLabel] of [
    ['resume', '이력서'],
    ['job', '채용 공고'],
    ['opportunities', '채용 공고'],
    ['preparing', '채용 공고'],
    ['questions', '모의지원'],
    ['result', '모의지원'],
  ]) {
    const markup = shell('', { page, draft });
    const headerEnd = markup.indexOf('</header>');
    const indicatorStart = markup.indexOf('aria-label="모의지원 진행 단계"');
    assert.ok(indicatorStart > headerEnd);
    const currentStep = markup.match(
      /<(?:a|span)\s+[^>]*class="step active[^>]*>[\s\S]*?<span>([^<]+)<\/span>/,
    );
    assert.equal(currentStep?.[1], activeLabel, page);
  }
});

test('introduction, auth, and standalone catalog have no workflow indicator', () => {
  for (const page of ['intro', 'login', 'email', 'register', 'jobs']) {
    const markup = shell('', { page });
    assert.ok(!markup.includes('aria-label="모의지원 진행 단계"'), page);
    assert.match(markup, /class="brand"\s+href="#\/intro"/);
  }
  const markup = introductionPage();
  assert.match(markup, /data-intro-skip/);
  assert.match(markup, /잠시 후 이력서 화면으로 이동합니다/);
});

function introHarness(t) {
  const listeners = new Map();
  const skip = {
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type) => listeners.delete(type),
  };
  const root = { querySelector: () => skip };
  const originalDocument = globalThis.document;
  globalThis.document = { querySelector: () => root };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  let callback;
  let duration;
  let cancelled = false;
  t.mock.method(globalThis, 'setTimeout', (action, delay) => {
    callback = action;
    duration = delay;
    return 7;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => {
    assert.equal(id, 7);
    cancelled = true;
  });
  return {
    skip: () => listeners.get('click')?.(),
    finish: () => callback(),
    delay: () => duration,
    cancelled: () => cancelled,
    listenerCount: () => listeners.size,
  };
}

test('introduction completes once after the short presentation', (t) => {
  const intro = introHarness(t);
  let completed = 0;
  bindIntroduction({ onComplete: () => completed++ });
  assert.equal(intro.delay(), INTRODUCTION_DURATION_MS);
  assert.equal(INTRODUCTION_DURATION_MS, 2500);
  intro.finish();
  intro.finish();
  assert.equal(completed, 1);
  assert.equal(intro.listenerCount(), 0);
});

test('skip completes immediately and prevents a second timer navigation', (t) => {
  const intro = introHarness(t);
  let completed = 0;
  bindIntroduction({ onComplete: () => completed++ });
  intro.skip();
  assert.equal(completed, 1);
  assert.ok(intro.cancelled());
  intro.finish();
  assert.equal(completed, 1);
});

test('leaving introduction cancels delayed navigation and allows a fresh replay', (t) => {
  const intro = introHarness(t);
  let completed = 0;
  const dispose = bindIntroduction({ onComplete: () => completed++ });
  dispose();
  intro.finish();
  intro.skip();
  assert.equal(completed, 0);
  assert.ok(intro.cancelled());
  assert.equal(intro.listenerCount(), 0);
  bindIntroduction({ onComplete: () => completed++ });
  intro.finish();
  assert.equal(completed, 1);
});
