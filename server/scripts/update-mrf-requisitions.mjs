/**
 * Update Requirement rows from the Manpower Requisition Form workbook.
 * Match key: ReqID-New = Requirement.jobCode.
 * Dry-run unless --apply is passed.
 */
import '../dist/config/loadEnv.js'
import fs from 'fs'
import ExcelJS from 'exceljs'
import { prisma } from '../dist/lib/prisma.js'
import { parseLegacyCsv } from '../dist/lib/legacyImport/parseCsv.js'
import { buildManpowerRequirementPayload } from '../dist/lib/legacyImport/fieldMap.js'
import { RECRUITER_EMAILS, resolveAllowedRecruiterName } from '../dist/lib/legacyImport/allowedRecruiters.js'
import { normalizePersonName } from '../dist/lib/legacyImport/ensureStitchUser.js'
import { ensureInterviewPlan } from '../dist/lib/interviewPlan.js'
import { syncRequirementPositionSlots } from '../dist/lib/syncRequirementPositionSlots.js'

const sourcePath = process.argv.find((arg) => /\.xlsx$/i.test(arg) || /\.csv$/i.test(arg)) ??
  'C:/Users/ATS/Downloads/Manpower Requisition Form (MRF) (33).csv'
const apply = process.argv.includes('--apply')

function cellToString(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') {
    if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value))
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0')
    const date = `${pad(value.getDate())}-${pad(value.getMonth() + 1)}-${value.getFullYear()}`
    if (value.getHours() === 0 && value.getMinutes() === 0) return date
    return `${date} ${pad(value.getHours())}:${pad(value.getMinutes())}`
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text ?? '').join('').trim()
    if (typeof value.text === 'string') return value.text.trim()
    if ('result' in value) return cellToString(value.result)
  }
  return String(value).trim()
}

function isChildRequirementRow(row) {
  const reqType = (row['Req Type'] || '').trim()
  return !reqType || /^child\s*req$/i.test(reqType)
}

function mapSheetHiringStage(cr) {
  const s = cr.trim().toLowerCase()
  if (s === 'sourcing') return 'SOURCING'
  if (s === 'l1 interview') return 'L1_INTERVIEW'
  if (s === 'l2 interview') return 'L2_INTERVIEW'
  if (s === 'client interview') return 'L2_INTERVIEW'
  if (s === 'hr final interview') return 'HR_INTERVIEW'
  if (s === 'joined') return 'JOINED'
  if (s === 'offer decline') return 'OFFERED'
  return null
}

/** Child status (CR) sets the stage. Parent status (PR) and child status together set open, hold, or closed. */
function mapTrackerStatus(cr, pr) {
  const crS = (cr || '').trim().toLowerCase()
  const prS = (pr || '').trim().toLowerCase()
  const hiringStage = mapSheetHiringStage(cr) ?? 'SOURCING'
  if (crS === 'hold') return { status: 'ON_HOLD', hiringStage: 'SOURCING' }
  const childClosed = /cancel|joined|decline|internal fulfilment|internal fulfillment|closed/.test(crS)
  const parentClosed = prS === 'close' || prS === 'closed'
  if (childClosed || parentClosed) return { status: 'CLOSED', hiringStage }
  if (prS === 'open') return { status: 'LIVE', hiringStage }
  return { status: 'CLOSED', hiringStage }
}

async function loadRows() {
  const rowsFromSource = async () => {
    if (/\.csv$/i.test(sourcePath)) {
      const csvText = fs.readFileSync(sourcePath, 'utf8')
      const rows = parseLegacyCsv(csvText)
      return rows.filter((row) => row['ReqID-New'] && isChildRequirementRow(row))
    }

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(sourcePath)
    const ws = wb.worksheets[0]
    const headers = []
    const headerRow = ws.getRow(1)
    for (let i = 1; i <= ws.columnCount; i++) headers.push(cellToString(headerRow.getCell(i).value))
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const parsed = {}
      for (let i = 1; i <= headers.length; i++) {
        const header = headers[i - 1]
        if (!header || header in parsed) continue
        parsed[header] = cellToString(row.getCell(i).value)
      }
      if (parsed['ReqID-New'] && isChildRequirementRow(parsed)) rows.push(parsed)
    })
    return rows
  }

  return rowsFromSource()
}

function buildLookup(users) {
  const byName = new Map()
  const byEmail = new Map()
  for (const user of users) {
    byEmail.set(user.email.toLowerCase(), user.id)
    const key = user.name.trim().toLowerCase()
    if (key && !byName.has(key)) byName.set(key, user.id)
    const normalized = normalizePersonName(user.name).toLowerCase()
    if (normalized && !byName.has(normalized)) byName.set(normalized, user.id)
  }
  return { byName, byEmail, users }
}

function resolveUserIdByName(lookup, name) {
  const v = name?.trim()
  if (!v) return null
  const exact = lookup.byName.get(v.toLowerCase()) ?? lookup.byName.get(normalizePersonName(v).toLowerCase())
  if (exact) return exact
  const tokens = normalizePersonName(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  let bestId = null
  let bestLen = tokens.length
  for (const user of lookup.users) {
    const registered = normalizePersonName(user.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (/&|\band\b/i.test(registered)) continue
    const regTokens = registered.split(/\s+/).filter(Boolean)
    if (regTokens.length <= tokens.length) continue
    if (!tokens.every((t, i) => t === regTokens[i])) continue
    if (regTokens.length > bestLen) {
      bestLen = regTokens.length
      bestId = user.id
    }
  }
  return bestId
}

function resolveRecruiterId(lookup, rawName) {
  const keeper = resolveAllowedRecruiterName(rawName)
  if (!keeper) return null
  const email = RECRUITER_EMAILS[keeper]
  if (email) {
    const byEmail = lookup.byEmail.get(email.toLowerCase())
    if (byEmail) return byEmail
  }
  return resolveUserIdByName(lookup, keeper)
}

function stable(value) {
  if (value instanceof Date) return value.toISOString()
  if (value == null) return null
  return value
}

const COMPARE_FIELDS = [
  'parentJobCode', 'client', 'title', 'department', 'projectName', 'orgUnit', 'quarter', 'reqMonth',
  'status', 'hiringStage', 'openings', 'priority', 'location', 'locationCity', 'employmentType', 'hireType',
  'seniorityLevel', 'businessType', 'domain', 'jobType', 'employmentChannel', 'requirementFor',
  'replacementDueTo', 'replacementEmployeeName', 'joinedEmployeeName', 'joinedEmployeeId', 'hireCategory',
  'experienceLabel', 'salaryBand', 'approvalStatus', 'cancellationStatus', 'assignedVendorName',
  'onboardSource', 'referrerName', 'joinedMonth', 'joinedQuarter', 'closureReason', 'description',
  'jobDescription', 'primarySkills', 'education', 'recruiters', 'hiringManager', 'visibleToCandidates',
]

async function removeRequirements(ids) {
  if (ids.length === 0) return { interviews: 0, feedback: 0, offers: 0, candidates: 0 }
  const interviews = await prisma.interview.findMany({
    where: { requirementId: { in: ids } },
    select: { id: true },
  })
  const interviewIds = interviews.map((row) => row.id)
  const feedback = interviewIds.length
    ? await prisma.feedback.deleteMany({ where: { interviewId: { in: interviewIds } } })
    : { count: 0 }
  const removedInterviews = await prisma.interview.deleteMany({ where: { requirementId: { in: ids } } })
  const offers = await prisma.offer.deleteMany({ where: { requirementId: { in: ids } } })
  const plans = await prisma.interviewPlan.findMany({
    where: { requirementId: { in: ids } },
    select: { id: true },
  })
  if (plans.length) {
    await prisma.interviewPlanStage.deleteMany({ where: { planId: { in: plans.map((plan) => plan.id) } } })
    await prisma.interviewPlan.deleteMany({ where: { requirementId: { in: ids } } })
  }
  await prisma.vendorRequirement.deleteMany({ where: { requirementId: { in: ids } } })
  const candidates = await prisma.candidate.updateMany({
    where: { requirementId: { in: ids } },
    data: { requirementId: null },
  })
  await prisma.businessRequirement.updateMany({
    where: { publishedRequirementId: { in: ids } },
    data: { publishedRequirementId: null },
  })
  await prisma.requirement.deleteMany({ where: { id: { in: ids } } })
  return {
    interviews: removedInterviews.count,
    feedback: feedback.count,
    offers: offers.count,
    candidates: candidates.count,
  }
}

async function main() {
  const rows = await loadRows()
  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, status: true } })
  const lookup = buildLookup(users)
  const fallback = users.find((u) => u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE')
  if (!fallback) throw new Error('No active SUPER_ADMIN')

  const existing = await prisma.requirement.findMany()
  const byCode = new Map(existing.filter((r) => r.jobCode).map((r) => [r.jobCode, r]))
  const sheetCodes = new Set(rows.map((r) => r['ReqID-New']))

  let created = 0
  let updated = 0
  let unchanged = 0
  const transitions = {}
  const unresolvedRecruiters = new Map()
  const unresolvedManagers = new Map()
  const samples = []

  for (const row of rows) {
    const reqId = row['ReqID-New']
    const recruiterId = resolveRecruiterId(lookup, row.Recruiter)
    const hmName = row['Hiring Manager']?.trim()
    const hiringManagerId = hmName ? resolveUserIdByName(lookup, hmName) : null
    if (!recruiterId && row.Recruiter) unresolvedRecruiters.set(row.Recruiter, (unresolvedRecruiters.get(row.Recruiter) ?? 0) + 1)
    if (hmName && !hiringManagerId) unresolvedManagers.set(hmName, (unresolvedManagers.get(hmName) ?? 0) + 1)

    const current = byCode.get(reqId)
    const recruiterIds = recruiterId ? [recruiterId] : current ? JSON.parse(current.recruiters || '[]') : []
    const hmId = hiringManagerId ?? current?.hiringManager ?? fallback.id
    const built = buildManpowerRequirementPayload(reqId, row, recruiterIds.length ? recruiterIds : [], fallback.id, hmId)
    const { _reqStatus, _recruiterCount, _vendorName, filled, ...data } = built
    const tracker = mapTrackerStatus(row['Requisition Status-CR'] || '', row['Requisition Status-PR'] || '')
    data.status = tracker.status
    data.hiringStage = tracker.hiringStage
    data.openings = 1
    if (tracker.status === 'LIVE') {
      data.closureReason = null
      data.closedAt = null
      data.onHoldAt = null
      data.visibleToCandidates = true
      data.visibleToReferrals = true
      data.liveAt = data.liveAt || new Date()
    } else if (tracker.status === 'ON_HOLD') {
      data.visibleToCandidates = false
      data.visibleToReferrals = false
      data.closedAt = null
      data.onHoldAt = data.onHoldAt || data.holdStartDate || new Date()
    } else {
      data.visibleToCandidates = false
      data.visibleToReferrals = false
      data.onHoldAt = null
      data.closureReason = (row['Requisition Status-CR'] || '').trim() || data.closureReason
      data.closedAt = data.closedAt || new Date()
    }
    if (!recruiterId && current) {
      data.recruiters = current.recruiters
      data.createdBy = current.createdBy
    }
    if (!recruiterId && !current) {
      data.recruiters = JSON.stringify([])
      data.createdBy = fallback.id
    }
    if (!hiringManagerId && current) data.hiringManager = current.hiringManager

    if (!current) {
      created++
      if (samples.length < 8) samples.push(`CREATE ${reqId} ${data.title} ${data.status}/${data.hiringStage}`)
      if (apply) {
        const createdRow = await prisma.requirement.create({ data })
        await ensureInterviewPlan(createdRow.id)
        await syncRequirementPositionSlots(createdRow.id)
      }
      continue
    }

    const changes = COMPARE_FIELDS.filter((field) => stable(current[field]) !== stable(data[field]))
    if (changes.length === 0) {
      unchanged++
      continue
    }
    updated++
    const key = `${current.status}/${current.hiringStage} -> ${data.status}/${data.hiringStage}`
    transitions[key] = (transitions[key] ?? 0) + 1
    if (samples.length < 12) samples.push(`UPDATE ${reqId} ${changes.slice(0, 6).join(', ')}`)
    if (apply) {
      await prisma.requirement.update({ where: { id: current.id }, data })
      if (current.openings !== data.openings) await syncRequirementPositionSlots(current.id)
    }
  }

  const extra = existing.filter((r) => !r.jobCode || !sheetCodes.has(r.jobCode))
  const extraByStatus = {}
  for (const row of extra) extraByStatus[row.status] = (extraByStatus[row.status] ?? 0) + 1
  let removed = null
  if (extra.length) {
    const extraIds = extra.map((row) => row.id)
    const [interviewCount, offerCount, candidateCount] = await Promise.all([
      prisma.interview.count({ where: { requirementId: { in: extraIds } } }),
      prisma.offer.count({ where: { requirementId: { in: extraIds } } }),
      prisma.candidate.count({ where: { requirementId: { in: extraIds } } }),
    ])
    console.log('Linked to requisitions not in the sheet:', { interviews: interviewCount, offers: offerCount, candidates: candidateCount })
  }
  if (apply) removed = await removeRequirements(extra.map((row) => row.id))

  console.log(apply ? 'APPLIED' : 'DRY RUN')
  console.log(`Sheet rows: ${rows.length}`)
  console.log(`Would update: ${updated}`)
  console.log(`Unchanged: ${unchanged}`)
  console.log(`Would create: ${created}`)
  console.log(`Requisitions not in the sheet: ${extra.length}`, extraByStatus)
  if (removed) console.log('Removed with those requisitions:', removed)
  console.log('Status/stage moves:')
  for (const [k, v] of Object.entries(transitions).sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`)
  if (unresolvedRecruiters.size) console.log('Unresolved recruiters:', [...unresolvedRecruiters.entries()])
  if (unresolvedManagers.size) console.log('Unresolved hiring managers:', [...unresolvedManagers.entries()].slice(0, 30))
  console.log(samples.join('\n'))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
