import BusinessSettlement from '../models/BusinessSettlement.js';
import User from '../models/User.js';

export const isBusinessCommerceEnabled = () =>
    String(process.env.BIZ_COMMERCE_ENABLED || '').toLowerCase() === 'true';

export const businessCommissionRate = () => {
    const parsed = Number(process.env.BIZ_COMMISSION_RATE ?? 8);
    if (!Number.isFinite(parsed)) return 8;
    return Math.min(Math.max(parsed, 0), 30);
};

export const calculateSettlementAmounts = (grossAmount, commissionRate) => {
    const parsedGross = Number(grossAmount || 0);
    const parsedRate = Number(commissionRate || 0);
    const gross = Number(Math.max(Number.isFinite(parsedGross) ? parsedGross : 0, 0).toFixed(2));
    const rate = Number(Math.min(Math.max(Number.isFinite(parsedRate) ? parsedRate : 0, 0), 30).toFixed(2));
    const commission = Number((gross * rate / 100).toFixed(2));
    return {
        grossAmount: gross,
        commissionRate: rate,
        commissionAmount: commission,
        netAmount: Number((gross - commission).toFixed(2))
    };
};

export const createSettlementForCompletedAppointment = async (appointment) => {
    if (!isBusinessCommerceEnabled() || !appointment?.catalogItemId) return null;
    const existing = await BusinessSettlement.findOne({ appointmentId: appointment._id });
    if (existing) return existing;

    const business = await User.findById(appointment.businessId)
        .select('userType businessProfile.catalogItems');
    if (!business || business.userType !== 'PROFESSIONAL') return null;
    const item = (business.businessProfile?.catalogItems || []).find(
        (candidate) => String(candidate._id) === String(appointment.catalogItemId)
    );
    if (!item) return null;
    const effectivePrice = item.discountPrice != null && item.discountPrice < item.price
        ? item.discountPrice
        : item.price;
    if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) return null;

    const amounts = calculateSettlementAmounts(effectivePrice, businessCommissionRate());
    const suffix = String(appointment._id).slice(-8).toUpperCase();
    return BusinessSettlement.create({
        settlementNumber: `MV-${new Date().getUTCFullYear()}-${suffix}`,
        businessId: appointment.businessId,
        customerId: appointment.customerId,
        appointmentId: appointment._id,
        catalogItemId: appointment.catalogItemId,
        itemName: item.name,
        ...amounts,
        status: 'pending'
    });
};
