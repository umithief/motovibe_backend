const asActiveDate = (value) => {
    if (value === null || value === undefined || value === '') return null;

    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

// A missing expiry denotes a legacy lifetime entitlement. An explicitly
// malformed expiry is denied, so corrupted data cannot grant permanent access.
export const hasActiveApexAccess = (user, now = new Date()) => {
    if (user?.isAdmin) return true;
    if (!user?.isPro && !user?.isPremium) return false;

    const expiry = asActiveDate(user?.proExpiryDate);
    if (expiry === null) return true;
    return expiry !== undefined && expiry > now;
};
