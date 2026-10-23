import { sendResponse } from '../../utils/respond.js';
import { serializeMediaUrls } from "../../utils/serializeMediaUrls.js";
import User from "./model.js";
import catchAsync from "../../utils/catchAsync.js";

export const getCart = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('cart');
    sendResponse(res.req,res,{
        status: 'success',
        data: { cart: user.cart }
    },{statusCode:200});
});

export const addToCart = catchAsync(async (req, res, next) => {
    const { productId, name, price, image, quantity = 1 } = req.body;

    // Check if item exists
    const user = await User.findById(req.user.id);
    const existingItemIndex = user.cart.findIndex(item => item.productId === productId);

    if (existingItemIndex > -1) {
        // Update quantity
        user.cart[existingItemIndex].quantity += quantity;
    } else {
        // Add new
        user.cart.push({ productId, name, price, image, quantity });
    }

    await user.save({ validateBeforeSave: false });

    sendResponse(res.req,res,{
        status: 'success',
        data: { cart: user.cart }
    },{statusCode:200});
});

export const removeFromCart = catchAsync(async (req, res, next) => {
    const { productId } = req.params;

    // Using pull to remove item
    const user = await User.findByIdAndUpdate(
        req.user.id,
        { $pull: { cart: { productId } } },
        { new: true }
    );

    sendResponse(res.req,res,{
        status: 'success',
        data: { cart: user.cart }
    },{statusCode:200});
});

export const updateCartItem = catchAsync(async (req, res, next) => {
    const { productId } = req.params;
    const { quantity } = req.body;

    const user = await User.findById(req.user.id);
    const item = user.cart.find(item => item.productId === productId);

    if (item) {
        item.quantity = quantity;
        await user.save({ validateBeforeSave: false });
    }

    sendResponse(res.req,res,{
        status: 'success',
        data: { cart: user.cart }
    },{statusCode:200});
});
