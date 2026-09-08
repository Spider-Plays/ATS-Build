/**
 * Normalize CTC / salary figures to annual INR for reports and imports.
 * Source data mixes per-month, per-annum, LPA, and raw INR.
 */
const MONTHLY_HINT = /per\s*month|\/\s*m(?:o(?:nth)?)?\b|\bpm\b|p\.?\s*m\.?|monthly|pcm|lpm|month\s*ly/i;
const ANNUAL_HINT = /per\s*annum|\/\s*(?:annum|year|yr)\b|\bpa\b|p\.?\s*a\.?|annual|yearly|lpa|lakh|lac|\bcr\b|crore/i;
const LAKH_HINT = /lpa|lakh|lac/i;
const CRORE_HINT = /cr|crore/i;
/**
 * Convert a numeric CTC that may be monthly, LPA, or annual INR → annual INR.
 * Optional `hint` is free text that may contain unit words (e.g. "pm", "LPA").
 */
export function normalizeToAnnualCtcInr(value, hint) {
    if (value == null || !Number.isFinite(value) || value <= 0)
        return 0;
    const text = hint?.trim() ?? '';
    const monthly = text ? MONTHLY_HINT.test(text) : false;
    const annual = text ? ANNUAL_HINT.test(text) : false;
    if (monthly && !annual) {
        // "1.5 LPM" / "2 lakh per month"
        if ((LAKH_HINT.test(text) || /\blpm\b/i.test(text)) && value < 1000) {
            return Math.round(value * 100_000 * 12);
        }
        if (CRORE_HINT.test(text) && value < 1000)
            return Math.round(value * 10_000_000 * 12);
        return Math.round(value * 12);
    }
    if (annual || LAKH_HINT.test(text) || CRORE_HINT.test(text)) {
        if (CRORE_HINT.test(text) && value < 1000)
            return Math.round(value * 10_000_000);
        // Small figures with annual wording are almost always LPA (e.g. "12 per annum", "18 PA")
        if (value < 1000)
            return Math.round(value * 100_000);
        return Math.round(value);
    }
    // Bare number heuristics (no unit text on Offer.annualCtc / baseSalary):
    // - < 1,000 → LPA (e.g. 18)
    // - < 1,00,000 → monthly INR (e.g. 75,000)
    // - else → already annual INR (e.g. 18,00,000)
    if (value < 1_000)
        return Math.round(value * 100_000);
    if (value < 100_000)
        return Math.round(value * 12);
    return Math.round(value);
}
/**
 * Parse a free-text CTC / salary band string to annual INR.
 * Ranges like "₹28–38 LPA" use the upper bound.
 */
export function parseCtcStringToAnnualInr(raw) {
    if (!raw?.trim())
        return 0;
    const s = raw.trim();
    const nums = [...s.replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)/g)]
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n));
    if (nums.length === 0)
        return 0;
    const value = Math.max(...nums);
    return normalizeToAnnualCtcInr(value, s);
}
/** Offer row → annual INR for report aggregation. */
export function offerCtcToAnnualInr(offer) {
    return normalizeToAnnualCtcInr(offer.annualCtc ?? offer.baseSalary ?? 0);
}
