import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import {
    resolveViewerAccess,
    stripPublicUserFields,
    userLookupQuery
} from "../modules/users/controller.js";

function makeUser(overrides = {}) {
    return {
        _id: new mongoose.Types.ObjectId('64b000000000000000000001'),
        followers: [],
        following: [],
        blockedUsers: [],
        privacy: { isPrivate: false, hideLocation: false },
        email: 'secret@example.com',
        phone: '555',
        emergencyPhone: '112',
        address: 'Kadıköy',
        location: 'İstanbul',
        lastCoordinates: { type: 'Point', coordinates: [29, 41] },
        isAdmin: true,
        revenueCatId: 'rc_1',
        expenses: [{ type: 'FUEL', amount: 100 }],
        garage: [{ brand: 'Yamaha', verificationImage: 'http://x/id.jpg' }],
        businessProfile: { address: { type: 'Point', coordinates: [29, 41] } },
        ...overrides
    };
}

test('user lookup lowercases username, accepts object ids, and excludes deleted users', () => {
    const id = '64b000000000000000000001';
    assert.deepEqual(userLookupQuery(id), { _id: id, isDeleted: { $ne: true } });
    assert.deepEqual(userLookupQuery('YamahaRider'), { username: 'yamaharider', isDeleted: { $ne: true } });
});

test('blocked viewer cannot access the target profile', () => {
    const targetId = new mongoose.Types.ObjectId('64b000000000000000000001');
    const viewerId = '64b000000000000000000002';
    const user = makeUser({
        _id: targetId,
        blockedUsers: [new mongoose.Types.ObjectId(viewerId)]
    });
    const access = resolveViewerAccess(user, { user: { id: viewerId, blockedUsers: [] } });
    assert.equal(access.blocked, true);
    assert.equal(access.isLocked, false);
});

test('private account is locked unless the viewer follows', () => {
    const targetId = new mongoose.Types.ObjectId('64b000000000000000000001');
    const viewerId = '64b000000000000000000002';
    const user = makeUser({
        _id: targetId,
        privacy: { isPrivate: true, hideLocation: false }
    });
    const locked = resolveViewerAccess(user, { user: { id: viewerId, blockedUsers: [] } });
    assert.equal(locked.isLocked, true);
    assert.equal(locked.isFollowing, false);

    const following = resolveViewerAccess(
        makeUser({
            _id: targetId,
            privacy: { isPrivate: true, hideLocation: false },
            followers: [viewerId]
        }),
        { user: { id: viewerId, blockedUsers: [] } }
    );
    assert.equal(following.isLocked, false);
    assert.equal(following.isFollowing, true);
});

test('public strip removes PII, admin, garage verification image and location when hidden', () => {
    const userObj = makeUser();
    stripPublicUserFields(userObj, { hideLocation: true });
    assert.equal(userObj.email, undefined);
    assert.equal(userObj.phone, undefined);
    assert.equal(userObj.emergencyPhone, undefined);
    assert.equal(userObj.isAdmin, undefined);
    assert.equal(userObj.revenueCatId, undefined);
    assert.equal(userObj.expenses, undefined);
    assert.equal(userObj.lastCoordinates, undefined);
    assert.equal(userObj.address, undefined);
    assert.equal(userObj.location, undefined);
    assert.equal(userObj.businessProfile.address, undefined);
    assert.equal(userObj.garage[0].verificationImage, undefined);
    assert.equal(userObj.garage[0].brand, 'Yamaha');
});

test('Post and Reel models declare isDeleted and visibility fields', async () => {
    const { default: Post } = await import("../modules/posts/model.js");
    const { default: Reel } = await import("../modules/reels/model.js");

    assert.ok(Post.schema.path('isDeleted'), 'Post schema should have isDeleted path');
    assert.ok(Post.schema.path('visibility'), 'Post schema should have visibility path');
    assert.ok(Reel.schema.path('isDeleted'), 'Reel schema should have isDeleted path');
});
