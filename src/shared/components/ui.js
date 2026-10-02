export const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const paths = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a22 22 0 0 0 18 0M12 11v4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  report: '<path d="M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8M8 7h6M8 11h3m3 7 3 3 5-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8"/>',
  lens: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
};
export const icon = (name, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;

export function shell(content, { user, draft = {}, page = 'resume' } = {}) {
  const step = page === 'resume' ? 1 : page === 'job' ? 2 : 3;
  const steps = [
    { label: '이력서', path: 'resume', icon: 'file', enabled: true },
    { label: '지원 공고', path: 'job', icon: 'briefcase', enabled: !!draft.resume_text },
    { label: '모의지원', path: draft.report ? 'result' : 'questions', icon: 'report', enabled: !!draft.job_text },
  ];
  return `<header class="topbar"><a class="brand" href="#/resume" aria-label="CareerLens 처음으로"><span class="brand-symbol">${icon('lens',23)}</span>Career<b>Lens</b></a><span class="workspace-name">프로젝트 2 · 모의지원</span><div class="account-menu"><span class="account-name">${escapeHtml(user?.name)} 님</span><button type="button" id="logout" class="button secondary compact">로그아웃</button></div></header><div class="app-shell"><nav class="steps" aria-label="모의지원 진행 단계">${steps.map((s, i) => `${s.enabled ? `<a href="#/${s.path}"` : '<span aria-disabled="true"'} class="step ${step === i + 1 ? 'active' : ''} ${s.enabled ? '' : 'disabled'}" ${step === i + 1 ? 'aria-current="step"' : ''}><span class="step-number">${step > i + 1 ? icon('check',16) : i + 1}</span>${icon(s.icon)}<span>${s.label}</span>${s.enabled ? '</a>' : '</span>'}`).join('')}</nav><div id="notices" class="notices" aria-live="polite"></div><main id="main" tabindex="-1">${content}</main></div><footer class="footer"><span>CareerLens · 교육 과정 프로젝트 2</span><span>연결된 팀 API로 분석하며, 이 화면에서 실제 기업에 지원서를 보내지 않습니다.</span></footer>`;
}

export function notice(message, type = 'error', target = document.getElementById('notices')) {
  if (!target) return;
  const p = document.createElement('p');
  p.className = `notice ${type}`;
  p.textContent = message;
  p.setAttribute('role', type === 'error' ? 'alert' : 'status');
  target.replaceChildren(p);
  p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export async function pending(form, label, action) {
  if (form.getAttribute('aria-busy') === 'true') return;
  const buttons = [...form.querySelectorAll('button')];
  const previous = buttons.map(button => ({ button, disabled: button.disabled, html: button.innerHTML }));
  const submit = form.querySelector('[type="submit"]');
  form.setAttribute('aria-busy', 'true');
  buttons.forEach(button => { button.disabled = true; });
  if (submit) submit.textContent = label;
  try { return await action(); }
  finally {
    form.removeAttribute('aria-busy');
    previous.forEach(({ button, disabled, html }) => { button.disabled = disabled; button.innerHTML = html; });
  }
}

export function bindCounters(root = document) {
  root.querySelectorAll('[data-count]').forEach(field => {
    const counter = document.getElementById(field.dataset.count);
    const update = () => { counter.textContent = `${field.value.length.toLocaleString('ko-KR')} / 50,000자`; };
    field.addEventListener('input', update);
    update();
  });
}
