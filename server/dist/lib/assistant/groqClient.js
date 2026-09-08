import { env } from '../../config/env.js';
export function isGroqConfigured() {
    return Boolean(env.groqApiKey);
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
