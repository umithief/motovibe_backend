import assert from 'node:assert/strict';
import test from 'node:test';

import {
    canManagePackAction,
    canManageTargetMember,
    membershipFlags,
    normalizePackRole,
    packMembers,
} from '../utils/packMembership.js';

const user = (id) => ({ _id: id, toString: () => id });

test('legacy membership projects to one normalized role vocabulary', () => {
    const pack = {
        owner: user('leader'),
        admins: [user('admin')],
        members: [user('leader'), user('admin'), user('member')],
        joinRequests: [{ user: user('prospect') }],
    };
    const roles = packMembers(pack).map((member) => [member.user._id, member.role]);
    assert.deepEqual(roles, [
        ['leader', 'leader'],
        ['admin', 'admin'],
        ['member', 'member'],
        ['prospect', 'prospect'],
    ]);
    assert.equal(normalizePackRole('ROAD_CAPTAIN'), 'leader');
});

test('canonical memberships provide stable viewer flags', () => {
    const pack = {
        memberRoles: [
            { user: user('leader'), role: 'leader' },
            { user: user('pending'), role: 'prospect' },
        ],
    };
    assert.deepEqual(membershipFlags(pack, 'leader'), {
        isMember: true,
        isPending: false,
        isAdmin: true,
        role: 'leader',
    });
    assert.deepEqual(membershipFlags(pack, 'pending'), {
        isMember: false,
        isPending: true,
        isAdmin: false,
        role: 'prospect',
    });
});

test('moderation matrix protects leadership while allowing normal operations', () => {
    const pack = {
        memberRoles: [
            { user: user('leader'), role: 'leader' },
            { user: user('admin'), role: 'admin' },
            { user: user('moderator'), role: 'moderator' },
            { user: user('member'), role: 'member' },
        ],
    };
    assert.equal(canManagePackAction(pack, 'moderator', 'approve'), true);
    assert.equal(canManagePackAction(pack, 'moderator', 'kick'), false);
    assert.equal(canManagePackAction(pack, 'admin', 'kick'), true);
    assert.equal(
        canManageTargetMember(pack.memberRoles[1], pack.memberRoles[3], 'kick'),
        true,
    );
    assert.equal(
        canManageTargetMember(pack.memberRoles[1], pack.memberRoles[0], 'kick'),
        false,
    );
});
