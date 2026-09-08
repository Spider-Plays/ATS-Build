const RATING_LABELS = {
    0: 'Not Assessed',
    1: '1 - Needs Improvement',
    2: '2 - Below Expectations',
    3: '3 - Meets Expectations',
    4: '4 - Exceeds Expectations',
    5: '5 - Outstanding',
};
const REC_LABELS = {
    STRONG_HIRE: 'Strong Hire',
    HIRE: 'Hire',
    ON_HOLD: 'On Hold',
    NO_HIRE: 'No Hire',
    STRONG_NO_HIRE: 'Strong No Hire',
};
const COMPETENCY_TOPICS = [
    'Ability to understand technical questions at 1st go?',
    'Problem solving and Critical Thinking?',
    'Attention to Detail?',
    'Ability to troubleshoot, debug code & log analysis?',
    'Overall communication Skills?',
    'Current Project understanding?',
    'General Technical Awareness of current industry?',
    'Innovation and Process improvement?',
];
function parseFormData(raw) {
    try {
        return JSON.parse(raw || '{}');
    }
    catch {
        return {};
    }
}
function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function buildFeedbackReportHtml(feedback, meta) {
    const form = parseFormData(feedback.formData);
    const skillList = form.skillAssessment ?? [];
    const skills = skillList.length > 0
        ? skillList
        : Array.from({ length: 5 }, () => ({
            skillAssessed: '',
            expectedProficiency: 'Not Assessed',
            possessProficiency: 'Not Assessed',
            rating: 0,
            remarks: '',
        }));
    const competencies = form.competencies?.length === COMPETENCY_TOPICS.length
        ? form.competencies
        : COMPETENCY_TOPICS.map((topic) => ({
            topic,
            rating: 0,
            remarks: '',
        }));
    const skillRows = skills
        .map((r) => `<tr>
      <td>${esc(r.skillAssessed || '—')}</td>
      <td>${esc(r.expectedProficiency || 'Not Assessed')}</td>
      <td>${esc(r.possessProficiency || 'Not Assessed')}</td>
      <td>${esc(RATING_LABELS[r.rating ?? 0] ?? 'Not Assessed')}</td>
      <td>${esc(r.remarks || '—')}</td>
    </tr>`)
        .join('');
    const compRows = competencies
        .map((r) => `<tr>
      <td>${esc(r.topic || '')}</td>
      <td>${esc(RATING_LABELS[r.rating ?? 0] ?? 'Not Assessed')}</td>
      <td>${esc(r.remarks || '—')}</td>
    </tr>`)
        .join('');
    const submitted = feedback.createdAt.toLocaleString();
    const rec = REC_LABELS[feedback.recommendation] ?? feedback.recommendation;
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Interview Feedback - ${esc(meta.candidateName)}</title>
<style>
body{font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:40px;color:#1a1a1a}
h1{font-size:16pt;border-bottom:2px solid #1a2b3c;padding-bottom:8px}
h2{font-size:12pt;margin-top:24px;color:#1a2b3c}
table{width:100%;border-collapse:collapse;margin:8px 0 16px}
th,td{border:1px solid #999;padding:8px;text-align:left;vertical-align:top}
th{background:#f0f4f8}
.overall{border:1px solid #999;padding:12px;background:#fafafa}
</style></head><body>
<h1>Interview Feedback Form</h1>
<p><strong>Candidate:</strong> ${esc(meta.candidateName)}${meta.candidateRole ? ` — ${esc(meta.candidateRole)}` : ''}</p>
<p><strong>Interview:</strong> ${esc(meta.interviewType)} · ${esc(meta.interviewDate)}</p>
${meta.jobTitle ? `<p><strong>Position:</strong> ${esc(meta.jobTitle)}</p>` : ''}
<p><strong>Interviewer:</strong> ${esc(meta.interviewerName)}</p>
<p><strong>Submitted:</strong> ${esc(submitted)}</p>
<h2>Overall Feedback</h2>
<div class="overall"><p><strong>Recommendation:</strong> ${esc(rec)}</p>
<p><strong>Comments:</strong></p><p>${esc(feedback.comments).replace(/\n/g, '<br/>')}</p></div>
<h2>Skill Assessment</h2>
<table><thead><tr><th>Skill Assessed</th><th>Expected Proficiency</th><th>Possess Proficiency</th><th>Rating</th><th>Remarks / Comments</th></tr></thead>
<tbody>${skillRows}</tbody></table>
<h2>Standard Competency Description</h2>
<table><thead><tr><th>Topic</th><th>Rating</th><th>Remarks / Comments</th></tr></thead>
<tbody>${compRows}</tbody></table>
</body></html>`;
}
