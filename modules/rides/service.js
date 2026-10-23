import Ride from "./model.js";
import mongoose from 'mongoose';
import Route from "../routes/model.js";
import AppError from '../../utils/appError.js';
export const rideOwnerFilter = user => ({$or:[{user},{user:null,userId:user}]});
export const buildActivityRideInput = (body,user) => {
    const startTime=new Date(body.startTime);
    const distance=Number(body.distance);
    if (Number.isNaN(startTime.getTime()) || !Number.isFinite(distance) || distance<0) throw new AppError('Geçerli başlangıç zamanı ve mesafe gereklidir.',422);
    if(body.route && !mongoose.isValidObjectId(body.route))throw new AppError('Geçersiz rota.',422);
    const activity={...body,user}; delete activity.userId; delete activity._id;
    const coordinates=(Array.isArray(body.path) ? body.path : []).map(p=>[Number(p.lng),Number(p.lat)]);
    if (coordinates.some(p=>!p.every(Number.isFinite) || Math.abs(p[0])>180 || Math.abs(p[1])>90)) throw new AppError('Geçersiz koordinat.',422);
    return {user,userId:user,date:startTime,title:body.title || 'Sürüş',isPublic:body.isPublic!==false,
        ...(coordinates.length>=2 ? {route:{type:'LineString',coordinates}} : {}),activity,
        stats:{totalDistance:distance,maxSpeed:Number(body.maxSpeed)||0,avgSpeed:Number(body.avgSpeed)||0}};
};
export const activityPayload = ride => ({...ride.activity,_id:ride._id,user:ride.user || ride.userId,createdAt:ride.createdAt,updatedAt:ride.updatedAt});
export const createLegacyActivity = async (body,user) => activityPayload(await Ride.create(buildActivityRideInput(body,user)));
export const findLatestActivity = async user => {
    // Old collection is read-only. Existing activity records do not disappear during migration.
    const [ride,rawLegacy]=await Promise.all([
        Ride.findOne({...rideOwnerFilter(user),activity:{$exists:true}}).sort({date:-1,_id:-1}).lean(),
        mongoose.connection.collection('rideactivities').findOne(rideOwnerFilter(new mongoose.Types.ObjectId(user)),{sort:{startTime:-1,_id:-1}})
    ]);
    const legacy=rawLegacy ? {...rawLegacy,user:rawLegacy.user || rawLegacy.userId} : null;
    const current=ride ? activityPayload(ride) : null;
    const result=!current ? legacy : !legacy || new Date(current.startTime)>=new Date(legacy.startTime) ? current : legacy;
    if (!result) throw new AppError('Son sürüş kaydı bulunamadı.',404);
    if (result.route) result.route=await Route.findById(result.route).lean();
    return result;
};
