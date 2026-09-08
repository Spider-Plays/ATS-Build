import { prisma } from './prisma.js';
function deriveMonthQuarter(isoDate) {
    const joiningMonth = isoDate.slice(0, 7);
    const d = new Date(`${isoDate}T12:00:00`);
    if (Number.isNaN(d.getTime()))
        return { joiningMonth, joiningQuarter: '' };
    const q = Math.floor(d.getMonth() / 3) + 1;
    return { joiningMonth, joiningQuarter: `Q${q} ${d.getFullYear()}` };
}
function parseSlots(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
/** Keep positionSlots aligned with openings and HIRED/JOINED candidates. */
export async function syncRequirementPositionSlots(requirementId) {
    const req = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: { openings: true, positionSlots: true },
    });
    if (!req)
        return;
    const hired = await prisma.candidate.findMany({
        where: { requirementId, status: { in: ['JOINED', 'HIRED'] } },
        select: { id: true, name: true, joiningDate: true },
        orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
    });
    const existing = parseSlots(req.positionSlots);
    const byIndex = new Map(existing.map((s) => [s.index, s]));
    const used = new Set();
    const next = Array.from({ length: Math.max(0, req.openings) }, (_, i) => {
        const prev = byIndex.get(i) ?? { index: i };
        if (prev.candidateId) {
            const match = hired.find((h) => h.id === prev.candidateId);
            if (match) {
                used.add(match.id);
                const joiningDate = prev.joiningDate ||
                    (match.joiningDate ? match.joiningDate.toISOString().slice(0, 10) : '');
                const derived = joiningDate ? deriveMonthQuarter(joiningDate) : null;
                return {
                    index: i,
                    candidateId: match.id,
                    candidateName: match.name,
                    employeeId: prev.employeeId ?? '',
                    joiningDate,
                    joiningMonth: derived?.joiningMonth || prev.joiningMonth || '',
                    joiningQuarter: derived?.joiningQuarter || prev.joiningQuarter || '',
                };
            }
        }
        return {
            index: i,
            employeeId: prev.employeeId ?? '',
            joiningDate: prev.joiningDate ?? '',
            joiningMonth: prev.joiningMonth ?? '',
            joiningQuarter: prev.joiningQuarter ?? '',
        };
    });
    const pool = hired.filter((h) => !used.has(h.id));
    let pi = 0;
    for (const slot of next) {
        if (slot.candidateId)
            continue;
        const c = pool[pi++];
        if (!c)
            break;
        const joiningDate = slot.joiningDate || (c.joiningDate ? c.joiningDate.toISOString().slice(0, 10) : '');
        const derived = joiningDate ? deriveMonthQuarter(joiningDate) : null;
        slot.candidateId = c.id;
        slot.candidateName = c.name;
        slot.joiningDate = joiningDate;
        slot.joiningMonth = derived?.joiningMonth || slot.joiningMonth || '';
        slot.joiningQuarter = derived?.joiningQuarter || slot.joiningQuarter || '';
    }
    await prisma.requirement.update({
        where: { id: requirementId },
        data: { positionSlots: JSON.stringify(next), updatedAt: new Date() },
    });
}
