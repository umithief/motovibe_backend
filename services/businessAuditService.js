import BusinessAuditLog from '../models/BusinessAuditLog.js';

export const recordBusinessAudit = async (entry) => {
    try {
        return await BusinessAuditLog.create(entry);
    } catch (error) {
        console.error('[BusinessAudit] Write failed:', error.message);
        return null;
    }
};
