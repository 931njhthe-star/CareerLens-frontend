import { api, getSession, setSession } from '../shared/api/client.js';
import { shell, notice, pending, bindCounters } from '../shared/components/ui.js';
import { renderAuth, bindAuth } from '../features/auth/auth.js';
import { workspacePage } from '../pages/workspace.js';
import { draftForPage, remainingEdits } from './workspace-state.js';

const app = document.getElementById('app');
const authPages = new Set(['login', 'email', 'signup', 'forgot', 'reset']);
const workflowPages = new Set(['resume', 'job', 'questions', 'result']);
const params = new URLSearchParams(location.search);
const resetToken = params.get('reset_token') || '';
let authError = params.get('auth_error');
let session;
let workspace = { draft: {}, questions: [] };
let edits = {};
let navigationMessage;

function navigate(page) {
  if (location.hash === `#/${page}`) render();
  else location.hash = `/${page}`;
}

function applyWorkspace(result, savedFields = []) {
  edits = remainingEdits(edits, savedFields, workspace.draft, result.draft);
  if (result.draft) workspace.draft = result.draft;
  if (result.questions) workspace.questions = result.questions;
}

async function loadWorkspace(savedFields = []) {
  applyWorkspace(await api('/workspace'), savedFields);
}

async function onSession(nextSession) {
  session = nextSession;
  setSession(session);
  edits = {};
  workspace = { draft: {}, questions: [] };
  if (!session.user) {
    navigate('email');
    return;
  }
  await loadWorkspace();
  navigate(workspace.draft.report ? 'result' : 'resume');
}

function render() {
  if (!session) return;
  let page = location.hash.replace(/^#\//, '') || (resetToken ? 'reset' : 'resume');
  if (!session.user && !authPages.has(page)) page = 'login';
  if (session.user && authPages.has(page) && page !== 'reset') page = workspace.draft.report ? 'result' : 'resume';
  if (session.user && !authPages.has(page)) {
    if (!workflowPages.has(page)) page = 'resume';
    if (page !== 'resume' && !workspace.draft.resume_text) page = 'resume';
    if (['questions', 'result'].includes(page) && !workspace.draft.job_text) page = 'job';
    if (page === 'result' && !workspace.draft.report) page = 'questions';
  }
  if (location.hash !== `#/${page}`) history.replaceState({}, '', `${location.pathname}${location.search}#/${page}`);
  const title = { login: '로그인', email: '이메일 로그인', signup: '회원가입', forgot: '비밀번호 찾기', reset: '비밀번호 재설정', resume: '이력서 입력', job: '지원 공고', questions: '모의지원 준비', result: '모의지원 결과' }[page];
  document.title = `${title} · CareerLens`;
  if (authPages.has(page)) {
    app.innerHTML = renderAuth(page, session);
    bindAuth({ onSession, resetToken, navigate });
    if (authError) {
      notice('소셜 로그인을 완료하지 못했습니다. 설정을 확인하거나 이메일로 로그인해 주세요.', 'error', document.getElementById('auth-notices'));
      authError = null;
      history.replaceState({}, '', `${location.pathname}${resetToken ? `?reset_token=${encodeURIComponent(resetToken)}` : ''}${location.hash}`);
    }
    if (page === 'reset' && !resetToken) {
      notice('재설정 링크가 없습니다. 비밀번호 찾기에서 안내를 다시 요청해 주세요.', 'error', document.getElementById('auth-notices'));
      document.querySelector('#auth-form [type="submit"]').disabled = true;
    }
  } else {
    app.innerHTML = shell(workspacePage(page, draftForPage(page, workspace.draft, edits), workspace.questions || []), { user: session.user, draft: workspace.draft, page });
    bindWorkflow();
    bindCounters();
    if (navigationMessage) {
      notice(navigationMessage, 'success');
      navigationMessage = null;
    } else if (['questions', 'result'].includes(page) && ['resume_text', 'company', 'role', 'job_text'].some(field => Object.hasOwn(edits, field))) {
      notice(page === 'result'
        ? '저장되지 않은 수정 내용이 있습니다. 이 결과는 마지막으로 저장하고 분석한 내용을 기준으로 표시합니다.'
        : '저장되지 않은 이력서 또는 공고 수정 내용이 있습니다. 질문과 분석에는 마지막으로 저장한 내용이 사용됩니다.', 'info');
    }
  }
  document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function handleError(error) {
  if (error.status === 401) {
    session = await getSession();
    navigate('email');
    setTimeout(() => notice('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.', 'error', document.getElementById('auth-notices')), 0);
  } else {
    notice(error.message);
  }
}

function bindForm(id, label, action) {
  const form = document.getElementById(id);
  form?.addEventListener('submit', event => {
    event.preventDefault();
    pending(form, label, async () => {
      try { await action(new FormData(form)); }
      catch (error) { await handleError(error); }
    });
  });
}

function bindWorkflow() {
  document.getElementById('logout')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
      session = await getSession();
      workspace = { draft: {}, questions: [] };
      edits = {};
      navigate('login');
    } catch (error) { button.disabled = false; await handleError(error); }
  });
  document.querySelectorAll('#resume-form textarea, #job-form input, #job-form textarea').forEach(field => {
    field.addEventListener('input', () => { edits[field.name] = field.value; });
  });
  document.querySelectorAll('#analysis-form textarea').forEach(field => {
    field.addEventListener('input', () => { edits.answers = { ...edits.answers, [field.name]: field.value }; });
  });
  bindForm('resume-form', '이력서 저장 중…', async form => {
    applyWorkspace(await api('/resume', { method: 'PUT', body: { resume_text: form.get('resume_text') } }), ['resume_text']);
    navigate('job');
  });
  bindForm('upload-form', '불러오는 중…', async form => {
    const file = form.get('file');
    if (file.size > 10 * 1024 * 1024) throw new Error('파일은 10MB 이하로 선택해 주세요.');
    applyWorkspace(await api('/resume/upload', { method: 'POST', body: form }), ['resume_text']);
    navigationMessage = '이력서를 불러왔습니다. 추출한 내용을 확인하고 다음 단계로 진행해 주세요.';
    render();
  });
  bindForm('job-form', '공고 저장 중…', async form => {
    applyWorkspace(await api('/job', { method: 'PUT', body: Object.fromEntries(form) }), ['company', 'role', 'job_text']);
    if (!workspace.questions?.length) workspace.questions = (await api('/questions')).questions || [];
    navigate('questions');
  });
  bindForm('analysis-form', '이력서와 공고를 분석하는 중…', async form => {
    const answers = Object.fromEntries(form);
    const result = await api('/analysis', { method: 'POST', body: { answers } });
    workspace.draft = { ...workspace.draft, answers, report: result.report };
    await loadWorkspace(['answers']);
    navigate('result');
  });
  document.getElementById('example')?.addEventListener('click', async event => {
    if (Object.keys(edits).length && !window.confirm('작성 중인 내용을 예시 이력서와 공고로 바꿀까요?')) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '예시를 불러오는 중…';
    try {
      applyWorkspace(await api('/example', { method: 'POST', body: {} }));
      edits = {};
      navigationMessage = '가상 이력서와 공고를 불러왔습니다. 내용을 확인하고 모의지원을 진행해 보세요.';
      navigate('job');
    } catch (error) { button.disabled = false; button.textContent = '예시로 체험하기'; await handleError(error); }
  });
  document.getElementById('clear-workspace')?.addEventListener('click', async event => {
    if (!window.confirm('내 계정의 이력서, 공고, 추가 답변과 분석 결과를 삭제할까요? 삭제한 내용은 복구할 수 없습니다.')) return;
    event.currentTarget.disabled = true;
    try {
      const result = await api('/workspace', { method: 'DELETE' });
      workspace = { draft: {}, questions: [] };
      edits = {};
      applyWorkspace(result);
      navigationMessage = '입력 내용과 분석 결과를 삭제했습니다.';
      navigate('resume');
    } catch (error) { render(); await handleError(error); }
  });
  document.getElementById('print-report')?.addEventListener('click', () => window.print());
  document.querySelectorAll('[data-section]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const card = document.querySelector('[data-resume-score-card]');
    const section = document.getElementById(link.dataset.section);
    if (!card || !section) return;
    const top = card.scrollTop + section.getBoundingClientRect().top - card.getBoundingClientRect().top - card.clientTop;
    card.focus({ preventScroll: true });
    card.scrollTo({ top: Math.max(0, top - 20), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }));
}

window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', event => {
  if (Object.keys(edits).length) { event.preventDefault(); event.returnValue = ''; }
});

async function start() {
  try {
    session = await getSession();
    if (session.user) await loadWorkspace();
    render();
  } catch (error) {
    app.innerHTML = '<main id="main" class="loading-screen"><h1>연결을 확인해 주세요.</h1><p id="startup-error" role="alert"></p><button id="retry" class="button primary">다시 시도</button></main>';
    document.getElementById('startup-error').textContent = error.message;
    document.getElementById('retry').addEventListener('click', start);
  }
}
start();
