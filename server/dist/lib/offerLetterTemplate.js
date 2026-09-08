import { DEFAULT_ORG_SETTINGS, EMPLOYMENT_CLAUSE_PAGES } from './offerLetterLegal.js';
export const DEFAULT_COVER_PAGE_HTML = `<p><strong>Name:</strong> {{candidateName}}</p>
<p><strong>Address:</strong><br/>{{candidateAddress}}</p>
<p>Dear {{candidateName}},</p>
<p>We are pleased to inform you that based on your application and the subsequent interviews you had, you have been selected for the position of <strong>{{positionTitle}}</strong>.</p>
<p>Your joining date will be <strong>{{joiningDateFormatted}}</strong></p>
<p>On the first day of the employment, please report to:</p>
<p><strong>Company Address:</strong> {{clientSiteAddress}}</p>
<p><strong>Reporting Time:</strong> {{reportingTime}}</p>
<p>You will be paid a gross annual salary of <strong>{{ctcFormatted}}</strong> ({{ctcWords}}).</p>
{{variablePayBlock}}
<p>Your salary composition and other details are listed in the Employment Agreement annexed to this letter. Please indicate your acceptance to the Employment Agreement by signing and returning it within <strong>{{acceptanceDeadlineDays}}</strong> days from the date of this letter{{returnAddressSuffix}}. Please retain the second copy for your records.</p>
{{returnAddressBlock}}
<p>I look forward to welcoming you in our organization.</p>
<p>Should you need any further clarifications, please feel free to contact us.</p>
<div class="sig-row">
  <div class="sig-block">HR Signature</div>
  <div class="sig-block">Candidate Signature</div>
</div>`;
export const DEFAULT_AGREEMENT_INTRO_HTML = `<h2>EMPLOYMENT AGREEMENT</h2>
<h3>COMPENSATION STRUCTURE</h3>
<p>Your individual compensation is strictly between yourself and the Company. It has been determined based on various factors such as your job, skills, specific background and professional merit. This information and any changes therein should be treated as personal and confidential.</p>
<p>Your total annual CTC will be <strong>{{ctcFormatted}}</strong> and its composition will be as follows:</p>
{{compensationTable}}
{{variablePayBlock}}`;
export const DEFAULT_DECLARATION_PAGE_HTML = `<h2>DECLARATION</h2>
<p>This is to confirm that the documents and information provided by me to the Company for the purpose of my services are true and accurate to the best of my knowledge and belief. I also agree that the various terms and conditions set forth in this Agreement are fair, just and reasonable and I shall strictly adhere to the terms specified.</p>
<div class="sig-row" style="margin-top:80px;">
  <div class="sig-block">Signature</div>
  <div class="sig-block">Date<br/>{{letterDateFormatted}}</div>
</div>`;
export const DEFAULT_OFFER_LETTER_TEMPLATE = {
    orgSettings: { ...DEFAULT_ORG_SETTINGS },
    coverPageHtml: DEFAULT_COVER_PAGE_HTML,
    agreementIntroHtml: DEFAULT_AGREEMENT_INTRO_HTML,
    clausePages: [...EMPLOYMENT_CLAUSE_PAGES],
    declarationPageHtml: DEFAULT_DECLARATION_PAGE_HTML,
};
export function mergeOfferLetterTemplate(partial) {
    if (!partial)
        return { ...DEFAULT_OFFER_LETTER_TEMPLATE, clausePages: [...DEFAULT_OFFER_LETTER_TEMPLATE.clausePages] };
    return {
        orgSettings: { ...DEFAULT_OFFER_LETTER_TEMPLATE.orgSettings, ...partial.orgSettings },
        coverPageHtml: partial.coverPageHtml ?? DEFAULT_OFFER_LETTER_TEMPLATE.coverPageHtml,
        agreementIntroHtml: partial.agreementIntroHtml ?? DEFAULT_OFFER_LETTER_TEMPLATE.agreementIntroHtml,
        clausePages: partial.clausePages && partial.clausePages.length > 0
            ? partial.clausePages
            : [...DEFAULT_OFFER_LETTER_TEMPLATE.clausePages],
        declarationPageHtml: partial.declarationPageHtml ?? DEFAULT_OFFER_LETTER_TEMPLATE.declarationPageHtml,
    };
}
