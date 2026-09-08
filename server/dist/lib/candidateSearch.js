import { prisma } from './prisma.js';
import { CandidateSearchQueryError, normalizeCandidateSearchQuery, } from './candidateSearchQuery.js';
import { buildCandidateListWhere } from './candidateAccess.js';
function parseOptionalFloat(v) {
    if (v == null || v === '')
        return null;
    const n = typeof v === 'number' ? v : Number(String(v));
    return Number.isFinite(n) ? n : null;
}
function splitCsv(raw) {
    if (Array.isArray(raw)) {
        return raw.map(String).map((s) => s.trim()).filter(Boolean);
    }
    if (typeof raw !== 'string' || !raw.trim())
        return [];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
export function parseCandidateSearchQuery(query) {
    const sortRaw = typeof query.sort === 'string' ? query.sort : 'appliedDate';
    const sort = sortRaw === 'appliedDate' ||
        sortRaw === 'experience' ||
        sortRaw === 'expectedCtc' ||
        sortRaw === 'relevance'
        ? sortRaw
        : 'appliedDate';
    const skillsMode = query.skillsMode === 'any' ? 'any' : 'all';
    const booleanMode = query.booleanMode === 'simple' ? 'simple' : 'advanced';
    const page = Math.max(1, Math.floor(parseOptionalFloat(query.page) ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(parseOptionalFloat(query.pageSize) ?? 20)));
    return {
        q: typeof query.q === 'string' ? query.q : null,
        booleanMode,
        skills: splitCsv(query.skills),
        skillsMode,
        locations: splitCsv(query.locations),
        expMin: parseOptionalFloat(query.expMin),
        expMax: parseOptionalFloat(query.expMax),
        currentCtcMin: parseOptionalFloat(query.currentCtcMin),
        currentCtcMax: parseOptionalFloat(query.currentCtcMax),
        expectedCtcMin: parseOptionalFloat(query.expectedCtcMin),
        expectedCtcMax: parseOptionalFloat(query.expectedCtcMax),
        noticeMaxDays: parseOptionalFloat(query.noticeMaxDays),
        status: typeof query.status === 'string' && query.status.trim() ? query.status.trim() : null,
        source: typeof query.source === 'string' && query.source.trim() ? query.source.trim() : null,
        company: typeof query.company === 'string' && query.company.trim() ? query.company.trim() : null,
        sort,
        page,
        pageSize,
    };
}
/** Prisma-level facets that don't need numeric helpers. */
function buildTextFacetWhere(params) {
    const and = [];
    if (params.status) {
        and.push({ status: params.status });
    }
    if (params.source) {
        and.push({ source: { contains: params.source, mode: 'insensitive' } });
    }
    if (params.company) {
        and.push({ currentCompany: { contains: params.company, mode: 'insensitive' } });
    }
    if (params.locations && params.locations.length > 0) {
        and.push({
            OR: params.locations.map((loc) => ({
                location: { contains: loc, mode: 'insensitive' },
            })),
        });
    }
    if (params.skills && params.skills.length > 0) {
        const skillClauses = params.skills.map((skill) => ({
            OR: [
                { primarySkills: { contains: skill, mode: 'insensitive' } },
                { secondarySkills: { contains: skill, mode: 'insensitive' } },
                { role: { contains: skill, mode: 'insensitive' } },
                { searchText: { contains: skill, mode: 'insensitive' } },
            ],
        }));
        if (params.skillsMode === 'any') {
            and.push({ OR: skillClauses });
        }
        else {
            and.push(...skillClauses);
        }
    }
    if (and.length === 0)
        return {};
    if (and.length === 1)
        return and[0];
    return { AND: and };
}
function hasNumericFacets(params) {
    return (params.expMin != null ||
        params.expMax != null ||
        params.currentCtcMin != null ||
        params.currentCtcMax != null ||
        params.expectedCtcMin != null ||
        params.expectedCtcMax != null ||
        params.noticeMaxDays != null);
}
/**
 * Resolve years from helper column or free-text totalExperience ("5 Years").
 * Same idea for CTC (LPA / lakhs / annual INR) and notice days.
 */
const EXP_YEARS_SQL = `
  COALESCE(
    c."experienceYears",
    NULLIF(substring(coalesce(c."totalExperience", '') from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision
  )
`;
const CURRENT_CTC_LAKHS_SQL = `
  COALESCE(
    c."currentCtcLakhs",
    CASE
      WHEN coalesce(c."currentCTC", '') ~* 'cr|crore'
        THEN NULLIF(substring(c."currentCTC" from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision * 100
      WHEN coalesce(c."currentCTC", '') ~* 'lpa|lac|lakh'
        THEN NULLIF(substring(c."currentCTC" from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision
      WHEN NULLIF(substring(coalesce(c."currentCTC", '') from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision > 1000
        THEN NULLIF(substring(c."currentCTC" from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision / 100000.0
      ELSE NULLIF(substring(coalesce(c."currentCTC", '') from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision
    END
  )
`;
const EXPECTED_CTC_LAKHS_SQL = `
  COALESCE(
    c."expectedCtcLakhs",
    CASE
      WHEN coalesce(c."expectedCTC", '') ~* 'cr|crore'
        THEN NULLIF(substring(c."expectedCTC" from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision * 100
      WHEN coalesce(c."expectedCTC", '') ~* 'lpa|lac|lakh'
        THEN NULLIF(substring(c."expectedCTC" from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision
      WHEN NULLIF(substring(coalesce(c."expectedCTC", '') from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision > 1000
        THEN NULLIF(substring(c."expectedCTC" from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision / 100000.0
      ELSE NULLIF(substring(coalesce(c."expectedCTC", '') from '([0-9]+(?:\\.[0-9]+)?)'), '')::double precision
    END
  )
`;
const NOTICE_DAYS_SQL = `
  COALESCE(
    c."noticePeriodDays",
    CASE
      WHEN coalesce(c."noticePeriod", '') ~* 'immediate' THEN 0
      WHEN coalesce(c."noticePeriod", '') ~* '[0-9]+\\s*(months?|mos?)'
        THEN NULLIF(substring(c."noticePeriod" from '([0-9]+)'), '')::int * 30
      WHEN coalesce(c."noticePeriod", '') ~* '[0-9]+'
        THEN NULLIF(substring(c."noticePeriod" from '([0-9]+)'), '')::int
      ELSE NULL
    END
  )
`;
async function idsMatchingNumericFacets(params) {
    if (!hasNumericFacets(params))
        return null;
    const conditions = [];
    const values = [];
    let i = 1;
    if (params.expMin != null) {
        conditions.push(`${EXP_YEARS_SQL} >= $${i++}`);
        values.push(params.expMin);
    }
    if (params.expMax != null) {
        conditions.push(`${EXP_YEARS_SQL} <= $${i++}`);
        values.push(params.expMax);
    }
    if (params.currentCtcMin != null) {
        conditions.push(`${CURRENT_CTC_LAKHS_SQL} >= $${i++}`);
        values.push(params.currentCtcMin);
    }
    if (params.currentCtcMax != null) {
        conditions.push(`${CURRENT_CTC_LAKHS_SQL} <= $${i++}`);
        values.push(params.currentCtcMax);
    }
    if (params.expectedCtcMin != null) {
        conditions.push(`${EXPECTED_CTC_LAKHS_SQL} >= $${i++}`);
        values.push(params.expectedCtcMin);
    }
    if (params.expectedCtcMax != null) {
        conditions.push(`${EXPECTED_CTC_LAKHS_SQL} <= $${i++}`);
        values.push(params.expectedCtcMax);
    }
    if (params.noticeMaxDays != null) {
        conditions.push(`${NOTICE_DAYS_SQL} IS NOT NULL AND ${NOTICE_DAYS_SQL} <= $${i++}`);
        values.push(params.noticeMaxDays);
    }
    const sql = `SELECT c.id FROM "Candidate" c WHERE ${conditions.join(' AND ')}`;
    const rows = await prisma.$queryRawUnsafe(sql, ...values);
    return rows.map((r) => r.id);
}
const SEARCH_DOCUMENT_SQL = `
  to_tsvector(
    'english',
    coalesce(
      nullif(c."searchText", ''),
      trim(
        concat_ws(
          ' ',
          c.name,
          c.email,
          c.role,
          c."jobTitle",
          c.location,
          c."currentCompany",
          c."totalExperience",
          c."primarySkills",
          c."secondarySkills",
          left(coalesce(c."resumeText", ''), 80000)
        )
      )
    )
  )
`;
async function ftsRankedIds(queryText, mode) {
    const tsqueryExpr = mode === 'simple'
        ? "plainto_tsquery('english', $1)"
        : "to_tsquery('english', $1)";
    const sql = `
    SELECT
      c.id,
      ts_rank_cd(${SEARCH_DOCUMENT_SQL}, ${tsqueryExpr}) AS rank,
      ts_headline(
        'english',
        left(
          coalesce(c.role, '') || ' ' ||
          coalesce(c."primarySkills", '') || ' ' ||
          coalesce(c."secondarySkills", ''),
          400
        ),
        ${tsqueryExpr},
        'MaxWords=20, MinWords=8, MaxFragments=1'
      ) AS headline
    FROM "Candidate" c
    WHERE ${SEARCH_DOCUMENT_SQL} @@ ${tsqueryExpr}
    ORDER BY rank DESC
  `;
    try {
        const rows = await prisma.$queryRawUnsafe(sql, queryText);
        return rows.map((r) => ({
            id: r.id,
            rank: Number(r.rank) || 0,
            headline: r.headline || '',
        }));
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/syntax error|tsquery/i.test(msg)) {
            throw new CandidateSearchQueryError('Invalid boolean search syntax. Use AND / OR / NOT, quotes for phrases, and balanced parentheses.');
        }
        throw err;
    }
}
export async function executeCandidateSearch(auth, params) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    let ftsQuery = null;
    const booleanMode = params.booleanMode === 'simple' ? 'simple' : 'advanced';
    try {
        if (booleanMode === 'simple') {
            const trimmed = params.q?.trim();
            if (trimmed) {
                if (trimmed.length > 500) {
                    throw new CandidateSearchQueryError('Search query is too long (max 500 characters)');
                }
                ftsQuery = trimmed;
            }
        }
        else {
            ftsQuery = normalizeCandidateSearchQuery(params.q);
        }
    }
    catch (err) {
        if (err instanceof CandidateSearchQueryError)
            throw err;
        throw err;
    }
    const accessWhere = await buildCandidateListWhere(auth);
    const textFacetWhere = buildTextFacetWhere(params);
    const clauses = [accessWhere, textFacetWhere].filter((w) => Object.keys(w).length > 0);
    const rankById = new Map();
    const headlines = {};
    if (ftsQuery) {
        let hits;
        try {
            hits = await ftsRankedIds(ftsQuery, booleanMode);
        }
        catch (err) {
            if (err instanceof CandidateSearchQueryError)
                throw err;
            throw err;
        }
        if (hits.length === 0) {
            return { ids: [], total: 0, page, pageSize, rankById, headlines };
        }
        for (const h of hits) {
            rankById.set(h.id, h.rank);
            if (h.headline)
                headlines[h.id] = h.headline;
        }
        clauses.push({ id: { in: hits.map((h) => h.id) } });
    }
    const numericIds = await idsMatchingNumericFacets(params);
    if (numericIds) {
        if (numericIds.length === 0) {
            return { ids: [], total: 0, page, pageSize, rankById, headlines };
        }
        clauses.push({ id: { in: numericIds } });
    }
    const baseWhere = clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { AND: clauses };
    const sort = params.sort ?? (ftsQuery ? 'relevance' : 'appliedDate');
    const effectiveSort = sort === 'relevance' && !ftsQuery ? 'appliedDate' : sort;
    if (effectiveSort === 'relevance' && ftsQuery) {
        const matching = await prisma.candidate.findMany({
            where: baseWhere,
            select: { id: true },
        });
        const allowed = new Set(matching.map((m) => m.id));
        const ordered = [...rankById.keys()].filter((id) => allowed.has(id));
        const total = ordered.length;
        const pageIds = ordered.slice(skip, skip + pageSize);
        return { ids: pageIds, total, page, pageSize, rankById, headlines };
    }
    const orderBy = effectiveSort === 'experience'
        ? { experienceYears: 'desc' }
        : effectiveSort === 'expectedCtc'
            ? { expectedCtcLakhs: 'desc' }
            : { appliedDate: 'desc' };
    const [total, rows] = await Promise.all([
        prisma.candidate.count({ where: baseWhere }),
        prisma.candidate.findMany({
            where: baseWhere,
            select: { id: true },
            orderBy,
            skip,
            take: pageSize,
        }),
    ]);
    return {
        ids: rows.map((r) => r.id),
        total,
        page,
        pageSize,
        rankById,
        headlines,
    };
}
export { CandidateSearchQueryError };
