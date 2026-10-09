import test from 'node:test';
import assert from 'node:assert/strict';
import { jobListPage, jobDetailPage, postingEditorPage } from '../../src/pages/jobs.js';
import {
  catalogQuery,
  catalogRoute,
  selectionNeedsConfirmation,
  withPostingSelection,
  safeSourceUrl,
  postingPayload,
} from '../../src/features/job-postings/catalog-state.js';
import { reportGuidance } from '../../src/features/analysis/guidance.js';
import { shell } from '../../src/shared/components/ui.js';

const posting = {
  id: 'example-python',
  company: '예시 기업',
  role: 'Python 개발자',
  description: '주요 업무 및 요건을 담은 가상 공고 본문',
  location: '서울',
  employment_type: '정규직',
  experience_level: '신입',
  skills: ['Python'],
  source_type: 'example',
  is_saved: false,
};

test('registered repository fixtures keep their fictional label without becoming private postings', () => {
  const fixture = { ...posting, id: 'registered-uuid', source_type: 'backend', is_example: true };
  const html = jobDetailPage(fixture, { id: 'member' });
  assert.ok(html.includes('가상 예시'));
  assert.ok(html.includes('실제 채용 중인 기업의 공고가 아닙니다.'));
  assert.ok(!html.includes('내가 입력한 공고 · 비공개'));
  assert.ok(html.includes('data-bookmark="registered-uuid"'));
  const registered = jobDetailPage({ ...fixture, is_example: false }, { id: 'member' });
  assert.ok(registered.includes('등록 공고'));
  assert.ok(!registered.includes('본인이 직접 입력한 비공개 공고'));
});

test('selecting a posting protects saved and unsaved job content and preserves unrelated edits', () => {
  const saved = {
    resume_text: '저장된 이력서',
    company: '이전 회사',
    role: '이전 직무',
    job_text: '저장된 공고',
  };
  const edits = {
    resume_text: '작성 중인 이력서',
    role: '작성 중인 지원 직무',
    answers: { work: '작성 중인 답변' },
  };
  assert.equal(selectionNeedsConfirmation(saved, edits, posting), true);
  assert.equal(selectionNeedsConfirmation({}, {}, posting), false);
  const selected = withPostingSelection(edits, posting);
  assert.equal(selected.resume_text, edits.resume_text);
  assert.deepEqual(selected.answers, edits.answers);
  assert.equal(selected.company, posting.company);
  assert.equal(selected.job_text, posting.description);
  assert.equal(selectionNeedsConfirmation(saved, selected, posting), false);
  assert.equal(saved.company, '이전 회사');
  assert.equal(edits.role, '작성 중인 지원 직무');
});

test('catalog filters survive route round trips, Unicode and pagination', () => {
  const query = catalogQuery(
    new URLSearchParams(
      'q=Python+%26+SQL&location=서울&skill=C%2B%2B&saved=1&page=2&irrelevant=secret',
    ),
  );
  const route = catalogRoute(`#/jobs?${query}`);
  assert.equal(route.kind, 'list');
  assert.equal(route.query.get('q'), 'Python & SQL');
  assert.equal(route.query.get('skill'), 'C++');
  assert.equal(route.query.get('location'), '서울');
  assert.equal(route.query.get('page'), '2');
  assert.equal(route.query.has('irrelevant'), false);
  for (const page of ['-1', 'NaN', '1.5'])
    assert.equal(catalogQuery(new URLSearchParams({ page })).get('page'), '1');
  assert.deepEqual(catalogRoute('#/jobs/new'), { kind: 'new' });
  assert.deepEqual(catalogRoute('#/jobs/example-python/edit'), {
    kind: 'edit',
    id: 'example-python',
  });
  assert.equal(catalogRoute('#/jobs/%zz'), null);
});

test('job pages render untrusted API values as text and reject executable source URLs', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const dangerous = {
    ...posting,
    company: payload,
    role: payload,
    location: payload,
    skills: [payload],
    description: payload,
    source_url: 'javascript:alert(1)',
  };
  const views = [
    jobListPage(
      { items: [dangerous], total: 1, page: 1, page_size: 12, filters: { locations: [payload] } },
      new URLSearchParams({ q: payload }),
      null,
    ),
    jobDetailPage(dangerous, null),
    postingEditorPage(dangerous, posting.id),
  ];
  for (const markup of views) {
    assert.equal(markup.includes(payload), false);
    assert.ok(markup.includes('&lt;img'));
    assert.equal(markup.includes('href="javascript:'), false);
  }
  assert.equal(safeSourceUrl('https://user:pass@example.com'), '');
  assert.equal(safeSourceUrl('data:text/html,hello'), '');
  assert.equal(safeSourceUrl('/local-relative'), '');
  assert.equal(safeSourceUrl('https://example.com/jobs'), 'https://example.com/jobs');
});

test('public catalogue offers login, real-source disclaimers and owner-only editing', () => {
  const publicShell = shell('jobs', { page: 'jobs' });
  assert.ok(publicShell.includes('href="#/email"'));
  assert.equal(publicShell.includes('id="logout"'), false);
  assert.equal(publicShell.includes('class="steps"'), false);
  const example = jobDetailPage(
    { ...posting, source_url: 'https://example.com/real-role' },
    { id: 'owner' },
  );
  assert.ok(example.includes('참고한 실제 직무 자료'));
  assert.ok(example.includes('직무 참고 출처'));
  assert.equal(example.includes('id="delete-posting"'), false);
  assert.equal(
    jobDetailPage(
      { ...posting, source_type: 'manual', is_owner: false },
      { id: 'someone' },
    ).includes('id="delete-posting"'),
    false,
  );
  assert.ok(
    jobDetailPage({ ...posting, source_type: 'manual', is_owner: true }, { id: 'owner' }).includes(
      'id="delete-posting"',
    ),
  );
});

test('posting form serializes comma-separated unique skills with Unicode intact', () => {
  const form = new URLSearchParams({
    company: '가상 기업',
    skills: 'Python, SQL, Python, 데이터 분석, ,',
    description: '공고 본문',
  });
  const payload = postingPayload(form);
  assert.deepEqual(payload.skills, ['Python', 'SQL', '데이터 분석']);
  assert.equal(payload.company, '가상 기업');
});

test('guidance distinguishes rule analysis, reference guidance and optional AI output safely', () => {
  const payload = '<script>alert(1)</script>';
  const rules = reportGuidance({
    agent: { fallback_used: false },
    reference_guidance: [{ title: payload, text: payload, source: payload }],
  });
  assert.ok(rules.includes('이력서의 경험과 근거를 살펴보고'));
  assert.equal(rules.includes('AI 보완 제안'), false);
  assert.equal(rules.includes(payload), false);
  const ai = reportGuidance({
    agent: {},
    ai_coaching: {
      summary: payload,
      recommendations: [{ text: payload, evidence_quote: payload }],
    },
  });
  assert.ok(ai.includes('AI 보완 제안'));
  assert.equal(ai.includes(payload), false);
  assert.equal(reportGuidance({}), '');
});
