import { prisma } from './prisma.js';
export const DUPLICATE_CANDIDATE_EMAIL_MESSAGE = 'A candidate with this email already exists';
export const DUPLICATE_CANDIDATE_PAN_MESSAGE = 'A candidate with this PAN already exists';
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export function normalizePan(pan) {
    return pan.trim().toUpperCase();
}
export function isValidPanFormat(pan) {
    return PAN_PATTERN.test(normalizePan(pan));
}
export async function findCandidateByEmail(email, excludeId) {
    const trimmed = email?.trim();
    if (!trimmed)
        return null;
    return prisma.candidate.findFirst({
        where: {
            email: { equals: trimmed, mode: 'insensitive' },
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
    });
}
export async function findCandidateByPan(pan, excludeId) {
    const normalized = normalizePan(pan);
    if (!normalized || !isValidPanFormat(normalized))
        return null;
    return prisma.candidate.findFirst({
        where: {
            pan: { equals: normalized, mode: 'insensitive' },
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
    });
}
