import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { DEV_PASSWORD, DEV_USERS } from '../../config/devUsers.js';
export function createEmptyStitchUserLookup() {
    return { byEmail: new Map(), byName: new Map(), emailName: new Map() };
}
export function normalizePersonName(name) {
    return name.trim().replace(/\s+/g, ' ');
}
/** Lowercase name tokens (spaces/dots/dashes). */
export function personNameTokens(name) {
    return normalizePersonName(name)
        .toLowerCase()
        .replace(/[._\-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}
const PROTECTED_STITCH_EMAILS = new Set(DEV_USERS.map((u) => u.email.trim().toLowerCase()));
/** Dev/demo registry emails must not be renamed or deleted during dedupe. */
export function isProtectedStitchEmail(email) {
    return PROTECTED_STITCH_EMAILS.has(email.trim().toLowerCase());
}
/**
 * Local-part slug: `firstname.lastinitial` (e.g. "Suma S" → `suma.s`).
 * Single-name users use first name only (`suma`).
 */
export function slugFromName(name) {
    const tokens = personNameTokens(name);
    if (tokens.length === 0)
        return 'user';
    const multi = tokens.filter((t) => t.length >= 2);
    const firstname = multi[0] ?? tokens[0];
    let lastInitial = null;
    if (multi.length >= 2) {
        lastInitial = multi[multi.length - 1][0];
    }
    else if (tokens.length >= 2 && tokens[tokens.length - 1].length === 1) {
        lastInitial = tokens[tokens.length - 1][0];
    }
    else if (tokens.length >= 2 && tokens[0].length === 1) {
        lastInitial = tokens[0][0];
    }
    if (lastInitial)
        return `${firstname}.${lastInitial}`;
    return firstname;
}
export function stitchEmailFromName(name) {
    return `${slugFromName(name)}@stitch-ats.in`;
}
/** True when `short` is a proper token-prefix of `full` (e.g. "Pooja" → "Pooja M C"). */
export function isShorterFormOf(short, full) {
    if (/&|\band\b/i.test(full) || /&|\band\b/i.test(short))
        return false;
    const a = personNameTokens(short);
    const b = personNameTokens(full);
    if (a.length === 0 || a.length >= b.length)
        return false;
    if (a.every((t) => t.length < 2))
        return false;
    return a.every((t, i) => t === b[i]);
}
/** Same significant tokens and initials, possibly reordered ("K Jagdish" ≈ "Jagdish K"). */
export function isNameReorder(a, b) {
    const ta = personNameTokens(a);
    const tb = personNameTokens(b);
    const ma = ta.filter((t) => t.length >= 2).sort();
    const mb = tb.filter((t) => t.length >= 2).sort();
    if (ma.length === 0 || ma.length !== mb.length)
        return false;
    const ia = ta.filter((t) => t.length === 1).sort().join('');
    const ib = tb.filter((t) => t.length === 1).sort().join('');
    return ma.every((t, i) => t === mb[i]) && ia === ib;
}
export function isSamePersonName(a, b) {
    if (personNameTokens(a).join(' ') === personNameTokens(b).join(' '))
        return true;
    if (isShorterFormOf(a, b) || isShorterFormOf(b, a))
        return true;
    if (isNameReorder(a, b))
        return true;
    return false;
}
export function isPlaceholderPerson(raw) {
    return !raw.trim() || /^(na|n\/a|nil|null|-|none|select option)$/i.test(raw.trim());
}
export function registerStitchUser(lookup, user, aliases = []) {
    const email = user.email.toLowerCase();
    lookup.byEmail.set(email, user.id);
    lookup.emailName.set(email, user.name.trim().toLowerCase());
    const nameKey = normalizePersonName(user.name).toLowerCase();
    if (nameKey)
        lookup.byName.set(nameKey, user.id);
    for (const alias of aliases) {
        const a = normalizePersonName(alias).toLowerCase();
        if (a)
            lookup.byName.set(a, user.id);
    }
}
export async function loadStitchUserLookup() {
    const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true },
    });
    const lookup = createEmptyStitchUserLookup();
    for (const u of users)
        registerStitchUser(lookup, u);
    return lookup;
}
function namesMatch(a, b) {
    return normalizePersonName(a).toLowerCase() === normalizePersonName(b).toLowerCase();
}
function departmentForRole(role) {
    if (role === 'RECRUITER' || role === 'TEAM_LEAD')
        return 'Talent Acquisition';
    if (role === 'EMPLOYEE')
        return 'Engineering';
    if (role === 'HIRING_MANAGER' || role === 'INTERVIEWER')
        return 'Engineering';
    return 'Operations';
}
function resolveByNamePreferFull(lookup, name) {
    const exact = lookup.byName.get(normalizePersonName(name).toLowerCase());
    if (exact)
        return exact;
    const tokens = normalizePersonName(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (tokens.length === 0)
        return null;
    let bestId = null;
    let bestLen = tokens.length;
    for (const [registeredName, id] of lookup.byName) {
        const regTokens = registeredName
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (regTokens.length <= tokens.length)
            continue;
        if (!tokens.every((t, i) => t === regTokens[i]))
            continue;
        if (regTokens.length > bestLen) {
            bestLen = regTokens.length;
            bestId = id;
        }
    }
    return bestId;
}
/**
 * Find or create a local user. Prefer exact / full-name match.
 * New accounts always get `{name-slug}@stitch-ats.in` with password `password`
 * (sheet emails are not used as login addresses).
 */
export async function ensureStitchUser(lookup, opts) {
    const rawName = opts.name?.trim();
    const name = rawName && !isPlaceholderPerson(rawName) ? normalizePersonName(rawName) : null;
    const emailRaw = opts.email?.trim().toLowerCase();
    const sheetEmail = emailRaw && emailRaw.includes('@') && !isPlaceholderPerson(emailRaw) ? emailRaw : null;
    if (!name && !sheetEmail)
        return null;
    if (name) {
        const byName = resolveByNamePreferFull(lookup, name);
        if (byName) {
            if (rawName)
                lookup.byName.set(rawName.trim().toLowerCase(), byName);
            lookup.byName.set(name.toLowerCase(), byName);
            const knownEmail = [...lookup.byEmail.entries()].find(([, id]) => id === byName)?.[0] ??
                stitchEmailFromName(name);
            return { id: byName, created: false, email: knownEmail };
        }
    }
    // Soft match on existing sheet email if that account already exists and names agree.
    if (sheetEmail) {
        const byEmail = lookup.byEmail.get(sheetEmail);
        if (byEmail) {
            const existingName = lookup.emailName.get(sheetEmail) || '';
            if (!name ||
                namesMatch(existingName, name) ||
                isShorterFormOf(name, existingName) ||
                isShorterFormOf(existingName, name)) {
                if (name) {
                    lookup.byName.set(name.toLowerCase(), byEmail);
                    if (rawName)
                        lookup.byName.set(rawName.trim().toLowerCase(), byEmail);
                }
                return { id: byEmail, created: false, email: sheetEmail };
            }
        }
    }
    const displayName = name ?? sheetEmail.split('@')[0];
    let finalEmail = stitchEmailFromName(displayName);
    if (lookup.byEmail.has(finalEmail)) {
        finalEmail = `${slugFromName(displayName)}.${crypto.randomBytes(2).toString('hex')}@stitch-ats.in`;
    }
    if (opts.dryRun) {
        const dryId = `dry-run-user-${finalEmail}`;
        registerStitchUser(lookup, { id: dryId, email: finalEmail, name: displayName }, [
            rawName ?? '',
            name ?? '',
        ]);
        return { id: dryId, created: true, email: finalEmail };
    }
    const existingByEmail = await prisma.user.findUnique({
        where: { email: finalEmail },
        select: { id: true, email: true, name: true },
    });
    if (existingByEmail) {
        registerStitchUser(lookup, existingByEmail, [rawName ?? '', name ?? '']);
        if (!name ||
            namesMatch(existingByEmail.name, displayName) ||
            isShorterFormOf(name, existingByEmail.name)) {
            return { id: existingByEmail.id, created: false, email: existingByEmail.email };
        }
        if (isShorterFormOf(existingByEmail.name, displayName)) {
            await prisma.user.update({
                where: { id: existingByEmail.id },
                data: { name: displayName },
            });
            registerStitchUser(lookup, { id: existingByEmail.id, email: existingByEmail.email, name: displayName }, [rawName ?? '', name ?? '']);
            return { id: existingByEmail.id, created: false, email: existingByEmail.email };
        }
        finalEmail = `${slugFromName(displayName)}.${crypto.randomBytes(2).toString('hex')}@stitch-ats.in`;
    }
    const passwordHash = opts.passwordHash ?? (await bcrypt.hash(DEV_PASSWORD, 10));
    try {
        const created = await prisma.user.create({
            data: {
                email: finalEmail,
                passwordHash,
                name: displayName,
                role: opts.role,
                department: departmentForRole(opts.role),
                status: 'ACTIVE',
                permissions: '[]',
                themePreference: 'light',
                authProvider: 'local',
                mustChangePassword: false,
            },
            select: { id: true, email: true, name: true },
        });
        registerStitchUser(lookup, created, [rawName ?? '', name ?? '']);
        return { id: created.id, created: true, email: created.email };
    }
    catch (err) {
        const code = err?.code;
        if (code !== 'P2002')
            throw err;
        const raced = await prisma.user.findUnique({
            where: { email: finalEmail },
            select: { id: true, email: true, name: true },
        });
        if (!raced)
            throw err;
        registerStitchUser(lookup, raced, [rawName ?? '', name ?? '']);
        return { id: raced.id, created: false, email: raced.email };
    }
}
