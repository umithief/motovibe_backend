import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    tempId: { type: String, maxlength: 128 },
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true,
        index: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // MotoComms Message Types
    type: {
        type: String,
        enum: ['TEXT', 'IMAGE', 'VOICE', 'ROUTE_SHARE', 'LIVE_LOCATION', 'RIDE_INVITE', 'MOTOMOJI'],
        default: 'TEXT'
    },
    // Text payload, image URL, voice URL, or JSON string for Route/Invite data
    content: {
        type: String,
        required: true,
        maxlength: 4000
    },
    metadata: {
        rideStatus: {
            type: String,
            enum: ['PENDING', 'ACCEPTED', 'DECLINED'],
            default: 'PENDING'
        },
        expiresAt: {
            type: Date,
            default: null
        },
        duration: {
            type: Number,
            default: null
        }
    },
    // Delivery status
    status: {
        type: String,
        enum: ['SENT', 'DELIVERED', 'READ'],
        default: 'SENT'
    },
    readBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    deletedFor: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { versionKey: false });

// Compound index for fast message retrieval per conversation
messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ sender: 1, tempId: 1 }, {
    unique: true,
    partialFilterExpression: { tempId: { $type: 'string' } }
});

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

export default Message;
