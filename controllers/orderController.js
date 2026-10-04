import Order from '../models/Order.js';
import Product from '../models/Product.js';
import mongoose from 'mongoose';

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
export const addOrderItems = async (req, res) => {
    const {
        orderItems,
        shippingAddress,
        paymentMethod
    } = req.body;

    if (!Array.isArray(orderItems) || orderItems.length === 0 || orderItems.length > 50) {
        return res.status(400).json({ message: 'Sipariş ürünleri geçersiz.' });
    }
    const allowedPaymentMethods = new Set(['credit_card', 'cash_on_delivery', 'bank_transfer']);
    if (!allowedPaymentMethods.has(paymentMethod)) {
        return res.status(400).json({ message: 'Ödeme yöntemi geçersiz.' });
    }
    if (paymentMethod === 'credit_card' && String(process.env.SHOP_CARD_PAYMENTS_ENABLED || '').toLowerCase() !== 'true') {
        return res.status(503).json({ message: 'Kartlı ödeme sağlayıcısı henüz etkin değil.' });
    }
    const address = String(shippingAddress?.address || '').trim();
    const city = String(shippingAddress?.city || '').trim();
    const postalCode = String(shippingAddress?.postalCode || '').trim();
    const country = String(shippingAddress?.country || 'Turkey').trim();
    if (!address || !city || !postalCode || address.length > 240 || city.length > 80 || postalCode.length > 20) {
        return res.status(400).json({ message: 'Teslimat adresi eksik veya geçersiz.' });
    }

    const requested = new Map();
    for (const item of orderItems) {
        const productId = String(item?.product || item?._id || '').trim();
        const quantity = Number(item?.quantity);
        if (!mongoose.Types.ObjectId.isValid(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
            return res.status(400).json({ message: 'Ürün veya adet bilgisi geçersiz.' });
        }
        requested.set(productId, (requested.get(productId) || 0) + quantity);
    }
    const products = await Product.find({ _id: { $in: [...requested.keys()] } })
        .select('_id name image price stock');
    if (products.length !== requested.size) {
        return res.status(409).json({ message: 'Sepette artık bulunmayan ürün var.' });
    }
    const serverItems = [];
    for (const product of products) {
        const quantity = requested.get(String(product._id));
        if (product.stock < quantity) {
            return res.status(409).json({ message: `${product.name} için yeterli stok yok.` });
        }
        serverItems.push({
            product: product._id,
            name: product.name,
            quantity,
            price: product.price,
            image: product.image
        });
    }
    const serverItemsPrice = Number(
        serverItems.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
    );
    const serverTaxPrice = 0;
    const serverShippingPrice = 0;
    const serverTotal = Number((serverItemsPrice + serverTaxPrice + serverShippingPrice).toFixed(2));

    {
        const order = new Order({
            user: req.user._id,
            items: serverItems,
            shippingAddress: { address, city, postalCode, country },
            paymentMethod,
            totalAmount: serverTotal,
            isPaid: false,
            status: 'Order Placed'
        });

        const createdOrder = await order.save();
        res.status(201).json(createdOrder);
    }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
export const getOrderById = async (req, res) => {
    const order = await Order.findById(req.params.id).populate('user', 'name email');

    if (order) {
        const ownerId = order.user?._id || order.user;
        if (!req.user.isAdmin && String(ownerId) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Bu siparişi görüntüleme yetkiniz yok.' });
        }
        res.json(order);
    } else {
        res.status(404);
        throw new Error('Order not found');
    }
};

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private
export const updateOrderToPaid = async (req, res) => {
    const order = await Order.findById(req.params.id);

    if (order) {
        if (order.isPaid) {
            return res.status(409).json({ message: 'Sipariş zaten ödenmiş.' });
        }
        const paymentId = String(req.body?.id || '').trim();
        if (!paymentId || paymentId.length > 160) {
            return res.status(400).json({ message: 'Ödeme referansı geçersiz.' });
        }
        order.isPaid = true;
        order.paidAt = Date.now();
        order.paymentResult = {
            id: paymentId,
            status: String(req.body.status || 'paid').slice(0, 40),
            update_time: req.body.update_time,
            email_address: req.body.email_address
        };

        const updatedOrder = await order.save();
        res.json(updatedOrder);
    } else {
        res.status(404);
        throw new Error('Order not found');
    }
};

// @desc    Update order to delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
export const updateOrderToDelivered = async (req, res) => {
    const order = await Order.findById(req.params.id);

    if (order) {
        order.isDelivered = true;
        order.deliveredAt = Date.now();
        order.status = 'Teslim Edildi';

        const updatedOrder = await order.save();
        res.json(updatedOrder);
    } else {
        res.status(404);
        throw new Error('Order not found');
    }
};

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
export const getMyOrders = async (req, res) => {
    // Check if req.user exists (auth middleware should handle this)
    if (!req.user) {
        return res.status(401).json({ message: 'Not authorized' });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const orders = await Order.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    const totalOrders = await Order.countDocuments({ user: req.user._id });
    const hasMore = skip + orders.length < totalOrders;

    res.json(orders);
};

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
export const getOrders = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const orders = await Order.find({})
        .populate('user', 'id name')
        .skip(skip)
        .limit(limit);

    const totalOrders = await Order.countDocuments({});
    const hasMore = skip + orders.length < totalOrders;

    res.json(orders);
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
export const updateOrderStatus = async (req, res) => {
    const { status } = req.body;
    const allowedStatuses = new Set([
        'Hazırlanıyor', 'Kargoda', 'Teslim Edildi', 'İptal',
        'Order Placed', 'Preparing Gear', 'On the Road', 'Delivered'
    ]);
    if (!allowedStatuses.has(status)) {
        return res.status(400).json({ message: 'Sipariş durumu geçersiz.' });
    }
    const order = await Order.findById(req.params.id);

    if (order) {
        order.status = status;
        const updatedOrder = await order.save();
        res.json(updatedOrder);
    } else {
        res.status(404).json({ message: 'Order not found' });
    }
};
