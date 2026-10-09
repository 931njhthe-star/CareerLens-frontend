import { finishPreparationPresentation, withPresentationSignal } from './preparation-transition.js';
import { reportTransitionPalette } from '../../shared/design/selected-theme.js';
import { playReportTransition } from '../../shared/motion/report-transition.js';

// A native modal prevents changes while the selected posting is analyzed.
// Explicit cancellation can return to that posting from any starting page.
export function createReportLoading({ draft, onCancel, journey }) {
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
          ${draft.analysis_mode === 'job_posting' ? '이력서와 선택한 채용공고를 함께 살펴봅니다.' : '이력서와 희망 직무를 함께 살펴봅니다.'}
        </p>
        <p class="report-loading-progress-note">진행률은 시각적 진행이며, 항목별 평가 결과가 아닙니다.</p>
        <p data-evaluation-status role="status" aria-live="polite"></p>
      </div>
      <div
        class="report-loading-eye"
        role="progressbar"
        aria-label="보고서 분석 진행"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
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
        채용공고로 돌아가기
      </button>
    </div>
  `;
  const host = dialog.querySelector('[data-report-eye]');
  const evaluationStatus = dialog.querySelector('[data-evaluation-status]');
  const back = dialog.querySelector('button');
  const focused = document.activeElement;
  const scrollOverflow = document.body.style.overflow;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let eye;
  let disposed = false;
  let startedAt;
  let requestSucceeded = false;
  let analysisComplete = false;
  document.body.append(dialog);
  document.body.style.overflow = 'hidden';
  dialog.showModal();
  dialog.focus();

  function dispose({ restoreFocus = true, cancelAnalysis = false } = {}) {
    if (disposed) return;
    disposed = true;
    abort.abort();
    if (cancelAnalysis && !requestSucceeded) onCancel?.();
    eye?.dispose();
    dialog.close();
    dialog.remove();
    document.body.style.overflow = scrollOverflow;
    const restore =
      focused?.isConnected && !focused.disabled
        ? focused
        : document.querySelector(
            '#opportunity-apply:not(:disabled), #select-posting:not(:disabled)',
          ) ||
          document.querySelector('#opportunity-detail') ||
          document.querySelector('#main[tabindex]');
    if (restoreFocus) restore?.focus({ preventScroll: true });
  }
  function cancel() {
    if (disposed) return;
    const succeeded = requestSucceeded;
    dispose({ cancelAnalysis: true });
    if (succeeded) onCancel?.();
  }
  function updateProgress(update) {
    if (signal.aborted || !evaluationStatus) return;
    const labels = {
      queued: '분석 순서를 기다리고 있어요.',
      parsing: '이력서와 공고 내용을 확인하고 있어요.',
      indexing: '경험과 연결되는 근거를 찾고 있어요.',
      evaluation: '항목별 경험과 역량을 살펴보고 있어요.',
      criterion: '항목별 경험과 역량을 살펴보고 있어요.',
      validation: '평가 근거를 다시 확인하고 있어요.',
      reporting: '분석 내용을 보고서로 정리하고 있어요.',
      completed: '보고서가 준비됐어요.',
    };
    evaluationStatus.textContent = labels[update?.run?.current_stage] || '분석을 진행하고 있어요.';
  }
  back.addEventListener('click', cancel, { signal });
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      cancel();
    },
    { signal },
  );

  async function run(request) {
    try {
      signal.throwIfAborted();
      startedAt = performance.now();
      // The fixed ring stays visible while the page clears to white behind it.
      // Its brief entry hold ends before acceleration and the eye strokes begin.
      // Graphics loading and drawing never hold up the actual analysis request.
      const visual = import('./live-eye-motion.js')
        .catch(() => null)
        .then((module) => {
          if (signal.aborted || !module) return;
          try {
            eye = module.mountLiveAnalysisEye(host, {
              snapshot: journey,
              onProgress(value) {
                if (signal.aborted) return;
                const percent = Math.min(
                  requestSucceeded ? 100 : 99,
                  Math.max(0, Math.round(value)),
                );
                host.setAttribute('aria-valuenow', String(percent));
                host.setAttribute('aria-valuetext', `${percent}% · 시각적 진행률`);
              },
            });
          } catch {
            // Keep a readable fallback if graphics are unavailable.
            if (!eye) host.textContent = '보고서를 작성하고 있습니다.';
          }
        });
      // Module loading cannot block the report request.
      host.setAttribute('aria-busy', 'true');
      const result = await request(signal, updateProgress);
      signal.throwIfAborted();
      requestSucceeded = true;
      await withPresentationSignal(visual, signal);
      signal.throwIfAborted();
      eye?.complete();
      if (!eye) host.textContent = '보고서가 완성되었습니다. 결과를 엽니다.';
      await finishPreparationPresentation({
        eye: eye && { finish: () => eye.whenSettled() },
        startedAt,
        signal,
        fold: false,
        onComplete() {},
      });
      host.setAttribute('aria-valuenow', '100');
      host.setAttribute('aria-valuetext', '100% · 보고서 분석 완료');
      host.setAttribute('aria-busy', 'false');
      analysisComplete = true;
      return result;
    } catch (error) {
      dispose();
      throw error;
    }
  }

  async function reveal({ frame, onReveal = () => {} } = {}) {
    signal.throwIfAborted();
    if (!analysisComplete) throw new Error('분석이 완료된 뒤 보고서를 열 수 있습니다.');
    let revealed = false;
    const revealContent = () => {
      if (revealed || signal.aborted) return;
      revealed = true;
      onReveal();
      dialog.classList.add('is-revealing');
      eye?.dispose();
      eye = undefined;
    };
    // The completed eye remains in the modal top layer while the real result is
    // measured underneath. No screenshot, cloned report or synthetic report is used.
    const source = eye?.scene || eye?.element || host;
    const bounds = dialog.getBoundingClientRect();
    const eyeBounds = source.getBoundingClientRect();
    const frameBounds = frame?.getBoundingClientRect();
    const viewportWidth = dialog.clientWidth || bounds.width;
    const viewportHeight = dialog.clientHeight || bounds.height;
    // Follow the real scroll window without moving or shrinking its outline into
    // a second, invented card. The canvas clips offscreen edges naturally.
    const target = frameBounds && {
      x: frameBounds.left - bounds.left,
      y: frameBounds.top - bounds.top,
      width: frameBounds.width,
      height: frameBounds.height,
    };
    if (
      !target ||
      !Object.values(target).every(Number.isFinite) ||
      target.width <= 0 ||
      target.height <= 0 ||
      target.x >= viewportWidth ||
      target.y >= viewportHeight ||
      target.x + target.width <= 0 ||
      target.y + target.height <= 0
    ) {
      revealContent();
      return;
    }
    dialog.classList.add('is-transferring');
    try {
      await playReportTransition({
        host: dialog,
        fromRect: {
          x: eyeBounds.left - bounds.left,
          y: eyeBounds.top - bounds.top,
          width: eyeBounds.width,
          height: eyeBounds.height,
        },
        toRect: target,
        outline: 'document',
        palette: reportTransitionPalette,
        signal,
        reducedMotion: reduced,
        onReveal: revealContent,
      });
    } catch (error) {
      signal.throwIfAborted();
      // Presentation failure cannot discard an already valid report. Routing and
      // authentication remain owned by the controller, including the guest gate.
      revealContent();
    }
    signal.throwIfAborted();
    revealContent();
  }
  return { run, reveal, dispose, signal };
}
