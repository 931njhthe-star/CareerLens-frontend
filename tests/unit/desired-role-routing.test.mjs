import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shell, escapeHtml } from '../../src/shared/components/ui.js';
import { workspacePage } from '../../src/pages/workspace.js';
import { jobsLoading } from '../../src/pages/jobs.js';
import { opportunitiesPage } from '../../src/pages/opportunities.js';
import { introductionPage } from '../../src/pages/introduction.js';
import { renderAuth } from '../../src/features/auth/auth.js';
import { guestResumePage } from '../../src/features/resumes/guest.js';
import { reportGatePage } from '../../src/features/auth/report-gate.js';
import { draftForPage, remainingEdits } from '../../src/app/workspace-state.js';
import { catalogRoute } from '../../src/features/job-postings/catalog-state.js';
import {
  opportunityRoute,
  opportunityPath,
} from '../../src/features/job-postings/opportunity-state.js';
import { roleChoicesMarkup } from '../../src/features/job-postings/job.js';
import { guestWorkspace, practiceDestination } from '../../src/features/analysis/guest-state.js';

// Exercise the real controller and markup. Only browser mounting and requests
// are replaced; route decisions and editor state remain production code.
const controller = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace(/\bstart\(\);\s*$/, '');

function routeFixture({ member = false, draft = {}, edits = {}, motion = false } = {}) {
  const elements = new Map();
  const calls = { catalog: 0, opportunities: [], gates: 0, journeys: [], observers: [] };
  let heading;
  const element = (id) => ({
    dataset: {},
    innerHTML: '',
    value: '',
    selectedOptions: [{ dataset: {}, textContent: '' }],
    addEventListener() {},
    focus() {},
    classList: { add() {} },
    querySelector: () => (id === 'main' && motion ? heading : null),
    querySelectorAll: () => [],
  });
  let markup = '';
  const app = {
    dataset: {},
    get innerHTML() {
      return markup;
    },
    set innerHTML(value) {
      markup = value;
      elements.clear();
      heading = /data-intro-journey|class="page-heading|class="posting-detail__header/.test(value)
        ? { isConnected: true }
        : null;
      for (const match of value.matchAll(/\bid="([^"]+)"/g))
        elements.set(match[1], element(match[1]));
    },
  };
  let hash = '#/desired-role';
  const location = {
    pathname: '/',
    search: '',
    get hash() {
      return hash;
    },
    set hash(value) {
      hash = value.startsWith('#') ? value : `#${value}`;
    },
  };
  const document = {
    title: '',
    getElementById: (id) => (id === 'app' ? app : elements.get(id) || null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    document,
    location,
    history: {
      pushState(_state, _unused, url) {
        location.hash = url.slice(url.indexOf('#'));
      },
      replaceState(_state, _unused, url) {
        location.hash = url.slice(url.indexOf('#'));
      },
    },
    window: { addEventListener() {}, scrollTo() {} },
    URLSearchParams,
    AbortController,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        calls.observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {
        this.disconnected = true;
      }
    },
    setTimeout() {},
    clearTimeout() {},
    shell,
    escapeHtml,
    workspacePage,
    jobsLoading,
    opportunitiesPage,
    introductionPage,
    renderAuth,
    guestResumePage,
    reportGatePage,
    draftForPage,
    remainingEdits,
    catalogRoute,
    opportunityRoute,
    opportunityPath,
    roleChoicesMarkup,
    guestWorkspace,
    practiceDestination,
    mountJourneyMotion(host, options) {
      const state = {
        host,
        options,
        updates: [],
        disposed: false,
        snapshot: { ...options.snapshot, phase: options.phase, rotation: 1.75, progress: 2.6 },
      };
      calls.journeys.push(state);
      return {
        capture: () => ({ ...state.snapshot }),
        update(next) {
          if (next.phase !== undefined) {
            state.updates.push(next.phase);
            state.snapshot.phase = next.phase;
          }
          if (next.host) state.host = next.host;
        },
        dispose() {
          state.disposed = true;
        },
      };
    },
    stopCatalogLoad() {},
    stopResumeExamples() {},
    clearCatalogEdits() {},
    bindCounters() {},
    bindResumeExamples() {},
    bindIntroduction() {},
    bindAuth() {},
    notice() {},
    bindCatalog() {
      calls.catalog += 1;
    },
    bindOpportunities({ route }) {
      calls.opportunities.push(route);
    },
    bindReportGate() {
      calls.gates += 1;
    },
    api: async (path) => {
      assert.equal(path, '/career-roles');
      return {
        items: [
          { id: 'backend', label: '백엔드 개발자', description: 'API 개발' },
          { id: 'ai', label: 'AI 개발자', description: '모델 개발' },
          { id: 'custom', label: '직접 입력', description: '' },
        ],
      };
    },
    initialUser: member ? { id: 'test-member', name: '테스트 회원' } : null,
    initialDraft: structuredClone(draft),
    initialEdits: structuredClone(edits),
  });
  vm.runInContext(controller, context);
  vm.runInContext(
    `
    session = { user: initialUser };
    workspace = { draft: { ...initialDraft, guest: !initialUser }, questions: [] };
    guest.target = workspace.draft.career_target || null;
    edits = initialEdits;
  `,
    context,
  );
  return {
    calls,
    document,
    location,
    get markup() {
      return markup;
    },
    element: (id) => elements.get(id),
    replaceCatalogHeading() {
      heading = { isConnected: true };
      calls.observers.at(-1)?.callback();
    },
    snapshot: () => JSON.parse(vm.runInContext('JSON.stringify({workspace, edits})', context)),
    bridge() {
      context.testBridge = {
        dispose() {
          calls.bridgeDisposed = true;
        },
      };
      vm.runInContext('disposeReportLoading = testBridge.dispose', context);
      return vm.runInContext('renderReportBridge(testBridge)', context);
    },
    changeOwner() {
      vm.runInContext('session = {user: {id: "different-owner"}}', context);
    },
    transitionState: () => app.dataset.reportTransition,
    resumeMotion(action) {
      context.resumeAction = action;
      return vm.runInContext('withResumeMotion(resumeAction)', context);
    },
    async render(route = location.hash) {
      location.hash = route;
      // A real browser dispatches hashchange after navigate updates location.
      for (let count = 0; count < 8; count += 1) {
        const before = location.hash;
        vm.runInContext('render()', context);
        await new Promise(setImmediate);
        if (location.hash === before) return;
      }
      assert.fail('Route did not settle');
    },
  };
}

function assertRolePage(fixture) {
  assert.equal(fixture.location.hash, '#/desired-role');
  assert.equal(fixture.document.title, '희망 직무 · CareerLens');
  assert.match(fixture.markup, /data-page="desired-role"/);
  assert.match(fixture.markup, /희망하는 직무를 선택해 주세요/);
  const header = fixture.markup.slice(0, fixture.markup.indexOf('</header>'));
  assert.doesNotMatch(header, /희망 직무|aria-current=/);
  assert.match(fixture.markup, /aria-current="step"[^>]*>\s*<span class="step-number">2<\/span>/);
  assert.equal(fixture.calls.catalog, 0);
  assert.equal(fixture.calls.opportunities.length, 0);
}

function postingNavigationLink(markup) {
  const navigation = markup.match(/<nav class="primary-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation, 'primary navigation is present');
  const link = navigation.match(/href="([^"]+)"[^>]*>채용공고<\/a>/)?.[1];
  assert.ok(link, 'posting link is present');
  return link.replaceAll('&amp;', '&');
}

function assertSavedRolePostingLink(
  markup,
  target = { role_id: 'backend', label: '백엔드 개발자' },
) {
  const route = opportunityRoute(postingNavigationLink(markup));
  assert.ok(route, 'posting link opens role-specific opportunities');
  assert.equal(route.role_id, target.role_id);
  assert.equal(route.label, target.label);
  assert.equal(route.page, 1);
}

function postingWorkflowStep(markup) {
  const step = markup.match(/<(a|span)\s+([^>]+)>\s*<span class="step-number">3<\/span>/);
  assert.ok(step, 'posting workflow step is present');
  return { tag: step[1], attributes: step[2] };
}

function assertSavedRoleWorkflowLink(markup, target) {
  const step = postingWorkflowStep(markup);
  assert.equal(step.tag, 'a');
  const link = step.attributes.match(/href="([^"]+)"/)?.[1];
  assert.ok(link, 'posting workflow link is enabled');
  const route = opportunityRoute(link.replaceAll('&amp;', '&'));
  assert.equal(route?.role_id, target.role_id);
  assert.equal(route?.label, target.label);
}

test('member introduction retains the saved desired role in its posting navigation', async () => {
  const fixture = routeFixture({
    member: true,
    draft: {
      resume_text: '저장한 이력서',
      career_target: { role_id: 'backend', label: '백엔드 개발자' },
    },
  });
  await fixture.render('#/intro');
  assert.equal(fixture.location.hash, '#/intro');
  assert.match(fixture.markup, /data-introduction/);
  assertSavedRolePostingLink(fixture.markup);
});

test('guest authentication retains the saved desired role in its posting navigation', async () => {
  const fixture = routeFixture({
    draft: {
      resume_attached: true,
      career_target: { role_id: 'backend', label: '백엔드 개발자' },
    },
  });
  await fixture.render('#/email');
  assert.equal(fixture.location.hash, '#/email');
  assert.match(fixture.markup, /id="auth-form"/);
  assertSavedRolePostingLink(fixture.markup);
});

for (const member of [false, true]) {
  const label = member ? 'member' : 'guest';
  const draft = member ? { resume_text: '저장한 이력서' } : { resume_attached: true };

  test(`${label} opens the desired-role editor independently of the catalog`, async () => {
    const fixture = routeFixture({ member, draft });
    await fixture.render('#/desired-role');
    assertRolePage(fixture);
    await fixture.render('#/jobs');
    assert.equal(fixture.calls.catalog, 1);
    assert.equal(fixture.document.title, '채용공고 · CareerLens');
    assert.doesNotMatch(fixture.markup, /data-page="desired-role"/);
  });

  test(`${label} old job bookmarks normalize to the desired-role route`, async () => {
    const fixture = routeFixture({ member, draft });
    await fixture.render('#/job');
    assertRolePage(fixture);
  });

  test(`${label} restores the chosen role and unsaved focus after leaving the editor`, async () => {
    const saved = { role_id: 'backend', label: '백엔드 개발자', focus: '저장한 관심 사항' };
    const fixture = routeFixture({
      member,
      draft: { ...draft, career_target: saved },
      edits: { role_id: 'ai', focus: '저장 전 관심 사항' },
    });
    await fixture.render();
    await fixture.render('#/jobs');
    await fixture.render('#/desired-role');
    assert.match(fixture.element('career-role').innerHTML, /value="ai"[^>]*selected>/);
    assert.match(fixture.markup, /저장 전 관심 사항/);
    assert.deepEqual(fixture.snapshot().workspace.draft.career_target, saved);
    assertSavedRolePostingLink(fixture.markup, saved);
    assertSavedRoleWorkflowLink(fixture.markup, saved);
  });

  test(`${label} unsaved role does not enable posting workflow before the role is saved`, async () => {
    const fixture = routeFixture({
      member,
      draft,
      edits: { role_id: 'ai', focus: '저장 전 관심 사항' },
    });
    await fixture.render('#/jobs');
    await fixture.render('#/desired-role');
    assert.match(fixture.element('career-role').innerHTML, /value="ai"[^>]*selected>/);
    assert.match(fixture.markup, /저장 전 관심 사항/);
    assert.equal(postingNavigationLink(fixture.markup), '#/jobs');
    const step = postingWorkflowStep(fixture.markup);
    assert.equal(step.tag, 'span');
    assert.match(step.attributes, /aria-disabled="true"/);
  });

  test(`${label} practice resumes at the saved role's postings in step three`, async () => {
    const fixture = routeFixture({
      member,
      draft: { ...draft, career_target: { role_id: 'backend', label: '백엔드 개발자' } },
    });
    await fixture.render('#/practice');
    assert.match(fixture.location.hash, /^#\/opportunities\?/);
    assert.equal(fixture.calls.opportunities.length, 1);
    assert.equal(fixture.calls.opportunities[0].role_id, 'backend');
    assert.match(fixture.markup, /aria-current="step"[^>]*>\s*<span class="step-number">3<\/span>/);
    assert.match(fixture.markup, /aria-current="page">채용공고<\/a>/);
    assert.doesNotMatch(fixture.markup, /data-page="desired-role"/);
  });
}

test('guests may browse desired roles before uploading a resume', async () => {
  const fixture = routeFixture();
  await fixture.render();
  assertRolePage(fixture);
  assert.match(fixture.markup, /분석 전 이력서를 첨부해 주세요/);
});

test('member role entry preserves the saved resume prerequisite', async () => {
  const fixture = routeFixture({ member: true, edits: { resume_text: '저장 전 이력서' } });
  await fixture.render('#/desired-role');
  assert.equal(fixture.location.hash, '#/resume');
  assert.equal(fixture.document.title, '이력서 입력 · CareerLens');
  assert.match(fixture.markup, /저장 전 이력서/);
  assert.doesNotMatch(fixture.markup, /data-page="desired-role"/);
});

test('edited custom role name survives a round trip without changing saved analysis context', async () => {
  const fixture = routeFixture({
    member: true,
    draft: {
      resume_text: '저장한 이력서',
      career_target: { role_id: 'custom', label: '저장한 직무', focus: '저장한 관심 사항' },
    },
    edits: { role: '수정 중인 직무', focus: '수정 중인 관심 사항' },
  });
  await fixture.render('#/jobs');
  await fixture.render('#/desired-role');
  assert.match(fixture.markup, /value="수정 중인 직무"/);
  assert.match(fixture.markup, /수정 중인 관심 사항/);
  assert.equal(fixture.snapshot().workspace.draft.career_target.label, '저장한 직무');
  const saved = { role_id: 'custom', label: '저장한 직무' };
  assertSavedRolePostingLink(fixture.markup, saved);
  assertSavedRoleWorkflowLink(fixture.markup, saved);
});

test('legacy analysis routes and unfinished results reopen saved role postings without questions', async () => {
  for (const member of [false, true]) {
    for (const route of ['#/practice', '#/questions', '#/preparing', '#/result']) {
      const fixture = routeFixture({
        member,
        draft: {
          ...(member ? { resume_text: '저장한 이력서' } : { resume_attached: true }),
          analysis_mode: 'desired_role',
          career_target: { role_id: 'backend', label: '백엔드 개발자' },
        },
      });
      await fixture.render(route);
      assert.match(fixture.location.hash, /^#\/opportunities\?/);
      assert.equal(fixture.calls.opportunities[0].role_id, 'backend');
      assert.equal(fixture.calls.gates, 0);
      assert.doesNotMatch(
        fixture.markup,
        /data-resume-score-card|id="analysis-form"|data-preparation-status/,
      );
    }
  }
});

test('legacy analysis links reopen a selected posting or its completed report for guests and members', async () => {
  for (const member of [false, true]) {
    for (const withTarget of [false, true]) {
      const draft = {
        ...(member ? { resume_text: '저장한 이력서' } : { resume_attached: true }),
        selected_posting_id: 'chosen-posting',
        ...(withTarget ? { career_target: { role_id: 'backend', label: '백엔드 개발자' } } : {}),
      };
      for (const route of ['#/questions', '#/preparing', '#/result']) {
        const fixture = routeFixture({ member, draft });
        await fixture.render(route);
        assert.equal(fixture.location.hash, '#/jobs/chosen-posting');
        assert.doesNotMatch(fixture.markup, /id="analysis-form"|data-preparation-status/);
      }
      for (const route of ['#/questions', '#/preparing']) {
        const fixture = routeFixture({
          member,
          draft: {
            ...draft,
            ...(member
              ? { report: { score: 75, summary: '완료', verdict: '완료' } }
              : { report_locked: true }),
          },
        });
        await fixture.render(route);
        assert.equal(fixture.location.hash, '#/result');
        assert.equal(fixture.calls.gates, member ? 0 : 1);
      }
    }
  }
});

test('guest report remains gated until analysis completes and never renders report content', async () => {
  const draft = { resume_attached: true, selected_posting_id: 'chosen-posting' };
  const incomplete = routeFixture({ draft });
  await incomplete.render('#/result');
  assert.equal(incomplete.location.hash, '#/jobs/chosen-posting');
  assert.equal(incomplete.calls.gates, 0);

  const complete = routeFixture({
    draft: {
      ...draft,
      report_locked: true,
      report: { score: 90, summary: 'PRIVATE_REPORT_NOT_FOR_GUESTS' },
    },
  });
  await complete.render('#/result');
  assert.equal(complete.location.hash, '#/result');
  assert.equal(complete.calls.gates, 1);
  assert.doesNotMatch(complete.markup, /PRIVATE_REPORT_NOT_FOR_GUESTS/);
  assert.doesNotMatch(complete.markup, /data-resume-score-card/);
});

test('the real report route keeps loading modal ownership and activates the safe guest gate only on completion', () => {
  const fixture = routeFixture({
    draft: {
      resume_attached: true,
      report_locked: true,
      report: { score: 91, summary: 'PRIVATE_REPORT_DURING_PARTICLES' },
    },
  });
  const view = fixture.bridge();
  assert.equal(fixture.location.hash, '#/result');
  assert.equal(fixture.calls.bridgeDisposed, undefined, 'render must retain the loading modal');
  assert.equal(fixture.calls.gates, 0, 'the native modal owns focus throughout particles');
  assert.equal(fixture.transitionState(), 'forming');
  assert.doesNotMatch(fixture.markup, /PRIVATE_REPORT_DURING_PARTICLES|data-resume-score-card/);
  view.onReveal();
  assert.equal(fixture.transitionState(), 'revealing');
  assert.equal(fixture.calls.gates, 0);
  view.activate();
  assert.equal(fixture.calls.gates, 1);
});

test('a changed account cannot reveal or activate the old result transition', () => {
  const fixture = routeFixture({ draft: { resume_attached: true, report_locked: true } });
  const view = fixture.bridge();
  fixture.changeOwner();
  view.onReveal();
  view.activate();
  assert.equal(fixture.transitionState(), 'forming');
  assert.equal(fixture.calls.gates, 0);
});

test('navigation disposes the retained modal and makes its late reveal callback inert', async () => {
  const fixture = routeFixture({ draft: { resume_attached: true, report_locked: true } });
  const view = fixture.bridge();
  await fixture.render('#/resume');
  assert.equal(fixture.calls.bridgeDisposed, true);
  view.onReveal();
  view.activate();
  assert.equal(fixture.transitionState(), undefined);
  assert.equal(fixture.calls.gates, 0);
  assert.equal(fixture.location.hash, '#/resume');
});

test('workflow navigation retargets one journey instance through async catalog loading', async () => {
  const fixture = routeFixture({ draft: { resume_attached: true }, motion: true });
  await fixture.render('#/desired-role');
  const first = fixture.calls.journeys[0];
  assert.equal(first.options.phase, 'elements');

  await fixture.render('#/resume');
  assert.equal(first.disposed, false);
  assert.equal(fixture.calls.journeys.length, 1);
  assert.equal(first.snapshot.phase, 'idle');

  await fixture.render('#/jobs');
  assert.equal(first.disposed, false, 'loading must not remove the active canvas');
  assert.equal(first.snapshot.phase, 'orbit', 'target advances before async heading arrives');
  assert.equal(fixture.calls.journeys.length, 1);
  assert.equal(fixture.calls.observers.length, 1);
  const previousHost = first.host;
  fixture.replaceCatalogHeading();
  assert.notEqual(first.host, previousHost);
  assert.equal(fixture.calls.journeys.length, 1, 'late heading only rebinds the host');
  await fixture.render('#/desired-role');
  assert.equal(first.disposed, false);
  assert.equal(first.snapshot.phase, 'elements');
  assert.equal(fixture.calls.journeys.length, 1);

  await fixture.render('#/email');
  assert.equal(fixture.calls.observers[0].disconnected, true);
  assert.equal(first.disposed, true, 'authentication does not retain a moving canvas');
  assert.equal(fixture.calls.journeys.length, 1);
});

test('failed uploads return to the resume seed and late failure cannot alter a replacement page', async () => {
  for (const attached of [false, true]) {
    const fixture = routeFixture({ draft: { resume_attached: attached }, motion: true });
    await fixture.render('#/resume');
    const original = fixture.calls.journeys[0];
    await assert.rejects(
      fixture.resumeMotion(async () => {
        throw new Error('Upload rejected');
      }),
      /Upload rejected/,
    );
    assert.deepEqual(original.updates, ['uploading', 'idle']);

    let rejectUpload;
    const pending = fixture.resumeMotion(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpload = reject;
        }),
    );
    const rejection = assert.rejects(pending, /Late rejection/);
    await fixture.render('#/desired-role');
    const active = fixture.calls.journeys.at(-1);
    const updates = [...active.updates];
    rejectUpload(new Error('Late rejection'));
    await rejection;
    assert.equal(original.disposed, false);
    assert.equal(active, original, 'the same renderer now belongs to the desired-role page');
    assert.equal(active.snapshot.phase, 'elements');
    assert.deepEqual(active.updates, updates, 'stale upload must not retarget the active page');
  }
});

for (const member of [false, true]) {
  test(`${member ? 'member' : 'guest'} saved resume never skips the page-specific motion stages`, async () => {
    const fixture = routeFixture({
      member,
      motion: true,
      draft: {
        ...(member ? { resume_text: '저장된 가상 이력서' } : { resume_attached: true }),
        career_target: { role_id: 'backend', label: '백엔드 개발자' },
      },
    });
    await fixture.render('#/intro');
    assert.equal(fixture.calls.journeys.length, 0, 'intro has no journey decoration');
    await fixture.render('#/resume');
    assert.equal(fixture.calls.journeys.at(-1).options.phase, 'idle');
    await fixture.resumeMotion(async () => 'uploaded');
    assert.deepEqual(fixture.calls.journeys.at(-1).updates, ['uploading', 'uploading']);
    await fixture.render('#/desired-role');
    assert.equal(fixture.calls.journeys.at(-1).snapshot.phase, 'elements');
    await fixture.render('#/opportunities?role_id=backend&label=백엔드%20개발자');
    assert.equal(fixture.calls.journeys.at(-1).snapshot.phase, 'orbit');
    assert.equal(fixture.calls.journeys.length, 1);
    const circle = fixture.calls.journeys.at(-1);
    await fixture.render('#/intro');
    assert.equal(circle.disposed, true);
    assert.equal(
      fixture.calls.journeys.at(-1),
      circle,
      'returning home never mounts a dot or ring',
    );
    await fixture.render('#/resume');
    assert.equal(fixture.calls.journeys.at(-1).options.phase, 'idle');
    assert.equal(fixture.calls.journeys.at(-1).options.snapshot, undefined);
    assert.notEqual(fixture.calls.journeys.at(-1), circle, 'home ends the previous journey');
  });
}

test('async posting heading replacements keep the same in-progress renderer', async () => {
  const fixture = routeFixture({ draft: { resume_attached: true }, motion: true });
  await fixture.render('#/jobs');
  assert.equal(fixture.calls.journeys.length, 0, 'loading markup has no misplaced anchor');
  fixture.replaceCatalogHeading();
  const initial = fixture.calls.journeys[0];
  assert.equal(initial.options.phase, 'orbit');
  initial.snapshot.time = 7.3;
  initial.snapshot.seed = 124;
  fixture.replaceCatalogHeading();
  const replacement = fixture.calls.journeys.at(-1);
  assert.equal(initial.disposed, false);
  assert.equal(replacement, initial);
  assert.equal(replacement.snapshot.phase, 'orbit');
  assert.equal(replacement.snapshot.time, 7.3);
  assert.equal(replacement.snapshot.seed, 124);
});
