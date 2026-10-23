import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    items: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        image: { type: String }
    }],
    shippingAddress: {
        address: { type: String, required: true },
        city: { type: String, required: true },
        postalCode: { type: String, required: true },
        country: { type: String, default: 'Turkey' }
    },
    paymentMethod: {
        type: String,
        required: true,
        enum: ['credit_card', 'cash_on_delivery', 'bank_transfer'],
        default: 'credit_card'
    },
    paymentResult: {
        id: { type: String },
        status: { type: String },
        update_time: { type: String },
        email_address: { type: String }
    },
    totalAmount: {
        type: Number,
        required: true,
        default: 0.0
    },
    status: {
        type: String,
        required: true,
        enum: ['Hazırlanıyor', 'Kargoda', 'Teslim Edildi', 'İptal', 'Order Placed', 'Preparing Gear', 'On the Road', 'Delivered'],
        default: 'Hazırlanıyor'
    },
    isPaid: {
        type: Boolean,
        required: true,
        default: false
    },
    paidAt: {
        type: Date
    },
    isDelivered: {
        type: Boolean,
        required: true,
        default: false
    },
    deliveredAt: {
        type: Date
    }
}, {
    timestamps: true
});

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export default Order;
