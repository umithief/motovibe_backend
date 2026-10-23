import catchAsync from '../../utils/catchAsync.js';
import AppError from '../../utils/appError.js';
const disabled=catchAsync(async()=>{const error=new AppError('Bu özellik bu sürümde kapalı.',404);error.code='FEATURE_DISABLED';throw error;});
export const getCart=disabled;
export const addToCart=disabled;
export const removeFromCart=disabled;
export const updateCartItem=disabled;
