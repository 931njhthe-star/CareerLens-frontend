import { escapeHtml as e, icon } from '../../shared/components/ui.js';

export function questionsEditor(draft, questions) {
  return `<form id="analysis-form" class="editor-panel padded-form">${questions.map((q, index) => `<div class="question-field"><label for="answer-${index}"><span class="question-index">${index + 1}</span>${e(q.prompt)}</label><p id="reason-${index}" class="input-hint">${e(q.reason)}</p><textarea id="answer-${index}" name="${e(q.id)}" aria-describedby="reason-${index}" rows="4" maxlength="8000" placeholder="본인이 맡은 역할, 실제로 한 일, 확인 가능한 결과를 적어주세요. 관련 경험이 없다면 비워두어도 괜찮습니다.">${e(draft.answers?.[q.id] || '')}</textarea></div>`).join('') || '<p class="input-hint">추가 질문 없이 현재 이력서와 공고로 분석할 수 있습니다.</p>'}<div class="form-actions"><a class="back-link" href="#/job">공고 수정</a><button class="button primary" type="submit">모의지원 결과 확인 ${icon('arrow',18)}</button></div></form>`;
}
