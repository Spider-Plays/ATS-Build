/**
 * Stitch email templates — everything that decides how an email looks.
 *
 *   tokens.ts     colours, fonts, per-audience accents
 *   assets.ts     inline logo images (CID) and the brand lockup
 *   blocks.ts     content building blocks (details, buttons, callouts, …)
 *   layout.ts     Portal layout (candidate / vendor / referral) and Tonal layout (staff)
 *   templates.ts  one render function per email
 *   workflow.ts   renders admin-editable workflow mail text into blocks
 *   preview.ts    `npm run email:preview` — writes every email to server/.cache/email-preview
 *
 * Sending lives in services/email.ts.
 */
export * from './templates.js';
export { renderEmail } from './layout.js';
export { renderBlocks } from './blocks.js';
export { fillTemplate, renderWorkflowBodyHtml, renderWorkflowEmail, workflowBodyBlocks } from './workflow.js';
export { brandLockupHtml, getEmailBrandInlineAttachments, getStitchMarkPng, inlineBrandImagesAsDataUris } from './assets.js';
export { ACCENTS, C as EMAIL_COLORS, FONT as EMAIL_FONT } from './tokens.js';
