import { randomInt } from 'crypto';
import { passwordPolicyError } from './passwordPolicy.js';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!#$%*+-=?@_';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;
/** Random temporary password for invites that always satisfies the password policy. */
export function generateTempPassword(length = 16) {
    for (;;) {
        const chars = [LOWER, UPPER, DIGITS, SYMBOLS].map((set) => set[randomInt(set.length)]);
        while (chars.length < length)
            chars.push(ALL[randomInt(ALL.length)]);
        for (let i = chars.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        const pw = chars.join('');
        if (!passwordPolicyError(pw))
            return pw;
    }
}
