// Radar Socket Controller
const activeRiders = new Map();

// Throttle interval (1 second for snappy realtime radar sync)
const BROADCAST_INTERVAL = 1000;

// TTL in milliseconds (25 seconds safety threshold for abrupt network drop/disconnect)
const TTL = 25000;

export const getActiveRiders = () => Array.from(activeRiders.values());

export const initRadarSocket = (io, socket) => {
    const handleLeaveRadar = (targetRiderId, optionalUserId) => {
        let removed = null;
        const targetUserId = (optionalUserId && String(optionalUserId).trim()) || null;
        const targetKey = (targetRiderId && String(targetRiderId).trim()) || null;

        // 1. Direct key match (by userId or socketId)
        if (targetUserId && activeRiders.has(targetUserId)) {
            removed = activeRiders.get(targetUserId);
            activeRiders.delete(targetUserId);
        } else if (targetKey && activeRiders.has(targetKey)) {
            removed = activeRiders.get(targetKey);
            activeRiders.delete(targetKey);
        }

        // 2. Search entries if not deleted by direct key
        if (!removed) {
            for (const [id, rider] of activeRiders.entries()) {
                if (rider.socketId === socket.id ||
                    (targetUserId && (rider.userId === targetUserId || id === targetUserId)) ||
                    (targetKey && (rider.userId === targetKey || id === targetKey))) {
                    removed = rider;
                    activeRiders.delete(id);
                    break;
                }
            }
        }

        const leftSocketId = removed?.socketId || socket.id;
        const leftUserId = removed?.userId || targetUserId || null;

        io.emit('rider_left', {
            id: leftSocketId,
            userId: leftUserId
        });

        const remainingRiders = Array.from(activeRiders.values());
        io.emit('riders_update', remainingRiders);
        io.emit('rider_locations', remainingRiders);
        io.emit('active_riders_snapshot', remainingRiders);
        io.emit('riders', remainingRiders);
    };

    socket.on('update_location', (payload) => {
        const { lat, lng, speed, heading, rotation, isGhostMode, hideLocation, userId, name: payloadName, avatar: payloadAvatar, packId } = payload || {};
        const user = socket.user || {};
        const riderId = (userId && String(userId).trim()) || (user._id ? user._id.toString() : socket.id);

        socket.data.radarRiderId = riderId;
        socket.data.radarUserId = (userId && String(userId).trim()) || (user._id ? user._id.toString() : null);

        const isGhost = isGhostMode === true ||
            user.isGhostMode === true ||
            hideLocation === true ||
            user.hideLocation === true ||
            user.privacy?.hideLocation === true;

        if (isGhost) {
            handleLeaveRadar(riderId, userId);
            return;
        }

        const safeLat = Number(lat);
        const safeLng = Number(lng);
        if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return;

        const name = payloadName || user.name || 'Sürücü';
        const avatar = payloadAvatar || user.avatar || user.photo || `https://i.pravatar.cc/150?u=${socket.id}`;
        const safeSpeed = Number(speed) || 0;
        const safeHeading = Number(heading ?? rotation) || 0;

        const riderData = {
            id: socket.id,
            userId: riderId,
            socketId: socket.id,
            packId: packId || null,
            name,
            avatar,
            lat: safeLat,
            lng: safeLng,
            speed: safeSpeed,
            heading: safeHeading,
            rotation: safeHeading,
            lastUpdate: Date.now(),
            updatedAt: new Date().toISOString()
        };

        activeRiders.set(riderId, riderData);

        // Incremental event for legacy clients
        io.emit('rider_moved', riderData);

        // Realtime full snapshot update
        io.emit('riders_update', Array.from(activeRiders.values()));
    });

    socket.on('rider_left', (payload) => {
        const user = socket.user || {};
        const userId = payload?.userId || (user._id ? user._id.toString() : null);
        const riderId = userId || payload?.id || socket.id;
        handleLeaveRadar(riderId, userId);
    });

    socket.on('stop_riding', (payload) => {
        const user = socket.user || {};
        const userId = payload?.userId || (user._id ? user._id.toString() : null);
        const riderId = userId || payload?.id || socket.id;
        handleLeaveRadar(riderId, userId);
    });

    socket.on('ghost_mode_changed', (payload) => {
        const user = socket.user || {};
        const riderId = payload?.userId || (user._id ? user._id.toString() : socket.id);
        const enabled = payload?.isGhostMode ?? true;
        if (enabled) {
            handleLeaveRadar(riderId, payload?.userId);
        }
    });

    socket.on('disconnect', () => {
        const user = socket.user || {};
        const riderId = socket.data.radarRiderId || (user._id ? user._id.toString() : null);
        const userId = socket.data.radarUserId || (user._id ? user._id.toString() : null);
        handleLeaveRadar(riderId, userId);
    });
};

let broadcastTimer;
export const stopRadarBroadcastLoop = () => { clearInterval(broadcastTimer); broadcastTimer = undefined; };
export const startRadarBroadcastLoop = (io) => {
    stopRadarBroadcastLoop();
    broadcastTimer = setInterval(() => {
        const now = Date.now();
        const ridersToBroadcast = [];
        const expiredRiders = [];

        for (const [userId, rider] of activeRiders.entries()) {
            if (now - rider.lastUpdate > TTL) {
                expiredRiders.push(rider);
                activeRiders.delete(userId);
            } else {
                ridersToBroadcast.push(rider);
            }
        }

        // Notify disconnected / timed-out riders immediately
        for (const rider of expiredRiders) {
            io.emit('rider_left', {
                id: rider.socketId,
                userId: rider.userId
            });
        }

        // Emit updated state immediately
        io.emit('rider_locations', ridersToBroadcast);
        io.emit('active_riders_snapshot', ridersToBroadcast);
        io.emit('riders_update', ridersToBroadcast);
        io.emit('riders', ridersToBroadcast);
    }, BROADCAST_INTERVAL);
};
