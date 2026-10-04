// Radar Socket Controller
const activeRiders = new Map();

// Throttle interval (2 seconds)
const BROADCAST_INTERVAL = 2000;

// TTL in milliseconds (60 seconds)
const TTL = 60000;

export const initRadarSocket = (io, socket) => {
    const handleLeaveRadar = (riderId) => {
        let removed = null;
        if (riderId && activeRiders.has(riderId)) {
            removed = activeRiders.get(riderId);
            activeRiders.delete(riderId);
        } else {
            for (const [id, rider] of activeRiders.entries()) {
                if (rider.socketId === socket.id) {
                    removed = rider;
                    activeRiders.delete(id);
                    break;
                }
            }
        }

        if (removed) {
            io.emit('rider_left', {
                id: removed.socketId,
                userId: removed.userId
            });
        }
    };

    socket.on('update_location', (payload) => {
        const { lat, lng, speed, heading, isGhostMode, hideLocation } = payload || {};
        const user = socket.user || {};
        const riderId = user._id ? user._id.toString() : socket.id;

        const isGhost = isGhostMode === true ||
            user.isGhostMode === true ||
            hideLocation === true ||
            user.hideLocation === true ||
            user.privacy?.hideLocation === true;

        if (isGhost) {
            handleLeaveRadar(riderId);
            return;
        }

        const safeLat = Number(lat);
        const safeLng = Number(lng);
        if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return;

        const name = user.name || 'Rider';

        const riderData = {
            userId: riderId,
            socketId: socket.id,
            name,
            lat: safeLat,
            lng: safeLng,
            speed: Number(speed) || 0,
            heading: Number(heading) || 0,
            lastUpdate: Date.now()
        };

        activeRiders.set(riderId, riderData);

        // Incremental event for legacy clients.
        io.emit('rider_moved', {
            id: riderData.socketId,
            userId: riderData.userId,
            socketId: riderData.socketId,
            name: riderData.name,
            lat: riderData.lat,
            lng: riderData.lng,
            speed: riderData.speed,
            heading: riderData.heading,
            lastUpdate: riderData.lastUpdate
        });
    });

    socket.on('ghost_mode_changed', (payload) => {
        const user = socket.user || {};
        const riderId = payload?.userId || (user._id ? user._id.toString() : socket.id);
        const enabled = payload?.isGhostMode ?? true;
        if (enabled) {
            handleLeaveRadar(riderId);
        }
    });

    socket.on('disconnect', () => {
        const user = socket.user || {};
        const riderId = user._id ? user._id.toString() : null;
        handleLeaveRadar(riderId);
    });
};

export const startRadarBroadcastLoop = (io) => {
    setInterval(() => {
        const now = Date.now();
        const ridersToBroadcast = [];

        for (const [userId, rider] of activeRiders.entries()) {
            if (now - rider.lastUpdate > TTL) {
                activeRiders.delete(userId);
            } else {
                ridersToBroadcast.push({
                    id: rider.socketId,
                    userId: rider.userId,
                    socketId: rider.socketId,
                    name: rider.name,
                    lat: rider.lat,
                    lng: rider.lng,
                    speed: rider.speed,
                    heading: rider.heading,
                    lastUpdate: rider.lastUpdate
                });
            }
        }

        // New and legacy event names are both emitted for compatibility.
        io.emit('rider_locations', ridersToBroadcast);
        io.emit('active_riders_snapshot', ridersToBroadcast);
    }, BROADCAST_INTERVAL);
};
