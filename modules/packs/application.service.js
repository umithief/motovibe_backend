import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';
import { getActiveRiders } from '../../radarSocket.js';

import { raiseHttpError } from '../../utils/httpError.js';

import { incrementMetric } from "../achievements/service.js";
import mongoose from 'mongoose';
import Pack from "./model.js";
import User from "../users/model.js";
import PackSignal from "./PackSignal.model.js";
import { createNotification } from "../notifications/service.js";
import {
    canManagePackAction,
    canManageTargetMember,
    findPackMember,
    isApprovedMember,
    membershipFlags,
    memberRole,
    memberUserId,
    normalizePackRole,
    packMembers,
    syncMemberCount,
} from "../../utils/packMembership.js";

// @desc    Get all packs (with search)
// @route   GET /api/packs
// @access  Public
export const getAllPacks = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { search, category, page = 1, limit = 20 } = input.query;
        const skip = (Number(page) - 1) * Number(limit);

        let query = { isDeleted: { $ne: true } };
        let sort = { createdAt: -1 };

        if (search) {
            query = {
                isDeleted: { $ne: true },
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { tag: { $regex: search, $options: 'i' } }
                ]
            };
        }

        // Category filtering logic
        if (category === 'ÖZEL') {
            query.isPrivate = true;
        } else if (category === 'POPÜLER') {
            sort = { memberCount: -1, updatedAt: -1 };
        } else if (category === 'RADARDA') {
            sort = { 'updatedAt': -1 };
        }

        const total = await Pack.countDocuments(query);
        const packs = await Pack.find(query)
            .select('name tag description emblem coverImage leaderProfile memberRoles members joinRequests owner admins isPrivate isVerified isFeatured memberCount garageStats globalRank location tier winRate')
            .sort(sort)
            .skip(skip)
            .limit(Number(limit));

        respond({
            status: 'success',
            data: packs.map(pack => {
                const packObj = pack.toJSON();
                const flags = membershipFlags(packObj, input.user?._id);
                packObj.isMember = flags.isMember;
                packObj.isPending = flags.isPending;
                packObj.isAdmin = flags.isAdmin;
                packObj.memberCount = packObj.memberCount ?? packMembers(packObj)
                    .filter((entry) => entry.role !== 'prospect').length;
                return packObj;
            }),
            hasMore: total > Number(page) * Number(limit)
        },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Create a new Pack
// @route   POST /api/packs/create
// @access  Private
export const createPack = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { name, tag, description, coverImage, emblem, isPrivate } = input.body;
        const userId = input.user._id;

        // Check if pack name or tag exists
        const exists = await Pack.findOne({ $or: [{ name }, { tag }] });
        if (exists) {
            return raiseHttpError({ message: 'Pack with this name or tag already exists' },400);
        }

        const newPack = await Pack.create({
            name,
            tag,
            description,
            coverImage,
            emblem,
            isPrivate,
            owner: userId,
            // Legacy readers keep the flat identifier list during migration.
            members: [userId],
            memberRoles: [{
                user: userId,
                role: 'leader',
                joinedAt: new Date()
            }],
            memberCount: 1,
            garageStats: {
                totalCC: 0,
                totalHP: 0,
                bikeCount: 0,
                powerScore: 0
            }
        });

        incrementMetric(userId, 'packLeads', 1).catch(err => console.error(err));
        respond(newPack,201);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get Pack Details (and calculate stats)
// @route   GET /api/packs/:packId
// @access  Public/Private
export const getPackDetails = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const packId = input.params.packId;

        // Validate ObjectId to prevent CastError
        if (!packId.match(/^[0-9a-fA-F]{24}$/)) {
            return raiseHttpError({ message: 'Invalid Pack ID format' },400);
        }

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } }).populate([
            {
                path: 'memberRoles.user',
                select: 'name username avatar garage lastActiveGarageId lastCoordinates'
            },
            {
                path: 'members',
                select: 'name username avatar garage lastActiveGarageId lastCoordinates'
            }
        ]);

        if (!pack) {
            return raiseHttpError({ message: 'Pack not found' },404);
        }

        // Convert to plain object to attach new properties safely
        const packObj = pack.toJSON();
        packObj.members = packMembers(packObj);

        // Check requester's approval status
        const requesterId = input.user?._id;
        const requesterMember = packObj.members.find(m => (m.user?._id || m.user)?.toString() === requesterId?.toString());
        const flags = membershipFlags(packObj, requesterId);
        const isApproved = flags.isMember;
        packObj.isMember = flags.isMember;
        packObj.isPending = flags.isPending;
        packObj.isAdmin = flags.isAdmin;

        // Privacy Logic: If private and not approved, mask data
        if (packObj.isPrivate && !isApproved) {
            packObj.isLocked = true;
            packObj.rules = '';
            packObj.upcomingRides = [];
            packObj.joinRequests = [];
            // Only show Leader in members list for non-approved users
            packObj.members = packObj.members.filter(m => m.role === 'leader');

            // Allow the requesting user to see their own membership status (e.g. PROSPECT)
            if (requesterMember && requesterMember.role === 'prospect') {
                packObj.members.push(requesterMember);
            }
        } else {
            packObj.isLocked = false;
        }

        let totalCC = 0;
        let totalKmRidden = 0;

        // Calculate fleetStats from active bikes
        packObj.members.forEach(member => {
            if (member.user && typeof member.user === 'object' && member.user.garage && member.user.garage.length > 0) {
                const activeBike = member.user.garage.find(
                    bike => bike._id && member.user.lastActiveGarageId &&
                            bike._id.toString() === member.user.lastActiveGarageId.toString()
                ) || member.user.garage[0];

                if (activeBike) {
                    if (activeBike.cc) totalCC += activeBike.cc;
                    if (activeBike.km) totalKmRidden += activeBike.km;
                }
            }
        });

        packObj.fleetStats = {
            totalCC,
            totalKmRidden
        };

        respond(packObj,200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get list of pack members currently emitting location data
// @route   GET /api/packs/:packId/live-riders
// @access  Private
export const getLiveRiders = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const packId = input.params.packId;
        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } })
            .select('memberRoles members joinRequests owner admins');

        if (!pack) {
            return raiseHttpError({ message: 'Pack not found' },404);
        }

        // Find requester member
        const requesterId = input.user._id;
        const activeMembers = packMembers(pack);
        const requesterMember = activeMembers.find(m => m.user?.toString() === requesterId.toString());

        if (!requesterMember || requesterMember.role === 'prospect') {
            return raiseHttpError({ message: 'You must be an approved klan member to see live riders.' },403);
        }

        const memberIds = activeMembers
            .filter(m => m.role !== 'prospect')
            .map(m => m.user.toString());

        // Check real-time active in-memory socket riders first
        const liveMemoryRiders = getActiveRiders().filter(r =>
            (r.packId && r.packId.toString() === packId.toString()) ||
            (r.userId && memberIds.includes(r.userId.toString()))
        );

        if (liveMemoryRiders.length > 0) {
            respond(liveMemoryRiders, 200);
            return response;
        }

        // Activity threshold: 15 seconds (prevents stale/ghost riders from persisting)
        const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000);

        const activeUsers = await User.find({
            _id: { $in: memberIds },
            'lastCoordinates.coordinates': { $exists: true, $ne: [] },
            updatedAt: { $gte: fifteenSecondsAgo } // Only fresh location data
        }).select('name username avatar lastCoordinates');

        respond(activeUsers,200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Join a Pack
// @route   POST /api/packs/:packId/join
// @access  Private
export const joinPack = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const packId = input.params.packId;
        const userId = input.user._id;

        const pack = await Pack.findById(packId);
        if (!pack) {
            return raiseHttpError({ message: 'Pack not found' },404);
        }

        // Check if already a member OR prospect
        const existingMember = packMembers(pack).find(m => m.user?.toString() === userId.toString());
        if (existingMember) {
            if (existingMember.role === 'prospect') {
                return raiseHttpError({ message: 'Your join request is already pending approval.' },400);
            }
            return raiseHttpError({ message: 'Already a member of this pack' },400);
        }

        if (!pack.memberRoles?.length) {
            pack.memberRoles = packMembers(pack);
        }
        const role = pack.isPrivate ? 'prospect' : 'member';
        pack.memberRoles.push({ user: userId, role, joinedAt: new Date() });
        if (!pack.members.some((member) => member.toString() === userId.toString())) {
            pack.members.push(userId);
        }
        syncMemberCount(pack);
        await pack.save();

        // Find the leader in the canonical role list and notify only for private requests.
        const roadCaptain = pack.memberRoles.find(m => m.role === 'leader');
        if (roadCaptain && role === 'prospect') {
            await createNotification({
                recipient: roadCaptain.user,
                sender: userId,
                type: 'JOIN_REQUEST',
                pack: packId
            });
        }

        const responseMessage = pack.isPrivate
            ? 'Katılım isteğiniz gönderildi.'
            : 'Klana katıldınız.';

        respond({ message: responseMessage, pack },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Leave a Pack
// @route   POST /api/packs/:packId/leave
// @access  Private
export const leavePack = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const packId = input.params.packId;
        const userId = input.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) {
            return raiseHttpError({ message: 'Pack not found' },404);
        }

        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);
        const memberIndex = pack.memberRoles.findIndex(
            (member) => member.user?.toString() === userId.toString(),
        );
        if (memberIndex === -1) {
            return raiseHttpError({ message: 'Not a member of this pack' },400);
        }

        // Check if Leader (Creator) - they can't leave unless they promote someone else or delete
        if (pack.memberRoles[memberIndex].role === 'leader') {
            return raiseHttpError({ message: 'Leader cannot leave without promoting another member first.' },400);
        }

        pack.memberRoles.splice(memberIndex, 1);
        pack.members = pack.members.filter(
            (member) => member.toString() !== userId.toString(),
        );
        syncMemberCount(pack);
        await pack.save();

        respond({ message: 'Successfully left the pack' },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Kick a member
// @route   DELETE /api/packs/:packId/members/:userId
// @access  Private (Leader only)
export const kickMember = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, userId } = input.params;
        const requesterId = input.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Pack not found' },404);

        // Check if requester is Leader
        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);
        const requester = pack.memberRoles.find(
            (member) => member.user?.toString() === requesterId.toString(),
        );
        if (!requester || !canManagePackAction(pack, requesterId, 'kick')) {
            return raiseHttpError({ message: 'Only Leader can kick members' },403);
        }

        // Can't kick yourself
        if (userId === requesterId.toString()) {
            return raiseHttpError({ message: 'You cannot kick yourself' },400);
        }

        const target = pack.memberRoles.find(
            (member) => member.user?.toString() === userId,
        );
        if (!target) {
            return raiseHttpError({ message: 'Member not found in this pack' },404);
        }
        if (!canManageTargetMember(requester, target, 'kick')) {
            return raiseHttpError({ message: 'Bu üyeyi çıkarma yetkiniz yok.' },403);
        }

        const targetId = memberUserId(target);
        pack.memberRoles = pack.memberRoles.filter(
            (member) => memberUserId(member) !== targetId,
        );
        pack.members = pack.members.filter(
            (member) => memberUserId(member) !== targetId,
        );
        syncMemberCount(pack);
        await pack.save();

        await createNotification({
            recipient: targetId,
            sender: requesterId,
            type: 'PACK_MEMBER_REMOVED',
            pack: packId,
        });

        respond({ message: 'Member kicked successfully' },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Approve a join request
// @route   PUT /api/packs/:packId/members/:userId/approve
// @access  Private (Leader / Admin only)
export const approveJoinRequest = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, userId } = input.params;
        const requesterId = input.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Pack not found' },404);

        if (!canManagePackAction(pack, requesterId, 'approve')) {
            return raiseHttpError({ message: 'Only Leader or Admin can approve members' },403);
        }

        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);

        const targetIndex = pack.memberRoles.findIndex(
            (m) => memberUserId(m) === userId.toString(),
        );

        if (targetIndex === -1) {
            return raiseHttpError({ message: 'User is not in the pack members list' },404);
        }

        if (memberRole(pack.memberRoles[targetIndex]) !== 'prospect') {
            return raiseHttpError({ message: 'User is already approved or not a prospect' },400);
        }

        pack.memberRoles[targetIndex].role = 'member';

        // Ensure user is in flat members list as well
        if (!pack.members.some((m) => m?.toString() === userId.toString())) {
            pack.members.push(userId);
        }

        // Remove from joinRequests if present
        pack.joinRequests = (pack.joinRequests || []).filter(
            (r) => r.user?.toString() !== userId.toString(),
        );

        syncMemberCount(pack);
        await pack.save();

        await createNotification({
            recipient: userId,
            sender: requesterId,
            type: 'JOIN_APPROVED',
            pack: packId
        });

        respond({ message: 'Join request approved', pack },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Reject a join request
// @route   PUT /api/packs/:packId/members/:userId/reject
// @access  Private (Leader / Admin only)
export const rejectJoinRequest = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, userId } = input.params;
        const requesterId = input.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Pack not found' },404);

        if (!canManagePackAction(pack, requesterId, 'reject')) {
            return raiseHttpError({ message: 'Only Leader or Admin can reject members' },403);
        }

        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);

        const targetIndex = pack.memberRoles.findIndex(
            (m) => memberUserId(m) === userId.toString(),
        );

        if (targetIndex === -1 && !(pack.joinRequests || []).some(r => r.user?.toString() === userId.toString())) {
            return raiseHttpError({ message: 'User is not in the pack members list' },404);
        }

        if (targetIndex !== -1 && memberRole(pack.memberRoles[targetIndex]) !== 'prospect') {
            return raiseHttpError({ message: 'User is already approved or not a prospect' },400);
        }

        if (targetIndex !== -1) {
            pack.memberRoles.splice(targetIndex, 1);
        }
        pack.members = (pack.members || []).filter(
            (m) => m?.toString() !== userId.toString(),
        );
        pack.joinRequests = (pack.joinRequests || []).filter(
            (r) => r.user?.toString() !== userId.toString(),
        );

        syncMemberCount(pack);
        await pack.save();

        await createNotification({
            recipient: userId,
            sender: requesterId,
            type: 'JOIN_REJECTED',
            pack: packId
        });

        respond({ message: 'Join request rejected' },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Change a member role or transfer leadership
// @route   PUT /api/packs/:packId/members/:userId/role
// @access  Private (leader only)
export const updateMemberRole = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, userId } = input.params;
        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Klan bulunamadı.' },404);

        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);
        const actor = pack.memberRoles.find(
            (member) => member.user?.toString() === input.user._id.toString(),
        );
        const target = pack.memberRoles.find(
            (member) => member.user?.toString() === userId,
        );
        if (!actor || memberRole(actor) !== 'leader') {
            return raiseHttpError({ message: 'Rol değişikliği yalnızca klan lideri tarafından yapılabilir.' },403);
        }
        if (!target || memberRole(target) === 'prospect') {
            return raiseHttpError({ message: 'Onaylı üye bulunamadı.' },404);
        }

        const role = normalizePackRole(input.body?.role, '');
        if (!['leader', 'admin', 'moderator', 'member'].includes(role)) {
            return raiseHttpError({ message: 'Geçersiz klan rolü.' },400);
        }
        if (role === 'leader') {
            if (memberUserId(target) === memberUserId(actor)) {
                return raiseHttpError({ message: 'Bu üye zaten klan lideri.' },400);
            }
            actor.role = 'admin';
            target.role = 'leader';
            pack.owner = target.user;
        } else {
            if (memberRole(target) === 'leader') {
                return raiseHttpError({ message: 'Liderlik yalnızca başka bir üyeye devredilebilir.' },400);
            }
            target.role = role;
        }
        syncMemberCount(pack);
        await pack.save();
        respond({ message: 'Üye rolü güncellendi.', role },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Migrate legacy member roles to canonical memberRoles structure
// @route   POST /api/packs/:packId/migrate-roles
// @access  Private (Leader only)
export const migratePackMemberRoles = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        const userId = input.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Klan bulunamadı.' },404);

        const actor = findPackMember(pack, userId);
        if (memberRole(actor) !== 'leader') {
            return raiseHttpError({ message: 'Yalnızca klan lideri rol geçişi yapabilir.' },403);
        }

        pack.memberRoles = packMembers(pack).map(m => ({
            user: memberUserId(m),
            role: memberRole(m),
            joinedAt: m.joinedAt || new Date()
        }));

        syncMemberCount(pack);
        await pack.save();

        respond({
            message: 'Roller başarıyla taşındı.',
            memberRoles: pack.memberRoles
        },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Update Pack Details
// @route   PUT /api/packs/:packId
// @access  Private (Leader / Admin only)
export const updatePack = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const packId = input.params.packId;
        const userId = input.user._id;
        const { name, tag, description, coverImage, emblem, isPrivate } = input.body;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Pack not found' },404);

        if (!canManagePackAction(pack, userId, 'announcement') && memberRole(findPackMember(pack, userId)) !== 'leader') {
            return raiseHttpError({ message: 'Only Leader or Admin can update pack' },403);
        }

        if (name) pack.name = name;
        if (tag) pack.tag = tag;
        if (description) pack.description = description;
        if (coverImage) pack.coverImage = coverImage;
        if (emblem) pack.emblem = emblem;
        if (typeof isPrivate !== 'undefined') pack.isPrivate = isPrivate;

        await pack.save();
        respond(pack,200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get Pack Signals
// @route   GET /api/packs/:packId/signals
// @access  Private (Approved Members only)
export const getPackSignals = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const packId = input.params.packId;
        const userId = input.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Pack not found' },404);

        if (!isApprovedMember(pack, userId)) {
            return raiseHttpError({ message: 'Only approved klan members can see signals.' },403);
        }

        const signals = await PackSignal.find({ pack: packId })
            .populate('user', 'name avatar')
            .sort({ createdAt: -1 })
            .limit(50);

        respond(signals,200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Create a Pack Signal
// @route   POST /api/packs/:packId/signals
// @access  Private (Approved Members only)
export const createPackSignal = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const packId = input.params.packId;
        const userId = input.user._id;
        const { type, content, coordinates } = input.body;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Pack not found' },404);

        if (!isApprovedMember(pack, userId)) {
            return raiseHttpError({ message: 'Only approved klan members can send signals.' },403);
        }

        const newSignal = await PackSignal.create({
            pack: packId,
            user: userId,
            type,
            content,
            coordinates
        });

        respond(newSignal,201);
    } catch (error) { throw error; }

    return response;
};

const cleanRideText = (value, max) =>
    typeof value === 'string' ? value.trim().slice(0, max) : undefined;

// @desc    Create an upcoming ride for pack
// @route   POST /api/packs/:packId/rides
// @access  Private (Leader/Admin/Moderator)
export const createPackRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        const userId = input.user._id;
        const { routeName, startsAt, pace = 'Tempolu', routeId } = input.body;
        const image = cleanRideText(input.body.image ?? input.body.coverImage, 2048);
        const location = cleanRideText(input.body.location, 160);

        if (!routeName || !startsAt) {
            return raiseHttpError({ message: 'Rota adı ve başlama tarihi zorunludur.' },400);
        }

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Klan bulunamadı.' },404);

        if (!canManagePackAction(pack, userId, 'announcement') && memberRole(findPackMember(pack, userId)) !== 'leader') {
            return raiseHttpError({ message: 'Sürüş oluşturma yetkiniz yok.' },403);
        }

        const newRide = {
            routeName: routeName.trim(),
            startsAt: new Date(startsAt),
            pace,
            routeId: routeId && mongoose.Types.ObjectId.isValid(routeId) ? routeId : null,
            attendeeIds: [userId],
            isActive: true,
            ...(image ? { image } : {}),
            ...(location ? { location } : {}),
        };

        pack.upcomingRides = pack.upcomingRides || [];
        pack.upcomingRides.push(newRide);
        await pack.save();

        const createdRide = pack.upcomingRides[pack.upcomingRides.length - 1];
        respond({
            message: 'Sürüş başarıyla oluşturuldu.',
            ride: createdRide,
            upcomingRides: pack.upcomingRides
        },201);
    } catch (error) { throw error; }

    return response;
};

// @desc    Update an upcoming ride
// @route   PUT /api/packs/:packId/rides/:rideId
// @access  Private (Leader/Admin/Moderator)
export const updatePackRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, rideId } = input.params;
        const userId = input.user._id;
        const { routeName, startsAt, pace, routeId, isActive } = input.body;
        const image = cleanRideText(input.body.image ?? input.body.coverImage, 2048);
        const location = cleanRideText(input.body.location, 160);

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Klan bulunamadı.' },404);

        if (!canManagePackAction(pack, userId, 'announcement') && memberRole(findPackMember(pack, userId)) !== 'leader') {
            return raiseHttpError({ message: 'Sürüşü güncelleme yetkiniz yok.' },403);
        }

        const ride = pack.upcomingRides?.id(rideId);
        if (!ride) return raiseHttpError({ message: 'Sürüş bulunamadı.' },404);

        if (routeName) ride.routeName = routeName.trim();
        if (startsAt) ride.startsAt = new Date(startsAt);
        if (pace) ride.pace = pace;
        if (image !== undefined) ride.image = image;
        if (location !== undefined) ride.location = location;
        if (routeId !== undefined) {
            ride.routeId = routeId && mongoose.Types.ObjectId.isValid(routeId) ? routeId : null;
        }
        if (typeof isActive !== 'undefined') ride.isActive = isActive;

        await pack.save();
        respond({ message: 'Sürüş güncellendi.', ride },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Delete an upcoming ride
// @route   DELETE /api/packs/:packId/rides/:rideId
// @access  Private (Leader/Admin/Moderator)
export const deletePackRide = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, rideId } = input.params;
        const userId = input.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Klan bulunamadı.' },404);

        if (!canManagePackAction(pack, userId, 'announcement') && memberRole(findPackMember(pack, userId)) !== 'leader') {
            return raiseHttpError({ message: 'Sürüşü silme yetkiniz yok.' },403);
        }

        const ride = pack.upcomingRides?.id(rideId);
        if (!ride) return raiseHttpError({ message: 'Sürüş bulunamadı.' },404);

        pack.upcomingRides.pull({ _id: rideId });
        await pack.save();

        respond({ message: 'Sürüş silindi.' },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Toggle the current member's attendance on an upcoming pack ride
// @route   POST /api/packs/:packId/rides/:rideId/attendance
// @access  Private (approved members only)
export const toggleRideAttendance = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId, rideId } = input.params;
        const userId = input.user._id;

        if (!mongoose.Types.ObjectId.isValid(packId) || !mongoose.Types.ObjectId.isValid(rideId)) {
            return raiseHttpError({ message: 'Geçersiz klan veya sürüş kimliği.' },400);
        }

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Klan bulunamadı.' },404);

        if (!isApprovedMember(pack, userId)) {
            return raiseHttpError({ message: 'Sürüş panosu yalnızca onaylı üyelere açıktır.' },403);
        }

        const ride = pack.upcomingRides?.id(rideId);
        if (!ride || ride.isActive === false) {
            return raiseHttpError({ message: 'Planlanan sürüş bulunamadı.' },404);
        }

        const attendeeIndex = (ride.attendeeIds || []).findIndex(
            (id) => id.toString() === userId.toString(),
        );
        let isJoined;
        if (attendeeIndex === -1) {
            ride.attendeeIds.push(userId);
            isJoined = true;
        } else {
            ride.attendeeIds.splice(attendeeIndex, 1);
            isJoined = false;
        }

        await pack.save();
        respond({
            isJoined,
            participantCount: ride.attendeeIds.length,
            attendeeIds: ride.attendeeIds,
        },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Delete a Pack
// @route   DELETE /api/packs/:packId
// @access  Private (Leader / Leader only)
export const deletePack = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const packId = input.params.packId;
        const userId = input.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return raiseHttpError({ message: 'Pack not found' },404);

        const actor = findPackMember(pack, userId);
        if (memberRole(actor) !== 'leader') {
            return raiseHttpError({ message: 'Only Leader can delete the klan.' },403);
        }

        pack.isDeleted = true;
        await pack.save();

        // Clean up signals
        await PackSignal.deleteMany({ pack: packId });

        respond({ message: 'Pack deleted successfully' },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get pack leaderboard
// @route   GET /api/packs/leaderboard
// @access  Private
export const getPackLeaderboard = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { page = 1, limit = 20 } = input.query;
        const skip = (page - 1) * limit;

        const packs = await Pack.find({ isDeleted: { $ne: true } })
            .sort({ 'fleetStats.totalKmRidden': -1, memberCount: -1 })
            .skip(Number(skip))
            .limit(Number(limit));

        const total = await Pack.countDocuments({ isDeleted: { $ne: true } });
        const hasMore = total > page * limit;

        respond({
            status: 'success',
            data: packs.map(pack => {
                const packObj = pack.toJSON();
                const flags = membershipFlags(packObj, input.user?._id);
                packObj.isMember = flags.isMember;
                packObj.isPending = flags.isPending;
                packObj.isAdmin = flags.isAdmin;
                packObj.memberCount = packObj.memberCount ?? packMembers(packObj)
                    .filter((entry) => entry.role !== 'prospect').length;
                return packObj;
            }),
            hasMore
        },200);
    } catch (error) { throw error; }

    return response;
};

// @desc    Get pack posts
// @route   GET /api/packs/:packId/posts
// @access  Private
export const getPackPosts = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { packId } = input.params;
        const page = parseInt(input.query.page) || 1;
        const limit = parseInt(input.query.limit) || 20;
        const skip = (page - 1) * limit;

        const Pack = mongoose.model('Pack');
        const pack = await Pack.findById(packId);
        if (!pack) {
            return raiseHttpError({ success: false, message: 'Pack not found' },404);
        }

        const Post = mongoose.model('Post');
        let query = {};
        const schemaPaths = Post.schema.paths;
        if (schemaPaths.pack) {
            query.pack = packId;
        } else {
            return respond({ success: true, data: [], hasMore: false },200);
        }

        const posts = await Post.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('user', 'name username avatar')
            .populate('bike', 'brand model');

        const total = await Post.countDocuments(query);

        respond({
            success: true,
            data: posts,
            hasMore: total > skip + limit,
            total
        },200);
    } catch (error) { throw error; }

    return response;
};
