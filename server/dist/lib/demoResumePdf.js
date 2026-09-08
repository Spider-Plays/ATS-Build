import { renderHtmlToPdf } from './offerPdf.js';
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
export function demoResumeHtml(fields) {
    const skills = [...(fields.primarySkills ?? []), ...(fields.secondarySkills ?? [])];
    const skillTags = skills
        .slice(0, 12)
        .map((s) => `<span class="tag">${escapeHtml(s)}</span>`)
        .join('');
    const summary = escapeHtml(fields.summary).replace(/\n/g, '<br/>');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      color: #1a2b3c;
      background: #fff;
    }
    .page {
      padding: 48px 52px;
      min-height: 100vh;
    }
    .brand {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #5c6b7a;
      margin-bottom: 28px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 30px;
      font-weight: 700;
      line-height: 1.15;
    }
    .headline {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 15px;
      color: #2f5f8f;
      margin-bottom: 14px;
      font-weight: 600;
    }
    .meta {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      color: #4a5b6c;
      margin-bottom: 28px;
      line-height: 1.6;
    }
    h2 {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #2f5f8f;
      border-bottom: 1px solid #d7e0ea;
      padding-bottom: 6px;
      margin: 0 0 12px;
    }
    .summary {
      font-size: 13px;
      line-height: 1.65;
      margin-bottom: 24px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 24px;
    }
    .tag {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      background: #eef4fa;
      color: #234;
      padding: 5px 10px;
      border-radius: 999px;
    }
    .note {
      margin-top: 36px;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      color: #8a97a5;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand">Stitch ATS · Demo Resume</div>
    <h1>${escapeHtml(fields.name)}</h1>
    <div class="headline">${escapeHtml(fields.role)}</div>
    <div class="meta">
      ${escapeHtml(fields.email)}${fields.location ? `<br/>${escapeHtml(fields.location)}` : ''}
    </div>
    <h2>Professional Summary</h2>
    <div class="summary">${summary}</div>
    ${skillTags
        ? `<h2>Core Skills</h2><div class="tags">${skillTags}</div>`
        : ''}
    <div class="note">Sample resume generated for Stitch ATS demo data.</div>
  </div>
</body>
</html>`;
}
export function demoResumeFileName(name) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return `${slug || 'candidate'}-resume.pdf`;
}
export async function renderDemoCandidateResumePdf(fields) {
    return renderHtmlToPdf(demoResumeHtml(fields));
}
