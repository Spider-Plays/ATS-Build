import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateListWhere } from './candidateAccess.js';
const NONE = { id: { in: ['__none__'] } };
describe('buildCandidateListWhere for portal roles', () => {
    // Regression: portal accounts used to inherit the staff scope, including every EXPIRED referral.
    for (const role of ['CANDIDATE', 'VENDOR', 'EMPLOYEE']) {
        it(`${role} matches no staff candidates`, async () => {
            const auth = { userId: 'portal-user', role };
            assert.deepEqual(await buildCandidateListWhere(auth), NONE);
            assert.deepEqual(await buildCandidateListWhere(auth, { includeReferralReview: true }), NONE);
        });
    }
});
