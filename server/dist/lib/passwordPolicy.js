import { z } from 'zod';
/** bcrypt work factor for all new password hashes. */
export const BCRYPT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
const COMMON_PASSWORDS = new Set([
    'password1234', 'password12345', 'password123!', 'passwordpassword', '123456789012', '1234567890ab',
    'qwertyuiop12', 'qwerty123456', 'iloveyou1234', 'welcome12345', 'welcome@1234', 'admin1234567',
    'administrator', 'changeme1234', 'letmein12345', 'stitchats123', 'stitch@12345', 'igsglobal123',
    'p@ssw0rd1234', 'password@123', 'abcdefghijkl', 'aaaaaaaaaaaa', '111111111111', 'password@1234',
    'welcome@12345', 'admin@123456', 'qwerty@12345', 'p@ssword1234', 'passw0rd@123', 'india@123456',
]);
/** Words that make a password guessable regardless of decoration (case/leet-insensitive substring). */
const BANNED_WORDS = ['password', 'passw0rd', 'p@ssw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'igsglobal', 'stitch'];
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiopasdfghjklzxcvbnm'];
function deLeet(v) {
    return v.toLowerCase().replace(/@/g, 'a').replace(/0/g, 'o').replace(/[1!]/g, 'i').replace(/3/g, 'e').replace(/\$/g, 's');
}
function hasSequence(v, run = 4) {
    const s = v.toLowerCase();
    for (const seq of SEQUENCES) {
        const rev = [...seq].reverse().join('');
        for (let i = 0; i + run <= seq.length; i++) {
            if (s.includes(seq.slice(i, i + run)) || s.includes(rev.slice(i, i + run)))
                return true;
        }
    }
    return false;
}
/** Enterprise complexity rules; returns the first violation message, or null when the password passes. */
export function passwordPolicyError(v) {
    if (v.length < MIN_PASSWORD_LENGTH)
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    if (v.length > MAX_PASSWORD_LENGTH)
        return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
    if (/^\s|\s$/.test(v))
        return 'Password cannot start or end with a space';
    if (!/[a-z]/.test(v))
        return 'Password must include a lowercase letter';
    if (!/[A-Z]/.test(v))
        return 'Password must include an uppercase letter';
    if (!/\d/.test(v))
        return 'Password must include a number';
    if (!/[^A-Za-z0-9\s]/.test(v))
        return 'Password must include a special character';
    if (/(.)\1\1/.test(v))
        return 'Password cannot repeat the same character 3 or more times in a row';
    if (hasSequence(v))
        return 'Password cannot contain sequences like "1234", "abcd" or "qwer"';
    if (new Set(v).size < 6)
        return 'Password must use at least 6 different characters';
    const lower = v.toLowerCase();
    const plain = deLeet(v);
    if (COMMON_PASSWORDS.has(lower) || BANNED_WORDS.some((w) => lower.includes(w) || plain.includes(deLeet(w)))) {
        return 'This password is too common or easy to guess';
    }
    return null;
}
/** Rejects passwords that contain the person's name or email local part. */
export function personalInfoPasswordError(password, info) {
    const pw = password.toLowerCase();
    const plain = deLeet(password);
    const tokens = [
        ...(info.email ? info.email.toLowerCase().split('@')[0].split(/[^a-z0-9]+/) : []),
        ...(info.name ? info.name.toLowerCase().split(/[^a-z0-9]+/) : []),
    ].filter((t) => t.length >= 3);
    if (tokens.some((t) => pw.includes(t) || plain.includes(t))) {
        return 'Password cannot contain your name or email address';
    }
    return null;
}
/** Rules for any password a person chooses (registration, change, reset, admin-set). */
export const newPasswordSchema = z.string().superRefine((v, ctx) => {
    const error = passwordPolicyError(v);
    if (error)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
});
