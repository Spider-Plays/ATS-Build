import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOfferApprovalRollbackTarget } from './offerApprovalRollback.js';
describe('getOfferApprovalRollbackTarget', () => {
    it('rolls pending HR back to draft', () => {
        const target = getOfferApprovalRollbackTarget({ status: 'PENDING_HR_APPROVAL' });
        assert.equal(target?.status, 'DRAFT');
    });
    it('rolls pending exec back to HR approval', () => {
        const target = getOfferApprovalRollbackTarget({ status: 'PENDING_EXEC_APPROVAL' });
        assert.equal(target?.status, 'PENDING_HR_APPROVAL');
        assert.equal(target?.approvalStep, 'HR');
    });
    it('rolls approved high-CTC offers back to executive approval', () => {
        const target = getOfferApprovalRollbackTarget({
            status: 'APPROVED',
            annualCtc: 3_000_000,
            approvalHistory: '[]',
        });
        assert.equal(target?.status, 'PENDING_EXEC_APPROVAL');
    });
    it('rolls sent offers back to approved', () => {
        const target = getOfferApprovalRollbackTarget({ status: 'SENT' });
        assert.equal(target?.status, 'APPROVED');
    });
    it('returns null for terminal states', () => {
        assert.equal(getOfferApprovalRollbackTarget({ status: 'ACCEPTED' }), null);
    });
});
