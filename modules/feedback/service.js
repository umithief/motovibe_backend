import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';

import { raiseHttpError } from '../../utils/httpError.js';


import mongoose from 'mongoose';



export const get=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        // Find existing model or use schema if not compiled yet (Server.js usually handles this)
        // Check if Feedback model exists, if not it might be missing in server.js
        // Need to check server.js if "Feedback" schema is defined.
        // Based on audit, Feedback schema was NOT in server.js! I need to add it there or here.
        // I will add it here to be safe, but ideally in server.js

        // Checking if model exists
        let Feedback;
        try {
            Feedback = mongoose.model('Feedback');
        } catch {
            const feedbackSchema = new mongoose.Schema({
                id: String,
                userId: String,
                userName: String,
                type: String,
                rating: Number,
                message: String,
                date: String,
                status: { type: String, default: 'new' }
            });
            Feedback = mongoose.model('Feedback', feedbackSchema);
        }

        const items = await Feedback.find().sort({ _id: -1 });
        respond(items,200);
    } catch (error) { throw error; }

    return response;
};

export const post=async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const Feedback = mongoose.model('Feedback');
        const newFeedback = new Feedback(input.body);
        await newFeedback.save();
        respond(newFeedback,201);
    } catch (error) {
        raiseHttpError({ message: error.message },400);
    }

    return response;
};
