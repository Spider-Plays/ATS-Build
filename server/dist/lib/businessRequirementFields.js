import { EMPLOYMENT_TYPES, RequirementFieldError, SENIORITY_LEVELS, WORK_MODES, pickRequirementExtrasForCreate, pickRequirementExtrasPatch, } from './requirementFields.js';
export { RequirementFieldError };
/** Validates and parses extended fields for POST /business-requirements (all required). */
export function pickBusinessRequirementExtrasForCreate(body) {
    return pickRequirementExtrasForCreate(body);
}
/** Only parses fields present in the patch body (partial update). */
export function pickBusinessRequirementExtrasPatch(body) {
    return pickRequirementExtrasPatch(body);
}
export { EMPLOYMENT_TYPES, SENIORITY_LEVELS, WORK_MODES };
