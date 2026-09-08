export const DEFAULT_COMPENSATION_CONFIG = {
    basicPercentOfCtc: 40,
    hraPercentOfBasic: 50,
    statBonusPercentOfBasic: 8.33,
    ltaPercentOfBasic: 8.33,
    mealAllowanceAnnual: 12000,
    mobileAllowanceAnnual: 7200,
    siteAllowanceAnnual: 24000,
    employerPfPercentOfBasic: 12,
    pfAdminPercentOfBasic: 1,
    insuranceAnnual: 2880,
    employerLwfAnnual: 600,
    employeeLwfAnnual: 300,
};
function round(n) {
    return Math.round(n);
}
function monthlyFromAnnual(annual) {
    return round(annual / 12);
}
function line(key, label, annual) {
    return { key, label, annual: round(annual), monthly: monthlyFromAnnual(annual) };
}
export function calculateCompensationBreakdown(annualCtc, config = DEFAULT_COMPENSATION_CONFIG) {
    const ctc = round(annualCtc);
    const basic = round((ctc * config.basicPercentOfCtc) / 100);
    const hra = round((basic * config.hraPercentOfBasic) / 100);
    const statBonus = round((basic * config.statBonusPercentOfBasic) / 100);
    const lta = round((basic * config.ltaPercentOfBasic) / 100);
    const meal = config.mealAllowanceAnnual;
    const mobile = config.mobileAllowanceAnnual;
    const site = config.siteAllowanceAnnual;
    const employerPf = round((basic * config.employerPfPercentOfBasic) / 100);
    const pfAdmin = round((basic * config.pfAdminPercentOfBasic) / 100);
    const employerEsic = 0;
    const insurance = config.insuranceAnnual;
    const employerLwf = config.employerLwfAnnual;
    const employerTotal = employerPf + pfAdmin + employerEsic + insurance + employerLwf;
    const grossAnnual = ctc - employerTotal;
    const special = grossAnnual - basic - hra - statBonus - lta - meal - mobile - site;
    const earnings = [
        line('basic', 'Basic', basic),
        line('hra', 'HRA', hra),
        line('statBonus', 'Stat Bonus', statBonus),
        line('lta', 'LTA', lta),
        line('meal', 'Meal Allowance', meal),
        line('mobile', 'Mobile Allowance', mobile),
        line('site', 'Site Allowance', site),
        line('special', 'Special Allowance', special),
    ];
    const gross = line('gross', 'Gross', grossAnnual);
    const employerContributions = [
        line('employerPf', 'Employer PF', employerPf),
        line('pfAdmin', 'PF Admin', pfAdmin),
        line('employerEsic', 'Employer ESIC', employerEsic),
        line('insurance', 'Insurance', insurance),
        line('employerLwf', 'Employer LWF Contribution', employerLwf),
    ];
    const totalCtcLine = line('totalCtc', 'Total CTC', ctc);
    const employeePf = employerPf;
    const employeeEsic = 0;
    const employeeLwf = config.employeeLwfAnnual;
    const employeeDeductions = [
        line('employeePf', 'Employee PF', employeePf),
        line('employeeEsic', 'Employee ESIC', employeeEsic),
        line('employeeLwf', 'Employee LWF Contribution', employeeLwf),
    ];
    const deductionAnnual = employeePf + employeeEsic + employeeLwf;
    const totalDeduction = line('deduction', 'Deduction', deductionAnnual);
    const netPay = line('netPay', 'Net Pay', grossAnnual - deductionAnnual);
    return {
        annualCtc: ctc,
        earnings,
        gross,
        employerContributions,
        totalCtc: totalCtcLine,
        employeeDeductions,
        totalDeduction,
        netPay,
    };
}
export function getAnnualCtcFromOffer(row) {
    if (row.annualCtc != null && row.annualCtc > 0)
        return row.annualCtc;
    if (row.baseSalary != null && row.baseSalary > 0)
        return row.baseSalary;
    return 0;
}
function isValidBreakdown(value) {
    if (!value || typeof value !== 'object')
        return false;
    const breakdown = value;
    return (Array.isArray(breakdown.earnings) &&
        breakdown.earnings.length > 0 &&
        breakdown.gross != null &&
        Array.isArray(breakdown.employerContributions) &&
        breakdown.totalCtc != null &&
        Array.isArray(breakdown.employeeDeductions) &&
        breakdown.totalDeduction != null &&
        breakdown.netPay != null);
}
export function resolveOfferCompensationBreakdown(offer, config = DEFAULT_COMPENSATION_CONFIG) {
    const annualCtc = getAnnualCtcFromOffer(offer);
    if (offer.compensationJson && offer.compensationJson !== '{}') {
        try {
            const parsed = JSON.parse(offer.compensationJson);
            if (isValidBreakdown(parsed))
                return parsed;
        }
        catch {
            /* fall through to recalculate */
        }
    }
    return calculateCompensationBreakdown(annualCtc, config);
}
