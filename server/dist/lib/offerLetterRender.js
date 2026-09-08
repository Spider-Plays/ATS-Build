import { DEFAULT_OFFER_LETTER_TEMPLATE, mergeOfferLetterTemplate, } from './offerLetterTemplate.js';
import { getOfferLetterLogoHtml } from './offerBrandAssets.js';
import { amountToIndianWords, formatIndianCurrency } from './numberToWords.js';
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br/>');
}
function formatLongDate(d) {
    return d.toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}
function formatShortDate(d) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtNum(n) {
    return Math.round(n).toLocaleString('en-IN');
}
function compensationTableHtml(b) {
    const row = (label, annual, monthly, bold = false) => `<tr${bold ? ' style="font-weight:bold;background:#f8fafc;"' : ''}>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;">${escapeHtml(label)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">${fmtNum(annual)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">${fmtNum(monthly)}</td>
    </tr>`;
    const rows = [
        `<tr style="background:#1a5fb4;color:#fff;font-weight:bold;">
      <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:left;">Head</th>
      <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;">Annual</th>
      <th style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right;">Monthly</th>
    </tr>`,
    ];
    for (const e of b.earnings)
        rows.push(row(e.label, e.annual, e.monthly));
    rows.push(row(b.gross.label, b.gross.annual, b.gross.monthly, true));
    for (const e of b.employerContributions)
        rows.push(row(e.label, e.annual, e.monthly));
    rows.push(row(b.totalCtc.label, b.totalCtc.annual, b.totalCtc.monthly, true));
    for (const e of b.employeeDeductions)
        rows.push(row(e.label, e.annual, e.monthly));
    rows.push(row(b.totalDeduction.label, b.totalDeduction.annual, b.totalDeduction.monthly, true));
    rows.push(row(b.netPay.label, b.netPay.annual, b.netPay.monthly, true));
    return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin:16px 0;">${rows.join('')}</table>`;
}
function letterhead(org) {
    const subtitle = org.legalEntityName?.trim();
    return getOfferLetterLogoHtml(subtitle || undefined);
}
function offerPage(inner) {
    return `<section class="offer-page">${inner}</section>`;
}
const OFFER_LETTER_STYLES = `
  @page {
    size: A4;
    margin: 18mm 16mm 20mm 16mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.55;
    color: #1e293b;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .offer-page {
    page-break-after: always;
    break-after: page;
    padding: 0;
  }
  .offer-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  @media screen {
    body {
      background: #e2e8f0;
      padding: 20px 12px 32px;
    }
    .offer-page {
      page-break-after: auto;
      break-after: auto;
      width: 210mm;
      max-width: 100%;
      min-height: 297mm;
      margin: 0 auto 20px;
      padding: 18mm 16mm;
      background: #fff;
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.1);
    }
  }
  h2 { font-size: 16px; margin: 16px 0 12px; color: #1a5fb4; }
  h3 {
    font-size: 13px;
    margin: 18px 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    page-break-after: avoid;
    break-after: avoid;
  }
  p { margin: 0 0 12px; orphans: 3; widows: 3; }
  mark { background-color: #fef08a; padding: 0 1px; }
  strong, b { font-weight: 700; }
  u { text-decoration: underline; }
  em, i { font-style: italic; }
  table { page-break-inside: avoid; break-inside: avoid; }
  .sig-row {
    margin-top: 48px;
    display: flex;
    justify-content: space-between;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .sig-block {
    width: 45%;
    border-top: 1px solid #94a3b8;
    padding-top: 8px;
    font-size: 12px;
  }
`;
function applyClausePlaceholders(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
function variablePayBlockHtml(amount) {
    if (amount == null || amount <= 0)
        return '';
    const formatted = formatIndianCurrency(amount);
    return `<p>In addition, you will be eligible for variable pay of up to <strong>${escapeHtml(formatted)}</strong> per annum, subject to company policy and your performance.</p>`;
}
export function renderOfferLetterHtml(ctx) {
    const letterTemplate = mergeOfferLetterTemplate(ctx.template ?? DEFAULT_OFFER_LETTER_TEMPLATE);
    const org = letterTemplate.orgSettings;
    const letterDate = ctx.letterDate ?? new Date();
    const joiningFormatted = formatLongDate(ctx.joiningDate);
    const ctcFormatted = formatIndianCurrency(ctx.annualCtc);
    const ctcWords = amountToIndianWords(ctx.annualCtc);
    const compTable = compensationTableHtml(ctx.breakdown);
    const variablePay = ctx.variablePay != null && ctx.variablePay > 0 ? ctx.variablePay : null;
    const variablePayBlock = variablePayBlockHtml(variablePay);
    const variablePayFormatted = variablePay != null ? escapeHtml(formatIndianCurrency(variablePay)) : '';
    const timesheetAddress = org.timesheetAddress?.trim() ?? '';
    const returnAddress = org.returnAddress?.trim() ?? '';
    const vars = {
        candidateName: escapeHtml(ctx.candidateName),
        candidateAddress: escapeHtml(ctx.candidateAddress),
        positionTitle: escapeHtml(ctx.positionTitle),
        clientSiteAddress: escapeHtml(ctx.clientSiteAddress),
        clientCompanyName: escapeHtml(ctx.clientCompanyName),
        joiningDateFormatted: escapeHtml(joiningFormatted),
        reportingTime: escapeHtml(ctx.reportingTime ?? org.reportingTime),
        ctcFormatted: escapeHtml(ctcFormatted),
        ctcWords: escapeHtml(ctcWords),
        compensationTable: compTable,
        variablePayBlock,
        variablePayFormatted,
        acceptanceDeadlineDays: String(ctx.acceptanceDeadlineDays ?? org.acceptanceDeadlineDays),
        returnAddressSuffix: returnAddress ? ' to the following address' : '',
        returnAddressBlock: returnAddress ? `<p>${escapeHtml(returnAddress)}</p>` : '',
        letterDateFormatted: escapeHtml(formatShortDate(letterDate)),
        timesheetAddressSuffix: timesheetAddress ? ' to the following address' : '',
        timesheetAddressBlock: timesheetAddress ? `<p>${escapeHtml(timesheetAddress)}</p>` : '',
        reviewPeriodMonths: String(org.reviewPeriodMonths),
        annualLeaveDays: String(org.annualLeaveDays),
        noticePeriodDays: String(org.noticePeriodDays),
    };
    const pages = [];
    pages.push(offerPage(`
    ${letterhead(org)}
    ${applyClausePlaceholders(letterTemplate.coverPageHtml, vars)}
  `));
    letterTemplate.clausePages.forEach((clausePage, index) => {
        const body = applyClausePlaceholders(clausePage, vars);
        if (index === 0) {
            const intro = applyClausePlaceholders(letterTemplate.agreementIntroHtml, vars);
            pages.push(offerPage(`${letterhead(org)}${intro}${body}`));
        }
        else {
            pages.push(offerPage(`${letterhead(org)}${body}`));
        }
    });
    pages.push(offerPage(`
    ${letterhead(org)}
    ${applyClausePlaceholders(letterTemplate.declarationPageHtml, vars)}
  `));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Offer Letter — ${escapeHtml(ctx.candidateName)}</title>
  <style>${OFFER_LETTER_STYLES}</style>
</head>
<body>
  ${pages.join('\n')}
</body>
</html>`;
}
export function buildLetterMetaJson(ctx) {
    return JSON.stringify(ctx);
}
export function parseLetterMetaJson(raw) {
    if (!raw)
        return {};
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
