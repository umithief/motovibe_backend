import Emoji from '../models/Emoji.js';

export const getMotoMojis = async (req, res) => {
  try {
    const emojis = await Emoji.find().sort({ sortOrder: 1 }).lean();
    
    const grouped = emojis.reduce((acc, emoji) => {
      (acc[emoji.category] = acc[emoji.category] || []).push(emoji);
      return acc;
    }, {});

    res.status(200).json({ success: true, data: grouped });
  } catch (error) {
    res.status(500).json({ success: false, error: 'MotoMoji getirilirken hata oluştu' });
  }
};
