import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    participantsKey: {
        type: String,
        default: null
    },
    isGroup: {
        type: Boolean,
        default: false
    },
    groupName: {
        type: String,
        default: null // e.g. "Gece Sürüşü Pack"
    },
    groupAvatar: {
        type: String,
        default: null
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    unreadCount: {
        type: Map,
        of: Number,
        default: {}
    },
    isMutedBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    deletedFor: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { versionKey: false, timestamps: true });

// Airtight compound unique index on participantsKey for 1-1 conversations
conversationSchema.index(
    { participantsKey: 1 },
    { unique: true, partialFilterExpression: { isGroup: false, participantsKey: { $type: "string" } } }
);
conversationSchema.index(
    { participants: 1, isGroup: 1 }
);
conversationSchema.index({ updatedAt: -1 });

// Helper to normalize 1-1 participants list order
conversationSchema.statics.normalizeParticipants = function(userA, userB) {
    const idA = userA.toString();
    const idB = userB.toString();
    return idA < idB ? [userA, userB] : [userB, userA];
};

// Helper to generate canonical sorted key for 1-1 conversations
conversationSchema.statics.getParticipantsKey = function(userA, userB) {
    const idA = userA.toString();
    const idB = userB.toString();
    return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
};

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

export default Conversation;
