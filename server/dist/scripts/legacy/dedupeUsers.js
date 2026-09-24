/**
 * Merge duplicate users (name variants, cross-role) into one account per person,
 * remap references, and normalize emails to firstname.lastinitial@ats.igsglobal.co.
 *
 *   npm run db:legacy -- dedupe-users --dry-run
 *   npm run db:legacy -- dedupe-users
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { isProtectedStitchEmail, isSamePersonName, normalizePersonName, personNameTokens, slugFromName, stitchEmailFromName, } from '../../lib/legacyImport/ensureStitchUser.js';
const ROLE_RANK = {
    SUPER_ADMIN: 100,
    ADMIN: 90,
    HR_HEAD: 80,
    HR_MANAGER: 70,
    FINANCE_HEAD: 65,
    TEAM_LEAD: 60,
    RECRUITER: 55,
    ACCOUNT_MANAGER: 50,
    HIRING_MANAGER: 45,
    INTERVIEWER: 40,
    EMPLOYEE: 30,
    VENDOR: 20,
    CANDIDATE: 10,
};
function parseArgs(argv) {
    return { dryRun: argv.includes('--dry-run') };
}
class UnionFind {
    parent = new Map();
    find(id) {
        if (!this.parent.has(id))
            this.parent.set(id, id);
        let root = id;
        while (this.parent.get(root) !== root)
            root = this.parent.get(root);
        let cur = id;
        while (cur !== root) {
            const next = this.parent.get(cur);
            this.parent.set(cur, root);
            cur = next;
        }
        return root;
    }
    union(a, b) {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb)
            this.parent.set(ra, rb);
    }
}
function roleRank(role) {
    return ROLE_RANK[role] ?? 0;
}
function longestName(names) {
    return [...names].sort((a, b) => {
        const ta = personNameTokens(a).length;
        const tb = personNameTokens(b).length;
        if (tb !== ta)
            return tb - ta;
        return b.length - a.length;
    })[0];
}
function pickKeeper(group) {
    const protectedUsers = group.filter((u) => isProtectedStitchEmail(u.email));
    if (protectedUsers.length > 0) {
        return protectedUsers.sort((a, b) => roleRank(b.role) - roleRank(a.role) ||
            personNameTokens(b.name).length - personNameTokens(a.name).length)[0];
    }
    const canonical = longestName(group.map((u) => u.name));
    const desiredEmail = stitchEmailFromName(canonical).toLowerCase();
    return [...group].sort((a, b) => {
        const aDesired = a.email.toLowerCase() === desiredEmail ? 1 : 0;
        const bDesired = b.email.toLowerCase() === desiredEmail ? 1 : 0;
        if (bDesired !== aDesired)
            return bDesired - aDesired;
        const nameDiff = personNameTokens(b.name).length - personNameTokens(a.name).length;
        if (nameDiff !== 0)
            return nameDiff;
        const roleDiff = roleRank(b.role) - roleRank(a.role);
        if (roleDiff !== 0)
            return roleDiff;
        return a.createdAt.getTime() - b.createdAt.getTime();
    })[0];
}
function buildMergeGroups(users) {
    const uf = new UnionFind();
    for (const u of users)
        uf.find(u.id);
    for (let i = 0; i < users.length; i++) {
        for (let j = i + 1; j < users.length; j++) {
            if (isSamePersonName(users[i].name, users[j].name)) {
                uf.union(users[i].id, users[j].id);
            }
        }
    }
    const groups = new Map();
    for (const u of users) {
        const root = uf.find(u.id);
        const list = groups.get(root) ?? [];
        list.push(u);
        groups.set(root, list);
    }
    return new Map([...groups.entries()].filter(([, list]) => list.length > 1));
}
function replaceIdInJsonArray(raw, from, to) {
    if (raw == null)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return raw;
        let changed = false;
        const next = parsed.map((v) => {
            if (v === from) {
                changed = true;
                return to;
            }
            return v;
        });
        const seen = new Set();
        const deduped = [];
        for (const v of next) {
            const key = String(v);
            if (seen.has(key)) {
                changed = true;
                continue;
            }
            seen.add(key);
            deduped.push(v);
        }
        return changed ? JSON.stringify(deduped) : raw;
    }
    catch {
        return raw;
    }
}
async function runInBatches(tasks, batchSize = 8) {
    for (let i = 0; i < tasks.length; i += batchSize) {
        const slice = tasks.slice(i, i + batchSize);
        await Promise.all(slice.map((fn) => fn()));
    }
}
async function remapUserReferences(fromId, toId, dryRun) {
    if (dryRun)
        return;
    const tasks = [];
    const candidateUpdates = await prisma.candidate.findMany({
        where: {
            OR: [
                { createdBy: fromId },
                { referredByUserId: fromId },
                { submittedByUserId: fromId },
            ],
        },
        select: { id: true, createdBy: true, referredByUserId: true, submittedByUserId: true },
    });
    for (const c of candidateUpdates) {
        tasks.push(() => prisma.candidate.update({
            where: { id: c.id },
            data: {
                ...(c.createdBy === fromId ? { createdBy: toId } : {}),
                ...(c.referredByUserId === fromId ? { referredByUserId: toId } : {}),
                ...(c.submittedByUserId === fromId ? { submittedByUserId: toId } : {}),
            },
        }));
    }
    const reqs = await prisma.requirement.findMany({
        where: {
            OR: [{ hiringManager: fromId }, { createdBy: fromId }, { recruiters: { contains: fromId } }],
        },
        select: { id: true, hiringManager: true, createdBy: true, recruiters: true },
    });
    for (const r of reqs) {
        const recruiters = replaceIdInJsonArray(r.recruiters, fromId, toId);
        tasks.push(() => prisma.requirement.update({
            where: { id: r.id },
            data: {
                ...(r.hiringManager === fromId ? { hiringManager: toId } : {}),
                ...(r.createdBy === fromId ? { createdBy: toId } : {}),
                ...(recruiters !== r.recruiters ? { recruiters: recruiters ?? '[]' } : {}),
            },
        }));
    }
    // Bulk remap scheduledBy where interviewer JSON does not need rewriting.
    await prisma.interview.updateMany({
        where: { scheduledBy: fromId, NOT: { interviewerIds: { contains: fromId } } },
        data: { scheduledBy: toId },
    });
    const interviews = await prisma.interview.findMany({
        where: {
            OR: [{ scheduledBy: fromId }, { interviewerIds: { contains: fromId } }],
        },
        select: { id: true, scheduledBy: true, interviewerIds: true },
    });
    for (const iv of interviews) {
        const interviewerIds = replaceIdInJsonArray(iv.interviewerIds, fromId, toId);
        tasks.push(() => prisma.interview.update({
            where: { id: iv.id },
            data: {
                ...(iv.scheduledBy === fromId ? { scheduledBy: toId } : {}),
                ...(interviewerIds !== iv.interviewerIds
                    ? { interviewerIds: interviewerIds ?? '[]' }
                    : {}),
            },
        }));
    }
    const panels = await prisma.interviewPanelLevel.findMany({
        where: { interviewerIds: { contains: fromId } },
        select: { id: true, interviewerIds: true },
    });
    for (const p of panels) {
        const interviewerIds = replaceIdInJsonArray(p.interviewerIds, fromId, toId);
        if (interviewerIds === p.interviewerIds)
            continue;
        tasks.push(() => prisma.interviewPanelLevel.update({
            where: { id: p.id },
            data: { interviewerIds: interviewerIds ?? '[]' },
        }));
    }
    await runInBatches(tasks);
    await prisma.feedback.updateMany({
        where: { interviewerId: fromId },
        data: { interviewerId: toId },
    });
    await prisma.offer.updateMany({
        where: { createdBy: fromId },
        data: { createdBy: toId },
    });
    await prisma.activityLog.updateMany({
        where: { performedBy: fromId },
        data: { performedBy: toId },
    });
    await prisma.businessRequirement.updateMany({
        where: { hiringManager: fromId },
        data: { hiringManager: toId },
    });
    await prisma.businessRequirement.updateMany({
        where: { accountManager: fromId },
        data: { accountManager: toId },
    });
    await prisma.businessRequirement.updateMany({
        where: { createdBy: fromId },
        data: { createdBy: toId },
    });
    await prisma.clientDeal.updateMany({
        where: { hiringManager: fromId },
        data: { hiringManager: toId },
    });
    await prisma.clientDeal.updateMany({
        where: { accountManager: fromId },
        data: { accountManager: toId },
    });
    await prisma.clientDeal.updateMany({
        where: { createdBy: fromId },
        data: { createdBy: toId },
    });
    await prisma.changeRequest.updateMany({
        where: { requestedBy: fromId },
        data: { requestedBy: toId },
    });
    await prisma.changeRequest.updateMany({
        where: { hrReviewedBy: fromId },
        data: { hrReviewedBy: toId },
    });
    await prisma.changeRequest.updateMany({
        where: { adminReviewedBy: fromId },
        data: { adminReviewedBy: toId },
    });
    await prisma.changeRequest.updateMany({
        where: { closedBy: fromId },
        data: { closedBy: toId },
    });
    await prisma.vendorRequirement.updateMany({
        where: { assignedBy: fromId },
        data: { assignedBy: toId },
    });
    await prisma.loginHistory.deleteMany({ where: { userId: fromId } });
}
async function applyCanonicalProfile(keeper, group, dryRun, reserved) {
    const canonicalName = normalizePersonName(longestName(group.map((u) => u.name)));
    const bestRole = [...group].sort((a, b) => roleRank(b.role) - roleRank(a.role))[0].role;
    const protectedEmail = isProtectedStitchEmail(keeper.email);
    let desiredEmail = keeper.email.toLowerCase();
    if (!protectedEmail) {
        desiredEmail = stitchEmailFromName(canonicalName).toLowerCase();
        if (reserved.has(desiredEmail) && desiredEmail !== keeper.email.toLowerCase()) {
            desiredEmail = `${slugFromName(canonicalName)}.${keeper.id.slice(-4).toLowerCase()}@ats.igsglobal.co`;
        }
    }
    const nameChanged = normalizePersonName(keeper.name) !== canonicalName;
    const roleChanged = keeper.role !== bestRole;
    const emailChanged = !protectedEmail && keeper.email.toLowerCase() !== desiredEmail;
    if (!nameChanged && !roleChanged && !emailChanged) {
        reserved.add(keeper.email.toLowerCase());
        return null;
    }
    if (dryRun) {
        reserved.add(desiredEmail);
        if (emailChanged)
            return desiredEmail;
        return nameChanged || roleChanged ? '(profile update)' : null;
    }
    if (emailChanged) {
        const clash = await prisma.user.findUnique({
            where: { email: desiredEmail },
            select: { id: true },
        });
        if (clash && clash.id !== keeper.id) {
            desiredEmail = `${slugFromName(canonicalName)}.${keeper.id.slice(-4).toLowerCase()}@ats.igsglobal.co`;
        }
    }
    await prisma.user.update({
        where: { id: keeper.id },
        data: {
            ...(nameChanged ? { name: canonicalName } : {}),
            ...(roleChanged ? { role: bestRole } : {}),
            ...(emailChanged ? { email: desiredEmail } : {}),
        },
    });
    reserved.add(desiredEmail);
    return emailChanged ? desiredEmail : null;
}
export async function run(argv = []) {
    const { dryRun } = parseArgs(argv);
    console.log(`Dedupe legacy users${dryRun ? ' (dry-run)' : ''}`);
    const users = await prisma.user.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            department: true,
            createdAt: true,
        },
        orderBy: { name: 'asc' },
    });
    const groups = buildMergeGroups(users);
    const merge = new Map();
    const groupKeepers = [];
    console.log(`\nMerge plan (${groups.size} group(s)):`);
    for (const [, group] of [...groups.entries()].sort((a, b) => longestName(a[1].map((u) => u.name)).localeCompare(longestName(b[1].map((u) => u.name))))) {
        const keeper = pickKeeper(group);
        groupKeepers.push(keeper);
        const losers = group.filter((u) => u.id !== keeper.id);
        console.log(`  keep "${keeper.name}" <${keeper.email}> [${keeper.role}] ← merge ${losers.length}:`);
        for (const loser of losers) {
            merge.set(loser.id, keeper.id);
            console.log(`    - "${loser.name}" <${loser.email}> [${loser.role}]`);
        }
    }
    for (const [fromId, toId] of merge) {
        await remapUserReferences(fromId, toId, dryRun);
        if (!dryRun) {
            await prisma.user.delete({ where: { id: fromId } });
        }
    }
    console.log(`  merged/deleted: ${merge.size}`);
    const remaining = dryRun
        ? users.filter((u) => !merge.has(u.id))
        : await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                department: true,
                createdAt: true,
            },
            orderBy: { name: 'asc' },
        });
    const reserved = new Set();
    let profileUpdates = 0;
    const mergedKeeperIds = new Set(groupKeepers.map((k) => k.id));
    console.log(`\nCanonical profile + email:`);
    for (const [, group] of groups) {
        const keeper = pickKeeper(group);
        const keeperRow = remaining.find((u) => u.id === keeper.id) ?? keeper;
        const next = await applyCanonicalProfile(keeperRow, group, dryRun, reserved);
        if (next) {
            profileUpdates++;
            if (profileUpdates <= 40) {
                console.log(`  ${keeperRow.name}: ${keeperRow.email} → ${next}`);
            }
        }
    }
    for (const u of remaining) {
        if (mergedKeeperIds.has(u.id))
            continue;
        if (isProtectedStitchEmail(u.email)) {
            reserved.add(u.email.toLowerCase());
            continue;
        }
        const desired = stitchEmailFromName(u.name).toLowerCase();
        if (u.email.toLowerCase() === desired) {
            reserved.add(desired);
            continue;
        }
        let nextEmail = desired;
        if (reserved.has(nextEmail)) {
            nextEmail = `${slugFromName(u.name)}.${u.id.slice(-4).toLowerCase()}@ats.igsglobal.co`;
        }
        profileUpdates++;
        if (profileUpdates <= 40) {
            console.log(`  ${u.name}: ${u.email} → ${nextEmail}`);
        }
        if (!dryRun) {
            const clash = await prisma.user.findUnique({
                where: { email: nextEmail },
                select: { id: true },
            });
            if (clash && clash.id !== u.id) {
                nextEmail = `${slugFromName(u.name)}.${u.id.slice(-4).toLowerCase()}@ats.igsglobal.co`;
            }
            await prisma.user.update({
                where: { id: u.id },
                data: { email: nextEmail },
            });
        }
        reserved.add(nextEmail);
    }
    console.log(`  profile/email updates: ${profileUpdates}`);
    if (dryRun)
        console.log('\n(dry-run — no database writes)');
}
