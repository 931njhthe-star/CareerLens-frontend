import { escapeHtml as e, icon } from '../shared/components/ui.js';

export function opportunitiesPage() {
  return `
    <div class="page-heading opportunities-heading"><div>
      <h1>어떤 공고에 지원해 볼까요?</h1>
      <p>희망 직무와 관련된 공고를 비교하고, 모의지원할 공고를 선택하세요.</p>
    </div><a class="back-link" href="#/desired-role">희망 직무 수정</a></div>
    <section class="opportunities" aria-label="희망 직무별 채용공고">
      <aside class="opportunities__sidebar" aria-label="채용공고 목록">
        <div class="opportunities__list-heading"><h2 id="opportunity-role">채용공고</h2><p id="opportunity-count" role="status">목록을 불러오는 중…</p></div>
        <div id="opportunity-list" class="opportunities__list" aria-busy="true"></div>
        <nav id="opportunity-pagination" class="opportunities__pagination" aria-label="공고 페이지"></nav>
      </aside>
      <article id="opportunity-detail" class="opportunities__detail" aria-label="선택한 채용공고 상세" tabindex="-1" aria-busy="true">
        <div class="opportunities__empty"><h2>공고를 준비하고 있어요.</h2><p>목록을 불러온 뒤 상세 내용을 표시합니다.</p></div>
      </article>
    </section>`;
}

export function opportunityList(items, selected) {
  return items
    .map(
      (item) => `
    <button type="button" class="opportunity-row" data-posting-id="${e(item.id)}"
      aria-current="${item.id === selected ? 'true' : 'false'}">
      <span class="opportunity-row__company">${e(item.company)}${item.source_type === 'example' ? '<span class="opportunity-example">가상 공고</span>' : ''}</span>
      <strong>${e(item.role)}</strong>
      <span class="opportunity-row__meta">${e(item.location)} · ${e(item.experience_level)}</span>
      <span class="opportunity-row__skills">${e((item.skills || []).slice(0, 3).join(' · '))}</span>
    </button>`,
    )
    .join('');
}

export function opportunityDetail(posting, user) {
  return `
    <div class="opportunity-detail__header">
      <p class="opportunity-detail__company">${e(posting.company)} ${posting.source_type === 'example' ? '<span class="badge neutral">가상 공고</span>' : ''}</p>
      <h2>${e(posting.role)}</h2>
      <dl class="opportunity-detail__facts">
        <div><dt>근무지</dt><dd>${e(posting.location)}</dd></div>
        <div><dt>경력</dt><dd>${e(posting.experience_level)}</dd></div>
        <div><dt>고용 형태</dt><dd>${e(posting.employment_type)}</dd></div>
      </dl>
      <div class="opportunity-detail__skills">${(posting.skills || []).map((skill) => `<span class="badge neutral">${e(skill)}</span>`).join('')}</div>
    </div>
    <section class="opportunity-detail__body"><h3>담당 업무와 지원 요건</h3><div class="opportunity-description">${e(posting.description)}</div></section>
    <footer class="opportunity-detail__actions">
      <p>${user ? '저장한 이력서를 이 공고의 요구사항과 비교해 모의지원 결과를 확인합니다.' : '비회원도 이 공고로 분석할 수 있어요. 완성된 보고서를 보려면 로그인·회원가입이 필요합니다.'}</p>
      <button id="opportunity-apply" class="button primary workflow-next" type="button">모의지원 결과 확인 ${icon('arrow', 18)}</button>
    </footer>`;
}
