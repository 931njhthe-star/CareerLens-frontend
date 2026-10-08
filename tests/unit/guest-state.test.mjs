import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guestWorkspace,
  requestGuestReport,
  practiceDestination,
} from '../../src/features/analysis/guest-state.js';

test('guest workspace excludes accidental private report and resume fields', () => {
  const value = guestWorkspace({
    completed: true,
    report_locked: true,
    expires_at: '2030-01-01T00:00:00Z',
    draft: {
      resume_attached: true,
      filename: 'attached.pdf',
      resume_text: 'PRIVATE RESUME',
      report: { score: 83, summary: 'PRIVATE REPORT' },
      answers: { one: 'PRIVATE ANSWER' },
      selected_posting_id: 'posting-a',
    },
  });
  assert.equal(value.draft.report_locked, true);
  assert.equal(value.draft.resume_attached, true);
  assert.ok(!JSON.stringify(value).includes('PRIVATE'));
  assert.ok(!JSON.stringify(value).includes('score'));
});

test('guest completion requires server confirmation and never fetches a report', async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push([path, options.body]);
    return { completed: true, report_locked: true, draft: { resume_attached: true } };
  };
  const result = await requestGuestReport({
    answers: { one: 'An experience' },
    signal: new AbortController().signal,
    request,
  });
  assert.deepEqual(calls, [['/guest/analysis', { answers: { one: 'An experience' } }]]);
  assert.equal(result.draft.report_locked, true);
  await assert.rejects(
    requestGuestReport({
      answers: {},
      signal: new AbortController().signal,
      request: async () => ({ completed: false, report_locked: true }),
    }),
    /분석 완료/,
  );
});

test('cancelled guest analysis does not open completed result', async () => {
  const controller = new AbortController();
  await assert.rejects(
    requestGuestReport({
      answers: {},
      signal: controller.signal,
      request: async () => {
        controller.abort();
        return { completed: true, report_locked: true };
      },
    }),
    { name: 'AbortError' },
  );
});

test('practice navigation respects resume, posting and locked report prerequisites', () => {
  assert.equal(practiceDestination({}), 'resume');
  assert.equal(practiceDestination({ resume_attached: true }), 'job');
  assert.equal(
    practiceDestination({ resume_attached: true, selected_posting_id: 'a' }),
    'questions',
  );
  assert.equal(practiceDestination({ report_locked: true }), 'result');
  assert.equal(practiceDestination({ report: { score: 0 } }), 'result');
});
