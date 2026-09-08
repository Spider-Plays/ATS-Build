import { prisma } from './prisma.js';
import { calculateCompensationBreakdown, getAnnualCtcFromOffer, resolveOfferCompensationBreakdown, } from './offerCompensation.js';
import { buildLetterMetaJson, parseLetterMetaJson, renderOfferLetterHtml, } from './offerLetterRender.js';
import { getCompensationConfig, getOfferLetterTemplate } from './offerSettings.js';
export async function loadOfferLetterContext(offerId) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer)
        return null;
    const [candidate, requirement] = await Promise.all([
        prisma.candidate.findUnique({ where: { id: offer.candidateId } }),
        prisma.requirement.findUnique({ where: { id: offer.requirementId } }),
    ]);
    if (!candidate)
        return null;
    const meta = parseLetterMetaJson(offer.letterMetaJson);
    const annualCtc = getAnnualCtcFromOffer(offer);
    const [compConfig, letterTemplate] = await Promise.all([
        getCompensationConfig(),
        getOfferLetterTemplate(),
    ]);
    const breakdown = resolveOfferCompensationBreakdown(offer, compConfig);
    const joiningDateRaw = (typeof meta.joiningDate === 'string' && meta.joiningDate) ||
        candidate.expectedJoiningDate?.toISOString().slice(0, 10) ||
        new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const parsedJoiningDate = new Date(joiningDateRaw);
    const joiningDate = Number.isNaN(parsedJoiningDate.getTime())
        ? new Date(Date.now() + 14 * 86400000)
        : parsedJoiningDate;
    const positionTitle = (typeof meta.positionTitle === 'string' && meta.positionTitle) ||
        candidate.role ||
        requirement?.title ||
        'Team Member';
    const clientSiteAddress = (typeof meta.clientSiteAddress === 'string' && meta.clientSiteAddress) ||
        requirement?.location ||
        'As communicated by HR';
    const clientCompanyName = (typeof meta.clientCompanyName === 'string' && meta.clientCompanyName) ||
        requirement?.client ||
        'Client Organization';
    const candidateAddress = (typeof meta.candidateAddress === 'string' && meta.candidateAddress) ||
        candidate.location ||
        'Address on file';
    return {
        offer,
        candidate,
        requirement,
        annualCtc,
        breakdown,
        letterHtml: renderOfferLetterHtml({
            candidateName: candidate.name,
            candidateAddress,
            positionTitle,
            joiningDate,
            clientCompanyName,
            clientSiteAddress,
            reportingTime: typeof meta.reportingTime === 'string' ? meta.reportingTime : undefined,
            annualCtc,
            variablePay: offer.bonus,
            breakdown,
            template: letterTemplate,
        }),
    };
}
export async function buildOfferCreateData(body) {
    const annualCtc = body.annualCtc ?? body.baseSalary ?? 0;
    const compConfig = await getCompensationConfig();
    const breakdown = calculateCompensationBreakdown(annualCtc, compConfig);
    const letterMetaJson = buildLetterMetaJson({
        candidateAddress: body.letterMeta?.candidateAddress ?? '',
        positionTitle: body.letterMeta?.positionTitle ?? '',
        joiningDate: body.letterMeta?.joiningDate ?? '',
        clientCompanyName: body.letterMeta?.clientCompanyName ?? '',
        clientSiteAddress: body.letterMeta?.clientSiteAddress ?? '',
        reportingTime: body.letterMeta?.reportingTime,
        acceptanceDeadlineDays: body.letterMeta?.acceptanceDeadlineDays,
    });
    const approvalChainJson = body.approvalChain
        ? JSON.stringify(body.approvalChain.stages)
        : '[]';
    const bonus = body.bonus != null && Number(body.bonus) > 0 ? Number(body.bonus) : null;
    return {
        candidateId: body.candidateId,
        requirementId: body.requirementId,
        baseSalary: annualCtc,
        annualCtc,
        bonus,
        status: 'DRAFT',
        compensationJson: JSON.stringify(breakdown),
        letterMetaJson,
        approvalChainJson,
        createdBy: body.createdBy,
    };
}
export function appendOfferHistory(existing, action, description, userId) {
    const history = JSON.parse(existing || '[]');
    return JSON.stringify([
        ...history,
        {
            id: crypto.randomUUID(),
            date: new Date().toISOString(),
            action,
            description,
            userId,
        },
    ]);
}
export function appendApprovalHistory(existing, entry) {
    const history = JSON.parse(existing || '[]');
    return JSON.stringify([...history, entry]);
}
