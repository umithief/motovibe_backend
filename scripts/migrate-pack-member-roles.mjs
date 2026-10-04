import 'dotenv/config';
import mongoose from 'mongoose';

const isApply = process.argv.includes('--apply');
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    throw new Error('MONGO_URI ortam değişkeni zorunludur.');
}

const rolePriority = { member: 1, moderator: 2, admin: 3, leader: 4, prospect: 0 };
const normalizeRole = (value, fallback = 'member') => {
    const key = value?.toString().trim().toLowerCase().replace(/[\s-]+/g, '_');
    return {
        road_captain: 'leader',
        roadcaptain: 'leader',
        leader: 'leader',
        admin: 'admin',
        moderator: 'moderator',
        member: 'member',
        prospect: 'prospect',
    }[key] || fallback;
};

const stringId = (value) => value?._id?.toString?.() || value?.toString?.() || '';

const buildMemberRoles = (pack) => {
    const byUser = new Map();
    const adminIds = new Set((pack.admins || []).map(stringId));
    const requestIds = new Set((pack.joinRequests || []).map((item) => stringId(item?.user)));
    const ownerId = stringId(pack.owner);

    const register = (candidate, role, joinedAt) => {
        const userId = stringId(candidate?.user ?? candidate);
        if (!userId) return;
        const normalizedRole = normalizeRole(
            role,
            userId === ownerId
                ? 'leader'
                : adminIds.has(userId)
                    ? 'admin'
                    : requestIds.has(userId)
                        ? 'prospect'
                        : 'member',
        );
        const existing = byUser.get(userId);
        if (!existing || rolePriority[normalizedRole] > rolePriority[existing.role]) {
            byUser.set(userId, {
                user: candidate?.user ?? candidate,
                role: normalizedRole,
                joinedAt: joinedAt || existing?.joinedAt || pack.createdAt || new Date(),
            });
        }
    };

    (pack.memberRoles || []).forEach((member) => register(member, member.role, member.joinedAt));
    (pack.members || []).forEach((member) => register(member, member?.role, member?.joinedAt));
    if (pack.owner) register(pack.owner, 'leader', pack.createdAt);

    const members = [...byUser.values()];
    if (members.length > 0 && !members.some((member) => member.role === 'leader')) {
        members[0].role = 'leader';
    }
    return members;
};

try {
    await mongoose.connect(mongoUri);
    const packs = mongoose.connection.collection('packs');
    const cursor = packs.find({ isDeleted: { $ne: true } });
    let scanned = 0;
    let changed = 0;

    for await (const pack of cursor) {
        scanned += 1;
        const memberRoles = buildMemberRoles(pack);
        const memberCount = memberRoles.filter((member) => member.role !== 'prospect').length;
        const current = JSON.stringify((pack.memberRoles || []).map((member) => ({
            user: stringId(member.user),
            role: normalizeRole(member.role),
        })));
        const next = JSON.stringify(memberRoles.map((member) => ({
            user: stringId(member.user),
            role: member.role,
        })));
        if (current === next && pack.memberCount === memberCount) continue;
        changed += 1;

        if (isApply) {
            await packs.updateOne(
                { _id: pack._id },
                { $set: { memberRoles, memberCount } },
            );
        }
    }

    console.log(JSON.stringify({ mode: isApply ? 'apply' : 'dry-run', scanned, changed }));
    if (!isApply) {
        console.log('Yazmak için aynı komutu --apply ile çalıştırın. Legacy alanlar bu adımda silinmez.');
    }
} finally {
    await mongoose.disconnect();
}
