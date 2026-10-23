import { serviceResult,throwError,readHeader } from "../../../utils/serviceResult.js";

import { raiseHttpError } from "../../../utils/httpError.js";


import mongoose from 'mongoose';

import redis from "../../../config/redis.js";



export const get=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const cacheKey = 'cache:categories';
        const cached = await redis.get(cacheKey);
        if (cached) return respond(JSON.parse(cached),200);

        const Category = mongoose.model('Category');
        const categories = await Category.find().lean();

        await redis.set(cacheKey, JSON.stringify(categories), 'EX', 3600); // 1 hour cache
        respond(categories,200);
    } catch (error) { throw error; }

    return response;
};

export const post=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const Category = mongoose.model('Category');
        const newCategory = new Category(input.body);
        await newCategory.save();
        await redis.del('cache:categories');
        respond(newCategory,201);
    } catch (error) {
        raiseHttpError({ message: error.message },400);
    }

    return response;
};

export const putId=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        if (!mongoose.Types.ObjectId.isValid(input.params.id)) {
            return raiseHttpError({ message: 'Geçersiz ID formatı' },400);
        }

        const Category = mongoose.model('Category');
        const updatedCategory = await Category.findByIdAndUpdate(input.params.id, input.body, { new: true });

        if (!updatedCategory) {
            return raiseHttpError({ message: 'Kategori bulunamadı' },404);
        }

        await redis.del('cache:categories');
        respond(updatedCategory,200);
    } catch (error) { throw error; }

    return response;
};

export const deleteId=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        if (!mongoose.Types.ObjectId.isValid(input.params.id)) {
            return raiseHttpError({ message: 'Geçersiz ID formatı' },400);
        }

        const Category = mongoose.model('Category');
        const result = await Category.findByIdAndDelete(input.params.id);

        if (!result) {
            return raiseHttpError({ message: 'Kategori bulunamadı' },404);
        }

        await redis.del('cache:categories');
        respond({ message: 'Kategori silindi' },200);
    } catch (error) { throw error; }

    return response;
};
