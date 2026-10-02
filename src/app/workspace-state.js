const pageFields = {
  resume: ['resume_text'],
  job: ['company', 'role', 'job_text'],
};

// Each editor overlays only its own fields. Analysis context always comes from
// the server snapshot that was actually saved and used to generate questions.
export function draftForPage(page, savedDraft, edits) {
  if (page === 'result') return savedDraft;
  if (page === 'questions') {
    return { ...savedDraft, answers: { ...savedDraft.answers, ...edits.answers } };
  }
  const draft = { ...savedDraft };
  for (const field of pageFields[page] || []) {
    if (Object.hasOwn(edits, field)) draft[field] = edits[field];
  }
  return draft;
}

export function remainingEdits(edits, savedFields, previousDraft, nextDraft) {
  const next = { ...edits };
  for (const field of savedFields) delete next[field];
  if (previousDraft && nextDraft && ['resume_text', 'company', 'role', 'job_text'].some(
    field => (previousDraft[field] ?? '') !== (nextDraft[field] ?? ''),
  )) {
    delete next.answers;
  }
  return next;
}
