
import UISetting from '../models/UISetting.js';


import SiteBranding from '../models/SiteBranding.js';

export const getBranding = async (req, res) => {
    try {
        let branding = await SiteBranding.findOne();
        if (!branding) {
            branding = await SiteBranding.create({}); // Create default if none exists
        }
        res.status(200).json(branding);
    } catch (error) {
        console.error('Branding Fetch Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

export const updateBranding = async (req, res) => {
    try {
        const settings = req.body;
        const branding = await SiteBranding.findOneAndUpdate(
            {},
            { ...settings, updatedAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.status(200).json(branding);
    } catch (error) {
        console.error('Branding Update Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};




export const getSettings = async (req, res) => {
    try {
        const settings = await UISetting.find();
        const settingsMap = settings.reduce((acc, curr) => ({ ...acc, [curr.component]: curr.config }), {});
        res.status(200).json(settingsMap);
    } catch (error) {
        console.error('UI Settings Fetch Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

export const updateSettings = async (req, res) => {
    try {
        const { component } = req.params;
        const config = req.body;

        const setting = await UISetting.findOneAndUpdate(
            { component },
            { config, updatedAt: new Date(), updatedBy: req.user ? req.user._id : 'admin' },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json(setting);
    } catch (error) {
        console.error('UI Settings Update Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
