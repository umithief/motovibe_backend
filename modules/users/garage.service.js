import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';
import { raiseHttpError } from '../../utils/httpError.js';


import mongoose from 'mongoose';
import User from "./model.js";

import AppError from "../../utils/appError.js";
import { recalculatePacksForUser, refreshPackGlobalRanks } from "../packs/service.js";

export const getGarage = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const targetUserId = input.query.userId || input.user.id;
    const user = await User.findById(targetUserId).select('name username garage primaryBike bikeModel');
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    const garage = user.garage || [];
    respond({
        status: 'success',
        results: garage.length,
        data: {
            garage,
            primaryBike: user.primaryBike || user.bikeModel || '',
            userName: user.name || user.username
        }
    },200);

    return response;
};

export const addToGarage = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { brand, model, year, image, km, color, cc, hp, style, isPrimary } = input.body;

    if (!brand || !model || !brand.trim() || !model.trim()) {
        return throwError(new AppError('Motosiklet marka ve modeli zorunludur.', 400));
    }

    const user = await User.findById(input.user.id);
    if (!user) {
        return throwError(new AppError('Kullanıcı bulunamadı.', 404));
    }

    if (user.garage && user.garage.length >= 20) {
        return throwError(new AppError('Garajınızda en fazla 20 motosiklet barındırabilirsiniz.', 400));
    }

    const shouldBePrimary = isPrimary === true || user.garage.length === 0;

    if (shouldBePrimary && user.garage.length > 0) {
        user.garage.forEach(b => { b.isPrimary = false; });
    }

    const newBike = {
        brand: brand.trim(),
        model: model.trim(),
        year: Number(year) || new Date().getFullYear(),
        image: image && typeof image === 'string' && image.trim() ? image.trim() : null,
        km: Number(km) >= 0 ? Number(km) : 0,
        color: color ? color.trim() : null,
        cc: Number(cc) > 0 ? Number(cc) : undefined,
        hp: Number(hp) > 0 ? Number(hp) : undefined,
        style: style || 'UNKNOWN',
        isPrimary: shouldBePrimary,
        _id: new mongoose.Types.ObjectId()
    };

    user.garage.push(newBike);

    if (shouldBePrimary) {
        user.primaryBike = `${brand.trim()} ${model.trim()}`;
        user.bikeModel = `${brand.trim()} ${model.trim()}`;
    }

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);

    respond({
        status: 'success',
        message: 'Motosiklet garaja eklendi.',
        data: {
            bike: newBike,
            garage: user.garage,
            primaryBike: user.primaryBike
        }
    },201);

    return response;
};

export const removeFromGarage = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { garageId } = input.params;

    const user = await User.findById(input.user.id);
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));

    const bikeIndex = user.garage.findIndex(b => b._id.toString() === garageId);
    if (bikeIndex === -1) {
        return throwError(new AppError('Motosiklet bulunamadı.', 404));
    }

    const wasPrimary = user.garage[bikeIndex].isPrimary ||
        user.primaryBike === `${user.garage[bikeIndex].brand} ${user.garage[bikeIndex].model}`;

    user.garage.splice(bikeIndex, 1);

    if (wasPrimary) {
        if (user.garage.length > 0) {
            user.garage[0].isPrimary = true;
            user.primaryBike = `${user.garage[0].brand} ${user.garage[0].model}`;
            user.bikeModel = `${user.garage[0].brand} ${user.garage[0].model}`;
        } else {
            user.primaryBike = '';
            user.bikeModel = '';
        }
    }

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(input.user.id);

    respond({
        status: 'success',
        message: 'Motosiklet garajdan silindi.',
        data: {
            garage: user.garage,
            primaryBike: user.primaryBike
        }
    },200);

    return response;
};

export const setPrimaryBike = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { garageId } = input.body;
    if (!garageId) {
        return throwError(new AppError('Motosiklet ID gereklidir.', 400));
    }

    const user = await User.findById(input.user.id);
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return throwError(new AppError('Motosiklet bulunamadı.', 404));

    user.garage.forEach(b => {
        b.isPrimary = (b._id.toString() === garageId);
    });

    user.primaryBike = `${bike.brand} ${bike.model}`;
    user.bikeModel = `${bike.brand} ${bike.model}`;

    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Birincil motosiklet güncellendi.',
        data: {
            garage: user.garage,
            primaryBike: user.primaryBike
        }
    },200);

    return response;
};

export const verifyGarageItem = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { garageId } = input.params;
    const { verificationImage } = input.body;

    if (!verificationImage) {
        return throwError(new AppError('Doğrulama görseli gereklidir.', 400));
    }

    const user = await User.findById(input.user.id);
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return throwError(new AppError('Motosiklet bulunamadı.', 404));

    bike.verificationImage = verificationImage;
    bike.verificationStatus = 'pending';
    bike.isVerified = false;

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);
    await refreshPackGlobalRanks();

    respond({
        status: 'success',
        message: 'Doğrulama talebi gönderildi.',
        data: {
            bike,
            garage: user.garage
        }
    },200);

    return response;
};

export const updateGarageItem = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { garageId } = input.params;
    const { brand, model, year, image, km, color, cc, hp, style, isPrimary } = input.body;

    const user = await User.findById(input.user.id);
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return throwError(new AppError('Motosiklet bulunamadı.', 404));

    if (brand && brand.trim()) bike.brand = brand.trim();
    if (model && model.trim()) bike.model = model.trim();
    if (year !== undefined) bike.year = Number(year) || bike.year;
    if (image !== undefined) bike.image = image && typeof image === 'string' && image.trim() ? image.trim() : null;
    if (km !== undefined) bike.km = Number(km) >= 0 ? Number(km) : bike.km;
    if (color !== undefined) bike.color = color ? color.trim() : null;
    if (cc !== undefined) bike.cc = Number(cc) > 0 ? Number(cc) : undefined;
    if (hp !== undefined) bike.hp = Number(hp) > 0 ? Number(hp) : undefined;
    if (style !== undefined) bike.style = style || 'UNKNOWN';

    if (isPrimary === true) {
        user.garage.forEach(b => {
            b.isPrimary = (b._id.toString() === garageId);
        });
        user.primaryBike = `${bike.brand} ${bike.model}`;
        user.bikeModel = `${bike.brand} ${bike.model}`;
    } else if (isPrimary === false && bike.isPrimary) {
        bike.isPrimary = false;
    }

    await user.save({ validateBeforeSave: false });
    await recalculatePacksForUser(user._id);

    respond({
        status: 'success',
        message: 'Motosiklet güncellendi.',
        data: {
            bike,
            garage: user.garage,
            primaryBike: user.primaryBike
        }
    },200);

    return response;
};

export const addMaintenanceRecord = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { garageId } = input.params;
    const { title, km, cost, serviceName, description, date } = input.body;

    if (!title || !title.trim()) {
        return throwError(new AppError('Bakım başlığı zorunludur.', 400));
    }

    const user = await User.findById(input.user.id);
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return throwError(new AppError('Motosiklet bulunamadı.', 404));

    if (!bike.maintenanceRecords) {
        bike.maintenanceRecords = [];
    }

    const record = {
        title: title.trim(),
        km: Number(km) >= 0 ? Number(km) : undefined,
        cost: Number(cost) >= 0 ? Number(cost) : undefined,
        serviceName: serviceName && serviceName.trim() ? serviceName.trim() : undefined,
        description: description && description.trim() ? description.trim() : undefined,
        date: date ? new Date(date) : new Date(),
        _id: new mongoose.Types.ObjectId()
    };

    bike.maintenanceRecords.unshift(record);

    if (record.km && record.km > (bike.km || 0)) {
        bike.km = record.km;
    }

    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Bakım kaydı eklendi.',
        data: {
            record,
            bike,
            maintenanceRecords: bike.maintenanceRecords
        }
    },201);

    return response;
};

export const deleteMaintenanceRecord = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { garageId, recordId } = input.params;

    const user = await User.findById(input.user.id);
    if (!user) return throwError(new AppError('Kullanıcı bulunamadı.', 404));

    const bike = user.garage.id(garageId);
    if (!bike) return throwError(new AppError('Motosiklet bulunamadı.', 404));

    if (bike.maintenanceRecords) {
        bike.maintenanceRecords = bike.maintenanceRecords.filter(
            r => r._id.toString() !== recordId
        );
    }

    await user.save({ validateBeforeSave: false });

    respond({
        status: 'success',
        message: 'Bakım kaydı silindi.',
        data: {
            bike,
            maintenanceRecords: bike.maintenanceRecords
        }
    },200);

    return response;
};

export const calculateFuelEfficiency = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);
    const takeResult=async result=>response=await result;

    const { expenses } = input.body;

    if (!expenses || !Array.isArray(expenses)) {
        return throwError(new AppError('Geçersiz gider verisi.', 400));
    }

    const fuelLogs = expenses
        .filter(e => e.type === 'FUEL')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (fuelLogs.length < 2) {
        return raiseHttpError({ message: "Hesaplama için en az iki yakıt alımı gereklidir." },400,{legacyExact:true});
    }

    const lastFuel = fuelLogs[fuelLogs.length - 2];
    const currentFuel = fuelLogs[fuelLogs.length - 1];
    const odoDifference = currentFuel.odometer - lastFuel.odometer;

    if (odoDifference <= 0) {
        return raiseHttpError({ message: "Geçersiz kilometre verisi algılandı." },400,{legacyExact:true});
    }

    const efficiency = (currentFuel.liters / odoDifference) * 100;

    respond({
        status: 'success',
        data: {
            efficiencyPer100km: efficiency.toFixed(2),
            month: new Date(currentFuel.date).getMonth() + 1
        }
    },200);

    return response;
};
