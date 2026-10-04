import AppError from './appError.js';

export const resolveRideInviteMetadata = async (GroupRide, metadata, now = new Date()) => {
    const id = metadata?.rideId;
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) {
        throw new AppError('Davet için gerçek bir sürüş seçmelisin.', 400);
    }
    const ride = await GroupRide.findById(id).select('_id routeId status date time').lean();
    if (!ride) throw new AppError('Davet edilen sürüş bulunamadı.', 404);
    const start = new Date(`${ride.date}T${ride.time}:00+03:00`);
    if (!['scheduled', 'active'].includes(ride.status) ||
        (ride.status === 'scheduled' && (!Number.isFinite(start.getTime()) || start < now))) {
        throw new AppError('Bu sürüş artık davet kabul etmiyor.', 409);
    }
    return { ...metadata, rideId: String(ride._id),
        routeId: ride.routeId ? String(ride.routeId) : undefined };
};
