import {
  finishPreparationPresentation,
  waitForPresentationDelay,
  withPresentationSignal,
} from './preparation-transition.js';
import { reportLoadingSnapshot } from './report-state.js';

// A native modal keeps the existing answers visible underneath, but prevents edits
// while the submitted snapshot is being analyzed. Escape returns to those answers.
export function createReportLoading({ draft, answers }) {
  const abort = new AbortController();
  const { signal } = abort;
  const dialog = document.createElement('dialog');
  dialog.className = 'report-loading-overlay';
  dialog.setAttribute('aria-labelledby', 'report-loading-title');
  dialog.setAttribute('aria-describedby', 'report-loading-description');
  dialog.setAttribute('tabindex', '-1');
  dialog.innerHTML = `
    <div class="report-loading-content">
      <div class="report-loading-heading">
        <h2 id="report-loading-title">경험을 하나의 보고서로 정리하고 있어요.</h2>
        <p id="report-loading-description">
          ${draft.analysis_mode === 'job_posting' ? '이력서와 선택한 채용공고, 추가로 적어주신 답변을 함께 살펴봅니다.' : '이력서와 희망 직무, 추가로 적어주신 답변을 함께 살펴봅니다.'}
        </p>
      </div>
      <div
        class="report-loading-eye"
        data-report-eye>
        <p
          class="report-loading-fallback"
          role="status">
          분석을 준비하고 있습니다.
        </p>
      </div>
      <button
        type="button"
        class="report-loading-return">
        입력으로 돌아가기
      </button>
    </div>
  `;
  const host = dialog.querySelector('[data-report-eye]');
  const back = dialog.querySelector('button');
  const focused = document.activeElement;
  const scrollOverflow = document.body.style.overflow;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let eye;
  let disposed = false;
  let startedAt;
  document.body.append(dialog);
  document.body.style.overflow = 'hidden';
  dialog.showModal();
  dialog.focus();

  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    eye?.dispose();
    dialog.close();
    dialog.remove();
    document.body.style.overflow = scrollOverflow;
    const restore =
      focused?.isConnected && !focused.disabled
        ? focused
        : document.querySelector('#analysis-form textarea');
    restore?.focus({ preventScroll: true });
  }
  back.addEventListener('click', dispose, { signal });
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      dispose();
    },
    { signal },
  );

  async function run(request) {
    try {
      // Fetch the module while the dimmer enters. API work starts after dimming;
      // eye drawing and the gauge then start together with that work.
      const modulePromise = import('./matching-eye.js').catch(() => null);
      await waitForPresentationDelay(reduced ? 0 : 220, signal);
      signal.throwIfAborted();
      startedAt = performance.now();
      const visual = modulePromise.then((module) => {
        if (signal.aborted || !module) return;
        try {
          eye = module.mountAnalysisEye(host, reportLoadingSnapshot(draft, answers), {
            surface: 'overlay',
            purpose: 'report',
          });
        } catch {
          host.textContent = '보고서를 작성하고 있습니다.';
        }
      });
      // Module loading cannot block the report request.
      host.setAttribute('aria-busy', 'true');
      const result = await request(signal);
      signal.throwIfAborted();
      await withPresentationSignal(visual, signal);
      signal.throwIfAborted();
      eye?.update(reportLoadingSnapshot(draft, answers, true));
      host.setAttribute('aria-busy', 'false');
      if (!eye) host.textContent = '보고서가 완성되었습니다. 결과를 엽니다.';
      await finishPreparationPresentation({ eye, startedAt, signal, onComplete() {} });
      dialog.classList.add('is-leaving');
      await waitForPresentationDelay(reduced ? 0 : 160, signal);
      return result;
    } catch (error) {
      dispose();
      throw error;
    }
  }
  return { run, dispose, signal };
}
