import sanitizeHtml from 'sanitize-html';
/**
 * Allowlist for admin-authored rich HTML (offer-letter clauses, mail bodies).
 * Keeps formatting and tables; drops scripts, frames, event handlers and non-data URLs.
 */
const RICH_TEXT_OPTIONS = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'span', 'u', 'h1', 'h2', 'font']),
    allowedAttributes: {
        '*': ['style', 'class', 'align'],
        img: ['src', 'alt', 'width', 'height'],
        a: ['href', 'name', 'target'],
        td: ['colspan', 'rowspan', 'width'],
        th: ['colspan', 'rowspan', 'width'],
        table: ['width', 'cellpadding', 'cellspacing', 'border'],
    },
    allowedSchemes: ['https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
};
export function sanitizeRichHtml(html) {
    return sanitizeHtml(html, RICH_TEXT_OPTIONS);
}
