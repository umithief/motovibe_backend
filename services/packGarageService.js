import mongoose from 'mongoose';
import Pack from '../models/Pack.js';
import User from '../models/User.js';

const toNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
        return new mongoose.Types.ObjectId(value);
    }
    return null;
};

let legacyMemberMigrationPromise = null;

export const normalizeLegacyPackMembers = async () => {
    if (legacyMemberMigrationPromise) {
        return legacyMemberMigrationPromise;
    }

    legacyMemberMigrationPromise = (async () => {
        try {
            const legacyPacks = await Pack.collection.find({ 'members.user': { $exists: true } }).toArray();
            if (legacyPacks.length === 0) return;

            for (const pack of legacyPacks) {
                const newMembers = (pack.members || []).map(m => m.user ? m.user : m);
                await Pack.collection.updateOne(
                    { _id: pack._id },
                    { $set: { members: newMembers } }
                );
            }
        } catch (error) {
            legacyMemberMigrationPromise = null;
            throw error;
        }
    })();

    return legacyMemberMigrationPromise;
};

export const calculateGarageStatsFromUsers = (users = []) => {
    let totalCC = 0;
    let totalHP = 0;
    let bikeCount = 0;

    users.forEach((user) => {
        const garage = Array.isArray(user?.garage) ? user.garage : [];
        garage.forEach((bike) => {
            // Only count verified bikes for CC, HP, and bikeCount under packs
            if (bike?.isVerified === true || bike?.verificationStatus === 'approved') {
                totalCC += toNumber(bike?.cc);
                totalHP += toNumber(bike?.hp);
                bikeCount += 1;
            }
        });
    });

    return {
        totalCC,
        totalHP,
        bikeCount,
    };
};

export const recalculatePackGarageStats = async (packId, options = {}) => {
    await normalizeLegacyPackMembers();

    const objectId = toObjectId(packId);
    if (!objectId) return null;

    const pack = await Pack.findById(objectId)
        .select('_id members owner admins')
        .lean();
    if (!pack) return null;

    const ownerId = toObjectId(pack.owner);
    const adminIds = (Array.isArray(pack.admins) ? pack.admins : []).map(toObjectId).filter(Boolean);
    const memberIds = (Array.isArray(pack.members) ? pack.members : []).map(toObjectId).filter(Boolean);

    // Merge to ensure everyone's bikes are counted
    const allMemberIds = [];
    const idSet = new Set();

    if (ownerId) {
        allMemberIds.push(ownerId);
        idSet.add(ownerId.toString());
    }

    adminIds.forEach(id => {
        const str = id.toString();
        if (!idSet.has(str)) {
            allMemberIds.push(id);
            idSet.add(str);
        }
    });

    memberIds.forEach(id => {
        const str = id.toString();
        if (!idSet.has(str)) {
            allMemberIds.push(id);
            idSet.add(str);
        }
    });

    if (allMemberIds.length === 0) {
        const zeroStats = { totalCC: 0, totalHP: 0, bikeCount: 0 };
        await Pack.updateOne(
            { _id: objectId },
            { $set: { garageStats: zeroStats } },
            options,
        );
        return zeroStats;
    }

    const users = await User.find({ _id: { $in: allMemberIds } })
        .select('_id garage')
        .lean();
    const stats = calculateGarageStatsFromUsers(users);

    await Pack.updateOne(
        { _id: objectId },
        { $set: { garageStats: stats } },
        options,
    );

    return stats;
};

export const recalculatePacksForUser = async (userId) => {
    await normalizeLegacyPackMembers();

    const objectId = toObjectId(userId);
    if (!objectId) return [];

    const packs = await Pack.find({ members: objectId }).select('_id').lean();
    if (packs.length === 0) return [];

    return Promise.all(
        packs.map((pack) => recalculatePackGarageStats(pack._id)),
    );
};

export const refreshPackGlobalRanks = async () => {
    const packs = await Pack.find({}).select('_id garageStats name').lean();

    const leaderboardRaw = packs.map(pack => {
        const cc = toNumber(pack.garageStats?.totalCC);
        const hp = toNumber(pack.garageStats?.totalHP);
        return {
            _id: pack._id,
            totalCC: cc,
            totalHP: hp,
            powerScore: cc + hp,
            name: pack.name || '',
        };
    });

    leaderboardRaw.sort((a, b) => {
        if (b.powerScore !== a.powerScore) return b.powerScore - a.powerScore;
        if (b.totalCC !== a.totalCC) return b.totalCC - a.totalCC;
        if (b.totalHP !== a.totalHP) return b.totalHP - a.totalHP;
        return a.name.localeCompare(b.name);
    });

    if (leaderboardRaw.length === 0) return 0;

    const operations = leaderboardRaw.map((pack, index) => ({
        updateOne: {
            filter: { _id: pack._id },
            update: { $set: { globalRank: index + 1 } },
        },
    }));

    if (operations.length > 0) {
        await Pack.bulkWrite(operations);
    }

    return operations.length;
};
