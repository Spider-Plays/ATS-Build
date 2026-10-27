import { z } from 'zod';
/**
 * Optional profile link. Anything with a URL scheme must be http(s); a bare "linkedin.com/in/x"
 * is still accepted. Blocks javascript:, data: and similar before they are stored and rendered as links.
 */
export const httpUrlOptional = z
    .string()
    .max(500)
    .optional()
    .refine((value) => {
    if (!value)
        return true;
    // Browsers ignore whitespace and control characters inside a scheme ("java\tscript:").
    const compact = value.replace(/[\u0000-\u0020]/g, '');
    return !/^[a-z][a-z0-9+.-]*:/i.test(compact) || /^https?:/i.test(compact);
}, 'Enter a valid http(s) link');
