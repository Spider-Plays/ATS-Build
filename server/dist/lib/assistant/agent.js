import { groqChatCompletion, isGroqConfigured } from './groqClient.js';
import { ASSISTANT_EXAMPLE_QUESTIONS } from './intents.js';
import { runAssistantQuestion } from './tools.js';
import { ASSISTANT_GROQ_TOOLS, executeAssistantTool, } from './toolRegistry.js';
const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY = 8;
function systemPrompt(auth) {
    return [
        'You are the Stitch ATS staff assistant.',
        `The signed-in user has role ${auth.role} (email ${auth.email}).`,
        'Answer questions about live ATS data and how to navigate the application.',
        'Use tools for any counts, lists, searches, or navigation guidance. Never invent IDs, counts, or names.',
        'Respect tool results: data is already scoped to what this user can see.',
        'You cannot create, edit, approve, delete, or send anything — read-only only.',
        'Company policies/handbooks are not stored in the ATS; say so and offer relevant app navigation or live data instead.',
        'Be concise and conversational. Use **bold** for key numbers.',
        'When tools return items/links, summarize clearly and invite a follow-up.',
        'If a tool says admin-only or forbidden, explain politely without leaking data.',
        'End with at most 3 short suggested next questions when helpful.',
    ].join(' ');
}
function mergeUiExtras(results) {
    const links = [];
    const items = [];
    const followUps = [];
    const seenHref = new Set();
    const seenItem = new Set();
    for (const r of results) {
        for (const link of r.links || []) {
            const key = `${link.href}|${link.label}`;
            if (seenHref.has(key))
                continue;
            seenHref.add(key);
            links.push(link);
        }
        for (const item of r.items || []) {
            if (seenItem.has(item.id))
                continue;
            seenItem.add(item.id);
            items.push(item);
        }
        for (const f of r.followUps || []) {
            if (!followUps.includes(f))
                followUps.push(f);
        }
    }
    return {
        links: links.slice(0, 6),
        items: items.slice(0, 8),
        followUps: followUps.slice(0, 5),
    };
}
function extractFollowUpsFromText(text) {
    const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l));
    const picks = lines
        .map((l) => l.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').replace(/^["']|["']$/g, ''))
        .filter((l) => l.length > 3 && l.length < 80 && /\?$/.test(l));
    return picks.slice(0, 3);
}
export async function runAssistantAgent(auth, question, options) {
    if (!isGroqConfigured()) {
        return runAssistantQuestion(auth, question, options?.context ?? null);
    }
    const history = (options?.history || [])
        .filter((m) => m.content?.trim())
        .slice(-MAX_HISTORY)
        .map((m) => ({
        role: m.role,
        content: m.content.trim().slice(0, 2000),
    }));
    const messages = [
        { role: 'system', content: systemPrompt(auth) },
        ...history.map((m) => ({
            role: m.role,
            content: m.content,
        })),
        { role: 'user', content: question.trim() },
    ];
    const collected = [];
    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const msg = await groqChatCompletion({
                messages,
                tools: ASSISTANT_GROQ_TOOLS,
                toolChoice: 'auto',
            });
            if (msg.tool_calls?.length) {
                messages.push({
                    role: 'assistant',
                    content: msg.content,
                    tool_calls: msg.tool_calls,
                });
                for (const call of msg.tool_calls) {
                    let result;
                    try {
                        result = await executeAssistantTool(auth, call.function.name, call.function.arguments || '{}');
                    }
                    catch (toolErr) {
                        console.error('[assistant/agent] tool error:', call.function.name, toolErr);
                        result = {
                            ok: false,
                            summary: `Tool ${call.function.name} failed. Try a different question.`,
                        };
                    }
                    collected.push(result);
                    messages.push({
                        role: 'tool',
                        tool_call_id: call.id,
                        name: call.function.name,
                        content: JSON.stringify(result),
                    });
                }
                continue;
            }
            const answerText = (msg.content || '').trim() ||
                'I looked that up, but I do not have more detail to share. Try rephrasing, or ask for a quick overview.';
            const extras = mergeUiExtras(collected);
            const fromText = extractFollowUpsFromText(answerText);
            const followUps = extras.followUps.length > 0
                ? extras.followUps
                : fromText.length > 0
                    ? fromText
                    : [...ASSISTANT_EXAMPLE_QUESTIONS.slice(0, 4)];
            return {
                intent: collected.length ? 'groq_tools' : 'groq',
                answer: answerText,
                links: extras.links,
                items: extras.items.length ? extras.items : undefined,
                followUps,
                context: {
                    lastIntent: 'groq_tools',
                    ...(options?.context || {}),
                },
            };
        }
        // Force a final answer without more tools
        messages.push({
            role: 'user',
            content: 'Please answer now using the tool results already provided. Do not call more tools.',
        });
        const finalMsg = await groqChatCompletion({
            messages,
            tools: ASSISTANT_GROQ_TOOLS,
            toolChoice: 'none',
        });
        const extras = mergeUiExtras(collected);
        return {
            intent: 'groq_tools',
            answer: (finalMsg.content || '').trim() ||
                'Here is what I found from the ATS tools. Ask a follow-up if you need more detail.',
            links: extras.links,
            items: extras.items.length ? extras.items : undefined,
            followUps: extras.followUps.length > 0
                ? extras.followUps
                : [...ASSISTANT_EXAMPLE_QUESTIONS.slice(0, 4)],
            context: { lastIntent: 'groq_tools' },
        };
    }
    catch (err) {
        console.error('[assistant/agent] Groq failed, using structured fallback:', err);
        return runAssistantQuestion(auth, question, options?.context ?? null);
    }
}
