import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    type: {
        type: String,
        uppercase: true,
        enum: [
            'LIKE', 'COMMENT', 'FOLLOW',
            'TAGGED_IN_POST', 'MENTIONED_IN_POST', 'MENTIONED_IN_COMMENT',
            'MENTIONED_IN_REEL', 'MENTIONED_IN_REEL_COMMENT', 'MENTIONED_IN_ROUTE_REVIEW',
            'MENTIONED_IN_PACK', 'MENTIONED_IN_STORY', 'MENTIONED_IN_EVENT',
            'REEL_LIKE', 'REEL_COMMENT', 'VIBECUT_LIKE', 'VIBECUT_COMMENT', 'VIBECUT_ROUTE_LINKED',
            'ROUTE_SAVED', 'ROUTE_REVIEW', 'ROUTE_HAZARD',
            'JOIN_REQUEST', 'JOIN_APPROVED', 'JOIN_REJECTED', 'PACK_MEMBER_REMOVED',
            'APPOINTMENT_REQUEST', 'APPOINTMENT_APPROVED', 'APPOINTMENT_REJECTED', 'APPOINTMENT_IN_PROGRESS', 'APPOINTMENT_COMPLETED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_UPDATE',
            'REPORT_RESOLVED',
            'RIDE_INVITE', 'RIDE_JOIN', 'RIDE_CANCELLED', 'RIDE_COMPLETED', 'ACHIEVEMENT_UNLOCKED',
            'SOS', 'HAZARD', 'SOCIAL', 'SYSTEM'
        ],
        required: true
    },
    title: {
        type: String,
        trim: true,
        maxlength: 120
    },
    body: {
        type: String,
        trim: true,
        maxlength: 600
    },
    actionUrl: {
        type: String,
        trim: true,
        maxlength: 500
    },
    text: { type: String },
    post: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SocialPost'
    },
    reel: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Reel'
    },
    pack: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pack'
    },
    appointment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Appointment'
    },
    ride: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Route'
    },
    route: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Route'
    },
    reelId: {
        type: String
    },
    routeId: {
        type: String
    },
    rideId: {
        type: String
    },
    relatedId: {
        type: String
    },
    commentId: {
        type: String
    },
    isRead: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: '30d'
    }
}, {
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Keep the existing recipient field and API queries compatible while exposing
// the requested userId name to newer clients.
notificationSchema.virtual('userId')
    .get(function () { return this.recipient; })
    .set(function (value) { this.recipient = value; });

notificationSchema.index({ recipient: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
