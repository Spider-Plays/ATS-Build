/**
 * Stitch email design tokens — hex equivalents of src/index.css and
 * src/styles/portal-palettes.css (email clients cannot read CSS variables).
 */
export const FONT = `'Plus Jakarta Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
export const MONO = `'JetBrains Mono',Consolas,Menlo,Monaco,monospace`;
export const C = {
    white: '#FFFFFF',
    surface: '#F5F7F9',
    surfaceLow: '#F2F4F8',
    surfaceContainer: '#ECEFF3',
    onSurface: '#15181E',
    onSurfaceVariant: '#4E545F',
    outline: '#6F7785',
    outlineVariant: '#CBCFD7',
    hairline: '#E4E8EE',
    success: '#2C9664',
    successContainer: '#E3F4EB',
    onSuccessContainer: '#14532F',
    warning: '#B86E00',
    warningContainer: '#FFF3DF',
    onWarningContainer: '#6B4000',
    error: '#B7291F',
    errorContainer: '#FCE9E7',
    onErrorContainer: '#7A1A13',
};
export const ACCENTS = {
    staff: {
        primary: '#1452A3', container: '#E2EEFD', onContainer: '#0B2D5C', line: '#C5DAF6',
        heroFrom: '#0B356B', heroTo: '#1A5FB4', chip: '#2B65A8', soft: '#CFE1F8', rule: '#4A7AB8',
    },
    candidate: {
        primary: '#0C6452', container: '#DEF2EB', onContainer: '#073A30', line: '#BCE2D4',
        heroFrom: '#0B2826', heroTo: '#14574A', chip: '#22574D', soft: '#BFE6D9', rule: '#3B7468',
    },
    referral: {
        primary: '#7C3AED', container: '#F1EAFE', onContainer: '#3B1782', line: '#DCCBFB',
        heroFrom: '#151A33', heroTo: '#4A2687', chip: '#4A3577', soft: '#DDD0FA', rule: '#6A55A0',
    },
    vendor: {
        primary: '#0C8D62', container: '#DDF8EB', onContainer: '#064A33', line: '#B7EBD3',
        heroFrom: '#0F2E2B', heroTo: '#137050', chip: '#2A6956', soft: '#BDEBD6', rule: '#3F8270',
    },
};
export const SUPPORT_EMAIL = 'talentacquisition@ats.igsglobal.co';
export const FOOTER_REASON = {
    candidate: 'You’re receiving this because you applied for a role at IGS.',
    staff: 'Sent to you as a Stitch ATS user at IGS.',
    vendor: 'Sent to you as an IGS recruitment partner.',
    referral: 'Sent because you referred a candidate to IGS.',
};
export const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
export function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
