import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCompensationBreakdown, resolveOfferCompensationBreakdown, DEFAULT_COMPENSATION_CONFIG } from './offerCompensation.js';
describe('calculateCompensationBreakdown', () => {
    it('matches sample offer letter at CTC 864480', () => {
        const b = calculateCompensationBreakdown(864480);
        assert.equal(b.earnings.find((e) => e.key === 'basic')?.annual, 345792);
        assert.equal(b.gross.annual, 816047);
        assert.equal(b.totalCtc.annual, 864480);
        assert.equal(b.netPay.annual, 774252);
    });
    it('recalculates when stored compensation JSON is incomplete', () => {
        const b = resolveOfferCompensationBreakdown({
            annualCtc: 2800000,
            compensationJson: JSON.stringify({ annualCtc: 2800000, gross: { label: 'Gross', annual: 1, monthly: 1 } }),
        }, DEFAULT_COMPENSATION_CONFIG);
        assert.equal(b.totalCtc.annual, 2800000);
        assert.ok(b.earnings.length > 0);
    });
});
