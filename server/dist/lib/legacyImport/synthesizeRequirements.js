import { rowGet } from './parseCsv.js';
function pick(row, ...keys) {
    return rowGet(row, ...keys).trim();
}
function firstFilled(...values) {
    return values.find((v) => v.trim())?.trim() ?? '';
}
/** Map a candidate-sheet row onto Manpower Form columns used by the importer. */
export function candidateRowToManpower(row, reqId) {
    const account = pick(row, 'Account');
    const designation = pick(row, 'Designation');
    const jd = pick(row, 'JD Selection');
    return {
        'Req Type': 'Child Req',
        'ReqID-New': reqId,
        'Job Title': firstFilled(designation, jd, `Requirement ${reqId}`),
        'Client Name': firstFilled(account, 'Legacy Import'),
        Recruiter: pick(row, 'Recruiter'),
        'Recruiter Email': pick(row, 'Recruiter Email'),
        'Requisition Status-CR': pick(row, 'Req Status'),
        Quarter: pick(row, 'Quarter'),
        'Req-Month': pick(row, 'Req-Month'),
        'Date of Requisition': pick(row, 'Req Receipt Date'),
        'Hire Category': pick(row, 'Hire Category'),
        'Type of employment': pick(row, 'Type of employment'),
        Location: firstFilled(pick(row, 'Preferred Location'), pick(row, 'Current Location')),
        'Desired / Primary skill': pick(row, 'Primary Skill'),
        'Org Unit': account,
        'Project/Department New': account,
        'Interview Category': pick(row, 'Area of Interview'),
        'Hiring Manager': pick(row, 'Hiring Manager'),
        Source: pick(row, 'Source'),
        'Global Job Type': pick(row, 'Hire Category'),
        'No of Position': '1',
    };
}
/**
 * The Main Data workbook has no Manpower sheet. Build one child requirement per
 * unique candidate `Title` (Req ID) so candidates can link in ATS.
 */
export function synthesizeRequirementsFromCandidates(rows) {
    const byTitle = new Map();
    for (const row of rows) {
        const title = pick(row, 'Title');
        if (!title)
            continue;
        const next = candidateRowToManpower(row, title);
        const existing = byTitle.get(title);
        if (!existing) {
            byTitle.set(title, next);
            continue;
        }
        for (const [key, value] of Object.entries(next)) {
            if (!existing[key] && value)
                existing[key] = value;
        }
    }
    return [...byTitle.values()];
}
