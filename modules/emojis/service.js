import { serviceResult,throwError,readHeader } from '../../utils/serviceResult.js';



import Emoji from "./model.js";

export const getMotoMojis = async (input) => {
    let response;
    const respond=(body,statusCode=200,options)=>response=serviceResult(body,statusCode,options);

  try {
    const emojis = await Emoji.find().sort({ sortOrder: 1 }).lean();

    const grouped = emojis.reduce((acc, emoji) => {
      (acc[emoji.category] = acc[emoji.category] || []).push(emoji);
      return acc;
    }, {});

    respond({ success: true, data: grouped },200);
  } catch (error) { throw error; }

    return response;
};
