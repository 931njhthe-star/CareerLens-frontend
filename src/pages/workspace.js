import { escapeHtml as e, icon } from '../shared/components/ui.js';
import { resumeEditor } from '../features/resumes/resume.js';
import { jobEditor } from '../features/job-postings/job.js';
import { questionsEditor } from '../features/analysis/questions.js';
import { analysisReport } from '../features/analysis/report.js';
import { resumeExamplesPanel } from '../features/resumes/examples.js';

function renderRolePage(draft) {
  return `
    <div class="page-heading">
      <div>
        <h1>희망하는 직무를 선택해 주세요.</h1>
        <p>내 경험을 바탕으로, 앞으로 하고 싶은 일을 준비합니다.</p>
      </div>
    </div>
    <div class="editor-layout">
      ${jobEditor(draft)}
      <aside class="guide-panel">
        <div class="aside-icon">${icon('briefcase', 27)}</div>
        <h2>
          어떤 일을
          <br />
          하고 싶으신가요?
        </h2>
        <p>
          관심 있는 직무를 고르거나 직접 입력할 수 있어요. 이력서에 담긴 경험과 더 설명하면 좋은
          부분을 공고의 요구사항과 함께 살펴봅니다.
        </p>
        <div class="attached-resume">
          ${icon('check', 18)}
          <div>
            <strong>${draft.guest ? (draft.resume_attached ? '분석할 이력서가 첨부되었어요' : '분석 전 이력서를 첨부해 주세요') : '이력서 준비 완료'}</strong>
            <p>
              ${e(draft.filename || (draft.guest ? '선택한 파일이 없습니다.' : '직접 입력한 이력서'))}
              <br />
              ${draft.guest ? '비회원도 분석까지 진행할 수 있어요. 결과 열람은 로그인 후 가능합니다.' : `${(draft.resume_text?.length || 0).toLocaleString('ko-KR')}자`}
            </p>
          </div>
        </div>
        <p class="small-note">
          직무 선택은 언제든 바꿀 수 있어요. 변경한 내용에 맞춰 모의지원을 다시 준비합니다.
        </p>
      </aside>
    </div>
  `;
}

function renderPreparationPage(draft) {
  return `
    <section
      class="preparation-page"
      aria-labelledby="preparation-title">
      <div class="page-heading">
        <div>
          <h1 id="preparation-title">모의지원 질문을 준비하고 있어요.</h1>
          <p>
            ${e(draft.career_target?.label || draft.role)} 직무를 준비하며 더 설명하면 좋을 경험을
            찾습니다.
          </p>
        </div>
      </div>
      <ol
        class="preparation-status"
        data-preparation-status
        aria-label="질문 준비 단계"></ol>
      <div class="preparation-footer">
        <p
          id="preparation-message"
          role="status"
          aria-live="polite">
          이력서와 희망 직무를 확인하고 있습니다.
        </p>
        <div class="preparation-actions">
          <a
            class="back-link"
            href="#/job">
            희망 직무 수정
          </a>
          <button
            id="preparation-retry"
            class="button secondary"
            type="button"
            hidden>
            질문 준비 다시 시도
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderQuestionsPage(draft, questions) {
  const desiredRole = draft.analysis_mode === 'desired_role';
  const label = desiredRole ? '희망 직무' : draft.company;
  return `
    <div class="page-heading">
      <div>
        <h1>조금 더 선명한 근거를 더해요.</h1>
        <p>이력서에서 다 담지 못한 경험이 있다면 알려주세요.</p>
      </div>
      <span class="badge neutral">결과 확인 전 마지막 단계</span>
    </div>
    <div class="editor-layout">
      ${questionsEditor(draft, questions)}
      <aside class="guide-panel">
        <div class="position-block">
          <span class="company-initial">
            ${desiredRole ? icon('briefcase', 24) : e(draft.company?.slice(0, 1))}
          </span>
          <p>${e(label)}</p>
          <h2>${e(draft.role)}</h2>
        </div>
        <div class="aside-separator"></div>
        <h3>있는 경험만 적어주세요.</h3>
        <p>
          추가 답변은 이력서와 구분해 결과에 표시합니다. 수치나 성과를 새로 만들어 적을 필요는
          없어요.
        </p>
        <p class="small-note">
          답변은 선택 사항입니다. 비워두면
          ${desiredRole ? '이력서와 희망 직무의 참고 기준' : '이력서와 공고'}으로 현재 상태를
          점검합니다.
        </p>
      </aside>
    </div>
  `;
}

function renderResumePage(draft) {
  return `
    <div class="page-heading">
      <div>
        <h1>
          지원의 시작은,
          <br class="mobile-break" />
          내 이력서부터.
        </h1>
        <p>이력서를 불러오면 희망 직무를 향한 준비 상태를 확인합니다.</p>
      </div>
      ${
        draft.resume_text
          ? ''
          : `
            <button
              id="example"
              class="button secondary compact"
              type="button">
              예시로 체험하기 ${icon('arrow', 17)}
            </button>
          `
      }
    </div>
    ${resumeExamplesPanel()}
    <div class="editor-layout">
      ${resumeEditor(draft)}
      <aside class="guide-panel">
        <h2>
          모의지원까지,
          <br />
          세 단계면 충분해요.
        </h2>
        <ol class="journey">
          <li class="current">
            <span>1</span>
            <div>
              <strong>이력서 입력</strong>
              <p>내 경험과 성과를 준비해요.</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>희망 직무 선택</strong>
              <p>앞으로 하고 싶은 일을 정해요.</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>공고 선택 · 모의지원</strong>
              <p>원하는 공고를 골라 보고서를 확인해요.</p>
            </div>
          </li>
        </ol>
        <div class="privacy-note">
          ${icon('lock', 20)}
          <p>
            입력한 이력서와 희망 직무는 연결된 팀 API로 전송됩니다. 저장과 분석은 해당 서비스의
            설정을 따릅니다.
          </p>
        </div>
        <p class="small-note">
          스캔한 PDF는 본문을 읽지 못할 수 있어요. 그럴 때는 텍스트를 직접 붙여넣어 주세요.
        </p>
      </aside>
    </div>
    ${
      draft.resume_text
        ? `
          <div class="reset-form">
            <button
              id="clear-workspace"
              class="text-button"
              type="button">
              입력 내용과 결과 삭제
            </button>
          </div>
        `
        : ''
    }
  `;
}

export function workspacePage(page, draft, questions) {
  switch (page) {
    case 'result':
      return analysisReport(draft);
    case 'job':
      return renderRolePage(draft);
    case 'preparing':
      return renderPreparationPage(draft);
    case 'questions':
      return renderQuestionsPage(draft, questions);
    default:
      return renderResumePage(draft);
  }
}
