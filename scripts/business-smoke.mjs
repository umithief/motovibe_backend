/*
 * Run only against an isolated BİZ smoke account and database:
 * BUSINESS_SMOKE_BASE_URL=https://api.example.com \
 * BUSINESS_SMOKE_CUSTOMER_TOKEN=... BUSINESS_SMOKE_BUSINESS_TOKEN=... \
 * BUSINESS_SMOKE_BUSINESS_ID=... BUSINESS_SMOKE_SLOT=2026-... \
 * BUSINESS_SMOKE_CANCEL_SLOT=2026-... node scripts/business-smoke.mjs
 */
import assert from 'node:assert/strict';

const config = {
    baseUrl: String(process.env.BUSINESS_SMOKE_BASE_URL || '').replace(/\/+$/, ''),
    customerToken: String(process.env.BUSINESS_SMOKE_CUSTOMER_TOKEN || ''),
    businessToken: String(process.env.BUSINESS_SMOKE_BUSINESS_TOKEN || ''),
    businessId: String(process.env.BUSINESS_SMOKE_BUSINESS_ID || ''),
    slot: String(process.env.BUSINESS_SMOKE_SLOT || ''),
    cancelSlot: String(process.env.BUSINESS_SMOKE_CANCEL_SLOT || ''),
    disabledSlot: String(process.env.BUSINESS_SMOKE_DISABLED_SLOT || ''),
    closedDate: String(process.env.BUSINESS_SMOKE_CLOSED_DATE || ''),
    addressLat: String(process.env.BUSINESS_SMOKE_ADDRESS_LAT || ''),
    addressLng: String(process.env.BUSINESS_SMOKE_ADDRESS_LNG || '')
};

for (const [key, value] of Object.entries(config)) {
    assert.ok(value, `Missing BUSINESS_SMOKE_${key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`);
}

const request = async (path, { token, method = 'GET', body } = {}) => {
    const response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
};

const expectStatus = (result, expected, label) => {
    assert.equal(
        result.response.status,
        expected,
        `${label}: ${JSON.stringify(result.json)}`
    );
    return result.json;
};

const createAppointment = async (date, notes) => {
    const result = await request('/api/appointments', {
        token: config.customerToken,
        method: 'POST',
        body: {
            businessId: config.businessId,
            service: 'BİZ smoke bakım',
            date,
            durationMin: 60,
            notes
        }
    });
    return expectStatus(result, 201, 'appointment create').data.appointment;
};

const transition = async (id, status, reason) => {
    const result = await request(`/api/appointments/${id}`, {
        token: config.businessToken,
        method: 'PATCH',
        body: { status, ...(reason ? { reason } : {}) }
    });
    return expectStatus(result, 200, `appointment ${status}`).data.appointment;
};

console.log('1. Create → pending → approve → inProgress → completed');
const completed = await createAppointment(config.slot, 'BİZ smoke lifecycle');
assert.equal(completed.status, 'pending');
assert.equal((await transition(completed._id, 'approved')).status, 'approved');
assert.equal((await transition(completed._id, 'inProgress')).status, 'inProgress');
assert.equal((await transition(completed._id, 'completed')).status, 'completed');

console.log('2. Reject/cancel roles and rejection reason');
const blocked = await createAppointment(config.cancelSlot, 'BİZ smoke conflict');
const conflictAvailability = await request(
    `/api/appointments/availability?businessId=${config.businessId}&date=${encodeURIComponent(config.cancelSlot)}&durationMin=60`,
    { token: config.customerToken }
);
expectStatus(conflictAvailability, 200, 'conflict availability');
assert.equal(
    conflictAvailability.json.data.slots.includes(new Date(config.cancelSlot).toISOString()),
    false,
    'active appointment did not reserve its slot'
);
const customerCancellation = await request(`/api/appointments/${blocked._id}`, {
    token: config.customerToken,
    method: 'PATCH',
    body: { status: 'cancelled', reason: 'BİZ smoke customer cancellation' }
});
assert.equal(expectStatus(customerCancellation, 200, 'customer cancellation').data.appointment.status, 'cancelled');
const rejected = await createAppointment(config.cancelSlot, 'BİZ smoke rejection');
assert.equal(
    (await transition(rejected._id, 'rejected', 'Usta kapasitesi bugün dolu.')).status,
    'rejected'
);

console.log('3. Availability: closed date, conflict and duration');
const closed = await request(
    `/api/appointments/availability?businessId=${config.businessId}&date=${encodeURIComponent(config.closedDate)}&durationMin=60`,
    { token: config.customerToken }
);
expectStatus(closed, 200, 'closed-day availability');
assert.ok(Array.isArray(closed.json?.data?.slots));

console.log('4. acceptsAppointments=false blocks creation and restores state');
const me = expectStatus(
    await request('/api/users/profile', { token: config.businessToken }),
    200,
    'business profile read'
).data.user;
const previousAcceptsAppointments = me.businessProfile?.acceptsAppointments !== false;
expectStatus(
    await request('/api/users/business-profile', {
        token: config.businessToken,
        method: 'PATCH',
        body: { acceptsAppointments: false }
    }),
    200,
    'disable appointments'
);
const disabledCreate = await request('/api/appointments', {
    token: config.customerToken,
    method: 'POST',
    body: {
        businessId: config.businessId,
        service: 'BİZ smoke disabled',
        date: config.disabledSlot,
        durationMin: 60
    }
});
assert.ok([400, 403].includes(disabledCreate.response.status), 'disabled business accepted an appointment');
expectStatus(
    await request('/api/users/business-profile', {
        token: config.businessToken,
        method: 'PATCH',
        body: { acceptsAppointments: previousAcceptsAppointments }
    }),
    200,
    'restore appointments'
);

console.log('5. Address/category persist and public data hygiene');
expectStatus(
    await request('/api/users/business-profile', {
        token: config.businessToken,
        method: 'PATCH',
        body: {
            category: 'SERVICE',
            addressCoordinates: [Number(config.addressLng), Number(config.addressLat)],
            addressLabel: 'BİZ smoke konum'
        }
    }),
    200,
    'business address update'
);
const publicProfile = await request(`/api/users/${config.businessId}`);
expectStatus(publicProfile, 200, 'public business profile');
const serialized = JSON.stringify(publicProfile.json);
assert.equal(serialized.includes('"taxId"'), false, 'public profile leaked taxId');
assert.equal(serialized.includes('BİZ smoke konum'), true, 'public profile did not persist address');

console.log('6. Reviews, analytics and commerce authentication');
expectStatus(
    await request(`/api/business-reviews/${config.businessId}`),
    200,
    'business reviews'
);
expectStatus(
    await request('/api/business-analytics/dashboard', { token: config.businessToken }),
    200,
    'business analytics'
);
expectStatus(
    await request('/api/business-commerce/summary', { token: config.businessToken }),
    200,
    'business commerce'
);

console.log('7. Directory near and verified filters');
const directory = await request(
    '/api/users/professionals?lat=41.0082&lng=28.9784&radius=30&verified=true',
    { token: config.customerToken }
);
expectStatus(directory, 200, 'professional directory');

console.log('BİZ smoke passed. Use a disposable smoke business: this script creates appointments.');
