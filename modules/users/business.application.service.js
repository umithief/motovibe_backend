import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import mongoose from 'mongoose';
import User from "./model.js";
import Appointment from "../appointments/model.js";

import AppError from "../../utils/appError.js";
import { createNotification } from "../notifications/service.js";
import { recordBusinessAudit } from "../business/businessAuditService.service.js";
import { escapeRegex } from "../../utils/tagUtils.js";
import { BUSINESS_CATEGORIES, normalizeProfessionalStatusForResponse, businessProfileForPublic, buildBusinessUserPayload, isValidBusinessCoordinates, normalizeBusinessServices, normalizeBusinessWorkingHours, maskTaxIdentifier, buildBusinessCatalogItemInput, sanitizeBusinessFlashOffers, buildBusinessFlashOfferInput } from './business.service.js';
import { isValidTurkishTaxIdentifier } from './service.js';

export const getProfessionalProfiles = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { category, q, verified, lat, lng, radius, limit } = input.query;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 60);
    const filter = {
        userType: 'PROFESSIONAL',
        $and: [
            {
                $or: [
                    { activeProfileMode: 'PROFESSIONAL' },
                    { activeProfileMode: { $exists: false } }
                ]
            }
        ]
    };

    if (category && BUSINESS_CATEGORIES.includes(String(category))) {
        filter['businessProfile.category'] = String(category);
    }

    if (String(verified || '').toLowerCase() === 'true') {
        filter.$and.push({
            $or: [
                { isVerified: true },
                { 'businessProfile.verifiedBadge': true }
            ]
        });
    }

    const hasLatitude = lat !== undefined && String(lat).trim() !== '';
    const hasLongitude = lng !== undefined && String(lng).trim() !== '';
    if (hasLatitude !== hasLongitude) {
        return throwError(new AppError('Yakınlık filtresi için enlem ve boylam birlikte gönderilmelidir.', 400));
    }

    let hasNearbyFilter = false;
    if (hasLatitude && hasLongitude) {
        const latitude = Number(lat);
        const longitude = Number(lng);
        const radiusKm = radius === undefined || String(radius).trim() === ''
            ? 30
            : Number(radius);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return throwError(new AppError('Yakınlık filtresi için geçerli koordinatlar gönderilmelidir.', 400));
        }
        if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 300) {
            return throwError(new AppError('Yakınlık yarıçapı 1 ile 300 km arasında olmalıdır.', 400));
        }
        filter['businessProfile.address'] = {
            $near: {
                $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                $maxDistance: Math.round(radiusKm * 1000)
            }
        };
        hasNearbyFilter = true;
    }

    if (q && String(q).trim().length > 0) {
        const regex = new RegExp(escapeRegex(String(q).trim()), 'i');
        filter.$and.push({
            $or: [
                { name: regex },
                { username: regex },
                { 'businessProfile.services': regex }
            ]
        });
    }
    let professionalsQuery = User.find(filter)
        .select('_id name username avatar rank isVerified verificationStatus followers postsCount totalKm userType activeProfileMode businessProfile')
        .limit(safeLimit)
        .lean();
    if (!hasNearbyFilter) {
        professionalsQuery = professionalsQuery.sort({
            'businessProfile.verifiedBadge': -1,
            postsCount: -1,
            createdAt: -1
        });
    }
    const professionals = await professionalsQuery;

    const normalized = professionals.map((user) => {
        normalizeProfessionalStatusForResponse(user);
        return {
            ...user,
            businessProfile: businessProfileForPublic(user.businessProfile),
            followers: Array.isArray(user.followers) ? user.followers.length : (user.followers || 0),
            following: 0
        };
    });

    respond({
        status: 'success',
        results: normalized.length,
        data: {
            professionals: normalized
        }
    },200);

    return response;
};

export const updateProfileMode = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const mode = String(input.body?.mode || '').toUpperCase().trim();
    if (!['PERSONAL', 'PROFESSIONAL'].includes(mode)) {
        return throwError(new AppError('Geçersiz profil modu.', 400));
    }

    const user = await User.findById(input.user.id).select('userType activeProfileMode businessProfile isPro isVerified verificationStatus');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (mode === 'PROFESSIONAL' && user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Profesyonel profil modunu kullanmak icin BIZ hesabini aktiflestir.', 403));
    }

    user.activeProfileMode = mode;
    normalizeProfessionalStatusForResponse(user);
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: mode === 'PROFESSIONAL'
            ? 'Profesyonel profil modu aktif edildi.'
            : 'Kisisel profil modu aktif edildi.',
        data: {
            user: buildBusinessUserPayload(user)
        }
    },200);

    return response;
};

export const upgradeToPro = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { category, services, addressCoordinates, taxId } = input.body;

    if (!category) {
        return throwError(new AppError('Lütfen işletme kategorisi seçiniz.', 400));
    }

    if (!taxId || String(taxId).trim().length === 0) {
        return throwError(new AppError('Vergi levhası / TC Kimlik no zorunludur.', 400));
    }

    if (!BUSINESS_CATEGORIES.includes(category)) {
        return throwError(new AppError('Geçersiz isletme kategorisi.', 400));
    }

    if (services !== undefined && !Array.isArray(services)) {
        return throwError(new AppError('Hizmet listesi dizi formatinda olmalidir.', 400));
    }

    if (addressCoordinates !== undefined && !isValidBusinessCoordinates(addressCoordinates)) {
        return throwError(new AppError('Konum koordinatlari geçersiz.', 400));
    }

    const user = await User.findById(input.user.id);
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const normalizedServices = normalizeBusinessServices(services || []);
    const normalizedTaxId = String(taxId || '').trim();
    if (!isValidTurkishTaxIdentifier(normalizedTaxId)) {
        return throwError(new AppError('Vergi numarası 10 haneli VKN veya 11 haneli TCKN olmalıdır.', 400));
    }

    if (user.userType === 'PROFESSIONAL') {
        if (!user.isVerified) {
            user.verificationStatus = 'pending';
        }
        if (!user.businessProfile) {
            user.businessProfile = {};
        }
        user.businessProfile.category = user.businessProfile.category || category;
        if (!Array.isArray(user.businessProfile.services) || user.businessProfile.services.length === 0) {
            user.businessProfile.services = normalizedServices;
        }
        if (!Array.isArray(user.businessProfile.catalogItems)) {
            user.businessProfile.catalogItems = [];
        }
        user.businessProfile.verifiedBadge = user.businessProfile.verifiedBadge === true;
        user.businessProfile.workingHours = user.businessProfile.workingHours || [];
        user.activeProfileMode = user.activeProfileMode || 'PROFESSIONAL';
        user.markModified('businessProfile');
        await user.save({ validateBeforeSave: false });

        return respond({
            status: 'success',
            message: 'Profesyonel hesap zaten aktif.',
            data: {
                user: buildBusinessUserPayload(user)
            }
        },200);
    }

    // Update to PRO
    user.userType = 'PROFESSIONAL';
    user.activeProfileMode = 'PROFESSIONAL';
    user.businessProfile = {
        category,
        services: normalizedServices,
        catalogItems: [],
        verifiedBadge: false,
        workingHours: [],
        address: addressCoordinates ? {
            type: 'Point',
            coordinates: [Number(addressCoordinates[0]), Number(addressCoordinates[1])]
        } : undefined,
        taxId: normalizedTaxId || undefined
    };
    if (!user.isVerified) {
        user.verificationStatus = 'pending';
    }

    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Profesyonel hesaba gecis tamamlandi.',
        data: {
            user: buildBusinessUserPayload(user)
        }
    },200);

    return response;
};

export const updateBusinessProfile = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { category, services, taxId, workingHours, addressCoordinates, addressLabel, businessName, businessDescription, businessPhone, businessSocials, acceptsAppointments } = input.body || {};

    const user = await User.findById(input.user.id).select('userType activeProfileMode businessProfile isPro isVerified verificationStatus');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    if (!user.businessProfile) {
        user.businessProfile = {};
    }

    if (category !== undefined) {
        if (!BUSINESS_CATEGORIES.includes(category)) {
            return throwError(new AppError('Geçersiz isletme kategorisi.', 400));
        }
        user.businessProfile.category = category;
    }

    if (businessName !== undefined) {
        const trimmed = String(businessName || '').trim();
        if (trimmed.length > 80) {
            return throwError(new AppError('Isletme adi cok uzun (max 80 karakter).', 400));
        }
        user.businessProfile.businessName = trimmed || undefined;
    }

    if (businessDescription !== undefined) {
        const trimmed = String(businessDescription || '').trim();
        if (trimmed.length > 300) {
            return throwError(new AppError('Isletme aciklamasi cok uzun (max 300 karakter).', 400));
        }
        user.businessProfile.businessDescription = trimmed || undefined;
    }

    if (businessPhone !== undefined) {
        const trimmed = String(businessPhone || '').trim();
        if (trimmed.length > 20) {
            return throwError(new AppError('Telefon numarasi cok uzun.', 400));
        }
        user.businessProfile.businessPhone = trimmed || undefined;
    }

    if (businessSocials !== undefined && typeof businessSocials === 'object') {
        if (!user.businessProfile.businessSocials) {
            user.businessProfile.businessSocials = {};
        }
        if (businessSocials.instagram !== undefined) {
            user.businessProfile.businessSocials.instagram = String(businessSocials.instagram || '').trim().slice(0, 100);
        }
        if (businessSocials.website !== undefined) {
            user.businessProfile.businessSocials.website = String(businessSocials.website || '').trim().slice(0, 200);
        }
        if (businessSocials.whatsapp !== undefined) {
            user.businessProfile.businessSocials.whatsapp = String(businessSocials.whatsapp || '').trim().slice(0, 20);
        }
    }

    if (taxId !== undefined) {
        const normalizedTaxId = String(taxId || '').trim();
        if (normalizedTaxId && !isValidTurkishTaxIdentifier(normalizedTaxId)) {
            return throwError(new AppError('Vergi numarası 10 haneli VKN veya 11 haneli TCKN olmalıdır.', 400));
        }
        const previousTaxId = String(user.businessProfile.taxId || '');
        if (previousTaxId !== normalizedTaxId) {
            user.businessProfile.taxId = normalizedTaxId || undefined;
            user.businessProfile.verifiedBadge = false;
            user.verificationStatus = normalizedTaxId ? 'pending' : 'none';
            await recordBusinessAudit({
                businessId: user._id,
                actorId: input.user.id,
                action: 'TAX_ID_UPDATED',
                metadata: {
                    maskedSuffix: normalizedTaxId.slice(-2),
                    source: 'business_profile',
                    verificationReset: true
                }
            });
        }
    }

    if (services !== undefined) {
        if (!Array.isArray(services)) {
            return throwError(new AppError('Hizmet listesi dizi formatinda olmalidir.', 400));
        }
        user.businessProfile.services = normalizeBusinessServices(services);
    }

    if (acceptsAppointments !== undefined) {
        if (typeof acceptsAppointments !== 'boolean') {
            return throwError(new AppError('Randevu tercihi geçersiz.', 400));
        }
        user.businessProfile.acceptsAppointments = acceptsAppointments;
    }

    if (workingHours !== undefined) {
        const normalizedHours = normalizeBusinessWorkingHours(workingHours);
        if (normalizedHours.error) return throwError(new AppError(normalizedHours.error, 400));
        user.businessProfile.workingHours = normalizedHours.value;
    }

    if (addressCoordinates !== undefined) {
        if (!isValidBusinessCoordinates(addressCoordinates)) {
            return throwError(new AppError('Konum koordinatlari geçersiz.', 400));
        }
        user.businessProfile.address = {
            type: 'Point',
            coordinates: [Number(addressCoordinates[0]), Number(addressCoordinates[1])],
            label: user.businessProfile.address?.label
        };
    }
    if (addressLabel !== undefined) {
        const normalizedLabel = String(addressLabel || '').trim();
        if (normalizedLabel.length > 160) {
            return throwError(new AppError('Adres etiketi çok uzun.', 400));
        }
        if (!user.businessProfile.address?.coordinates || user.businessProfile.address.coordinates.length !== 2) {
            return throwError(new AppError('Adres etiketi için önce geçerli konum koordinatları ekleyin.', 400));
        }
        user.businessProfile.address.label = normalizedLabel || undefined;
    }

    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Isletme profili guncellendi.',
        data: {
            user: buildBusinessUserPayload(user)
        }
    },200);

    return response;
};

export const getBusinessCatalog = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id).select('userType businessProfile');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    const items = Array.isArray(user.businessProfile?.catalogItems)
        ? user.businessProfile.catalogItems
        : [];

    respond({
        status: 'success',
        results: items.length,
        data: { items }
    },200);

    return response;
};

export const updateBusinessCatalog = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { items } = input.body || {};
    if (!Array.isArray(items)) {
        return throwError(new AppError('Katalog listesi dizi formatinda olmalidir.', 400));
    }

    const user = await User.findById(input.user.id).select('userType businessProfile');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }


    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Isletme profili guncellendi.',
        data: {
            user: buildBusinessUserPayload(user)
        }
    },200);

    return response;
};

export const getBusinessTaxId = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id)
        .select('userType +businessProfile.taxId');
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Vergi bilgisi için BİZ hesabı gerekir.', 403));
    }

    const rawTaxId = user.businessProfile?.taxId;
    await recordBusinessAudit({
        businessId: user._id,
        actorId: input.user.id,
        action: 'TAX_ID_ACCESSED',
        metadata: {
            source: 'business_profile_owner',
            hasValue: Boolean(rawTaxId)
        }
    });

    respond({
        status: 'success',
        data: { maskedTaxId: maskTaxIdentifier(rawTaxId) }
    },200);

    return response;
};

export const createBusinessCatalogItem = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const parsed = buildBusinessCatalogItemInput(input.body || {});
    if (parsed.error) return throwError(new AppError(parsed.error, 400));

    const user = await User.findById(input.user.id).select('userType businessProfile');
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Bu işlem için profesyonel hesap gerekir.', 403));
    }

    if (!user.businessProfile) user.businessProfile = {};
    const catalogItems = Array.isArray(user.businessProfile.catalogItems)
        ? user.businessProfile.catalogItems
        : [];
    if (catalogItems.length >= 120) {
        return throwError(new AppError('Katalog en fazla 120 ürün içerebilir.', 400));
    }

    const normalizedName = parsed.value.name.toLocaleLowerCase('tr-TR');
    const duplicate = catalogItems.some(
        (item) => String(item.name || '').trim().toLocaleLowerCase('tr-TR') === normalizedName
    );
    if (duplicate) {
        return throwError(new AppError('Bu isimde bir ürün katalogda zaten var.', 409));
    }

    user.businessProfile.catalogItems.push(parsed.value);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    const item = user.businessProfile.catalogItems[user.businessProfile.catalogItems.length - 1];
    respond({
        status: 'success',
        message: 'Ürün eklendi.',
        data: { item, items: user.businessProfile.catalogItems }
    },201);

    return response;
};

export const updateBusinessCatalogItem = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const itemId = String(input.params.itemId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
        return throwError(new AppError('Geçersiz ürün kimliği.', 400));
    }

    const user = await User.findById(input.user.id).select('userType businessProfile');
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Bu işlem için profesyonel hesap gerekir.', 403));
    }

    const catalogItems = Array.isArray(user.businessProfile?.catalogItems)
        ? user.businessProfile.catalogItems
        : [];
    const itemIndex = catalogItems.findIndex((item) => String(item._id) === itemId);
    if (itemIndex < 0) return throwError(new AppError('Ürün bulunamadı.', 404));

    const currentItem = catalogItems[itemIndex].toObject
        ? catalogItems[itemIndex].toObject()
        : catalogItems[itemIndex];
    const parsed = buildBusinessCatalogItemInput({ ...currentItem, ...(input.body || {}) });
    if (parsed.error) return throwError(new AppError(parsed.error, 400));

    const normalizedName = parsed.value.name.toLocaleLowerCase('tr-TR');
    const duplicate = catalogItems.some((item, index) =>
        index !== itemIndex && String(item.name || '').trim().toLocaleLowerCase('tr-TR') === normalizedName
    );
    if (duplicate) {
        return throwError(new AppError('Bu isimde bir ürün katalogda zaten var.', 409));
    }

    catalogItems[itemIndex].set(parsed.value);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Ürün güncellendi.',
        data: { item: user.businessProfile.catalogItems[itemIndex], items: user.businessProfile.catalogItems }
    },200);

    return response;
};

export const deleteBusinessCatalogItem = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const itemId = String(input.params.itemId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
        return throwError(new AppError('Geçersiz ürün kimliği.', 400));
    }

    const user = await User.findById(input.user.id).select('userType businessProfile');
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Bu işlem için profesyonel hesap gerekir.', 403));
    }

    const catalogItems = Array.isArray(user.businessProfile?.catalogItems)
        ? user.businessProfile.catalogItems
        : [];
    const itemIndex = catalogItems.findIndex((item) => String(item._id) === itemId);
    if (itemIndex < 0) return throwError(new AppError('Ürün bulunamadı.', 404));

    catalogItems.splice(itemIndex, 1);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Ürün silindi.',
        data: { items: user.businessProfile.catalogItems }
    },200);

    return response;
};

export const getBusinessFlashOffers = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id).select('userType businessProfile');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    const activeOnly = String(input.query.activeOnly || 'true') !== 'false';
    const offers = sanitizeBusinessFlashOffers(user.businessProfile?.flashOffers || []);
    const now = Date.now();
    const visible = activeOnly
        ? offers.filter((offer) => offer.isActive === true && new Date(offer.validUntil).getTime() > now)
        : offers;

    respond({
        status: 'success',
        results: visible.length,
        data: { offers: visible }
    },200);

    return response;
};

export const getNearbyBusinessFlashOffers = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const latitude = Number(input.query.lat);
    const longitude = Number(input.query.lng);
    const radiusKm = input.query.radius === undefined ? 30 : Number(input.query.radius);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return throwError(new AppError('Geçerli enlem ve boylam gönderilmelidir.', 400));
    }
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 300) {
        return throwError(new AppError('Yarıçap 1 ile 300 km arasında olmalıdır.', 400));
    }

    const businesses = await User.find({
        userType: 'PROFESSIONAL',
        activeProfileMode: 'PROFESSIONAL',
        'businessProfile.address': {
            $near: {
                $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                $maxDistance: Math.round(radiusKm * 1000)
            }
        },
        'businessProfile.flashOffers': {
            $elemMatch: { isActive: true, validUntil: { $gt: new Date() } }
        }
    })
        .select('_id name username avatar isVerified businessProfile')
        .limit(60)
        .lean();

    const toRadians = (value) => value * Math.PI / 180;
    const distanceKm = (coordinates) => {
        const [targetLng, targetLat] = coordinates;
        const dLat = toRadians(targetLat - latitude);
        const dLng = toRadians(targetLng - longitude);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRadians(latitude)) * Math.cos(toRadians(targetLat)) * Math.sin(dLng / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const offers = businesses.flatMap((business) => {
        const profile = businessProfileForPublic(business.businessProfile);
        const coordinates = profile?.address?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
        const distance = distanceKm(coordinates);
        return (profile.flashOffers || [])
            .filter((offer) => offer.targetRadiusKm >= distance)
            .map((offer) => ({
                offer,
                distanceKm: Number(distance.toFixed(1)),
                business: {
                    _id: business._id,
                    name: business.name,
                    username: business.username,
                    avatar: business.avatar,
                    isVerified: business.isVerified,
                    businessProfile: profile
                }
            }));
    }).sort((a, b) => a.distanceKm - b.distanceKm);

    respond({
        status: 'success',
        results: offers.length,
        data: { offers }
    },200);

    return response;
};

export const createBusinessFlashOffer = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const parsed = buildBusinessFlashOfferInput(input.body || {});
    if (parsed.error) {
        return throwError(new AppError(parsed.error, 400));
    }

    const user = await User.findById(input.user.id).select('userType businessProfile');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    if (!user.businessProfile) {
        user.businessProfile = {};
    }

    const normalizedOffers = sanitizeBusinessFlashOffers(user.businessProfile.flashOffers || []);
    const now = Date.now();
    const activeCount = normalizedOffers.filter(
        (offer) => offer.isActive === true && new Date(offer.validUntil).getTime() > now
    ).length;
    if (activeCount >= 1) {
        return throwError(new AppError('Aynı anda yalnızca 1 aktif flash kampanya yayınlayabilirsiniz.', 400));
    }

    const nextOffers = [parsed.value, ...normalizedOffers];
    user.businessProfile.flashOffers = sanitizeBusinessFlashOffers(nextOffers);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Flash kampanya yayinlandi.',
        data: {
            offer: parsed.value,
            offers: user.businessProfile.flashOffers
        }
    },201);

    return response;
};

export const cancelBusinessFlashOffer = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const offerId = String(input.params.offerId || '').trim();
    if (!offerId) {
        return throwError(new AppError('Geçersiz kampanya kimligi.', 400));
    }

    const user = await User.findById(input.user.id).select('userType businessProfile');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Bu islem icin profesyonel hesap gerekir.', 403));
    }

    if (!user.businessProfile) {
        return throwError(new AppError('Aktif isletme profili bulunamadı.', 404));
    }

    const offers = sanitizeBusinessFlashOffers(user.businessProfile.flashOffers || []);
    const index = offers.findIndex((offer) => String(offer.offerId) === offerId);
    if (index < 0) {
        return throwError(new AppError('Kampanya bulunamadı.', 404));
    }

    offers[index] = {
        ...offers[index],
        isActive: false,
        validUntil: new Date()
    };

    user.businessProfile.flashOffers = sanitizeBusinessFlashOffers(offers);
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Flash kampanya kapatildi.',
        data: { offer: offers[index], offers: user.businessProfile.flashOffers }
    },200);

    return response;
};

export const downgradeFromPro = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id).select('userType activeProfileMode businessProfile isPro isVerified verificationStatus');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.userType !== 'PROFESSIONAL') {
        return throwError(new AppError('Zaten bireysel hesap kullaniyorsunuz.', 400));
    }

    const openAppointments = await Appointment.find({
        businessId: user._id,
        status: { $in: ['pending', 'approved', 'inProgress'] }
    }).select('_id customerId');
    if (openAppointments.length > 0) {
        // Customers learn why: the workshop closed, not that it ignored them.
        await Appointment.updateMany(
            { _id: { $in: openAppointments.map((appointment) => appointment._id) } },
            { $set: { status: 'cancelled', statusReason: 'İşletme Motonom BİZ hesabını kapattı.' } }
        );
        await Promise.allSettled(
            openAppointments.map((appointment) => createNotification({
                recipient: appointment.customerId,
                sender: user._id,
                type: 'APPOINTMENT_CANCELLED',
                appointment: appointment._id
            }))
        );
    }

    user.userType = 'INDIVIDUAL';
    user.activeProfileMode = 'PERSONAL';
    user.businessProfile = undefined;
    user.markModified('businessProfile');
    await user.save({ validateBeforeSave: false });
    normalizeProfessionalStatusForResponse(user);

    respond({
        status: 'success',
        message: 'Profesyonel hesap kapatildi. Bireysel profil aktif.',
        data: {
            user: buildBusinessUserPayload(user),
            cancelledAppointments: openAppointments.length
        }
    },200);

    return response;
};

export const upgradeToBusiness = upgradeToPro;

export const downgradeFromBusiness = downgradeFromPro;
