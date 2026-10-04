import { incrementMetric } from '../services/achievementEngine.js';
import mongoose from 'mongoose';
import Pack from '../models/Pack.js';
import User from '../models/User.js';
import PackSignal from '../models/PackSignal.js';
import { createNotification } from './notificationController.js';
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
} from '../utils/packMembership.js';

// @desc    Get all packs (with search)
// @route   GET /api/packs
// @access  Public
export const getAllPacks = async (req, res) => {
    try {
        const { search, category, page = 1, limit = 20 } = req.query;
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
            
        res.status(200).json({
            status: 'success',
            data: packs.map(pack => {
                const packObj = pack.toJSON();
                const flags = membershipFlags(packObj, req.user?._id);
                packObj.isMember = flags.isMember;
                packObj.isPending = flags.isPending;
                packObj.isAdmin = flags.isAdmin;
                packObj.memberCount = packObj.memberCount ?? packMembers(packObj)
                    .filter((entry) => entry.role !== 'prospect').length;
                return packObj;
            }),
            hasMore: total > Number(page) * Number(limit)
        });
    } catch (error) {
        console.error('Error fetching packs:', error);
        res.status(500).json({ message: 'Server error fetching packs' });
    }
};

// @desc    Create a new Pack
// @route   POST /api/packs/create
// @access  Private
export const createPack = async (req, res) => {
    try {
        const { name, tag, description, coverImage, emblem, isPrivate } = req.body;
        const userId = req.user._id;

        // Check if pack name or tag exists
        const exists = await Pack.findOne({ $or: [{ name }, { tag }] });
        if (exists) {
            return res.status(400).json({ message: 'Pack with this name or tag already exists' });
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
        res.status(201).json(newPack);
    } catch (error) {
        console.error('Error creating pack:', error);
        res.status(500).json({ message: 'Server error creating pack' });
    }
};

// @desc    Get Pack Details (and calculate stats)
// @route   GET /api/packs/:packId
// @access  Public/Private
export const getPackDetails = async (req, res) => {
    try {
        const packId = req.params.packId;
        
        // Validate ObjectId to prevent CastError
        if (!packId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ message: 'Invalid Pack ID format' });
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
            return res.status(404).json({ message: 'Pack not found' });
        }

        // Convert to plain object to attach new properties safely
        const packObj = pack.toJSON();
        packObj.members = packMembers(packObj);

        // Check requester's approval status
        const requesterId = req.user?._id;
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

        res.status(200).json(packObj);
    } catch (error) {
        console.error('Error fetching pack details:', error);
        res.status(500).json({ message: 'Server error fetching pack details' });
    }
};

// @desc    Get list of pack members currently emitting location data
// @route   GET /api/packs/:packId/live-riders
// @access  Private
export const getLiveRiders = async (req, res) => {
    try {
        const packId = req.params.packId;
        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } })
            .select('memberRoles members joinRequests owner admins');

        if (!pack) {
            return res.status(404).json({ message: 'Pack not found' });
        }

        // Find requester member
        const requesterId = req.user._id;
        const activeMembers = packMembers(pack);
        const requesterMember = activeMembers.find(m => m.user?.toString() === requesterId.toString());
        
        if (!requesterMember || requesterMember.role === 'prospect') {
            return res.status(403).json({ message: 'You must be an approved klan member to see live riders.' });
        }

        const memberIds = activeMembers
            .filter(m => m.role !== 'prospect')
            .map(m => m.user.toString());
        
        // Activity threshold: 15 minutes
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        const activeUsers = await User.find({
            _id: { $in: memberIds },
            'lastCoordinates.coordinates': { $exists: true, $ne: [] },
            updatedAt: { $gte: fifteenMinutesAgo } // Only fresh location data
        }).select('name username avatar lastCoordinates');

        res.status(200).json(activeUsers);
    } catch (error) {
        console.error('Error fetching live riders:', error);
        res.status(500).json({ message: 'Server error fetching live riders' });
    }
};

// @desc    Join a Pack
// @route   POST /api/packs/:packId/join
// @access  Private
export const joinPack = async (req, res) => {
    try {
        const packId = req.params.packId;
        const userId = req.user._id;

        const pack = await Pack.findById(packId);
        if (!pack) {
            return res.status(404).json({ message: 'Pack not found' });
        }

        // Check if already a member OR prospect
        const existingMember = packMembers(pack).find(m => m.user?.toString() === userId.toString());
        if (existingMember) {
            if (existingMember.role === 'prospect') {
                return res.status(400).json({ message: 'Your join request is already pending approval.' });
            }
            return res.status(400).json({ message: 'Already a member of this pack' });
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

        res.status(200).json({ message: responseMessage, pack });
    } catch (error) {
        console.error('Error joining pack:', error);
        res.status(500).json({ message: `Server error joining pack: ${error.message}` });
    }
};

// @desc    Leave a Pack
// @route   POST /api/packs/:packId/leave
// @access  Private
export const leavePack = async (req, res) => {
    try {
        const packId = req.params.packId;
        const userId = req.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) {
            return res.status(404).json({ message: 'Pack not found' });
        }

        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);
        const memberIndex = pack.memberRoles.findIndex(
            (member) => member.user?.toString() === userId.toString(),
        );
        if (memberIndex === -1) {
            return res.status(400).json({ message: 'Not a member of this pack' });
        }

        // Check if Leader (Creator) - they can't leave unless they promote someone else or delete
        if (pack.memberRoles[memberIndex].role === 'leader') {
            return res.status(400).json({ message: 'Leader cannot leave without promoting another member first.' });
        }

        pack.memberRoles.splice(memberIndex, 1);
        pack.members = pack.members.filter(
            (member) => member.toString() !== userId.toString(),
        );
        syncMemberCount(pack);
        await pack.save();
        
        res.status(200).json({ message: 'Successfully left the pack' });
    } catch (error) {
        console.error('Error leaving pack:', error);
        res.status(500).json({ message: 'Server error leaving pack' });
    }
};

// @desc    Kick a member
// @route   DELETE /api/packs/:packId/members/:userId
// @access  Private (Leader only)
export const kickMember = async (req, res) => {
    try {
        const { packId, userId } = req.params;
        const requesterId = req.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Pack not found' });

        // Check if requester is Leader
        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);
        const requester = pack.memberRoles.find(
            (member) => member.user?.toString() === requesterId.toString(),
        );
        if (!requester || !canManagePackAction(pack, requesterId, 'kick')) {
            return res.status(403).json({ message: 'Only Leader can kick members' });
        }

        // Can't kick yourself
        if (userId === requesterId.toString()) {
            return res.status(400).json({ message: 'You cannot kick yourself' });
        }

        const target = pack.memberRoles.find(
            (member) => member.user?.toString() === userId,
        );
        if (!target) {
            return res.status(404).json({ message: 'Member not found in this pack' });
        }
        if (!canManageTargetMember(requester, target, 'kick')) {
            return res.status(403).json({ message: 'Bu üyeyi çıkarma yetkiniz yok.' });
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

        res.status(200).json({ message: 'Member kicked successfully' });
    } catch (error) {
        console.error('Error kicking member:', error);
        res.status(500).json({ message: 'Server error kicking member' });
    }
};

// @desc    Approve a join request
// @route   PUT /api/packs/:packId/members/:userId/approve
// @access  Private (Leader / Admin only)
export const approveJoinRequest = async (req, res) => {
    try {
        const { packId, userId } = req.params;
        const requesterId = req.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Pack not found' });

        if (!canManagePackAction(pack, requesterId, 'approve')) {
            return res.status(403).json({ message: 'Only Leader or Admin can approve members' });
        }

        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);

        const targetIndex = pack.memberRoles.findIndex(
            (m) => memberUserId(m) === userId.toString(),
        );

        if (targetIndex === -1) {
            return res.status(404).json({ message: 'User is not in the pack members list' });
        }

        if (memberRole(pack.memberRoles[targetIndex]) !== 'prospect') {
            return res.status(400).json({ message: 'User is already approved or not a prospect' });
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

        res.status(200).json({ message: 'Join request approved', pack });
    } catch (error) {
        console.error('Error approving join request:', error);
        res.status(500).json({ message: 'Server error approving join request' });
    }
};

// @desc    Reject a join request
// @route   PUT /api/packs/:packId/members/:userId/reject
// @access  Private (Leader / Admin only)
export const rejectJoinRequest = async (req, res) => {
    try {
        const { packId, userId } = req.params;
        const requesterId = req.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Pack not found' });

        if (!canManagePackAction(pack, requesterId, 'reject')) {
            return res.status(403).json({ message: 'Only Leader or Admin can reject members' });
        }

        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);

        const targetIndex = pack.memberRoles.findIndex(
            (m) => memberUserId(m) === userId.toString(),
        );

        if (targetIndex === -1 && !(pack.joinRequests || []).some(r => r.user?.toString() === userId.toString())) {
            return res.status(404).json({ message: 'User is not in the pack members list' });
        }

        if (targetIndex !== -1 && memberRole(pack.memberRoles[targetIndex]) !== 'prospect') {
            return res.status(400).json({ message: 'User is already approved or not a prospect' });
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

        res.status(200).json({ message: 'Join request rejected' });
    } catch (error) {
        console.error('Error rejecting join request:', error);
        res.status(500).json({ message: 'Server error rejecting join request' });
    }
};

// @desc    Change a member role or transfer leadership
// @route   PUT /api/packs/:packId/members/:userId/role
// @access  Private (leader only)
export const updateMemberRole = async (req, res) => {
    try {
        const { packId, userId } = req.params;
        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Klan bulunamadı.' });

        if (!pack.memberRoles?.length) pack.memberRoles = packMembers(pack);
        const actor = pack.memberRoles.find(
            (member) => member.user?.toString() === req.user._id.toString(),
        );
        const target = pack.memberRoles.find(
            (member) => member.user?.toString() === userId,
        );
        if (!actor || memberRole(actor) !== 'leader') {
            return res.status(403).json({ message: 'Rol değişikliği yalnızca klan lideri tarafından yapılabilir.' });
        }
        if (!target || memberRole(target) === 'prospect') {
            return res.status(404).json({ message: 'Onaylı üye bulunamadı.' });
        }

        const role = normalizePackRole(req.body?.role, '');
        if (!['leader', 'admin', 'moderator', 'member'].includes(role)) {
            return res.status(400).json({ message: 'Geçersiz klan rolü.' });
        }
        if (role === 'leader') {
            if (memberUserId(target) === memberUserId(actor)) {
                return res.status(400).json({ message: 'Bu üye zaten klan lideri.' });
            }
            actor.role = 'admin';
            target.role = 'leader';
            pack.owner = target.user;
        } else {
            if (memberRole(target) === 'leader') {
                return res.status(400).json({ message: 'Liderlik yalnızca başka bir üyeye devredilebilir.' });
            }
            target.role = role;
        }
        syncMemberCount(pack);
        await pack.save();
        res.status(200).json({ message: 'Üye rolü güncellendi.', role });
    } catch (error) {
        console.error('updateMemberRole error:', error);
        res.status(500).json({ message: 'Üye rolü güncellenemedi.' });
    }
};

// @desc    Migrate legacy member roles to canonical memberRoles structure
// @route   POST /api/packs/:packId/migrate-roles
// @access  Private (Leader only)
export const migratePackMemberRoles = async (req, res) => {
    try {
        const { packId } = req.params;
        const userId = req.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Klan bulunamadı.' });

        const actor = findPackMember(pack, userId);
        if (memberRole(actor) !== 'leader') {
            return res.status(403).json({ message: 'Yalnızca klan lideri rol geçişi yapabilir.' });
        }

        pack.memberRoles = packMembers(pack).map(m => ({
            user: memberUserId(m),
            role: memberRole(m),
            joinedAt: m.joinedAt || new Date()
        }));

        syncMemberCount(pack);
        await pack.save();

        res.status(200).json({
            message: 'Roller başarıyla taşındı.',
            memberRoles: pack.memberRoles
        });
    } catch (error) {
        console.error('migratePackMemberRoles error:', error);
        res.status(500).json({ message: 'Rol migration işlemi başarısız oldu.' });
    }
};

// @desc    Update Pack Details
// @route   PUT /api/packs/:packId
// @access  Private (Leader / Admin only)
export const updatePack = async (req, res) => {
    try {
        const packId = req.params.packId;
        const userId = req.user._id;
        const { name, tag, description, coverImage, emblem, isPrivate } = req.body;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Pack not found' });

        if (!canManagePackAction(pack, userId, 'announcement') && memberRole(findPackMember(pack, userId)) !== 'leader') {
            return res.status(403).json({ message: 'Only Leader or Admin can update pack' });
        }

        if (name) pack.name = name;
        if (tag) pack.tag = tag;
        if (description) pack.description = description;
        if (coverImage) pack.coverImage = coverImage;
        if (emblem) pack.emblem = emblem;
        if (typeof isPrivate !== 'undefined') pack.isPrivate = isPrivate;

        await pack.save();
        res.status(200).json(pack);
    } catch (error) {
        console.error('Error updating pack:', error);
        res.status(500).json({ message: 'Server error updating pack' });
    }
};

// @desc    Get Pack Signals
// @route   GET /api/packs/:packId/signals
// @access  Private (Approved Members only)
export const getPackSignals = async (req, res) => {
    try {
        const packId = req.params.packId;
        const userId = req.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Pack not found' });

        if (!isApprovedMember(pack, userId)) {
            return res.status(403).json({ message: 'Only approved klan members can see signals.' });
        }

        const signals = await PackSignal.find({ pack: packId })
            .populate('user', 'name avatar')
            .sort({ createdAt: -1 })
            .limit(50);

        res.status(200).json(signals);
    } catch (error) {
        console.error('Error fetching signals:', error);
        res.status(500).json({ message: 'Server error fetching signals' });
    }
};

// @desc    Create a Pack Signal
// @route   POST /api/packs/:packId/signals
// @access  Private (Approved Members only)
export const createPackSignal = async (req, res) => {
    try {
        const packId = req.params.packId;
        const userId = req.user._id;
        const { type, content, coordinates } = req.body;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Pack not found' });

        if (!isApprovedMember(pack, userId)) {
            return res.status(403).json({ message: 'Only approved klan members can send signals.' });
        }

        const newSignal = await PackSignal.create({
            pack: packId,
            user: userId,
            type,
            content,
            coordinates
        });

        res.status(201).json(newSignal);
    } catch (error) {
        console.error('Error creating signal:', error);
        res.status(500).json({ message: 'Server error creating signal' });
    }
};

// @desc    Create an upcoming ride for pack
// @route   POST /api/packs/:packId/rides
// @access  Private (Leader/Admin/Moderator)
export const createPackRide = async (req, res) => {
    try {
        const { packId } = req.params;
        const userId = req.user._id;
        const { routeName, startsAt, pace = 'Tempolu', routeId } = req.body;

        if (!routeName || !startsAt) {
            return res.status(400).json({ message: 'Rota adı ve başlama tarihi zorunludur.' });
        }

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Klan bulunamadı.' });

        if (!canManagePackAction(pack, userId, 'announcement') && memberRole(findPackMember(pack, userId)) !== 'leader') {
            return res.status(403).json({ message: 'Sürüş oluşturma yetkiniz yok.' });
        }

        const newRide = {
            routeName: routeName.trim(),
            startsAt: new Date(startsAt),
            pace,
            routeId: routeId && mongoose.Types.ObjectId.isValid(routeId) ? routeId : null,
            attendeeIds: [userId],
            isActive: true,
        };

        pack.upcomingRides = pack.upcomingRides || [];
        pack.upcomingRides.push(newRide);
        await pack.save();

        const createdRide = pack.upcomingRides[pack.upcomingRides.length - 1];
        res.status(201).json({
            message: 'Sürüş başarıyla oluşturuldu.',
            ride: createdRide,
            upcomingRides: pack.upcomingRides
        });
    } catch (error) {
        console.error('createPackRide error:', error);
        res.status(500).json({ message: 'Sürüş oluşturulamadı.' });
    }
};

// @desc    Update an upcoming ride
// @route   PUT /api/packs/:packId/rides/:rideId
// @access  Private (Leader/Admin/Moderator)
export const updatePackRide = async (req, res) => {
    try {
        const { packId, rideId } = req.params;
        const userId = req.user._id;
        const { routeName, startsAt, pace, routeId, isActive } = req.body;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Klan bulunamadı.' });

        if (!canManagePackAction(pack, userId, 'announcement') && memberRole(findPackMember(pack, userId)) !== 'leader') {
            return res.status(403).json({ message: 'Sürüşü güncelleme yetkiniz yok.' });
        }

        const ride = pack.upcomingRides?.id(rideId);
        if (!ride) return res.status(404).json({ message: 'Sürüş bulunamadı.' });

        if (routeName) ride.routeName = routeName.trim();
        if (startsAt) ride.startsAt = new Date(startsAt);
        if (pace) ride.pace = pace;
        if (routeId !== undefined) {
            ride.routeId = routeId && mongoose.Types.ObjectId.isValid(routeId) ? routeId : null;
        }
        if (typeof isActive !== 'undefined') ride.isActive = isActive;

        await pack.save();
        res.status(200).json({ message: 'Sürüş güncellendi.', ride });
    } catch (error) {
        console.error('updatePackRide error:', error);
        res.status(500).json({ message: 'Sürüş güncellenemedi.' });
    }
};

// @desc    Delete an upcoming ride
// @route   DELETE /api/packs/:packId/rides/:rideId
// @access  Private (Leader/Admin/Moderator)
export const deletePackRide = async (req, res) => {
    try {
        const { packId, rideId } = req.params;
        const userId = req.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Klan bulunamadı.' });

        if (!canManagePackAction(pack, userId, 'announcement') && memberRole(findPackMember(pack, userId)) !== 'leader') {
            return res.status(403).json({ message: 'Sürüşü silme yetkiniz yok.' });
        }

        const ride = pack.upcomingRides?.id(rideId);
        if (!ride) return res.status(404).json({ message: 'Sürüş bulunamadı.' });

        pack.upcomingRides.pull({ _id: rideId });
        await pack.save();

        res.status(200).json({ message: 'Sürüş silindi.' });
    } catch (error) {
        console.error('deletePackRide error:', error);
        res.status(500).json({ message: 'Sürüş silinemedi.' });
    }
};

// @desc    Toggle the current member's attendance on an upcoming pack ride
// @route   POST /api/packs/:packId/rides/:rideId/attendance
// @access  Private (approved members only)
export const toggleRideAttendance = async (req, res) => {
    try {
        const { packId, rideId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(packId) || !mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({ message: 'Geçersiz klan veya sürüş kimliği.' });
        }

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Klan bulunamadı.' });

        if (!isApprovedMember(pack, userId)) {
            return res.status(403).json({ message: 'Sürüş panosu yalnızca onaylı üyelere açıktır.' });
        }

        const ride = pack.upcomingRides?.id(rideId);
        if (!ride || ride.isActive === false) {
            return res.status(404).json({ message: 'Planlanan sürüş bulunamadı.' });
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
        res.status(200).json({
            isJoined,
            participantCount: ride.attendeeIds.length,
            attendeeIds: ride.attendeeIds,
        });
    } catch (error) {
        console.error('toggleRideAttendance error:', error);
        res.status(500).json({ message: 'Sürüş katılımı güncellenemedi.' });
    }
};

// @desc    Delete a Pack
// @route   DELETE /api/packs/:packId
// @access  Private (Leader / Leader only)
export const deletePack = async (req, res) => {
    try {
        const packId = req.params.packId;
        const userId = req.user._id;

        const pack = await Pack.findOne({ _id: packId, isDeleted: { $ne: true } });
        if (!pack) return res.status(404).json({ message: 'Pack not found' });

        const actor = findPackMember(pack, userId);
        if (memberRole(actor) !== 'leader') {
            return res.status(403).json({ message: 'Only Leader can delete the klan.' });
        }

        pack.isDeleted = true;
        await pack.save();
        
        // Clean up signals
        await PackSignal.deleteMany({ pack: packId });

        res.status(200).json({ message: 'Pack deleted successfully' });
    } catch (error) {
        console.error('Error deleting pack:', error);
        res.status(500).json({ message: 'Server error deleting pack' });
    }
};

// @desc    Get pack leaderboard
// @route   GET /api/packs/leaderboard
// @access  Private
export const getPackLeaderboard = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (page - 1) * limit;

        const packs = await Pack.find({ isDeleted: { $ne: true } })
            .sort({ 'fleetStats.totalKmRidden': -1, memberCount: -1 })
            .skip(Number(skip))
            .limit(Number(limit));

        const total = await Pack.countDocuments({ isDeleted: { $ne: true } });
        const hasMore = total > page * limit;

        res.status(200).json({
            status: 'success',
            data: packs.map(pack => {
                const packObj = pack.toJSON();
                const flags = membershipFlags(packObj, req.user?._id);
                packObj.isMember = flags.isMember;
                packObj.isPending = flags.isPending;
                packObj.isAdmin = flags.isAdmin;
                packObj.memberCount = packObj.memberCount ?? packMembers(packObj)
                    .filter((entry) => entry.role !== 'prospect').length;
                return packObj;
            }),
            hasMore
        });
    } catch (error) {
        console.error('Error fetching pack leaderboard:', error);
        res.status(500).json({ message: 'Server error fetching pack leaderboard' });
    }
};

// @desc    Get pack posts
// @route   GET /api/packs/:packId/posts
// @access  Private
export const getPackPosts = async (req, res) => {
    try {
        const { packId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const Pack = mongoose.model('Pack');
        const pack = await Pack.findById(packId);
        if (!pack) {
            return res.status(404).json({ success: false, message: 'Pack not found' });
        }

        const Post = mongoose.model('Post');
        let query = {};
        const schemaPaths = Post.schema.paths;
        if (schemaPaths.pack) {
            query.pack = packId;
        } else {
            return res.status(200).json({ success: true, data: [], hasMore: false });
        }

        const posts = await Post.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('user', 'name username avatar')
            .populate('bike', 'brand model');

        const total = await Post.countDocuments(query);

        res.status(200).json({
            success: true,
            data: posts,
            hasMore: total > skip + limit,
            total
        });
    } catch (error) {
        console.error('getPackPosts error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
