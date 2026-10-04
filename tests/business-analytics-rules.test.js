import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBusinessFunnelMetrics } from '../controllers/businessAnalyticsController.js';

test('business funnel calculates request, approval and completion metrics', () => {
    const result = calculateBusinessFunnelMetrics({
        profileViews: 20,
        appointmentCounts: {
            pending: 2,
            approved: 3,
            inProgress: 1,
            completed: 4,
            rejected: 1,
            cancelled: 1
        }
    });

    assert.equal(result.appointmentRequests, 12);
    assert.equal(result.convertedAppointments, 8);
    assert.equal(result.completedAppointments, 4);
    assert.equal(result.bookingConversionRate, 60);
    assert.equal(result.approvalRate, 66.7);
});

test('business funnel is zero-safe and caps conversion at one hundred percent', () => {
    const empty = calculateBusinessFunnelMetrics();
    assert.deepEqual(empty, {
        appointmentRequests: 0,
        convertedAppointments: 0,
        completedAppointments: 0,
        bookingConversionRate: 0,
        approvalRate: 0
    });

    const repeated = calculateBusinessFunnelMetrics({
        profileViews: 1,
        appointmentCounts: { completed: 3 }
    });
    assert.equal(repeated.bookingConversionRate, 100);
    assert.equal(repeated.approvalRate, 100);
});
