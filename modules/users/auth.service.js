import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';


import crypto from 'crypto';
import User from "./model.js";
import Post from "../posts/model.js";
import Reel from "../reels/model.js";
import Comment from "../posts/Comment.model.js";
import ReelComment from "../reels/ReelComment.model.js";
import Message from "../messages/model.js";
import Conversation from "../messages/Conversation.model.js";
import PackLoungeMessage from "../packs/PackLoungeMessage.model.js";
import PackPost from "../packs/PackPost.model.js";

import AppError from "../../utils/appError.js";
import bcrypt from 'bcryptjs';
import { isReservedUsername } from "../../utils/reservedUsernames.js";
import { sendSMS } from "../notifications/sms.service.js";
import PhoneOtp from "./PhoneOtp.model.js";
import { getJwtSecret } from "../../config/env.js";
import { disconnectUserSessions } from "../../socket.js";
import { createSessionResult } from './service.js';

export const registerUser = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { name, email, password, username, bikeModel } = input.body;

    if ([name, email, password].some((value) => typeof value !== 'string' || !value.trim())) {
        return throwError(new AppError('Lütfen isim, e-posta ve şifre girin.', 400));
    }
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const requestedUsername = typeof username === 'string' && username.trim()
        ? username.trim().toLowerCase()
        : normalizedEmail
            .split('@')[0]
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .slice(0, 20);
    const normalizedUsername = requestedUsername;
    if (normalizedName.length < 2 || normalizedName.length > 80) {
        return throwError(new AppError('Isim 2-80 karakter arasinda olmalidir.', 422));
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
        return throwError(new AppError('Gecerli bir e-posta adresi girin.', 422));
    }
    if (password.length < 8 || password.length > 128) {
        return throwError(new AppError('Sifre 8-128 karakter arasinda olmalidir.', 422));
    }
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername) || isReservedUsername(normalizedUsername)) {
        return throwError(new AppError('Kullanici adi 3-20 karakter olmali ve yalnizca harf, rakam veya alt cizgi icermelidir.', 422));
    }

    const userExists = await User.exists({
        $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    });
    if (userExists) {
        return throwError(new AppError('E-posta veya kullanici adi zaten kullanimda.', 409));
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Asfalt Kıdemi - Check if among first 1000 users
    let isFounder = false;
    try {
        const userCount = await User.countDocuments();
        isFounder = userCount < 1000;
    } catch (countErr) {
        console.error('[AUTH] countDocuments error:', countErr);
    }

    const newUser = await User.create({
        name: normalizedName,
        email: normalizedEmail,
        username: normalizedUsername,
        password: hashedPassword,
        bikeModel,
        isFounder,
        isPro: false,
        isPremium: false,
        isAdmin: false
    });

    await takeResult(createSessionResult(newUser,201));

    return response;
};

export const loginUser = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { email, password } = input.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return throwError(new AppError('Lütfen e-posta ve şifre girin.', 400));
    }

    const selectFields = '+password +tokenVersion name username email avatar coverImage bio phone address location garage totalKm topSpeed isAdmin isVerified rank points primaryBike bikeModel verificationStatus joinDate isFounder onboardingComplete createdAt isPro isPremium proExpiryDate profileThemeId profileThemeConfigVersion profileThemeUpdatedAt preferences ridingPace emergencyPhone userType activeProfileMode businessProfile bioBlocks revenueCatId isDeleted';
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select(selectFields);

    if (!user) {
        return throwError(new AppError('Hatalı e-posta veya şifre.', 401));
    }

    if (user.isDeleted) {
        return throwError(new AppError('Bu hesap kapatılmıştır.', 403));
    }

    if (!(await bcrypt.compare(password, user.password))) {
        return throwError(new AppError('Hatalı e-posta veya şifre.', 401));
    }

    await takeResult(createSessionResult(user,200));

    return response;
};

export const updatePassword = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    // Since user requested "Change Password flow", we need a controller for it.
    // This typically requires: currentPassword, password, passwordConfirm
    const { currentPassword, password, passwordConfirm } = input.body;

    if ([currentPassword, password, passwordConfirm].some((value) => typeof value !== 'string')) {
        return throwError(new AppError('Mevcut sifre, yeni sifre ve sifre tekrari zorunludur.', 400));
    }
    if (password.length < 8 || password.length > 128) {
        return throwError(new AppError('Yeni sifre 8-128 karakter arasinda olmalidir.', 422));
    }
    if (password !== passwordConfirm) {
        return throwError(new AppError('Sifreler eslesmiyor.', 422));
    }

    // 1) Get user from collection
    const user = await User.findById(input.user.id).select('+password +tokenVersion +refreshSessions');

    if (!user) {
        return throwError(new AppError('Kullanici bulunamadi.', 404));
    }

    // 2) Check if POSTed current password is correct
    if (!(await user.correctPassword(currentPassword, user.password))) {
        return throwError(new AppError('Mevcut şifreniz hatalı.', 401));
    }

    // 3) Update
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(password, salt);
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    user.refreshSessions = [];

    await user.save();

    await takeResult(createSessionResult(user,200));
    const disconnectTimer = setTimeout(() => disconnectUserSessions(user._id), 1000);
    disconnectTimer.unref?.();

    return response;
};

export const sendPhoneOtp = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { phone } = input.body;
    if (typeof phone !== 'string' || !phone.trim()) {
        return throwError(new AppError('Telefon numarası zorunludur.', 400));
    }

    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    if (!/^\+?[1-9]\d{9,14}$/.test(cleanedPhone)) {
        return throwError(new AppError('Geçerli bir telefon numarası giriniz.', 400));
    }

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto
        .createHmac('sha256', getJwtSecret())
        .update(`${input.user.id}:${cleanedPhone}:${otpCode}`, 'utf8')
        .digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await PhoneOtp.findOneAndUpdate(
        { userId: input.user.id },
        {
            userId: input.user.id,
            phone: cleanedPhone,
            otpHash,
            attempts: 0,
            expiresAt,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const smsResult = await sendSMS({
        to: cleanedPhone,
        message: `MotoVibe telefon doğrulama kodunuz: ${otpCode}. Bu kod 10 dakika geçerlidir.`
    });

    const isProd = process.env.NODE_ENV === 'production';
    if (!smsResult.success && isProd) {
        await PhoneOtp.deleteOne({ userId: input.user.id, otpHash });
        return throwError(new AppError('Doğrulama kodu gönderilemedi. Lütfen tekrar deneyin.', 503));
    }

    respond({
        status: 'success',
        message: 'Doğrulama kodu telefonunuza gönderildi.',
        phone: cleanedPhone,
        isMock: !isProd && smsResult.provider === 'NONE'
    },200);

    return response;
};

export const verifyPhone = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { phone, otp } = input.body;

    if (typeof phone !== 'string' || !phone.trim()) {
        return throwError(new AppError('Telefon numarası zorunludur.', 400));
    }

    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    const cleanOtp = otp ? otp.toString().trim() : '';

    if (!/^\d{6}$/.test(cleanOtp)) {
        return throwError(new AppError('Geçerli bir doğrulama kodu (OTP) giriniz.', 400));
    }

    const otpRecord = await PhoneOtp.findOneAndUpdate({
        userId: input.user.id,
        phone: cleanedPhone,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: 5 },
    }, {
        $inc: { attempts: 1 },
    }, { new: true }).select('+otpHash +attempts');

    const submittedHash = crypto
        .createHmac('sha256', getJwtSecret())
        .update(`${input.user.id}:${cleanedPhone}:${cleanOtp}`, 'utf8')
        .digest('hex');
    const storedHash = otpRecord?.otpHash || '';
    const isValid = storedHash.length === submittedHash.length &&
        storedHash.length > 0 &&
        crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(submittedHash, 'hex'));

    if (!isValid) {
        if (otpRecord?.attempts >= 5) {
            await PhoneOtp.deleteOne({ _id: otpRecord._id });
        }
        return throwError(new AppError('Geçersiz veya süresi dolmuş doğrulama kodu.', 400));
    }

    await Promise.all([
        User.findByIdAndUpdate(input.user.id, {
            isPhoneVerified: true,
            phone: cleanedPhone,
        }),
        PhoneOtp.deleteOne({ _id: otpRecord._id }),
    ]);

    respond({
        status: 'success',
        message: 'Telefon numarası başarıyla doğrulandı.',
        verified: true,
        phone: cleanedPhone,
    },200);

    return response;
};

export const deleteMyAccount = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const user = await User.findById(input.user.id).select('+tokenVersion +refreshSessions');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    user.isDeleted = true;
    user.deletedAt = new Date();
    user.pushTokens = [];
    user.refreshSessions = [];
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    user.resetPasswordOTPHash = undefined;
    user.resetPasswordNonce = undefined;
    user.resetPasswordAttempts = 0;
    user.resetPasswordExpires = undefined;
    user.email = `deleted_${user._id}_${user.email}`;
    if (user.username) {
        user.username = `deleted_${user._id}_${user.username}`;
    }
    await user.save({ validateBeforeSave: false });
    disconnectUserSessions(user._id);

    // İçerikleri gizle, mesaj ve yorumları temizle, takip grafiğini sıfırla
    try {
        await Promise.allSettled([
            Post.updateMany(
                { user: user._id },
                { $set: { isDeleted: true, visibility: 'DELETED' } }
            ),
            Reel.updateMany(
                { userId: { $in: [user._id.toString(), user._id] } },
                { $set: { isDeleted: true } }
            ),
            Comment.deleteMany({ author: user._id }),
            ReelComment.deleteMany({ author: user._id }),
            PackPost.updateMany(
                { 'comments.author': user._id },
                { $pull: { comments: { author: user._id } } }
            ),
            Message.deleteMany({ sender: user._id }),
            PackLoungeMessage.deleteMany({ sender: user._id }),
            Conversation.updateMany(
                { participants: user._id },
                { $pull: { participants: user._id } }
            ),
            User.updateMany(
                { followers: user._id },
                { $pull: { followers: user._id } }
            ),
            User.updateMany(
                { following: user._id },
                { $pull: { following: user._id } }
            )
        ]);
    } catch (cleanErr) {
        console.warn('deleteMyAccount cleanup warning:', cleanErr);
    }

    respond({
        status: 'success',
        message: 'Hesabınız ve kişisel verileriniz başarıyla silindi.'
    },200);

    return response;
};
