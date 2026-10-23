import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildBusinessCatalogItemInput,
    isValidBusinessCoordinates,
    normalizeBusinessWorkingHours
} from "../modules/users/controller.js";

test('business coordinates enforce longitude and latitude bounds', () => {
    assert.equal(isValidBusinessCoordinates([28.9784, 41.0082]), true);
    assert.equal(isValidBusinessCoordinates([181, 41]), false);
    assert.equal(isValidBusinessCoordinates([29, -91]), false);
    assert.equal(isValidBusinessCoordinates(['x', 41]), false);
});

test('catalog duration is validated and defaults to sixty minutes', () => {
    const defaultDuration = buildBusinessCatalogItemInput({
        name: 'Zincir bakımı', category: 'Bakım', price: 450
    });
    assert.equal(defaultDuration.value.durationMin, 60);

    const invalidDuration = buildBusinessCatalogItemInput({
        name: 'Detaylı bakım', category: 'Bakım', price: 850, durationMin: 47
    });
    assert.match(invalidDuration.error, /süresi/);
});

test('business working hours reject invalid, duplicate and reversed slots', () => {
    assert.match(
        normalizeBusinessWorkingHours([
            { day: 'Pazartesi', open: '18:00', close: '09:00' }
        ]).error,
        /kapanış/
    );
    assert.match(
        normalizeBusinessWorkingHours([
            { day: 'Pazartesi', open: '09:00', close: '18:00' },
            { day: 'Pazartesi', open: '10:00', close: '19:00' }
        ]).error,
        /yinelenmiş/
    );
});

test('business working hours normalize a valid weekly schedule', () => {
    const result = normalizeBusinessWorkingHours([
        { day: 'Pazartesi', open: '09:00', close: '18:00' },
        { day: 'Pazar', isClosed: true }
    ]);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.value, [
        { day: 'Pazartesi', open: '09:00', close: '18:00', isClosed: false },
        { day: 'Pazar', open: '09:00', close: '18:00', isClosed: true }
    ]);
});
