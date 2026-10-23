import { serializeMediaUrls } from "../../../utils/serializeMediaUrls.js";
import express from 'express';

const router = express.Router();

const getSettings = () => ({
    apiKey: process.env.LASTFM_API_KEY,
});

// GET currently playing track from Last.fm
router.get('/:username/now-playing', async (req, res) => {
    const { username } = req.params;
    const { apiKey } = getSettings();

    if (!username) {
        return res.status(400).json(serializeMediaUrls({ success: false, message: 'Username is required' }, res.req));
    }

    if (!apiKey) {
        return res.status(500).json(serializeMediaUrls({ success: false, message: 'LASTFM_API_KEY not found in .env' }, res.req));
    }

    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=${apiKey}&format=json&limit=1`;

        const response = await fetch(url);

        if (!response.ok) {
            const errBody = await response.text();
            console.error('Last.fm API Error:', response.status, errBody);
            return res.status(response.status).json(serializeMediaUrls({ success: false, message: 'Failed to fetch from Last.fm', detail: errBody }, res.req));
        }

        const data = await response.json();

        // Check for error payload in a 200 response (Last.fm sometimes does this)
        if (data.error) {
            return res.status(400).json(serializeMediaUrls({ success: false, message: data.message }, res.req));
        }

        const tracks = data.recenttracks?.track;
        if (!tracks || tracks.length === 0) {
            return res.json(serializeMediaUrls({ success: true, isPlaying: false, message: 'No tracks found' }, res.req));
        }

        // Get the very first track
        // Last.fm returns either an array of objects or a single object. If array, get [0]
        const latestTrack = Array.isArray(tracks) ? tracks[0] : tracks;

        // Check if it's currently playing (Last.fm uses an "@attr" object with "nowplaying": "true")
        const isPlaying = latestTrack['@attr'] && latestTrack['@attr'].nowplaying === 'true';

        return res.json(serializeMediaUrls({
            success: true,
            isPlaying: isPlaying,
            data: {
                trackName: latestTrack.name,
                artistName: latestTrack.artist['#text'] || latestTrack.artist.name,
                coverUrl: latestTrack.image && latestTrack.image.length > 0 ? latestTrack.image[latestTrack.image.length - 1]['#text'] : '',
                trackUrl: latestTrack.url || ''
            }
        }, res.req));

    } catch (err) {
        console.error('Last.fm Fetch Error:', err);
        res.status(500).json(serializeMediaUrls({ success: false, message: err.message }, res.req));
    }
});

export default router;
