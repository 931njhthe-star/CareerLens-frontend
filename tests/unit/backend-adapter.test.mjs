import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backendApi, enableBackendAdapter } from '../../src/shared/api/backend-adapter.js';

function createStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

globalThis.sessionStorage = createStorage();
enableBackendAdapter();

beforeEach(() => {
  globalThis.sessionStorage = createStorage();
});

function sourceMarkdown(id, role = '예시 직무', company = '예시 회사') {
  return {
    id,
    filename: `${id}.md`,
    content: `# ${id}. ${role}
- **회사명:** ${company}
- **공고명:** ${role} 채용
- **직무명:** ${role}
- **근무지:** 서울
- **고용형태:** 정규직
- **경력:** 신입
- **직무 소개:** 한글 직무 소개

### 3. 담당업무
- 원본 업무 설명

### 4. 자격요건
- 원본 자격 설명

### 5. 우대사항
- 원본 우대 설명
`,
  };
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

test('backend mode loads the career choices from the frontend job catalog', async () => {
  const requests = [];
  const request = async (path, options = {}) => {
    requests.push([path, options]);
    if (path === '/local-data/career-markdown')
      return { items: [sourceMarkdown('001'), sourceMarkdown('002')] };
    if (path === '/me') return { id: 'user-1', email: 'person@example.com' };
    throw new ApiError('not found', 404);
  };
  const session = await backendApi('/auth/session', {}, request, ApiError);
  assert.equal(session.user, null);
  assert.equal(session.csrf_token, '');
  const roles = await backendApi('/career-roles', {}, request, ApiError);
  assert.deepEqual(
    roles.items.map((role) => role.id),
    ['role-001', 'custom'],
  );
  assert.equal(roles.items[0].label, '예시 직무');
  assert.deepEqual(requests, [['/local-data/career-markdown', { signal: undefined, auth: false }]]);
});

test('backend mode parses and opens a posting from its original Markdown', async () => {
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [sourceMarkdown('001')] };
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const result = await backendApi(
    '/job-postings?role_id=role-001&page=1&page_size=20',
    {},
    request,
    ApiError,
  );
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'backup-001');
  assert.equal(result.items[0].source_type, 'example');
  const detail = await backendApi('/job-postings/backup-001', {}, request, ApiError);
  assert.match(detail.posting.description, /원본 업무 설명/);
  assert.match(detail.posting.source_markdown, /### 5\. 우대사항/);
});

test('registered Markdown jobs replace local mock duplicates and keep the backend UUID', async () => {
  globalThis.sessionStorage.setItem('careerlens.backend.access-token', 'real-access-token');
  const markdown = sourceMarkdown('001');
  const raw = {
    id: 'job-db-001',
    company_id: 'company-db-001',
    title: '등록 공고 제목',
    source_name: 'local_markdown',
    source_external_id: '001.md',
    description: markdown.content,
  };
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [markdown] };
    if (path === '/jobs?limit=100') return [{ ...raw, description: undefined }];
    if (path === '/jobs/job-db-001') return raw;
    if (path === '/companies/company-db-001') return { name: '예시 회사' };
    if (path === '/me') return { id: 'user-1' };
    if (path === '/resumes?limit=100') return [];
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const list = await backendApi(
    '/job-postings?role_id=role-001&page=1&page_size=20',
    {},
    request,
    ApiError,
  );
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, 'job-db-001');
  assert.equal(list.items[0].source_type, 'backend');
  assert.equal(list.items[0].source_external_id, '001.md');
  assert.equal(list.items[0].role, '예시 직무');
  assert.equal(list.items[0].title, '예시 직무 채용');
  assert.equal(list.items[0].location, '서울');
  assert.equal(list.items[0].employment_type, '정규직');
  assert.equal(list.items[0].experience_level, '신입');
  assert.equal(list.items[0].source_markdown, markdown.content);
  assert.equal(list.items[0].is_example, true);

  const detail = await backendApi('/job-postings/job-db-001', {}, request, ApiError);
  assert.equal(detail.posting.id, 'job-db-001');
  assert.equal(detail.posting.company, '예시 회사');
  assert.equal(detail.posting.source_markdown, markdown.content);
  assert.equal(detail.posting.role, '예시 직무');
  assert.equal(detail.posting.is_example, true);

  const workspace = await backendApi(
    '/job-postings/job-db-001/select',
    { method: 'POST' },
    request,
    ApiError,
  );
  assert.equal(workspace.draft.selected_posting_id, 'job-db-001');
  assert.equal(workspace.draft.role, '예시 직무');
  assert.match(workspace.draft.job_text, /원본 업무 설명/);
});

test('legacy title classification links still filter exactly and preserve backend identities', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const sources = [sourceMarkdown('001', '데이터 분석'), sourceMarkdown('002', '데이터 분석 플랫폼 개발')];
  const jobs = sources.map((source, index) => ({
    id: `registered-${index + 1}`,
    title: '백엔드 공고 제목',
    source_name: 'local_markdown',
    source_external_id: source.filename,
    description: source.content,
  }));
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: sources };
    if (path === '/jobs?limit=100') return jobs;
    const job = jobs.find((item) => path === `/jobs/${item.id}`);
    if (job) return job;
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const category = encodeURIComponent('데이터 분석');
  const result = await backendApi(`/job-postings?role_category=${category}`, {}, request, ApiError);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'registered-1');
  assert.equal(result.items[0].role, '데이터 분석');
  assert.deepEqual(result.filters.roles, ['데이터 분석', '데이터 분석 플랫폼 개발']);
  const empty = await backendApi('/job-postings?role_category=unknown', {}, request, ApiError);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.filters.roles, result.filters.roles);
});

for (const authenticated of [false, true]) {
  test(`${authenticated ? 'registered' : 'preview'} jobs can browse source classification, exact role and all jobs`, async () => {
    if (authenticated) sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
    const sources = [
      { ...sourceMarkdown('001', '모델 서빙 최적화'), role_category: '플랫폼·서빙' },
      { ...sourceMarkdown('002', '추론 플랫폼'), role_category: '플랫폼·서빙' },
      { ...sourceMarkdown('003', '검색 엔지니어'), role_category: 'RAG·데이터' },
      sourceMarkdown('004', '새로운 직무'),
    ];
    // A mention in the description must not make an exact-role match.
    sources[2].content += '\n모델 서빙 최적화 협업';
    const jobs = sources.map((source, index) => ({
      id: `registered-${index + 1}`,
      title: '등록 공고',
      source_name: 'local_markdown',
      source_external_id: source.filename,
    }));
    const request = async (path) => {
      if (path === '/local-data/career-markdown') return { items: sources };
      if (path === '/jobs?limit=100' && authenticated) return jobs;
      throw new Error(`Unexpected call: ${path}`);
    };
    const list = (query) => backendApi(`/job-postings?${query}`, {}, request, ApiError);
    const category = await list('role_id=role-001&role_scope=category');
    assert.equal(category.total, 2);
    assert.equal(category.available_total, 4);
    assert.equal(category.role_scope, 'category');
    assert.equal(category.role_category, '플랫폼·서빙');
    assert.deepEqual(category.items.map((item) => item.id), authenticated
      ? ['registered-1', 'registered-2'] : ['backup-001', 'backup-002']);
    assert.ok(category.filters.roles.includes('플랫폼·서빙'));
    assert.ok(!category.filters.roles.includes('모델 서빙 최적화'));

    const exact = await list('role_id=role-001&role_scope=exact');
    assert.equal(exact.total, 1);
    assert.equal(exact.items[0].source_external_id, '001.md');
    const all = await list('role_id=role-001&role_scope=all&page_size=2&page=2');
    assert.equal(all.total, 4);
    assert.equal(all.role_scope, 'all');
    assert.deepEqual(all.items.map((item) => item.source_external_id), ['003.md', '004.md']);

    const fromCatalog = await list(`role_category=${encodeURIComponent('플랫폼·서빙')}`);
    assert.equal(fromCatalog.total, 2);
    const missingCategory = await list('role_id=role-004&role_scope=category');
    assert.equal(missingCategory.total, 4);
    assert.equal(missingCategory.role_scope, 'all');
    assert.equal(missingCategory.role_category, '');
    const custom = await list(`role_id=custom&role=${encodeURIComponent('서빙')}&role_scope=all`);
    assert.equal(custom.total, 4);
    const keyword = await list(`role_id=custom&role=${encodeURIComponent('서빙')}&role_scope=category`);
    assert.equal(keyword.role_scope, 'exact');
    assert.equal(keyword.total, 2);
  });
}

test('a filename shared by another source cannot borrow a local fixture identity or content', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture-token');
  const local = sourceMarkdown('001', '로컬 직무', '로컬 회사');
  const external = {
    id: 'external-job',
    company_id: 'external-company',
    source_name: 'external_feed',
    source_external_id: '001.md',
    title: '외부 직무',
    description: '외부 공고 본문',
    location: '부산',
  };
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [local, sourceMarkdown('002')] };
    if (path === '/jobs?limit=100') return [external];
    if (path === '/companies/external-company') return { name: '외부 회사' };
    if (path === '/jobs/external-job') return external;
    throw new Error(`Unexpected call: ${path}`);
  };
  const list = await backendApi('/job-postings', {}, request, ApiError);
  assert.equal(list.total, 1);
  assert.equal(list.items[0].company, '외부 회사');
  assert.equal(list.items[0].role, '외부 직무');
  assert.equal(list.items[0].is_example, false);
  const detail = await backendApi('/job-postings/external-job', {}, request, ApiError);
  assert.equal(detail.posting.description, '외부 공고 본문');
  assert.equal(detail.posting.source_markdown, '');
  assert.equal(detail.posting.location, '부산');
  assert.equal(detail.posting.source_type, 'backend');
});

test('an unmatched guest role returns an empty preview rather than inventing a posting', async () => {
  const result = await backendApi(
    '/job-postings?role_id=custom&role=의료%20서비스%20기획자&page=1&page_size=20',
    {},
    async (path) => {
      assert.equal(path, '/local-data/career-markdown');
      return { items: [] };
    },
    ApiError,
  );
  assert.equal(result.items.length, 0);
  assert.match(result.mock_notice, /로그인 후 백엔드 등록 공고/);
});

test('guest upload uses local conversion and keeps only tab staging plus response metadata', async () => {
  const form = new FormData();
  form.set('file', new Blob(['# Resume'], { type: 'text/markdown' }), 'resume.md');
  const result = await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async (path) => {
      assert.equal(path, '/local-data/convert-resume');
      return { text: '# Resume' };
    },
    ApiError,
  );
  assert.equal(result.draft.resume_attached, true);
  assert.equal(result.draft.filename, 'resume.md');
  assert.ok(result.expires_at);
  assert.equal(Object.hasOwn(result.draft, 'resume_text'), false);
  assert.equal(
    JSON.parse(sessionStorage.getItem('careerlens.backend.guest')).resume_text,
    '# Resume',
  );
});

test('guest analysis requires actual login and never fabricates a completed result', async () => {
  await assert.rejects(
    backendApi(
      '/guest/analysis',
      { method: 'POST' },
      async () => {
        throw new Error('Guest analysis must not call the backend');
      },
      ApiError,
    ),
    (error) => error.status === 401 && error.code === 'login_required',
  );
  assert.equal(sessionStorage.getItem('careerlens.backend.guest'), null);
});

test('PDF guest upload stages extracted text instead of a fake attachment', async () => {
  const form = new FormData();
  form.set('file', new Blob(['not parsed'], { type: 'application/pdf' }), 'resume.pdf');
  const result = await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async (path) => {
      assert.equal(path, '/local-data/convert-resume');
      return { text: '# Extracted PDF resume' };
    },
    ApiError,
  );
  assert.equal(result.draft.mock_upload, undefined);
  assert.equal(result.draft.resume_attached, true);
  assert.equal(
    JSON.parse(globalThis.sessionStorage.getItem('careerlens.backend.guest')).resume_text,
    '# Extracted PDF resume',
  );
});

test('real member analysis never silently substitutes a demo report for an unregistered posting', async () => {
  await assert.rejects(
    backendApi(
      '/analysis',
      { method: 'POST' },
      async (path) => {
        if (path === '/me') return { id: 'user-1' };
        throw new Error(`Unexpected backend call: ${path}`);
      },
      ApiError,
    ),
    (error) => error.status === 409 && error.code === 'backend_posting_required',
  );
});

test('backend adapter forwards evaluation cancellation requests with keepalive', async () => {
  const requests = [];
  const request = async (path, options) => {
    requests.push({ path, options });
    return { run_id: 'run-1', status: 'cancelled' };
  };
  const result = await backendApi(
    '/evaluations/run-1/cancel',
    { method: 'POST', body: {}, keepalive: true },
    request,
    ApiError,
  );
  assert.deepEqual(result, { run_id: 'run-1', status: 'cancelled' });
  assert.equal(requests[0].path, '/evaluations/run-1/cancel');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.keepalive, true);
});

test('member backend analysis falls back to run status when progress events are unavailable', async () => {
  const reportText =
    '# 에이전트 최종 보고서\n\n종합점수: 보류\n\nYahoo Finance 조회 결과를 반영했습니다.';
  globalThis.sessionStorage.setItem('careerlens.backend.access-token', 'real-access-token');
  globalThis.sessionStorage.setItem(
    'careerlens.backend.workspace:user-1',
    JSON.stringify({
      resume_id: 'resume-1',
      selected_posting_id: 'job-1',
      selected_posting: {
        id: 'job-1',
        source_type: 'backend',
        company: '예시 기업',
        role: '예시 직무',
        description: '# 원본 공고',
      },
      suppress_latest_report: true,
    }),
  );
  const progressUpdates = [];
  const request = async (path, options = {}) => {
    if (path === '/me') return { id: 'user-1' };
    if (path === '/resumes?limit=100') return [{ id: 'resume-1', title: '저장된 이력서' }];
    if (path === '/resumes/resume-1')
      return { id: 'resume-1', title: '저장된 이력서', original_text: '# 이력서' };
    if (path === '/evaluations' && options.method === 'POST') return { run_id: 'run-1' };
    if (path === '/evaluations/run-1/progress?after_id=0') throw new ApiError('Not Found', 404);
    if (path === '/evaluations/run-1')
      return {
        id: 'run-1',
        status: 'partial',
        current_stage: 'validation',
        progress_percent: 94,
      };
    if (path === '/evaluations/run-1/result')
      return {
        overall_score: null,
        resume_completeness: 75,
        job_fit: 60,
        qualifications: 55,
        practical_competitiveness: 70,
        validation_status: 'partial',
        criteria: [],
        reports: [{ id: 'report-1' }],
      };
    if (path === '/reports/report-1') return { status: 'completed', report_text: reportText };
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const result = await backendApi(
    '/analysis',
    { method: 'POST', onProgress: (update) => progressUpdates.push(update) },
    request,
    ApiError,
  );
  assert.equal(progressUpdates.length, 2);
  assert.equal(progressUpdates[0].run.current_stage, 'queued');
  assert.equal(progressUpdates[1].run.progress_percent, 94);
  assert.deepEqual(progressUpdates[1].events, []);
  assert.equal(result.report.source, 'backend');
  assert.equal(result.report.score, null);
  assert.equal(result.report.score_components.resume_completeness.score, 75);
  assert.equal(result.report.backend_report_text, reportText);
  assert.equal(result.report.status, 'partial');
});

test('claiming an incomplete guest upload transfers the actual resume but never an old mock report', async () => {
  const form = new FormData();
  form.set('file', new Blob(['# Guest resume'], { type: 'text/markdown' }), 'resume.md');
  await backendApi(
    '/guest/resume/upload',
    { method: 'POST', body: form },
    async (path) => {
      assert.equal(path, '/local-data/convert-resume');
      return { text: '# Guest resume' };
    },
    ApiError,
  );
  const staged = JSON.parse(sessionStorage.getItem('careerlens.backend.guest'));
  sessionStorage.setItem(
    'careerlens.backend.guest',
    JSON.stringify({ ...staged, report: { demo: true }, completed: true }),
  );
  const request = async (path, options = {}) => {
    if (path === '/me') return { id: 'user-1' };
    if (path === '/resumes?limit=100')
      return (!options.method || options.method === 'GET') &&
        globalThis.sessionStorage.getItem('resume-created')
        ? [{ id: 'resume-1', title: 'Guest resume' }]
        : [];
    if (path === '/resumes' && options.method === 'POST') {
      globalThis.sessionStorage.setItem('resume-created', 'true');
      return { id: 'resume-1', title: 'Guest resume' };
    }
    if (path === '/resumes/resume-1')
      return { id: 'resume-1', title: 'Guest resume', original_text: '# Guest resume' };
    if (path === '/evaluations?limit=1') return [];
    throw new Error(`Unexpected backend call: ${path}`);
  };
  const claimed = await backendApi('/guest/claim', { method: 'POST' }, request, ApiError);
  assert.equal(claimed.draft.resume_id, 'resume-1');
  assert.equal(claimed.draft.report, undefined);
  assert.equal(globalThis.sessionStorage.getItem('careerlens.backend.guest'), null);
});

test('a changed mock posting does not reload an older backend report', async () => {
  globalThis.sessionStorage.setItem(
    'careerlens.backend.workspace:user-1',
    JSON.stringify({ suppress_latest_report: true, selected_posting: { source_type: 'mock' } }),
  );
  const requests = [];
  const workspace = await backendApi(
    '/workspace',
    {},
    async (path) => {
      requests.push(path);
      if (path === '/me') return { id: 'user-1' };
      if (path === '/resumes?limit=100') return [];
      if (path === '/evaluations?limit=1') return [{ id: 'old-run', status: 'completed' }];
      throw new Error(`Unexpected backend call: ${path}`);
    },
    ApiError,
  );
  assert.equal(workspace.draft.report, undefined);
  assert.equal(requests.includes('/evaluations?limit=1'), false);
});

test('Supabase profile user_id scopes member sessions and saved workspace state', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'test-token');
  const request = async (path) => {
    if (path === '/me') return { user_id: 'supabase-user', display_name: '테스트' };
    if (path === '/resumes?limit=100') return [{ id: 'resume-1' }];
    if (path === '/resumes/resume-1') return { id: 'resume-1', original_text: 'Resume' };
    if (path === '/evaluations?limit=1') return [];
    throw new Error(`Unexpected call: ${path}`);
  };
  const session = await backendApi('/auth/session', {}, request, ApiError);
  assert.equal(session.user.id, 'supabase-user');
  assert.equal(session.user.name, '테스트');
  await backendApi('/workspace', {}, request, ApiError);
  assert.equal(
    JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:supabase-user')).resume_id,
    'resume-1',
  );
  assert.equal(sessionStorage.getItem('careerlens.backend.workspace:undefined'), null);
});

test('a minimal authenticated profile uses a readable member label and keeps available email', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture');
  let profile = { user_id: 'member-1' };
  const request = async (path) => {
    assert.equal(path, '/me');
    return profile;
  };
  const minimal = await backendApi('/auth/session', {}, request, ApiError);
  assert.deepEqual(minimal.user, { id: 'member-1', email: '', name: '회원' });
  profile = { user_id: 'member-1', display_name: '  ', email: 'person@example.test' };
  const withEmail = await backendApi('/auth/session', {}, request, ApiError);
  assert.deepEqual(withEmail.user, {
    id: 'member-1',
    email: 'person@example.test',
    name: 'person@example.test',
  });
});

test('PDF member upload is converted locally then sends Markdown to the unchanged backend', async () => {
  const body = new FormData();
  body.set('file', new Blob(['synthetic PDF bytes']), '경력.pdf');
  const controller = new AbortController();
  let uploaded = false;
  const request = async (path, options = {}) => {
    if (path === '/local-data/convert-resume') {
      assert.equal(options.body, body);
      assert.equal(options.signal, controller.signal);
      assert.equal(options.auth, false);
      return { filename: '경력.md', text: '# Parsed synthetic resume' };
    }
    if (path === '/resumes' && options.method === 'POST') {
      assert.equal(options.body.get('file').name, 'resume.md');
      assert.equal(await options.body.get('file').text(), '# Parsed synthetic resume');
      assert.equal(options.body.get('title'), '경력');
      assert.equal(options.signal, controller.signal);
      uploaded = true;
      return { id: 'resume-2', title: '경력' };
    }
    if (path === '/me') return { user_id: 'member-2' };
    if (path === '/resumes?limit=100') return [{ id: 'resume-2', title: '경력' }];
    if (path === '/resumes/resume-2')
      return { id: 'resume-2', original_text: '# Parsed synthetic resume' };
    throw new Error(`Unexpected call: ${path}`);
  };
  const workspace = await backendApi(
    '/resume/upload',
    { method: 'POST', body, signal: controller.signal },
    request,
    ApiError,
  );
  assert.equal(uploaded, true);
  assert.equal(workspace.draft.resume_id, 'resume-2');
});

test('a failed local conversion cannot create an empty backend resume', async () => {
  const body = new FormData();
  body.set('file', new Blob(['synthetic']), 'empty.pdf');
  const calls = [];
  await assert.rejects(
    backendApi(
      '/resume/upload',
      { method: 'POST', body },
      async (path) => {
        calls.push(path);
        return { text: '   ' };
      },
      ApiError,
    ),
    (error) => error.code === 'resume_text_empty',
  );
  assert.deepEqual(calls, ['/local-data/convert-resume']);
});

test('logout clears member credentials and cached reports without erasing unrelated app data', async () => {
  for (const key of [
    'careerlens.backend.access-token',
    'careerlens.backend.refresh-token',
    'careerlens.backend.workspace',
    'careerlens.backend.workspace:member-1',
    'careerlens.backend.workspace:member-2',
    'careerlens.backend.bookmarks',
  ]) {
    sessionStorage.setItem(key, 'private fixture');
  }
  sessionStorage.setItem('another-app', 'preserved');
  const session = await backendApi(
    '/auth/logout',
    { method: 'POST' },
    async () => {
      throw new Error('Unexpected request');
    },
    ApiError,
  );
  assert.equal(session.user, null);
  assert.equal(sessionStorage.length, 1);
  assert.equal(sessionStorage.getItem('another-app'), 'preserved');
});

test('guest navigation does not extend the initial upload retention deadline', async () => {
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  sessionStorage.setItem(
    'careerlens.backend.guest',
    JSON.stringify({ filename: 'sample.md', expires_at: expiresAt }),
  );
  const workspace = await backendApi(
    '/guest/career-target',
    { method: 'PUT', body: { role_id: 'custom', role: '테스트' } },
    async (path) => {
      assert.equal(path, '/local-data/career-markdown');
      return { items: [] };
    },
    ApiError,
  );
  assert.equal(workspace.expires_at, expiresAt);
});

test('an evaluation queued during cancellation still reports its run id for server cancellation', async () => {
  sessionStorage.setItem(
    'careerlens.backend.workspace:member-1',
    JSON.stringify({
      resume_id: 'resume-1',
      selected_posting_id: 'job-1',
      selected_posting: { source_type: 'backend', id: 'job-1' },
      suppress_latest_report: true,
    }),
  );
  const controller = new AbortController();
  const updates = [];
  await assert.rejects(
    backendApi(
      '/analysis',
      { method: 'POST', signal: controller.signal, onProgress: (update) => updates.push(update) },
      async (path, options = {}) => {
        if (path === '/me') return { user_id: 'member-1' };
        if (path === '/resumes?limit=100') return [{ id: 'resume-1' }];
        if (path === '/resumes/resume-1') return { id: 'resume-1', original_text: 'Resume' };
        if (path === '/evaluations' && options.method === 'POST') {
          assert.equal(options.signal, undefined);
          controller.abort();
          return { run_id: 'queued-1', status: 'queued' };
        }
        throw new Error(`Unexpected call: ${path}`);
      },
      ApiError,
    ),
    { name: 'AbortError' },
  );
  assert.equal(updates[0].run.id, 'queued-1');
});

test('restoring a backend report preserves withheld totals and actual evaluation metadata', async () => {
  const criterion = {
    score: null,
    verdict: 'unknown',
    evaluation_criteria: { criterion_code: 'A1', name_ko: '근거' },
  };
  const result = {
    validation_status: 'hold',
    eligibility_status: 'unknown',
    resume_completeness: 85,
    job_fit: 65,
    criteria: [criterion],
    reports: [{ id: 'report-2' }],
  };
  const workspace = await backendApi(
    '/workspace',
    {},
    async (path) => {
      if (path === '/me') return { user_id: 'member-1' };
      if (path === '/resumes?limit=100') return [];
      if (path === '/evaluations?limit=1')
        return [{ id: 'run-2', status: 'partial', created_at: '2026-10-09T00:00:00Z' }];
      if (path === '/evaluations/run-2/result') return result;
      if (path === '/reports/report-2') return { report_text: '# 실제 보고서' };
      throw new Error(`Unexpected call: ${path}`);
    },
    ApiError,
  );
  const report = workspace.draft.report;
  assert.equal(report.score, null);
  assert.match(report.summary, /종합점수는 제공되지 않았습니다/);
  assert.doesNotMatch(report.summary, /로 인해/);
  assert.equal(report.status, 'partial');
  assert.equal(report.validation_status, 'hold');
  assert.equal(report.run_id, 'run-2');
  assert.deepEqual(report.backend_criteria, [criterion]);
  assert.deepEqual(report.backend_result, result);
  assert.equal(workspace.draft.created_at, '2026-10-09T00:00:00Z');
});

test('member listings contain registered backend jobs only, including empty-role matches', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture');
  const request = async (path) => {
    if (path === '/local-data/career-markdown') return { items: [sourceMarkdown('001')] };
    if (path === '/jobs?limit=100') return [];
    throw new Error(`Unexpected call: ${path}`);
  };
  const list = await backendApi('/job-postings?role_id=role-001', {}, request, ApiError);
  assert.equal(list.total, 0);
  assert.deepEqual(list.items, []);
});

test('member role filtering finds registered postings after the first 100 records', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'fixture');
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `job-${index}`,
    title: '다른 직무',
  }));
  const controller = new AbortController();
  const request = async (path, options) => {
    calls.push(path);
    if (path === '/local-data/career-markdown')
      return { items: [sourceMarkdown('999', '후반 직무')] };
    assert.equal(options.signal, controller.signal);
    if (path === '/jobs?limit=100') return firstPage;
    if (path === '/jobs?limit=100&offset=100')
      return [
        {
          id: 'job-101',
          title: '후반 직무',
          source_name: 'local_markdown',
          source_external_id: '999.md',
        },
      ];
    throw new Error(`Unexpected call: ${path}`);
  };
  const list = await backendApi(
    '/job-postings?role_id=role-999',
    { signal: controller.signal },
    request,
    ApiError,
  );
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, 'job-101');
  assert.equal(list.items[0].source_type, 'backend');
  assert.ok(calls.includes('/jobs?limit=100&offset=100'));
});

for (const registered of [true, false]) {
  test(`guest claim ${registered ? 'maps the preview to the registered job UUID' : 'clears an unregistered preview but preserves the chosen role'}`, async () => {
    const selected = {
      id: 'backup-001',
      source_type: 'example',
      source_name: 'local_markdown',
      source_external_id: '001.md',
      company: '회사',
      role: '역할',
    };
    const careerTarget = { role_id: 'role-001', label: '역할', focus: '' };
    sessionStorage.setItem(
      'careerlens.backend.guest',
      JSON.stringify({
        resume_text: '# Staged resume',
        filename: 'resume.pdf',
        selected_posting: selected,
        career_target: careerTarget,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const actual = {
      id: 'real-job',
      source_name: 'local_markdown',
      source_external_id: '001.md',
      title: '실제 공고',
      description: '본문',
    };
    const calls = [];
    const request = async (path, options = {}) => {
      calls.push(path);
      if (path === '/me') return { user_id: 'member-1' };
      if (path === '/jobs?limit=100')
        return registered
          ? Array.from({ length: 100 }, (_, index) => ({
              id: `other-${index}`,
              title: '다른 공고',
            }))
          : [];
      if (path === '/jobs?limit=100&offset=100') return [actual];
      if (path === '/jobs/real-job') return actual;
      if (path === '/resumes' && options.method === 'POST') {
        assert.equal(await options.body.get('file').text(), '# Staged resume');
        return { id: 'resume-1', title: 'Resume' };
      }
      if (path === '/resumes?limit=100') return [{ id: 'resume-1' }];
      if (path === '/resumes/resume-1') return { id: 'resume-1', original_text: '# Staged resume' };
      throw new Error(`Unexpected call: ${path}`);
    };
    const claimed = await backendApi('/guest/claim', { method: 'POST' }, request, ApiError);
    assert.equal(claimed.draft.selected_posting_id, registered ? 'real-job' : undefined);
    assert.deepEqual(claimed.draft.career_target, careerTarget);
    assert.equal(claimed.draft.report, undefined);
    assert.equal(calls.includes('/evaluations'), false);
    assert.equal(calls.includes('/jobs?limit=100&offset=100'), registered);
    if (registered) {
      assert.equal(
        JSON.parse(sessionStorage.getItem('careerlens.backend.workspace:member-1')).selected_posting
          .is_example,
        true,
      );
    }
    assert.equal(sessionStorage.getItem('careerlens.backend.guest'), null);
  });
}

test('expired guest staging is rejected without creating a backend resume', async () => {
  sessionStorage.setItem(
    'careerlens.backend.guest',
    JSON.stringify({
      resume_text: '# Expired',
      expires_at: new Date(Date.now() - 1).toISOString(),
    }),
  );
  await assert.rejects(
    backendApi(
      '/guest/claim',
      { method: 'POST' },
      async () => {
        throw new Error('No server request expected');
      },
      ApiError,
    ),
    (error) => error.code === 'guest_expired',
  );
  assert.equal(sessionStorage.getItem('careerlens.backend.guest'), null);
});
