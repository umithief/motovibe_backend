import mongoose from 'mongoose';

export function userLookupQuery(idOrUsername) {
    const base = { isDeleted: { $ne: true } };
    if (mongoose.isValidObjectId(idOrUsername)) {
        return { _id: idOrUsername, ...base };
    }
    return { username: String(idOrUsername || '').toLowerCase().trim(), ...base };
}

export function resolveViewerAccess(user, req) {
    const viewerId = req.user?.id ? String(req.user.id) : null;
    const userId = user._id.toString();
    const isMe = !!(viewerId && viewerId === userId);
    const viewerBlocked = (req.user?.blockedUsers || []).some((id) => id.toString() === userId);
    const targetBlocked = (user.blockedUsers || []).some((id) => viewerId && id.toString() === viewerId);
    const blocked = !!(!isMe && viewerId && (viewerBlocked || targetBlocked));
    const followersIds = (user.followers || []).map((id) => id.toString());
    const followingIds = (user.following || []).map((id) => id.toString());
    const isFollowing = viewerId ? followersIds.includes(viewerId) : false;
    const isPrivate = user.privacy?.isPrivate === true;
    const isLocked = isPrivate && !isMe && !isFollowing;
    const hideLocation = user.privacy?.hideLocation === true;
    return {
        viewerId,
        isMe,
        blocked,
        isFollowing,
        isPrivate,
        isLocked,
        hideLocation,
        followersIds,
        followingIds
    };
}

export function stripGarageVerificationImages(garage) {
    if (!Array.isArray(garage)) return garage || [];
    return garage.map((bike) => {
        if (!bike || typeof bike !== 'object') return bike;
        const clone = { ...bike };
        delete clone.verificationImage;
        return clone;
    });
}

export function stripPublicUserFields(userObj, { hideLocation = false } = {}) {
    delete userObj.email;
    delete userObj.phone;
    delete userObj.emergencyPhone;
    delete userObj.emergencyContacts;
    delete userObj.lastCoordinates;
    delete userObj.coordinates;
    delete userObj.verificationImage;
    delete userObj.spotifyRefreshToken;
    delete userObj.cart;
    delete userObj.blockedUsers;
    delete userObj.isAdmin;
    delete userObj.revenueCatId;
    delete userObj.expenses;
    delete userObj.password;
    delete userObj.interestVector;
    userObj.garage = stripGarageVerificationImages(userObj.garage);
    if (hideLocation) {
        delete userObj.address;
        delete userObj.location;
        if (userObj.businessProfile && typeof userObj.businessProfile === 'object') {
            delete userObj.businessProfile.address;
        }
    }
    return userObj;
}
