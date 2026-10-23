import mongoose from 'mongoose';

const packLoungeMessageSchema = new mongoose.Schema(
    {
        pack: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pack',
            required: true,
            index: true,
        },
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ['TEXT', 'IMAGE', 'VOICE', 'SYSTEM'],
            default: 'TEXT',
        },
        content: {
            type: String,
            required: true,
            trim: true,
            maxlength: [4000, 'Lounge mesajı 4000 karakteri aşamaz.'],
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        versionKey: false,
    },
);

packLoungeMessageSchema.index({ pack: 1, createdAt: -1 });

const PackLoungeMessage =
    mongoose.models.PackLoungeMessage ||
    mongoose.model('PackLoungeMessage', packLoungeMessageSchema);

export default PackLoungeMessage;
