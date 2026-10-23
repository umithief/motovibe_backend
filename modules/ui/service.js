import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';




import UISetting from "./model.js";


import SiteBranding from "./SiteBranding.model.js";

export const getBranding = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        let branding = await SiteBranding.findOne();
        if (!branding) {
            branding = await SiteBranding.create({}); // Create default if none exists
        }
        respond(branding,200);
    } catch (error) { throw error; }

    return response;
};

export const updateBranding = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const settings = input.body;
        const branding = await SiteBranding.findOneAndUpdate(
            {},
            { ...settings, updatedAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        respond(branding,200);
    } catch (error) { throw error; }

    return response;
};

export const getSettings = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const settings = await UISetting.find();
        const settingsMap = settings.reduce((acc, curr) => ({ ...acc, [curr.component]: curr.config }), {});
        respond(settingsMap,200);
    } catch (error) { throw error; }

    return response;
};

export const updateSettings = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

    try {
        const { component } = input.params;
        const config = input.body;

        const setting = await UISetting.findOneAndUpdate(
            { component },
            { config, updatedAt: new Date(), updatedBy: input.user ? input.user._id : 'admin' },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        respond(setting,200);
    } catch (error) { throw error; }

    return response;
};
