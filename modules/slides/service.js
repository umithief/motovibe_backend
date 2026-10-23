import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';

import { raiseHttpError } from '../../utils/httpError.js';


import mongoose from 'mongoose';

import Slide from "./model.js";

import { validateSlideBody } from "../../utils/slideValidation.js";

import { getIO } from "../../socket.js";



export const get=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const includeInactive = input.query.includeInactive === 'true';

        let slides;
        if (includeInactive) {
            if (!input.user || !input.user.isAdmin) {
                return raiseHttpError({ message: 'Tüm slaytları görüntülemek için yönetici yetkisi gereklidir.' },403);
            }
            slides = await Slide.find().lean().sort({ order: 1 });
        } else {
            if (typeof Slide.getActiveSlides === 'function') {
                slides = await Slide.getActiveSlides();
            } else {
                slides = await Slide.find({ isActive: true }).lean().sort({ order: 1 });
            }
        }
        respond(slides,200);
    } catch (error) { throw error; }

    return response;
};

export const putReorder=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { slideIds } = input.body;
        if (!Array.isArray(slideIds) || !slideIds.length || slideIds.length > 100 ||
            new Set(slideIds).size !== slideIds.length ||
            slideIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) {
            return raiseHttpError({ message: 'Geçersiz slayt sıralaması.' },400);
        }
        const Slide = mongoose.model('Slide');

        // Update order for each slide
        for (let i = 0; i < slideIds.length; i++) {
            await Slide.findByIdAndUpdate(slideIds[i], { order: i });
        }
        try { getIO().emit('app_config_updated', { type: 'slides' }); } catch(e) {} respond({ message: 'Success' },200);
    } catch (error) { throw error; }

    return response;
};

export const post=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const body = validateSlideBody(input.body);
        const newSlide = new Slide(body);
        await newSlide.save();
        try { getIO().emit('app_config_updated', { type: 'slides' }); } catch(e) {} respond(newSlide,201);
    } catch (error) {
        raiseHttpError({ message: error.message },400);
    }

    return response;
};

export const putId=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const existing = await Slide.findById(input.params.id).lean();
        if (!existing) return raiseHttpError({ message: 'Slayt bulunamadı.' },404);
        const patch = validateSlideBody(input.body, { partial: true });
        validateSlideBody({ ...existing, ...patch,
            startDate: patch.startDate !== undefined ? patch.startDate : existing.startDate?.toISOString() || null,
            endDate: patch.endDate !== undefined ? patch.endDate : existing.endDate?.toISOString() || null });
        const updatedSlide = await Slide.findByIdAndUpdate(input.params.id, patch, { new: true, runValidators: true });
        try { getIO().emit('app_config_updated', { type: 'slides' }); } catch(e) {} respond(updatedSlide,200);
    } catch (error) {
        raiseHttpError({ message: error.message },400);
    }

    return response;
};

export const deleteId=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const Slide = mongoose.model('Slide');
        await Slide.findByIdAndDelete(input.params.id);
        try { getIO().emit('app_config_updated', { type: 'slides' }); } catch(e) {} respond({ message: 'Slide silindi' },200);
    } catch (error) { throw error; }

    return response;
};
