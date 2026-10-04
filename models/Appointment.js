import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema({
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    service: { type: String, required: true },
    catalogItemId: { type: mongoose.Schema.Types.ObjectId },
    date: { type: Date, required: true },
    durationMin: { type: Number, min: 15, max: 480, default: 60 },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'inProgress', 'completed', 'cancelled'],
        default: 'pending'
    },
    statusReason: { type: String, maxlength: 300 },
    notes: { type: String, maxlength: 500 },
    attachmentUrl: { type: String, maxlength: 400 }
}, {
    timestamps: true
});

const Appointment = mongoose.model('Appointment', appointmentSchema);
export default Appointment;
