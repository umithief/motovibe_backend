import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-with-at-least-32-characters';

const {
    appendRefreshSession,
    createRefreshSession,
    getRefreshTokenFamilyId,
    hashOpaqueToken,
    signAccessToken,
    verifyAccessToken,
} = await import("../modules/auth/service.js");

test('access tokens are audience-bound and carry the revocation version', () => {
    const user = {
        _id: { toString: () => '507f1f77bcf86cd799439011' },
        tokenVersion: 7,
    };
    const token = signAccessToken(user);
    const decoded = verifyAccessToken(token);

    assert.equal(decoded.id, '507f1f77bcf86cd799439011');
    assert.equal(decoded.tokenVersion, 7);
    assert.equal(decoded.iss, 'motovibe-api');
    assert.equal(decoded.aud, 'motovibe-app');
});

test('refresh credentials are random and only their hashes are persisted', () => {
    const first = createRefreshSession();
    const second = createRefreshSession();

    assert.notEqual(first.refreshToken, second.refreshToken);
    assert.equal(first.session.tokenHash, hashOpaqueToken(first.refreshToken));
    assert.notEqual(first.session.tokenHash, first.refreshToken);
    assert.equal(getRefreshTokenFamilyId(first.refreshToken), first.session.familyId);
    const rotated = createRefreshSession({ familyId: first.session.familyId });
    assert.equal(rotated.session.familyId, first.session.familyId);
    assert.notEqual(rotated.refreshToken, first.refreshToken);
    assert.ok(first.session.expiresAt > first.session.createdAt);
});

test('in-memory session normalization drops expired sessions and caps devices', () => {
    const now = Date.now();
    const user = {
        refreshSessions: [
            { tokenHash: 'expired', expiresAt: new Date(now - 1) },
            ...Array.from({ length: 5 }, (_, index) => ({
                tokenHash: `active-${index}`,
                expiresAt: new Date(now + 60_000),
            })),
        ],
    };
    const newest = {
        tokenHash: 'newest',
        createdAt: new Date(now),
        expiresAt: new Date(now + 60_000),
    };

    appendRefreshSession(user, newest);

    assert.deepEqual(
        user.refreshSessions.map((session) => session.tokenHash),
        ['active-1', 'active-2', 'active-3', 'active-4', 'newest'],
    );
});
