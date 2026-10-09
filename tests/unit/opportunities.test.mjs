import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { guestResumePage, guestFileMetadata } from '../../src/features/resumes/guest.js';
import {
  opportunityRoute,
  opportunityPath,
  opportunityQuery,
} from '../../src/features/job-postings/opportunity-state.js';
import {
  opportunitiesPage,
  opportunityList,
  opportunityDetail,
  opportunityCountLabel,
} from '../../src/pages/opportunities.js';
import { analysisReport } from '../../src/features/analysis/report.js';
import { shell } from '../../src/shared/components/ui.js';

test('file choice validates metadata while guest attachment UI never previews the resume', () => {
  const file = {
    name: '경험.md',
    size: 1000,
    text() {
      throw new Error('must not read');
    },
    arrayBuffer() {
      throw new Error('must not read');
    },
  };
  assert.equal(guestFileMetadata(file), file.name);
  assert.throws(() => guestFileMetadata({ name: 'large.md', size: 11000000 }));
  assert.throws(() => guestFileMetadata({ name: 'script.html', size: 100 }));
  const html = guestResumePage('<script>private</script>.md');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('id="upload-form"'));
  assert.ok(!html.includes('<textarea'));
  assert.ok(!html.includes('resume-examples'));
  assert.ok(html.includes('id="guest-upload-form"'));
  assert.ok(shell(html, { draft: { guest: true } }).includes('채용공고'));
});

test('role filters, selected posting and pagination round-trip without uploading resume data', () => {
  const route = opportunityRoute(
    '#/' + opportunityPath({ role_id: 'custom', label: 'UX & 데이터' }, 2, '공고/?&'),
  );
  assert.deepEqual(route, {
    role_id: 'custom',
    label: 'UX & 데이터',
    scope: 'category',
    page: 2,
    selected: '공고/?&',
  });
  const query = new URLSearchParams(opportunityQuery(route).split('?')[1]);
  assert.equal(query.get('role'), 'UX & 데이터');
  assert.equal(query.get('role_scope'), 'category');
  assert.equal(query.get('page'), '2');
  assert.equal(query.has('resume_text'), false);
  assert.equal(opportunityRoute('#/questions'), null);
});

test('scope survives selection, pagination and reload while invalid values default to category', () => {
  for (const scope of ['category', 'exact', 'all']) {
    const target = { role_id: 'serving', label: 'AI 모델 서빙 최적화 엔지니어', scope };
    const selected = opportunityRoute(`#/${opportunityPath(target, 3, 'registered-uuid')}`);
    assert.equal(selected.scope, scope);
    assert.equal(selected.selected, 'registered-uuid');
    const next = opportunityRoute(`#/${opportunityPath(selected, 4)}`);
    assert.equal(next.scope, scope);
    assert.equal(next.page, 4);
    assert.equal(next.selected, '');
    const request = new URLSearchParams(opportunityQuery(next).split('?')[1]);
    assert.equal(request.get('role_scope'), scope);
    assert.equal(request.get('role_id'), target.role_id);
  }
  for (const value of ['', 'unknown', 'ALL', '<script>']) {
    const route = opportunityRoute(`#/opportunities?scope=${encodeURIComponent(value)}`);
    assert.equal(route.scope, 'category');
    const query = new URLSearchParams(opportunityQuery({ ...route, scope: value }).split('?')[1]);
    assert.equal(query.get('role_scope'), 'category');
  }
});

test('scope counts explain the source classification and custom role fallback', () => {
  const category = {
    total: 11,
    available_total: 100,
    role_category: '플랫폼·서빙',
    role_scope: 'category',
  };
  assert.equal(
    opportunityCountLabel(category, { scope: 'category' }),
    '전체 100개 중 11개 공고 · 플랫폼·서빙 분류',
  );
  assert.equal(
    opportunityCountLabel({ ...category, total: 1 }, { scope: 'exact' }),
    '전체 100개 중 1개 공고 · 선택한 직무명만',
  );
  assert.equal(
    opportunityCountLabel({ ...category, total: 100 }, { scope: 'all' }),
    '전체 100개 공고',
  );
  assert.equal(
    opportunityCountLabel(
      { ...category, total: 100, role_scope: 'all', role_category: '' },
      { scope: 'category', role_id: 'legacy-role' },
    ),
    '전체 100개 공고 · 분류 정보가 없어 전체 표시',
  );
  const fallback = { ...category, total: 2, role_scope: 'exact', role_category: '' };
  assert.equal(
    opportunityCountLabel(fallback, { scope: 'category', role_id: 'custom' }),
    '전체 100개 중 2개 공고 · 입력 직무 기준 · 분류 정보 없음',
  );
  assert.equal(
    opportunityCountLabel(fallback, { scope: 'category', role_id: 'legacy-role' }),
    '전체 100개 중 2개 공고 · 선택한 직무명만 · 분류 정보 없음',
  );
});

test('scope controls reset the page while list navigation and evaluation retain posting identity', async () => {
  const controller = readFileSync(
    new URL('../../src/features/job-postings/opportunities.js', import.meta.url),
    'utf8',
  )
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
    .replace('export function bindOpportunities', 'function bindOpportunities');
  const elements = new Map();
  for (const id of [
    'opportunity-list',
    'opportunity-detail',
    'opportunity-count',
    'opportunity-pagination',
    'opportunity-scope',
    'opportunity-role',
    'opportunity-apply',
  ]) {
    elements.set(id, {
      listeners: new Map(),
      value: '',
      isConnected: true,
      setAttribute() {},
      querySelectorAll: () => [],
      addEventListener(type, callback) {
        this.listeners.set(type, callback);
      },
    });
  }
  const posting = {
    id: '97a60839-656f-471d-a30e-2b3e0be3ed90',
    role: '같은 분류의 다른 직무',
    company: '가상 기업',
    skills: [],
  };
  const route = { role_id: 'serving', label: '서빙 직무', scope: 'category', page: 3, selected: '' };
  const navigations = [];
  const requests = [];
  let selectedPosting;
  let selectedUrl;
  const context = vm.createContext({
    AbortController,
    document: { getElementById: (id) => elements.get(id) },
    history: { replaceState: (_state, _unused, url) => (selectedUrl = url) },
    opportunityList,
    opportunityDetail,
    opportunityCountLabel,
    opportunityPath,
    opportunityQuery,
    api: async (path) => {
      requests.push(path);
      if (path === '/career-roles') return { items: [{ id: 'serving', label: route.label }] };
      if (path.includes('?'))
        return {
          items: [posting],
          total: 61,
          available_total: 100,
          page_size: 20,
          role_category: '플랫폼·서빙',
          role_scope: 'category',
        };
      assert.equal(path, `/job-postings/${posting.id}`);
      return { posting };
    },
    options: {
      route,
      user: { id: 'member' },
      navigate: (path) => navigations.push(opportunityRoute(`#/${path}`)),
      onSelect: async (value) => (selectedPosting = value),
      onError: assert.fail,
    },
  });
  vm.runInContext(`${controller}\nconst dispose = bindOpportunities(options);`, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('opportunity-scope').value, 'category');
  assert.ok(requests.some((path) => path.includes('role_scope=category')));
  assert.equal(opportunityRoute(selectedUrl).selected, posting.id);
  assert.equal(opportunityRoute(selectedUrl).scope, 'category');
  await elements.get('opportunity-apply').listeners.get('click')();
  assert.equal(selectedPosting, posting);
  elements.get('opportunity-pagination').listeners.get('click')({
    target: { closest: () => ({ dataset: { page: '4' }, disabled: false }) },
  });
  assert.equal(navigations.at(-1).scope, 'category');
  assert.equal(navigations.at(-1).page, 4);
  elements.get('opportunity-scope').value = 'all';
  elements.get('opportunity-scope').listeners.get('change')();
  assert.equal(navigations.at(-1).scope, 'all');
  assert.equal(navigations.at(-1).page, 1);
  assert.equal(navigations.at(-1).selected, '');
  vm.runInContext('dispose();', context);
});

test('registered fictional postings keep their badge and analysis identity in both panes', () => {
  const posting = {
    id: 'registered-posting',
    source_type: 'backend',
    is_example: true,
    company: '가상 기업',
    role: '에이전트 엔지니어',
    description: '파일의 공고 본문',
    skills: [],
  };
  const list = opportunityList([posting], posting.id);
  assert.ok(list.includes('data-posting-id="registered-posting"'));
  assert.ok(list.includes('가상 공고'));
  assert.ok(opportunityDetail(posting, { id: 'member' }).includes('가상 공고'));
});

test('master-detail content escapes DB fields and guests may analyze before result login', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const posting = {
    id: attack,
    company: attack,
    role: attack,
    location: attack,
    experience_level: attack,
    employment_type: attack,
    description: attack,
    skills: [attack],
    source_type: 'example',
  };
  for (const html of [opportunityList([posting], posting.id), opportunityDetail(posting, null)]) {
    assert.ok(!html.includes(attack));
    assert.ok(html.includes('&lt;img'));
  }
  assert.ok(opportunityDetail(posting, null).includes('모의지원 결과 확인'));
  assert.ok(opportunityDetail(posting, null).includes('로그인·회원가입'));
  assert.ok(opportunityDetail(posting, { id: 'test' }).includes('모의지원 결과 확인'));
  assert.ok(opportunitiesPage().includes('opportunity-list'));
  assert.ok(opportunitiesPage().includes('opportunity-detail'));
});

test('report is view-only and clearly labels the four demonstration axes', () => {
  const html = analysisReport({ report: { score: 50, criteria: [], matches: [] } });
  assert.ok(!html.includes('print-report'));
  assert.ok(!html.includes('리포트 인쇄'));
  for (const label of ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'])
    assert.ok(html.includes(label));
  assert.ok(html.includes('시연용 점수 · 실제 평가와 무관'));
});
