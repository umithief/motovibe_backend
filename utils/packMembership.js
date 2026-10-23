export const PACK_ROLES = Object.freeze([
    'leader',
    'admin',
    'moderator',
    'member',
    'prospect',
]);

const legacyRoleMap = Object.freeze({
    road_captain: 'leader',
    roadcaptain: 'leader',
    leader: 'leader',
    admin: 'admin',
    moderator: 'moderator',
    member: 'member',
    prospect: 'prospect',
});

export const normalizePackRole = (value, fallback = 'member') => {
    const key = value?.toString().trim().toLowerCase().replace(/[\s-]+/g, '_');
    return legacyRoleMap[key] || fallback;
};

export const memberUserId = (member) => {
    const user = member?.user ?? member;
    return user?._id?.toString?.() || user?.toString?.() || '';
};

const legacyMembers = (pack) => {
    const owners = pack?.owner ? [{ user: pack.owner, role: 'leader' }] : [];
    const adminIds = new Set((pack?.admins || []).map((id) => id?.toString()));
    const pendingIds = new Set(
        (pack?.joinRequests || []).map((entry) => entry?.user?.toString()),
    );
    const members = (pack?.members || []).map((entry) => {
        const userId = memberUserId(entry);
        const explicitRole = entry?.role;
        return {
            user: entry?.user ?? entry,
            role: normalizePackRole(
                explicitRole,
                userId === pack?.owner?.toString()
                    ? 'leader'
                    : adminIds.has(userId)
                        ? 'admin'
                        : pendingIds.has(userId)
                            ? 'prospect'
                            : 'member',
            ),
            joinedAt: entry?.joinedAt,
        };
    });
    const requests = (pack?.joinRequests || []).map((request) => ({
        user: request?.user,
        role: 'prospect',
        joinedAt: request?.requestedAt,
    }));
    return [...owners, ...members, ...requests];
};

/** The staged read path supports legacy records until migration is applied. */
export const packMembers = (pack) => {
    const source = (pack?.memberRoles || []).length > 0
        ? pack.memberRoles
        : legacyMembers(pack);
    const seen = new Set();
    return source.filter((member) => {
        const userId = memberUserId(member);
        if (!userId || seen.has(userId)) return false;
        seen.add(userId);
        return true;
    });
};

export const findPackMember = (pack, userId) =>
    packMembers(pack).find((member) => memberUserId(member) === userId?.toString());

export const memberRole = (member) => normalizePackRole(member?.role, 'member');

export const isApprovedMember = (pack, userId) => {
    const member = findPackMember(pack, userId);
    return Boolean(member) && memberRole(member) !== 'prospect';
};

/** Ids of approved (non-prospect) members; pack content is visible only to them. */
export const approvedMemberIds = (pack) => packMembers(pack)
    .filter((member) => memberRole(member) !== 'prospect')
    .map(memberUserId);

export const membershipFlags = (pack, userId) => {
    const member = findPackMember(pack, userId);
    const role = memberRole(member);
    return {
        isMember: Boolean(member) && role !== 'prospect',
        isPending: Boolean(member) && role === 'prospect',
        isAdmin: ['leader', 'admin', 'moderator'].includes(role),
        role: member ? role : null,
    };
};

export const canManagePackAction = (pack, userId, action) => {
    const role = memberRole(findPackMember(pack, userId));
    if (role === 'leader') return true;
    if (role === 'admin') {
        return ['approve', 'reject', 'kick', 'pin', 'announcement'].includes(action);
    }
    if (role === 'moderator') {
        return ['approve', 'reject', 'pin', 'announcement'].includes(action);
    }
    return false;
};

export const canManageTargetMember = (actor, target, action) => {
    const actorRole = memberRole(actor);
    const targetRole = memberRole(target);
    if (!actor || !target) return false;
    if (action !== 'kick') return false;
    if (actorRole === 'leader') return targetRole !== 'leader';
    return actorRole === 'admin' && ['member', 'prospect'].includes(targetRole);
};

export const syncMemberCount = (pack) => {
    pack.memberCount = packMembers(pack).filter(
        (member) => memberRole(member) !== 'prospect',
    ).length;
    return pack.memberCount;
};
