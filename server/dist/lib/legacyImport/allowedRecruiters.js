/**
 * Canonical TA recruiters kept in ATS after legacy cleanup.
 * Everyone else who "owned" a candidate is treated as an employee referral.
 */
import { isSamePersonName, normalizePersonName, personNameTokens } from './ensureStitchUser.js';
/** Display names from SharePoint Recruiter choices + Alankar. */
export const ALLOWED_RECRUITER_NAMES = [
    'Employee Referral',
    'Pooja M C',
    'Sachin S',
    'Smitha Shastri',
    'Suma S',
    'TA',
    'Pravin Christo Peter Selvaraj',
    'Karthik V C',
    'Shrinath',
    'Izel Saveeno Dsouza',
    'Alankar',
];
/** Extra aliases seen in CSV / DB that should map to a keeper. */
const KEEPER_ALIASES = {
    'Sachin S': ['Sachin S Kulkarni', 'Sachin'],
    'Suma S': ['Suma biradar', 'Suma Biradar', 'Suma'],
    Alankar: ['Alankar C', 'Alankar'],
    'Pooja M C': ['Pooja'],
    'Karthik V C': ['Karthik'],
    'Pravin Christo Peter Selvaraj': ['Pravin', 'Pravin Christo', 'Pravin Selvaraj'],
    'Izel Saveeno Dsouza': ['Izel', 'Izel Dsouza'],
    'Smitha Shastri': ['Smitha'],
    Shrinath: ['Shrinath'],
    TA: ['TA'],
    'Employee Referral': ['Employee Referral', 'Employee Referrals', 'Referral'],
};
/** Official TA mailbox per keeper (TA recruiter list). Import users get these instead of stitch emails. */
export const RECRUITER_EMAILS = {
    'Pooja M C': 'pooja.mc@igsglobal.com',
    'Smitha Shastri': 'smitha.shastri@igsglobal.com',
    'Karthik V C': 'karthik.vc@igsglobal.com',
    'Pravin Christo Peter Selvaraj': 'pravin.christo@igsglobal.com',
    Shrinath: 'shrinath@igsglobal.com',
    'Izel Saveeno Dsouza': 'izelsaveeno.dsouza@igsglobal.com',
    'Sachin S': 'sachin.s@igsglobal.com',
    'Suma S': 'suma.s@igsglobal.com',
};
/** Keepers that share another recruiter's mailbox, so their rows are owned by that account. */
export const RECRUITER_OWNER_ALIASES = {
    'Employee Referral': 'Sachin S',
};
export const EMPLOYEE_REFERRAL_NAME = 'Employee Referral';
export const EMPLOYEE_REFERRAL_SOURCE = 'Employee Referral';
function tokensKey(name) {
    return personNameTokens(name).join(' ');
}
/** True when `name` is one of the allowed recruiters (including aliases / short forms). */
export function isAllowedRecruiterName(name) {
    const n = normalizePersonName(name);
    if (!n)
        return false;
    for (const keeper of ALLOWED_RECRUITER_NAMES) {
        if (isSamePersonName(n, keeper))
            return true;
        const aliases = KEEPER_ALIASES[keeper] ?? [];
        for (const alias of aliases) {
            if (isSamePersonName(n, alias) || tokensKey(n) === tokensKey(alias))
                return true;
        }
        // First-token match for single-token keepers / known full names (Alankar C, etc.)
        const nt = personNameTokens(n);
        const kt = personNameTokens(keeper);
        if (kt.length === 1 && nt[0] === kt[0] && kt[0].length >= 3)
            return true;
    }
    return false;
}
/** Map a free-text Recruiter cell to a keeper display name, or null → Employee Referral. */
export function resolveAllowedRecruiterName(name) {
    const n = normalizePersonName(name);
    if (!n)
        return null;
    if (!isAllowedRecruiterName(n))
        return null;
    for (const keeper of ALLOWED_RECRUITER_NAMES) {
        if (isSamePersonName(n, keeper))
            return keeper;
        const aliases = KEEPER_ALIASES[keeper] ?? [];
        for (const alias of aliases) {
            if (isSamePersonName(n, alias) || tokensKey(n) === tokensKey(alias))
                return keeper;
        }
        const nt = personNameTokens(n);
        const kt = personNameTokens(keeper);
        if (kt.length === 1 && nt[0] === kt[0] && kt[0].length >= 3)
            return keeper;
    }
    return EMPLOYEE_REFERRAL_NAME;
}
