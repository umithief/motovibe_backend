import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import Appointment from "../modules/appointments/model.js";
import {
    ACTIVE_APPOINTMENT_STATUSES,
    appointmentFitsWorkingHours,
    businessClock,
    businessInstant,
    isAppointmentTransitionAllowed,
    withBusinessBookingLock
} from "../modules/appointments/controller.js";

const mondayHours = [
    { day: 'Pazartesi', open: '09:00', close: '18:00', isClosed: false }
];

test('appointment status machine accepts only supported lifecycle transitions', () => {
    assert.equal(isAppointmentTransitionAllowed('pending', 'approved'), true);
    assert.equal(isAppointmentTransitionAllowed('pending', 'rejected'), true);
    assert.equal(isAppointmentTransitionAllowed('approved', 'inProgress'), true);
    assert.equal(isAppointmentTransitionAllowed('inProgress', 'completed'), true);
    assert.equal(isAppointmentTransitionAllowed('approved', 'completed'), false);
    assert.equal(isAppointmentTransitionAllowed('rejected', 'approved'), false);
    assert.equal(isAppointmentTransitionAllowed('completed', 'pending'), false);
});

test('working-hour rule accepts a fitting appointment and rejects overflow', () => {
    // Explicit Istanbul times: the rule must not depend on the server's TZ.
    const mondayAtTen = new Date('2026-08-10T10:00:00+03:00');
    const mondayAtSeventeenThirty = new Date('2026-08-10T17:30:00+03:00');

    assert.equal(appointmentFitsWorkingHours(mondayHours, mondayAtTen, 60), true);
    assert.equal(
        appointmentFitsWorkingHours(mondayHours, mondayAtSeventeenThirty, 60),
        false
    );
});

test('working-hour rule rejects closed or missing business days', () => {
    const mondayAtTen = new Date('2026-08-10T10:00:00+03:00');
    const tuesdayAtTen = new Date('2026-08-11T10:00:00+03:00');
    const closedMonday = [
        { day: 'Pazartesi', open: '09:00', close: '18:00', isClosed: true }
    ];

    assert.equal(
        appointmentFitsWorkingHours(closedMonday, mondayAtTen, 60),
        false
    );
    assert.equal(appointmentFitsWorkingHours(mondayHours, tuesdayAtTen, 60), false);
    assert.equal(appointmentFitsWorkingHours([], mondayAtTen, 60), false);
});

test('only open lifecycle states reserve an appointment slot', () => {
    assert.deepEqual(ACTIVE_APPOINTMENT_STATUSES, [
        'pending',
        'approved',
        'inProgress'
    ]);
});

test('appointments persist a bounded rejection or cancellation reason', () => {
    const appointment = new Appointment({
        businessId: new mongoose.Types.ObjectId(),
        customerId: new mongoose.Types.ObjectId(),
        service: 'Bakım',
        date: new Date(),
        status: 'rejected',
        statusReason: 'Usta kapasitesi bugün dolu.'
    });
    assert.equal(appointment.statusReason, 'Usta kapasitesi bugün dolu.');
});

test('working hours read the workshop clock, not the server timezone', () => {
    // 09:30 in Istanbul is 06:30 UTC; a UTC server once rejected it.
    const earlyMorning = new Date('2026-08-10T06:30:00Z');
    assert.equal(appointmentFitsWorkingHours(mondayHours, earlyMorning, 60), true);
    // 18:30 in Istanbul is 15:30 UTC; it is after closing time.
    const evening = new Date('2026-08-10T15:30:00Z');
    assert.equal(appointmentFitsWorkingHours(mondayHours, evening, 60), false);
    // Sunday 23:30 UTC is already Monday 02:30 in Istanbul.
    assert.equal(businessClock(new Date('2026-08-09T23:30:00Z')).weekday, 1);
});

test('business wall-clock times map to the right instants', () => {
    assert.equal(
        businessInstant(2026, 8, 10, 9 * 60).toISOString(),
        '2026-08-10T06:00:00.000Z'
    );
    // Day overflow rolls into the next month on the workshop calendar.
    assert.equal(
        businessInstant(2026, 8, 32, 0).toISOString(),
        '2026-08-31T21:00:00.000Z'
    );
});

test('bookings for one business run one at a time, others in parallel', async () => {
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const log = [];
    const book = (business, name) => withBusinessBookingLock(business, async () => {
        log.push(`${name}:check`);
        await tick();
        await tick();
        log.push(`${name}:insert`);
        return name;
    });
    const results = await Promise.all([
        book('garage', 'first'),
        book('garage', 'second'),
        book('cafe', 'other')
    ]);
    assert.deepEqual(results, ['first', 'second', 'other']);
    // The second rider checks only after the first booking is written.
    assert.ok(log.indexOf('first:insert') < log.indexOf('second:check'));
    // Another business is not held up by the garage queue.
    assert.ok(log.indexOf('other:check') < log.indexOf('first:insert'));
});

test('a rejected booking releases the business for the next rider', async () => {
    await assert.rejects(
        withBusinessBookingLock('garage', async () => { throw new Error('dolu'); }),
        /dolu/
    );
    assert.equal(await withBusinessBookingLock('garage', async () => 'next'), 'next');
});
