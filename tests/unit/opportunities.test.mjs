import test from 'node:test';
import assert from 'node:assert/strict';
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
} from '../../src/pages/opportunities.js';
import { analysisReport } from '../../src/features/analysis/report.js';
import { shell } from '../../src/shared/components/ui.js';

test('file choice validates metadata while guest attachment UI never previews the resume', () => {
  const file = {
    name: '경험.pdf',
    size: 1000,
    text() {
      throw new Error('must not read');
    },
    arrayBuffer() {
      throw new Error('must not read');
    },
  };
  assert.equal(guestFileMetadata(file), file.name);
  assert.throws(() => guestFileMetadata({ name: 'large.pdf', size: 11000000 }));
  assert.throws(() => guestFileMetadata({ name: 'script.html', size: 100 }));
  const html = guestResumePage('<script>private</script>.pdf');
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
    page: 2,
    selected: '공고/?&',
  });
  const query = new URLSearchParams(opportunityQuery(route).split('?')[1]);
  assert.equal(query.get('role'), 'UX & 데이터');
  assert.equal(query.get('page'), '2');
  assert.equal(query.has('resume_text'), false);
  assert.equal(opportunityRoute('#/questions'), null);
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
