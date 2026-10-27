import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { emailBrandLockupHtml } from './emailBrandAssets.js';
import { computeRequirementAgingDays } from './requirementAging.js';
export const OPEN_REQ_STAGE_COLUMNS = [
    'Sourcing',
    'L1 Interview',
    'L2 Interview',
    'Client Interview',
    'HR Final Interview',
    'HR Select',
    'Offered',
];
const PRIORITY_LABEL = {
    CRITICAL: 'P0',
    HIGH: 'P1',
    MEDIUM: 'P2',
    LOW: 'P3',
};
const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
export const FULFILLMENT_PRIORITY_INDEX = [
    ['P0', 'Billing Loss & SOW Signed'],
    ['P1', '<15 Days to fulfil & SOW Signed'],
    ['P2', '16-30 Days'],
    ['P3', '30-60 Days'],
    ['P4', '60+ Days / Project Planning/ Shadow'],
    ['P5', 'Market Data check'],
];
function emptyCounts() {
    return {
        Sourcing: 0,
        'L1 Interview': 0,
        'L2 Interview': 0,
        'Client Interview': 0,
        'HR Final Interview': 0,
        'HR Select': 0,
        Offered: 0,
    };
}
export function openReqStageBucket(trackerStatus, hiringStage) {
    const raw = (trackerStatus || '').trim().toLowerCase();
    if (/client/.test(raw))
        return 'Client Interview';
    if (/l1/.test(raw))
        return 'L1 Interview';
    if (/l2/.test(raw))
        return 'L2 Interview';
    if (/hr select/.test(raw))
        return 'HR Select';
    if (/hr/.test(raw))
        return 'HR Final Interview';
    if (/offer/.test(raw))
        return 'Offered';
    if (/sourc/.test(raw))
        return 'Sourcing';
    switch (hiringStage) {
        case 'L1_INTERVIEW':
            return 'L1 Interview';
        case 'L2_INTERVIEW':
            return 'L2 Interview';
        case 'HR_INTERVIEW':
            return 'HR Final Interview';
        case 'TO_BE_OFFERED':
        case 'OFFERED':
        case 'OFFER_ACCEPTED':
            return 'Offered';
        default:
            return 'Sourcing';
    }
}
function recruitmentLabel(value) {
    if (!value?.trim())
        return '—';
    if (value === 'NEW_POSITION' || /new/i.test(value))
        return 'New Position';
    if (value === 'REPLACEMENT' || /replac/i.test(value))
        return 'Replacement';
    return value;
}
function priorityLabel(value) {
    if (!value?.trim())
        return '—';
    return PRIORITY_LABEL[value] || value;
}
function display(value) {
    const raw = value?.trim();
    return raw || '—';
}
const CLOSED_TRACKER = ['Hold', 'Cancel', 'Joined', 'Fulfil', 'Decline', 'Closed'];
function isClosedTracker(status) {
    const raw = (status || '').trim().toLowerCase();
    if (!raw)
        return false;
    return CLOSED_TRACKER.some((fragment) => raw.includes(fragment.toLowerCase()));
}
export async function buildOpenRequisitionReport(now = new Date()) {
    const [requirements, users] = await Promise.all([
        prisma.requirement.findMany({
            where: {
                status: 'LIVE',
                NOT: {
                    AND: [
                        { trackerStatus: { not: null } },
                        {
                            OR: CLOSED_TRACKER.map((fragment) => ({
                                trackerStatus: { contains: fragment, mode: Prisma.QueryMode.insensitive },
                            })),
                        },
                    ],
                },
            },
            select: {
                jobCode: true,
                title: true,
                projectName: true,
                client: true,
                requirementFor: true,
                hireType: true,
                employmentType: true,
                priority: true,
                hiringStage: true,
                trackerStatus: true,
                location: true,
                locationCity: true,
                agingDays: true,
                liveAt: true,
                raisedOn: true,
                closedAt: true,
                status: true,
                hiringManager: true,
                recruiters: true,
            },
        }),
        prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    ]);
    const nameById = new Map(users.map((user) => [user.id, user.name || user.email]));
    const rows = requirements
        .filter((row) => !isClosedTracker(row.trackerStatus))
        .map((row) => {
        let recruiterIds = [];
        try {
            const parsed = JSON.parse(row.recruiters || '[]');
            if (Array.isArray(parsed))
                recruiterIds = parsed.map(String);
        }
        catch {
            recruiterIds = [];
        }
        const stage = openReqStageBucket(row.trackerStatus, row.hiringStage);
        const priority = priorityLabel(row.priority);
        return {
            jobCode: row.jobCode || '—',
            recruitmentFor: recruitmentLabel(row.requirementFor),
            priority,
            project: display(row.projectName || row.client),
            title: row.title,
            reqStatus: display(row.trackerStatus) === '—' ? stage : display(row.trackerStatus),
            hireType: display(row.hireType),
            employmentType: display(row.employmentType),
            location: display(row.location || row.locationCity),
            agingDays: computeRequirementAgingDays(row, now) ?? row.agingDays ?? null,
            recruiter: recruiterIds.map((id) => nameById.get(id) || id).filter(Boolean).join(', ') || '—',
            owner: nameById.get(row.hiringManager) || row.hiringManager || '—',
            stage,
            priorityRank: PRIORITY_RANK[priority] ?? 9,
        };
    })
        .sort((a, b) => a.priorityRank - b.priorityRank || a.jobCode.localeCompare(b.jobCode, undefined, { numeric: true }));
    const totals = emptyCounts();
    const accountOrder = [];
    const byAccount = new Map();
    for (const row of rows) {
        totals[row.stage] += 1;
        if (!byAccount.has(row.project)) {
            byAccount.set(row.project, emptyCounts());
            accountOrder.push(row.project);
        }
        byAccount.get(row.project)[row.stage] += 1;
    }
    let hireInternal = 0;
    let newPositions = 0;
    let replacements = 0;
    for (const row of rows) {
        if (/internal/i.test(row.hireType))
            hireInternal += 1;
        if (row.recruitmentFor === 'New Position')
            newPositions += 1;
        if (row.recruitmentFor === 'Replacement')
            replacements += 1;
    }
    return {
        active: rows.length,
        newPositions,
        replacements,
        hireExternal: rows.length - hireInternal,
        hireInternal,
        totals,
        accounts: accountOrder.map((name) => {
            const counts = byAccount.get(name);
            return {
                name,
                counts,
                total: OPEN_REQ_STAGE_COLUMNS.reduce((sum, stage) => sum + counts[stage], 0),
            };
        }),
        rows: rows.map(({ stage: _stage, priorityRank: _rank, ...row }) => row),
    };
}
const FONT = 'Segoe UI,Roboto,Helvetica,Arial,sans-serif';
const BRAND = {
    primary: '#1266c4',
    primaryDark: '#0d4d96',
    primaryLight: '#e8f2ff',
    text: '#1a2b3c',
    muted: '#64748b',
    border: '#e2e8f0',
    bg: '#f0f5fa',
    white: '#ffffff',
    mark: '#2e76cc',
};
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function pill(label, bg, color) {
    return `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${bg};color:${color};font-size:11px;font-weight:700;font-family:${FONT};line-height:1.3;white-space:nowrap;">${escapeHtml(label)}</span>`;
}
function priorityPill(code) {
    const tones = {
        P0: ['#fee2e2', '#b91c1c'],
        P1: ['#ffedd5', '#c2410c'],
        P2: ['#fef3c7', '#b45309'],
        P3: ['#e2e8f0', '#334155'],
        P4: ['#e0e7ff', '#3730a3'],
        P5: ['#f1f5f9', '#475569'],
    };
    const [bg, color] = tones[code] ?? ['#f1f5f9', '#334155'];
    return pill(code, bg, color);
}
function statusPill(status) {
    const raw = status.toLowerCase();
    if (raw.includes('client'))
        return pill(status, '#ede9fe', '#6d28d9');
    if (raw.includes('l2'))
        return pill(status, '#e0e7ff', '#4338ca');
    if (raw.includes('l1'))
        return pill(status, '#dbeafe', '#1d4ed8');
    if (raw.includes('hr'))
        return pill(status, '#fce7f3', '#be185d');
    if (raw.includes('offer'))
        return pill(status, '#ccfbf1', '#0f766e');
    return pill(status, '#e0f2fe', '#0369a1');
}
function agingLabel(days) {
    if (days == null)
        return '—';
    const color = days >= 40 ? '#b91c1c' : days >= 20 ? '#c2410c' : '#047857';
    return `<span style="font-weight:700;color:${color};font-family:${FONT};">${days}</span>`;
}
const GRID = '#c5d0dc';
function compactCell(tag, content, align, color, strong = false, width) {
    const weight = strong ? 'font-weight:bold;' : '';
    const size = tag === 'th' ? '10px' : '12px';
    const bg = tag === 'th' ? '#f4f7fb' : '#ffffff';
    const widthAttr = width ? ` width="${width}"` : '';
    const widthStyle = width ? `width:${width}px;` : '';
    return `<${tag} class="acct"${widthAttr} nowrap="nowrap" align="${align}" valign="middle" bgcolor="${bg}" style="${widthStyle}padding:0;margin:0;border:1px solid ${GRID};background:${bg};font-family:Segoe UI,Arial,sans-serif;font-size:${size};line-height:15px;mso-line-height-rule:exactly;mso-line-height-alt:15px;color:${color};"><p class="acct" align="${align}" style="margin:0;padding:3px 6px;mso-margin-top-alt:0px;mso-margin-bottom-alt:0px;text-align:${align};font-family:Segoe UI,Arial,sans-serif;font-size:${size};line-height:15px;mso-line-height-rule:exactly;mso-line-height-alt:15px;${weight}color:${color};">${content}</p></${tag}>`;
}
function textCell(value, options) {
    const weight = options?.strong ? 'font-weight:700;' : '';
    const family = options?.mono ? 'Consolas,Monaco,monospace' : FONT;
    const color = options?.muted ? BRAND.muted : BRAND.text;
    if (options?.compact) {
        return compactCell('td', escapeHtml(value), 'center', color, Boolean(options.strong));
    }
    return `<td nowrap="nowrap" valign="middle" style="padding:8px 8px;border:1px solid ${GRID};font-size:12px;line-height:1.4;color:${color};${weight}font-family:${family};white-space:nowrap;">${escapeHtml(value)}</td>`;
}
function th(label, align = 'left', compact = false, width) {
    const widthAttr = width ? ` width="${width}"` : '';
    const widthStyle = width ? `width:${width}px;` : '';
    if (compact) {
        return compactCell('th', escapeHtml(label).toUpperCase(), align, BRAND.muted, true, width);
    }
    return `<th${widthAttr} nowrap="nowrap" align="${align}" valign="middle" bgcolor="#f4f7fb" style="${widthStyle}padding:8px 8px;font-size:10px;line-height:1.3;border:1px solid ${GRID};background:#f4f7fb;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};font-family:${FONT};white-space:nowrap;">${escapeHtml(label)}</th>`;
}
function accountCell(content, options = {}) {
    const align = options.align ?? 'center';
    const tone = options.tone ?? 'body';
    let bg = options.zebra ? '#f5f9fc' : '#ffffff';
    let color = options.muted ? '#c5ced6' : BRAND.text;
    let border = GRID;
    if (options.accent)
        color = BRAND.primary;
    if (tone === 'total') {
        bg = options.zebra ? '#d7e8fb' : BRAND.primaryLight;
        color = options.muted ? '#93c5fd' : BRAND.primary;
        border = '#c5daf6';
    }
    if (tone === 'header') {
        bg = BRAND.primary;
        color = '#ffffff';
        border = '#3b82c4';
    }
    if (tone === 'grand') {
        bg = BRAND.primaryDark;
        color = '#ffffff';
        border = '#0a3f7a';
    }
    const weight = options.strong || tone === 'header' || tone === 'grand' || tone === 'total' ? 'font-weight:bold;' : '';
    const size = tone === 'header' ? '10px' : '13px';
    const tracking = tone === 'header' ? 'letter-spacing:0.04em;' : '';
    const widthAttr = options.width ? ` width="${options.width}"` : '';
    const widthStyle = options.width ? `width:${options.width}px;` : '';
    return `<td${widthAttr} class="acct" nowrap="nowrap" align="${align}" valign="middle" bgcolor="${bg}" style="${widthStyle}padding:0;margin:0;border:1px solid ${border};background:${bg};font-family:Segoe UI,Arial,sans-serif;font-size:${size};line-height:16px;mso-line-height-rule:exactly;mso-line-height-alt:16px;color:${color};"><p class="acct" align="${align}" style="margin:0;padding:4px 8px;mso-margin-top-alt:0px;mso-margin-bottom-alt:0px;text-align:${align};font-family:Segoe UI,Arial,sans-serif;font-size:${size};line-height:16px;mso-line-height-rule:exactly;mso-line-height-alt:16px;${weight}${tracking}color:${color};">${content}</p></td>`;
}
function statCard(label, value) {
    return `<td nowrap="nowrap" valign="middle" bgcolor="${BRAND.primaryLight}" style="padding:10px 14px;background:${BRAND.primaryLight};border:1px solid #d6e6f8;font-family:${FONT};white-space:nowrap;">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};line-height:14px;mso-line-height-rule:exactly;white-space:nowrap;">${escapeHtml(label)}</div>
    <div style="margin-top:2px;font-size:22px;font-weight:800;letter-spacing:-0.03em;color:${BRAND.primary};line-height:26px;mso-line-height-rule:exactly;white-space:nowrap;">${value}</div>
  </td>`;
}
function legendColumn(entries) {
    const tones = {
        P0: ['#fee2e2', '#b91c1c'],
        P1: ['#ffedd5', '#c2410c'],
        P2: ['#fef3c7', '#b45309'],
        P3: ['#e2e8f0', '#334155'],
        P4: ['#e0e7ff', '#3730a3'],
        P5: ['#f1f5f9', '#475569'],
    };
    const rows = entries.map(([code, meaning]) => {
        const [bg, color] = tones[code] ?? ['#f1f5f9', '#334155'];
        return `<tr><td width="26" align="center" valign="middle" bgcolor="${bg}" style="width:26px;background:${bg};padding:1px 4px;font-family:Segoe UI,Arial,sans-serif;font-size:11px;line-height:15px;mso-line-height-rule:exactly;font-weight:bold;color:${color};">${escapeHtml(code)}</td><td width="6" style="width:6px;font-size:11px;line-height:15px;mso-line-height-rule:exactly;">&nbsp;</td><td nowrap="nowrap" valign="middle" style="padding:1px 0;font-family:Segoe UI,Arial,sans-serif;font-size:12px;line-height:15px;mso-line-height-rule:exactly;color:${BRAND.text};">${escapeHtml(meaning)}</td></tr>`;
    }).join('');
    return `<table cellpadding="0" cellspacing="0" border="0" role="presentation">${rows}</table>`;
}
export function renderOpenRequisitionReportHtml(report) {
    const generated = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(new Date());
    const stats = [
        ['Active', report.active],
        ['New positions', report.newPositions],
        ['Replacement', report.replacements],
        ['External', report.hireExternal],
        ['Internal', report.hireInternal],
    ]
        .map(([label, value], index) => `${index ? '<td width="8"></td>' : ''}${statCard(String(label), Number(value))}`)
        .join('');
    const accountWidths = [148, 92, 118, 118, 148, 164, 96, 84, 210];
    const accountTableWidth = accountWidths.reduce((sum, width) => sum + width, 0);
    const accountHead = [
        accountCell('ACCOUNT', { align: 'left', width: accountWidths[0], tone: 'header' }),
        ...OPEN_REQ_STAGE_COLUMNS.map((stage, index) => accountCell(stage.toUpperCase(), { width: accountWidths[index + 1], tone: 'header' })),
        accountCell('TOTAL NO OF REQUIREMENT', { width: accountWidths[8], tone: 'header' }),
    ].join('');
    const accountRows = report.accounts
        .map((account, index) => {
        const zebra = index % 2 === 1;
        const stages = OPEN_REQ_STAGE_COLUMNS.map((stage, stageIndex) => {
            const count = account.counts[stage];
            return accountCell(count > 0 ? String(count) : '–', {
                width: accountWidths[stageIndex + 1],
                zebra,
                strong: count > 0,
                muted: count === 0,
                accent: count > 0,
            });
        }).join('');
        return `<tr>${accountCell(escapeHtml(account.name), { align: 'left', width: accountWidths[0], zebra, strong: true })}${stages}${accountCell(String(account.total), { width: accountWidths[8], tone: 'total', zebra, strong: true })}</tr>`;
    })
        .join('');
    const grandStages = OPEN_REQ_STAGE_COLUMNS.map((stage, stageIndex) => accountCell(String(report.totals[stage]), { width: accountWidths[stageIndex + 1], tone: 'grand', strong: true })).join('');
    const detailHead = [
        ['Job code', 'left'],
        ['For', 'left'],
        ['Priority', 'center'],
        ['Project', 'left'],
        ['Role', 'left'],
        ['Status', 'left'],
        ['Hire', 'left'],
        ['Employment', 'left'],
        ['Location', 'left'],
        ['Aging', 'center'],
        ['Recruiter', 'left'],
        ['Owner', 'left'],
    ]
        .map(([label, align]) => th(label, align))
        .join('');
    const detailRows = report.rows
        .map((row, index) => {
        const bg = index % 2 === 1 ? 'background:#f8fafc;' : '';
        return `<tr style="${bg}">
        ${textCell(row.jobCode, { mono: true, strong: true })}
        ${textCell(row.recruitmentFor)}
        <td nowrap="nowrap" align="center" valign="middle" style="padding:8px 8px;border:1px solid ${GRID};white-space:nowrap;">${priorityPill(row.priority)}</td>
        ${textCell(row.project, { strong: true })}
        ${textCell(row.title, { strong: true })}
        <td nowrap="nowrap" valign="middle" style="padding:8px 8px;border:1px solid ${GRID};white-space:nowrap;">${statusPill(row.reqStatus)}</td>
        ${textCell(row.hireType, { muted: true })}
        ${textCell(row.employmentType, { muted: true })}
        ${textCell(row.location)}
        <td nowrap="nowrap" align="center" valign="middle" style="padding:8px 8px;border:1px solid ${GRID};white-space:nowrap;">${agingLabel(row.agingDays)}</td>
        ${textCell(row.recruiter)}
        ${textCell(row.owner)}
      </tr>`;
    })
        .join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <!--[if mso]>
  <style type="text/css">
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    .acct, .acct p { margin: 0 !important; mso-margin-top-alt: 0px; mso-margin-bottom-alt: 0px; mso-line-height-rule: exactly; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <div style="display:none;font-size:1px;color:${BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${report.active} active requisitions · ${generated}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${BRAND.bg}" style="background:${BRAND.bg};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="0" style="width:auto;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
          <tr>
            <td bgcolor="${BRAND.primary}" style="background:${BRAND.primary};padding:28px 32px;border-radius:16px 16px 0 0;">
              ${emailBrandLockupHtml({ subtitle: 'Creating Impact' })}
              <p style="margin:22px 0 0;font-size:28px;font-weight:800;letter-spacing:-0.03em;color:#ffffff;font-family:${FONT};">Open requisition status</p>
              <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#dbeafe;font-family:${FONT};">Hello — here is the current picture of active requisitions. On hold and closed roles are not included. ${escapeHtml(generated)}.</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="${BRAND.white}" style="background:${BRAND.white};padding:28px 32px 8px;border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};">
              <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="0" style="width:auto;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0 0 22px;">
                <tr>
                  <td align="left" valign="middle">
                    <table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>${stats}</tr></table>
                  </td>
                  <td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>
                  <td align="left" valign="middle">
                    <table cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#f8fafc" style="background:#f8fafc;border:1px solid ${GRID};">
                      <tr><td bgcolor="#f8fafc" style="background:#f8fafc;padding:8px 12px;">
                    <p style="margin:0 0 6px;mso-margin-top-alt:0px;mso-margin-bottom-alt:6px;font-family:Segoe UI,Arial,sans-serif;font-size:10px;line-height:14px;mso-line-height-rule:exactly;font-weight:bold;color:${BRAND.muted};">FULFILLMENT PRIORITY INDEX</p>
                    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="0" style="width:auto;"><tr>
                      <td valign="top">${legendColumn(FULFILLMENT_PRIORITY_INDEX.slice(0, 3))}</td>
                      <td width="16" style="width:16px;font-size:1px;line-height:1px;">&nbsp;</td>
                      <td valign="top" style="border-left:1px solid ${GRID};padding-left:12px;">${legendColumn(FULFILLMENT_PRIORITY_INDEX.slice(3))}</td>
                    </tr></table>
                      </td></tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:18px;font-weight:800;letter-spacing:-0.02em;color:${BRAND.text};font-family:${FONT};">Account wise Requirement Hiring Status</p>
              <table class="acct" cellpadding="0" cellspacing="0" border="0" role="presentation" width="${accountTableWidth}" style="width:${accountTableWidth}px;border-collapse:collapse;border:1px solid ${GRID};mso-table-lspace:0pt;mso-table-rspace:0pt;">
                <tr>${accountHead}</tr>
                ${accountRows}
                <tr>${accountCell('Grand total', { align: 'left', width: accountWidths[0], tone: 'grand', strong: true })}${grandStages}${accountCell(String(report.active), { width: accountWidths[8], tone: 'grand', strong: true })}</tr>
              </table>
              <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%"><tr><td height="22" style="height:22px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
              <p style="margin:0 0 10px;font-size:18px;font-weight:800;letter-spacing:-0.02em;color:${BRAND.text};font-family:${FONT};">Active requisitions</p>
              <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="0" style="width:auto;border-collapse:collapse;border:1px solid ${GRID};mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0 0 8px;white-space:nowrap;">
                <tr>${detailHead}</tr>
                ${detailRows}
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="${BRAND.white}" style="background:${BRAND.white};padding:8px 32px 28px;border:1px solid ${BRAND.border};border-top:none;border-radius:0 0 16px 16px;">
              <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${BRAND.muted};font-family:${FONT};">This report is generated automatically and is scheduled for 11:00 IST each day.</p>
              <p style="margin:8px 0 0;font-size:13px;color:${BRAND.text};font-family:${FONT};">Best regards,<br/><strong>TA Process Team</strong></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
