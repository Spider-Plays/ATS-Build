import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { findResumeFile, normalizeEmail, rowGet, } from './parseCsv.js';
import { mapLegacyStatus } from './statusMap.js';
function styleHeader(sheet) {
    const row = sheet.getRow(1);
    row.font = { bold: true };
    row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8EEF7' },
    };
    row.alignment = { vertical: 'middle', wrapText: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
}
function addSheet(workbook, name, columns, rows) {
    const sheet = workbook.addWorksheet(name.slice(0, 31));
    sheet.columns = columns.map((c) => ({ ...c, width: c.width ?? 18 }));
    for (const row of rows)
        sheet.addRow(row);
    styleHeader(sheet);
    return sheet;
}
export function buildImportReportRows(input) {
    const { allRows, selected, skippedDuplicates, manifest, dataDir } = input;
    const selectedEmails = new Set(selected.map((r) => normalizeEmail(rowGet(r, 'Email ID', 'Email ID1'))).filter(Boolean));
    const rows = [];
    for (const row of selected) {
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        const name = rowGet(row, 'Candidate Name');
        const resumeId = rowGet(row, 'RESUME ID');
        const reqId = rowGet(row, 'Title');
        const legacyId = rowGet(row, 'ID');
        if (!email || !name) {
            rows.push({
                email: email || '(missing)',
                name: name || '(missing)',
                resumeId,
                reqId,
                legacyId,
                status: rowGet(row, 'Candidate Status'),
                subStatus: rowGet(row, 'Candidate Sub Status'),
                atsStatus: '',
                phone: rowGet(row, 'Contact Number'),
                role: rowGet(row, 'Designation') || rowGet(row, 'JD Selection'),
                source: rowGet(row, 'Source'),
                candidateId: '',
                hasRequirement: false,
                hasResumeFile: Boolean(resumeId && findResumeFile(dataDir, resumeId, name)),
                resumeAttach: rowGet(row, 'Resume Attach'),
                action: 'skipped_invalid',
            });
            continue;
        }
        const entry = manifest.candidatesByEmail[email];
        const reqMapped = Boolean(reqId &&
            manifest.requirements[reqId] &&
            !manifest.requirements[reqId].startsWith('dry-run-'));
        rows.push({
            email,
            name,
            resumeId,
            reqId,
            legacyId,
            status: rowGet(row, 'Candidate Status'),
            subStatus: rowGet(row, 'Candidate Sub Status'),
            atsStatus: mapLegacyStatus(row),
            phone: rowGet(row, 'Contact Number'),
            role: rowGet(row, 'Designation') || rowGet(row, 'JD Selection'),
            source: rowGet(row, 'Source'),
            candidateId: entry?.candidateId || '',
            hasRequirement: reqMapped,
            hasResumeFile: Boolean(resumeId && findResumeFile(dataDir, resumeId, name)),
            resumeAttach: rowGet(row, 'Resume Attach'),
            action: entry?.candidateId ? 'created' : 'would_import',
        });
    }
    for (const skipped of skippedDuplicates) {
        if (selectedEmails.has(skipped.email)) {
            // already represented by the kept row; still list duplicate separately below
        }
        const row = allRows.find((r) => normalizeEmail(rowGet(r, 'Email ID', 'Email ID1')) === skipped.email &&
            rowGet(r, 'Title') === skipped.title);
        const skippedName = row ? rowGet(row, 'Candidate Name') : '';
        rows.push({
            email: skipped.email,
            name: skippedName,
            resumeId: row ? rowGet(row, 'RESUME ID') : '',
            reqId: skipped.title,
            legacyId: row ? rowGet(row, 'ID') : '',
            status: row ? rowGet(row, 'Candidate Status') : '',
            subStatus: row ? rowGet(row, 'Candidate Sub Status') : '',
            atsStatus: row ? mapLegacyStatus(row) : '',
            phone: row ? rowGet(row, 'Contact Number') : '',
            role: row ? rowGet(row, 'Designation') || rowGet(row, 'JD Selection') : '',
            source: row ? rowGet(row, 'Source') : '',
            candidateId: '',
            hasRequirement: Boolean(skipped.title &&
                manifest.requirements[skipped.title] &&
                !manifest.requirements[skipped.title].startsWith('dry-run-')),
            hasResumeFile: Boolean(row &&
                rowGet(row, 'RESUME ID') &&
                findResumeFile(dataDir, rowGet(row, 'RESUME ID'), skippedName)),
            resumeAttach: row ? rowGet(row, 'Resume Attach') : '',
            action: 'skipped_duplicate',
        });
    }
    return rows;
}
export async function writeLegacyImportWorkbook(options) {
    const { reportPath, reportRows, skippedDuplicates, missingRequirementIds, requirementCount, interviewCount = 0, offerCount = 0, resumeAttachedCount = 0, } = options;
    const added = reportRows.filter((r) => r.action === 'created' || r.action === 'updated');
    const missingResume = reportRows.filter((r) => (r.action === 'created' || r.action === 'updated' || r.action === 'would_import') && !r.hasResumeFile);
    const missingReq = reportRows.filter((r) => (r.action === 'created' || r.action === 'updated' || r.action === 'would_import') &&
        (!r.reqId || !r.hasRequirement));
    const withResume = reportRows.filter((r) => (r.action === 'created' || r.action === 'updated') && r.hasResumeFile);
    const withReq = reportRows.filter((r) => (r.action === 'created' || r.action === 'updated') && r.hasRequirement);
    const invalid = reportRows.filter((r) => r.action === 'skipped_invalid');
    const duplicates = reportRows.filter((r) => r.action === 'skipped_duplicate');
    const statusCounts = new Map();
    for (const r of added) {
        const key = r.atsStatus || '(empty)';
        statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Stitch ATS Legacy Import';
    workbook.created = new Date();
    const summary = workbook.addWorksheet('Summary Report');
    summary.columns = [
        { header: 'Metric', key: 'metric', width: 42 },
        { header: 'Count', key: 'count', width: 14 },
        { header: 'Notes', key: 'notes', width: 60 },
    ];
    styleHeader(summary);
    const summaryRows = [
        { metric: 'Generated at', count: new Date().toISOString(), notes: options.dataDir },
        { metric: 'Candidates imported / kept (unique email)', count: added.length, notes: 'One row per email after dedupe' },
        { metric: 'Candidates with requirement linked', count: withReq.length, notes: 'Title matched ReqID-New' },
        { metric: 'Candidates missing requirement', count: missingReq.length, notes: 'Created with blank requirementId' },
        { metric: 'Candidates with resume file on disk', count: withResume.length, notes: 'Matched Resume_Repository/**/{RESUME ID}.* (or Resumes/)' },
        { metric: 'Candidates missing resume file', count: missingResume.length, notes: 'Resume fields left blank' },
        { metric: 'Resumes attached this run', count: resumeAttachedCount, notes: 'Written to RESUME_UPLOAD_DIR' },
        { metric: 'Requirements created / matched', count: requirementCount, notes: 'From Manpower Requisition Form' },
        { metric: 'Req IDs not in Manpower form', count: missingRequirementIds.length, notes: 'See sheet Missing Req IDs' },
        { metric: 'Duplicate email rows skipped', count: skippedDuplicates.length, notes: 'Kept highest pipeline stage' },
        { metric: 'Invalid rows (missing email/name)', count: invalid.length, notes: 'Cannot create Candidate without email' },
        { metric: 'Interviews created (this run)', count: interviewCount, notes: '' },
        { metric: 'Offers created (this run)', count: offerCount, notes: '' },
    ];
    for (const row of summaryRows)
        summary.addRow(row);
    summary.addRow({});
    summary.addRow({ metric: 'ATS status breakdown (imported)', count: '', notes: '' });
    for (const [status, count] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
        summary.addRow({ metric: `  ${status}`, count, notes: '' });
    }
    const candidateCols = [
        { header: 'Email', key: 'email', width: 32 },
        { header: 'Name', key: 'name', width: 28 },
        { header: 'ATS Status', key: 'atsStatus', width: 22 },
        { header: 'Legacy Status', key: 'status', width: 20 },
        { header: 'Sub Status', key: 'subStatus', width: 22 },
        { header: 'Req ID (Title)', key: 'reqId', width: 16 },
        { header: 'Has Requirement', key: 'hasRequirement', width: 16 },
        { header: 'RESUME ID', key: 'resumeId', width: 14 },
        { header: 'Has Resume File', key: 'hasResumeFile', width: 16 },
        { header: 'Resume Attach', key: 'resumeAttach', width: 14 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Role', key: 'role', width: 24 },
        { header: 'Source', key: 'source', width: 16 },
        { header: 'Candidate ID', key: 'candidateId', width: 28 },
        { header: 'Legacy ID', key: 'legacyId', width: 14 },
        { header: 'Action', key: 'action', width: 18 },
    ];
    addSheet(workbook, 'Candidates Added', candidateCols, added.map((r) => ({ ...r, hasRequirement: r.hasRequirement ? 'Yes' : 'No', hasResumeFile: r.hasResumeFile ? 'Yes' : 'No' })));
    addSheet(workbook, 'Missing Resumes', candidateCols, missingResume.map((r) => ({ ...r, hasRequirement: r.hasRequirement ? 'Yes' : 'No', hasResumeFile: 'No' })));
    addSheet(workbook, 'Missing Requirement', candidateCols, missingReq.map((r) => ({ ...r, hasRequirement: 'No', hasResumeFile: r.hasResumeFile ? 'Yes' : 'No' })));
    addSheet(workbook, 'With Resume', candidateCols, withResume.map((r) => ({ ...r, hasRequirement: r.hasRequirement ? 'Yes' : 'No', hasResumeFile: 'Yes' })));
    addSheet(workbook, 'With Requirement', candidateCols, withReq.map((r) => ({ ...r, hasRequirement: 'Yes', hasResumeFile: r.hasResumeFile ? 'Yes' : 'No' })));
    addSheet(workbook, 'Duplicate Emails Skipped', [
        { header: 'Email', key: 'email', width: 32 },
        { header: 'Req ID (Title)', key: 'title', width: 16 },
        { header: 'Reason', key: 'reason', width: 48 },
        { header: 'Name', key: 'name', width: 28 },
        { header: 'RESUME ID', key: 'resumeId', width: 14 },
        { header: 'Legacy Status', key: 'status', width: 20 },
    ], duplicates.map((r) => ({
        email: r.email,
        title: r.reqId,
        reason: 'duplicate email — kept row with higher pipeline stage',
        name: r.name,
        resumeId: r.resumeId,
        status: r.status,
    })));
    addSheet(workbook, 'Invalid Rows', candidateCols, invalid.map((r) => ({ ...r, hasRequirement: r.hasRequirement ? 'Yes' : 'No', hasResumeFile: r.hasResumeFile ? 'Yes' : 'No' })));
    addSheet(workbook, 'Missing Req IDs', [
        { header: 'Req ID (from Candidate Title)', key: 'reqId', width: 36 },
        { header: 'Candidate Count', key: 'count', width: 16 },
    ], missingRequirementIds
        .map((reqId) => ({
        reqId,
        count: reportRows.filter((r) => r.reqId === reqId).length,
    }))
        .sort((a, b) => b.count - a.count));
    addSheet(workbook, 'Status Breakdown', [
        { header: 'ATS Status', key: 'status', width: 28 },
        { header: 'Count', key: 'count', width: 12 },
    ], [...statusCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({ status, count })));
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    try {
        await workbook.xlsx.writeFile(reportPath);
        return reportPath;
    }
    catch (err) {
        const code = err?.code;
        if (code !== 'EBUSY' && code !== 'EPERM')
            throw err;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const altPath = path.join(path.dirname(reportPath), `${path.basename(reportPath, path.extname(reportPath))}-${stamp}.xlsx`);
        await workbook.xlsx.writeFile(altPath);
        console.warn(`Report file locked; wrote alternative: ${altPath}`);
        return altPath;
    }
}
