import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
    {
        reporterId: {
            type: mongoose.Schema.ObjectId,
            ref: 'User',
            required: [true, 'Bir şikayette raporlayan kullanıcı ID\'si zorunludur.']
        },
        targetId: {
            type: mongoose.Schema.ObjectId,
            required: [true, 'Şikayet edilen içeriğin ID\'si zorunludur.']
        },
        targetModel: {
            type: String,
            required: [true, 'Şikayet edilen içeriğin modeli belirtilmelidir.'],
            enum: ['User', 'Post', 'Route', 'Comment', 'HazardPin', 'Reel']
        },
        reasonCategory: {
            type: String,
            required: [true, 'Şikayet nedeni zorunludur.'],
            enum: ['SPAM', 'INAPPROPRIATE', 'HATE_SPEECH', 'DANGEROUS_BEHAVIOR', 'FAKE_INFO', 'OTHER']
        },
        customNote: {
            type: String,
            trim: true,
            maxlength: [500, 'Açıklama notu en fazla 500 karakter olabilir.']
        },
        status: {
            type: String,
            enum: ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'],
            default: 'PENDING'
        },
        adminActionTaken: {
            type: String,
            trim: true
        },
        resolvedBy: {
            type: mongoose.Schema.ObjectId,
            ref: 'User'
        },
        resolvedAt: {
            type: Date
        }
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// Indexed for faster querying by status and polymorphic relations
reportSchema.index({ status: 1 });
reportSchema.index({ targetId: 1, targetModel: 1 });
reportSchema.index({ reporterId: 1 });

const Report = mongoose.model('Report', reportSchema);
export default Report;
