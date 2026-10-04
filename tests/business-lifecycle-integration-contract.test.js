import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import {
    ACTIVE_APPOINTMENT_STATUSES,
    appointmentFitsWorkingHours,
    isAppointmentTransitionAllowed,
    resolveAppointmentService
} from '../controllers/appointmentController.js';
import {
    businessProfileForPublic,
    buildBusinessFlashOfferInput,
    isValidBusinessCoordinates,
    normalizeProfessionalStatusForResponse,
    sanitizeBusinessFlashOffers
} from '../controllers/userController.js';

const mondayHours = [
    { day: 'Pazartesi', open: '09:00', close: '18:00', isClosed: false }
];

test('01 PERSONAL account upgrades into a coherent PROFESSIONAL BİZ mode', () => {
    const user = { userType: 'PROFESSIONAL', activeProfileMode: null };
    normalizeProfessionalStatusForResponse(user);
    assert.equal(user.userType, 'PROFESSIONAL');
    assert.equal(user.activeProfileMode, 'PROFESSIONAL');
});

test('02 editor fields survive the public business projection', () => {
    const publicProfile = businessProfileForPublic({
        businessName: 'Moto Usta',
        businessPhone: '+905551112233',
        workingHours: mondayHours
    });
    assert.equal(publicProfile.businessName, 'Moto Usta');
    assert.equal(publicProfile.businessPhone, '+905551112233');
    assert.deepEqual(publicProfile.workingHours, mondayHours);
});

test('03 a valid editor location remains usable for directions', () => {
    const coordinates = [28.9784, 41.0082];
    assert.equal(isValidBusinessCoordinates(coordinates), true);
    const publicProfile = businessProfileForPublic({
        address: { type: 'Point', coordinates, label: 'Kadıköy, İstanbul' }
    });
    assert.deepEqual(publicProfile.address.coordinates, coordinates);
});

test('04 appointment lifecycle supports request approval and completion', () => {
    assert.equal(isAppointmentTransitionAllowed('pending', 'approved'), true);
    assert.equal(isAppointmentTransitionAllowed('approved', 'inProgress'), true);
    assert.equal(isAppointmentTransitionAllowed('inProgress', 'completed'), true);
});

test('05 appointments outside working hours are rejected', () => {
    const mondayAtNineteen = new Date(2026, 7, 10, 19, 0);
    assert.equal(
        appointmentFitsWorkingHours(mondayHours, mondayAtNineteen, 60),
        false
    );
});

test('06 catalog appointments resolve from the selected active item', () => {
    const itemId = new mongoose.Types.ObjectId();
    const resolved = resolveAppointmentService({
        requestedService: 'untrusted client label',
        catalogItemId: itemId,
        catalogItems: [{ _id: itemId, name: 'Zincir Bakımı', isActive: true }],
        services: []
    });
    assert.deepEqual(resolved, { service: 'Zincir Bakımı' });
});

test('07 individual mode cannot retain a stale PROFESSIONAL visitor surface', () => {
    const user = { userType: 'INDIVIDUAL', activeProfileMode: 'PROFESSIONAL' };
    normalizeProfessionalStatusForResponse(user);
    assert.equal(user.activeProfileMode, 'PERSONAL');
});

test('08 downgrade cancellation covers every slot-reserving status', () => {
    assert.deepEqual(ACTIVE_APPOINTMENT_STATUSES, [
        'pending',
        'approved',
        'inProgress'
    ]);
    for (const status of ACTIVE_APPOINTMENT_STATUSES) {
        assert.equal(isAppointmentTransitionAllowed(status, 'cancelled'), true);
    }
});

test('09 public business data excludes tax and payment provider secrets', () => {
    const publicProfile = businessProfileForPublic({
        businessName: 'Moto Usta',
        taxId: '1234567890',
        iyzicoSubMerchantKey: 'sub-key-secret'
    });
    assert.equal('taxId' in publicProfile, false);
    assert.equal('iyzicoSubMerchantKey' in publicProfile, false);
});

test('10 flash offer create cancel and expiry states normalize safely', () => {
    const created = buildBusinessFlashOfferInput({
        title: 'Gece Bakımı',
        description: 'Bu gece geçerli',
        discountRate: 20,
        durationMinutes: 60,
        targetRadiusKm: 10
    });
    assert.equal(created.error, undefined);
    assert.equal(sanitizeBusinessFlashOffers([created.value])[0].isActive, true);

    const cancelled = sanitizeBusinessFlashOffers([
        { ...created.value, isActive: false }
    ]);
    assert.equal(cancelled[0].isActive, false);

    const expired = sanitizeBusinessFlashOffers([
        { ...created.value, validUntil: new Date(Date.now() - 1000) }
    ]);
    assert.equal(expired[0].isActive, false);
});
