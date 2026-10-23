import { serviceResult,throwError,readHeader } from "../../../utils/serviceResult.js";

import { raiseHttpError } from "../../../utils/httpError.js";


import mongoose from 'mongoose';



export const get=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const Model3D = mongoose.model('Model3D');
        const models = await Model3D.find().sort({ _id: -1 });
        respond(models,200);
    } catch (error) { throw error; }

    return response;
};

export const post=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const Model3D = mongoose.model('Model3D');
        const newModel = new Model3D(input.body);
        await newModel.save();
        respond(newModel,201);
    } catch (error) {
        raiseHttpError({ message: error.message },400);
    }

    return response;
};

export const deleteId=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const Model3D = mongoose.model('Model3D');
        await Model3D.findByIdAndDelete(input.params.id);
        respond({ message: 'Model deleted' },200);
    } catch (error) { throw error; }

    return response;
};
