/**
 * Push locally stored resume files to a remote ATS API (QA / production).
 *
 * Needed after a local `db:import-legacy` against Neon: metadata lands in the shared DB,
 * but PDF bytes stay on the local machine. The Render API then 404s resume downloads.
 *
 * Usage (PowerShell):
 *   npm run db:sync-legacy-resumes -- `
 *     --api-url https://qa.stitch-ats.in `
 *     --email you@company.com `
 *     --password "..." `
 *     [--data-dir C:\path\to\data] `
 *     [--from-local-disk]
 *
 * `--from-local-disk` uploads files already under RESUME_UPLOAD_DIR (named {candidateId}.pdf).
 * `--data-dir` uploads from data/resume/{RESUME_ID}.pdf using import-manifest.json mappings.
 * You can pass both; local disk is tried first when `--from-local-disk` is set.
 */
import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { RESUME_UPLOAD_DIR, findResumeFile } from '../../lib/resumeStorage.js';
import { defaultManifestPath, loadManifest, } from '../../lib/legacyImport/manifest.js';
import { findResumeFile as findLegacyResumeFile } from '../../lib/legacyImport/parseCsv.js';
function parseArgs(argv) {
    let apiUrl = '';
    let email = '';
    let password = '';
    let dataDir = null;
    let fromLocalDisk = false;
    let dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--api-url')
            apiUrl = (argv[++i] ?? '').replace(/\/$/, '');
        else if (a === '--email')
            email = argv[++i] ?? '';
        else if (a === '--password')
            password = argv[++i] ?? '';
        else if (a === '--data-dir')
            dataDir = path.resolve(argv[++i] ?? '');
        else if (a === '--from-local-disk')
            fromLocalDisk = true;
        else if (a === '--dry-run')
            dryRun = true;
    }
    if (!apiUrl)
        throw new Error('Missing --api-url (e.g. https://qa.stitch-ats.in)');
    if (!email || !password)
        throw new Error('Missing --email / --password for staff login');
    if (!dataDir && !fromLocalDisk) {
        throw new Error('Pass --data-dir and/or --from-local-disk');
    }
    return { apiUrl, email, password, dataDir, fromLocalDisk, dryRun };
}
async function login(apiUrl, email, password) {
    const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const body = (await res.json().catch(() => ({})));
    if (!res.ok || !body.token) {
        throw new Error(`Login failed: ${body.error || res.statusText}`);
    }
    return body.token;
}
async function uploadResume(apiUrl, token, candidateId, filePath, fileName, mime) {
    const buf = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('resume', new Blob([new Uint8Array(buf)], { type: mime }), fileName);
    const res = await fetch(`${apiUrl}/api/candidates/${candidateId}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => ({})));
        throw new Error(body.error || `${res.status} ${res.statusText}`);
    }
}
export async function run(argv = []) {
    const opts = parseArgs(argv);
    console.log(`API: ${opts.apiUrl}`);
    console.log(`Local disk: ${RESUME_UPLOAD_DIR}`);
    if (opts.dataDir)
        console.log(`Data dir: ${opts.dataDir}`);
    const token = opts.dryRun ? '' : await login(opts.apiUrl, opts.email, opts.password);
    if (!opts.dryRun)
        console.log('Logged in.');
    const jobs = [];
    if (opts.fromLocalDisk) {
        const withResume = await prisma.candidate.findMany({
            where: { resumeFileName: { not: null } },
            select: { id: true, email: true, resumeFileName: true, resumeMimeType: true },
        });
        for (const c of withResume) {
            const stored = await findResumeFile(c.id);
            if (!stored)
                continue;
            jobs.push({
                candidateId: c.id,
                email: c.email,
                filePath: stored.filePath,
                fileName: c.resumeFileName || path.basename(stored.filePath),
                mime: c.resumeMimeType || stored.mime,
            });
        }
    }
    if (opts.dataDir) {
        const manifest = loadManifest(defaultManifestPath(opts.dataDir));
        if (!manifest) {
            console.warn(`No manifest at ${defaultManifestPath(opts.dataDir)}`);
        }
        else {
            for (const [resumeId, candidateId] of Object.entries(manifest.candidatesByResumeId)) {
                if (jobs.some((j) => j.candidateId === candidateId))
                    continue;
                const file = findLegacyResumeFile(opts.dataDir, resumeId);
                if (!file) {
                    console.warn(`  ⚠ missing legacy file for RESUME ID ${resumeId}`);
                    continue;
                }
                const cand = await prisma.candidate.findUnique({
                    where: { id: candidateId },
                    select: { email: true },
                });
                if (!cand) {
                    console.warn(`  ⚠ candidate ${candidateId} not in DB (resume ${resumeId})`);
                    continue;
                }
                jobs.push({
                    candidateId,
                    email: cand.email,
                    filePath: file.path,
                    fileName: file.fileName,
                    mime: file.mime,
                });
            }
        }
    }
    console.log(`\nUploading ${jobs.length} resume(s)${opts.dryRun ? ' [dry-run]' : ''}…`);
    let ok = 0;
    let fail = 0;
    for (const job of jobs) {
        if (opts.dryRun) {
            console.log(`  [dry-run] ${job.email} ← ${job.fileName}`);
            ok++;
            continue;
        }
        try {
            await uploadResume(opts.apiUrl, token, job.candidateId, job.filePath, job.fileName, job.mime);
            ok++;
            console.log(`  ✓ ${job.email}`);
        }
        catch (err) {
            fail++;
            console.error(`  ✗ ${job.email}:`, err instanceof Error ? err.message : err);
        }
    }
    console.log(`\nDone. uploaded ${ok}, failed ${fail}`);
}
