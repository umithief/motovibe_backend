import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import { raiseHttpError } from '../../utils/httpError.js';

import mongoose from 'mongoose';
import admin from 'firebase-admin';
import User from "../users/model.js";
import { getIO } from "../../socket.js";
import { sendSOSAlert } from "../notifications/sms.service.js";

/**
 * Triggers SOS Emergency Protocol
 * 1. Finds nearby riders within 5km radius
 * 2. Emits critical socket event to nearby users
 * 3. Sends SMS/WhatsApp alert to emergency contact via Twilio/Netgsm
 */
export const triggerSOS = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { userId, lat, lng, timestamp, severity } = input.body;
        const callerId = input.user?._id || userId;

        if (typeof lat !== 'number' || typeof lng !== 'number' ||
            !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return raiseHttpError({ status: 'error', message: 'Geolocations are required.' },400);
        }

        // 1. Find Nearby Users within 5km (using MongoDB GeoNear)
        let nearbyUsers = [];
        try {
            nearbyUsers = await User.find({
                lastCoordinates: {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [lng, lat] // MongoDB uses [longitude, latitude]
                        },
                        $maxDistance: 5000 // 5000 meters = 5km
                    }
                },
                _id: { $ne: callerId } // Exclude the crashed user
            }).select('_id name');
        } catch (geoErr) {
            console.warn('[Vibe-SOS] GeoNear search skipped/failed:', geoErr.message);
        }

        const io = getIO();

        // 2. Broadcast via Socket.IO to nearby users strictly
        if (io && nearbyUsers.length > 0) {
            nearbyUsers.forEach(user => {
                io.to(user._id.toString()).emit('emergency_sos_nearby', {
                    crashLat: lat,
                    crashLng: lng,
                    severity: severity || 'CRITICAL',
                    timestamp: timestamp || new Date().toISOString(),
                    distanceDetails: 'Kaza 5km çapında gerçekleşti.'
                });
            });
        }

        // 2.5. Send instant FCM Heads-Up Push Alert to nearby riders
        if (nearbyUsers.length > 0 && admin.apps.length > 0) {
            try {
                const nearbyDocs = await User.find({
                    _id: { $in: nearbyUsers.map(u => u._id) }
                }).select('pushTokens notifications').lean();

                const tokens = [];
                nearbyDocs.forEach(u => {
                    if (u.notifications?.pushEnabled !== false && Array.isArray(u.pushTokens)) {
                        u.pushTokens.forEach(entry => {
                            if (entry.token) tokens.push(entry.token);
                        });
                    }
                });

                if (tokens.length > 0) {
                    admin.messaging().sendEachForMulticast({
                        tokens,
                        notification: {
                            title: '🚨 ACİL DURUM (SOS) UYARISI',
                            body: 'Yakınınızda (5 km) bir motosiklet sürücüsü kaza / acil durum bildirdi!'
                        },
                        data: {
                            type: 'sos',
                            lat: String(lat),
                            lng: String(lng),
                            severity: String(severity || 'CRITICAL'),
                            click_action: 'FLUTTER_NOTIFICATION_CLICK'
                        },
                        android: {
                            priority: 'high',
                            notification: {
                                channelId: 'motovibe_heads_up_channel',
                                priority: 'max',
                                sound: 'default',
                                defaultSound: true,
                                defaultVibrateTimings: true,
                                visibility: 'public'
                            }
                        },
                        apns: { payload: { aps: { sound: 'default', 'content-available': 1 } } }
                    }).catch(pushErr => console.warn('[Vibe-SOS] Push multicast error:', pushErr.message));
                }
            } catch (pushErr) {
                console.warn('[Vibe-SOS] Push alert lookup error:', pushErr.message);
            }
        }

        // 3. Automated SMS/WhatsApp to emergency contact via SMS Service
        let smsResult = { sent: false, channel: 'NONE' };
        if (callerId) {
            const crashedUser = await User.findById(callerId).select('name phone emergencyPhone');
            if (crashedUser && crashedUser.emergencyPhone) {
                // Emergency-contact numbers must never be logged.
                smsResult = await sendSOSAlert({
                    toPhone: crashedUser.emergencyPhone,
                    riderName: crashedUser.name || 'Motonom sürücüsü',
                    lat,
                    lng,
                    severity: severity || 'CRITICAL'
                });
            }
        }

        return respond({
            status: 'success',
            message: 'Acil durum protokolü başlatıldı. Yakındaki sürücüler ve acil durum kanalları bilgilendirildi.',
            notifiedCount: nearbyUsers.length,
            smsStatus: smsResult
        },200);
    } catch (error) { throw error; }

    return response;
};

/**
 * Update Rider Location Continuously (Required for accurate $geoNear queries)
 */
export const updateLiveLocation = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { lat, lng } = input.body;
        await User.findByIdAndUpdate(input.user.id, {
            lastCoordinates: {
                type: 'Point',
                coordinates: [lng, lat]
            }
        });
        respond({ status: 'success' },200);
    } catch (err) { throw err; }

    return response;
};
