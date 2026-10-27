/**
 * Sends every sample email through Resend (never M365) to one inbox for design review.
 *   npm run email:send-samples -- someone@example.com
 */
import { Resend } from 'resend';
import { env } from '../config/env.js';
import { getEmailBrandInlineAttachments } from './assets.js';
import { samples } from './samples.js';
const to = process.argv[2]?.trim();
if (!to || !to.includes('@')) {
    console.error('Usage: npm run email:send-samples -- <recipient@example.com>');
    process.exit(1);
}
if (!env.resendApiKey) {
    console.error('RESEND_API_KEY is not set.');
    process.exit(1);
}
const resend = new Resend(env.resendApiKey);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sent = 0;
for (const [index, sample] of samples.entries()) {
    const label = `[${index + 1}/${samples.length}] ${sample.group} · ${sample.name}`;
    const { data, error } = await resend.emails.send({
        from: env.emailFrom,
        to,
        subject: `[Design preview ${index + 1}/${samples.length}] ${sample.email.subject}`,
        html: sample.email.html,
        attachments: getEmailBrandInlineAttachments(sample.email.html).map((image) => ({
            filename: image.filename,
            content: image.content,
            contentType: image.contentType,
            contentId: image.cid,
        })),
    });
    if (error)
        console.error(`${label} — failed: ${error.message}`);
    else {
        sent += 1;
        console.log(`${label} — sent ${data?.id ?? ''}`);
    }
    await pause(700); // Resend allows ~2 requests/second.
}
console.log(`Sent ${sent} of ${samples.length} emails to ${to} via Resend.`);
process.exit(sent === samples.length ? 0 : 1);
