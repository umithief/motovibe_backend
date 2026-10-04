import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import Appointment from '../models/Appointment.js';
import {
    ACTIVE_APPOINTMENT_STATUSES,
    appointmentFitsWorkingHours,
    isAppointmentTransitionAllowed
} from '../controllers/appointmentController.js';

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
    const mondayAtTen = new Date(2026, 7, 10, 10, 0);
    const mondayAtSeventeenThirty = new Date(2026, 7, 10, 17, 30);

    assert.equal(appointmentFitsWorkingHours(mondayHours, mondayAtTen, 60), true);
    assert.equal(
        appointmentFitsWorkingHours(mondayHours, mondayAtSeventeenThirty, 60),
        false
    );
});

test('working-hour rule rejects closed or missing business days', () => {
    const mondayAtTen = new Date(2026, 7, 10, 10, 0);
    const tuesdayAtTen = new Date(2026, 7, 11, 10, 0);
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
