import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
import { assistantRateLimiter } from '../middleware/rateLimit.js';
import { runAssistantAgent } from '../lib/assistant/agent.js';
import { ASSISTANT_EXAMPLE_QUESTIONS } from '../lib/assistant/intents.js';
import { isGroqConfigured } from '../lib/assistant/groqClient.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
const contextSchema = z
    .object({
    lastIntent: z.string().optional(),
    candidateStatus: z.string().optional(),
    offerStep: z.enum(['hr', 'exec', 'chain', 'all']).optional(),
    searchQuery: z.string().optional(),
    userRoleFilter: z.string().optional(),
})
    .passthrough()
    .optional()
    .nullable();
const historySchema = z
    .array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(2000),
}))
    .max(8)
    .optional()
    .nullable();
const askSchema = z.object({
    question: z.string().trim().min(1).max(500),
    context: contextSchema,
    history: historySchema,
});
router.get('/examples', (_req, res) => {
    res.json({
        examples: ASSISTANT_EXAMPLE_QUESTIONS,
        groqEnabled: isGroqConfigured(),
    });
});
router.post('/ask', assistantRateLimiter, async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Question is required (max 500 characters).' });
    }
    try {
        const result = await runAssistantAgent(req.auth, parsed.data.question, {
            history: parsed.data.history ?? null,
            context: parsed.data.context ?? null,
        });
        res.json(result);
    }
    catch (err) {
        console.error('[assistant/ask]', err);
        res.json({
            intent: 'error',
            answer: "Something went wrong looking that up. Try again, or ask “help” for examples I can answer.",
            links: [{ label: 'Dashboard', href: '/' }],
            followUps: [
                'Give me a quick overview',
                'How many candidates in interview?',
                'Help',
            ],
        });
    }
});
export default router;
