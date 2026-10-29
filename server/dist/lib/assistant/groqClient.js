import { env } from '../../config/env.js';
export function isGroqConfigured() {
    return Boolean(env.groqApiKey);
}
const GROQ_TIMEOUT_MS = 30_000;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone-like runs: optional +country code, then 10+ digits allowing spaces, dots or dashes.
const PHONE_PATTERN = /\+?\d[\d\s.-]{8,}\d/g;
// Indian PAN: five letters, four digits, one letter.
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
/**
 * Contact and identity details (email, phone, PAN) never leave for the external LLM provider;
 * apply to any personal text before it goes into a prompt.
 */
export function maskContactDetails(text) {
    return text
        .replace(EMAIL_PATTERN, '[email]')
        .replace(PAN_PATTERN, '[pan]')
        .replace(PHONE_PATTERN, (match) => (match.replace(/\D/g, '').length >= 10 ? '[phone]' : match));
}
export async function groqChatCompletion(input) {
    if (!env.groqApiKey) {
        throw new Error('GROQ_API_KEY is not configured');
    }
    const body = {
        model: env.groqModel,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
    };
    if (input.tools?.length) {
        body.tools = input.tools;
        body.tool_choice = input.toolChoice ?? 'auto';
    }
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.groqApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        // A stalled upstream must not hold the caller's request (and a worker) open indefinitely.
        signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
    const data = (await res.json());
    if (!res.ok) {
        const msg = data.error?.message || `Groq API error (${res.status})`;
        throw new Error(msg);
    }
    const message = data.choices?.[0]?.message;
    if (!message) {
        throw new Error('Groq returned an empty response');
    }
    return message;
}
