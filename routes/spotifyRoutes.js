import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { checkUser, protect } from '../middleware/authMiddleware.js';
import { getJwtSecret } from '../config/env.js';

const router = express.Router();

// Helper to get credentials
const getSpotifyCredentials = () => ({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:5001/api/spotify/callback'
});

const buildSpotifyAuthorizationUrl = ({ clientId, redirectUri, state }) => {
    const scope = 'user-read-currently-playing user-read-playback-state user-read-private user-read-email';
    const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope,
        redirect_uri: redirectUri,
        state,
        show_dialog: 'true',
    }).toString();
    return `https://accounts.spotify.com/authorize?${query}`;
};

// The app obtains a signed OAuth URL through an authenticated API call.
// User ids and access tokens are never accepted in browser query parameters.
router.post('/auth-url', protect, (req, res) => {
    const { clientId, clientSecret, redirectUri } = getSpotifyCredentials();

    if (!clientId || !clientSecret) {
        return res.status(503).json({
            status: 'error',
            message: 'Spotify baglantisi su anda kullanilamiyor.',
        });
    }

    const state = jwt.sign(
        { userId: req.user.id, purpose: 'spotify-link' },
        getJwtSecret(),
        {
            algorithm: 'HS256',
            expiresIn: '10m',
            issuer: 'motovibe-api',
            audience: 'spotify-oauth',
        },
    );

    return res.status(200).json({
        status: 'success',
        data: { authorizationUrl: buildSpotifyAuthorizationUrl({ clientId, redirectUri, state }) },
    });
});

router.get('/auth', (_req, res) => res.status(410).send('Bu baglanti akisi guncellendi. Lutfen uygulamayi guncelleyin.'));

// 2. Callback from Spotify
router.get('/callback', async (req, res) => {
    const { code, error, state } = req.query;
    const { clientId, clientSecret, redirectUri } = getSpotifyCredentials();

    if (error || !code) {
        return res.status(400).send('<h2>Spotify yetkilendirmesi tamamlanamadi.</h2>');
    }

    if (!state) {
        return res.status(400).send('<h2>Geçersiz OAuth oturumu (State eksik).</h2>');
    }

    let userId;
    try {
        const decoded = jwt.verify(state, getJwtSecret(), {
            algorithms: ['HS256'],
            issuer: 'motovibe-api',
            audience: 'spotify-oauth',
        });
        if (decoded?.purpose !== 'spotify-link') {
            throw new Error('Invalid OAuth state purpose');
        }
        userId = decoded.userId;
    } catch (_) {
        return res.status(400).send('<h2>Geçersiz veya süresi dolmuş OAuth oturumu.</h2>');
    }

    try {
        const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
            },
            body: new URLSearchParams({
                code: code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            }).toString()
        });

        const data = await tokenResponse.json();

        if (data.error) {
            console.error('Spotify Callback Token Error:', data);
            return res.send(`<h2>Error generating token: ${data.error_description || data.error}</h2>`);
        }

        const refreshToken = data.refresh_token;

        if (refreshToken) {
            await User.findByIdAndUpdate(userId, { spotifyRefreshToken: refreshToken });
        }

        res.send(`
            <html>
            <body style="background-color: #111; color: #fff; text-align: center; padding: 50px; font-family: sans-serif;">
                <h1 style="color: #1DB954;">Spotify Successfully Connected!</h1>
                <p>You can now close this window and return to MotoVibe Studio.</p>
                <script>setTimeout(() => { window.close(); }, 3000);</script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Spotify Callback Error:', err);
        res.status(500).send(`<h2>Internal Server Error</h2><p>${err.message}</p>`);
    }
});

// 3. Get Currently Playing via Refresh Token
router.get('/:id/now-playing', checkUser, async (req, res) => {
    const { clientId, clientSecret } = getSpotifyCredentials();
    const targetUserId = req.params.id;
    const viewerId = req.user?.id;
    const isMe = viewerId && viewerId === targetUserId;

    try {
        const user = await User.findById(targetUserId).select('+spotifyRefreshToken privacy blockedUsers followers');
        if (!user) {
            return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
        }

        if (viewerId && !isMe) {
            const isTargetBlockedByMe = (req.user.blockedUsers || []).some(b => b.toString() === targetUserId);
            const amIBlockedByTarget = (user.blockedUsers || []).some(b => b.toString() === viewerId);
            if (isTargetBlockedByMe || amIBlockedByTarget) {
                return res.status(403).json({ success: false, message: 'Erişim engellendi.' });
            }
        }

        if (user.privacy?.isPrivate && !isMe) {
            const isFollowing = (user.followers || []).some(f => f.toString() === viewerId);
            if (!isFollowing) {
                return res.status(403).json({ success: false, message: 'Gizli hesap içeriği görüntülenemez.' });
            }
        }

        if (!user.spotifyRefreshToken) {
            return res.status(404).json({ success: false, message: 'Spotify bağlı değil.' });
        }

        const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: user.spotifyRefreshToken,
                client_id: clientId
            }).toString()
        });

        const tokenData = await tokenResponse.json();
        if (tokenData.error) {
            console.error('Spotify Refresh Token Error:', tokenData);
            return res.status(401).json({ success: false, message: 'Spotify session expired. Please reconnect.' });
        }

        const accessToken = tokenData.access_token;

        const npResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (npResponse.status === 204) {
            return res.json({ success: true, isPlaying: false, message: 'No track currently playing' });
        }

        if (npResponse.status > 400) {
            const errData = await npResponse.text();
            let userMessage = 'Spotify API Error';
            
            if (npResponse.status === 403 && (errData.includes('not registered') || errData.includes('User not registered'))) {
                userMessage = 'Spotify Dashboard: User not registered in "Users and Scopes". Please check your developer settings.';
            }

            console.error(`Spotify API Error [${npResponse.status}]:`, errData);
            return res.status(npResponse.status).json({
                success: false,
                message: userMessage,
                detail: errData
            });
        }

        const npData = await npResponse.json();

        if (!npData.item) {
            return res.json({ success: true, isPlaying: false, message: 'No track item found' });
        }

        return res.json({
            success: true,
            isPlaying: npData.is_playing,
            data: {
                trackName: npData.item.name,
                artistName: npData.item.artists.map(a => a.name).join(', '),
                coverUrl: npData.item.album.images[0]?.url || '',
                trackUrl: npData.item.external_urls?.spotify || ''
            }
        });

    } catch (err) {
        console.error('Spotify Now Playing Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
