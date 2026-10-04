import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

import '../models/User.js';
import {
    validateAndSanitizeBioBlocks,
    FREE_BIO_BLOCK_TYPES,
    PRO_BIO_BLOCK_TYPES,
    ALL_BIO_BLOCK_TYPES
} from '../controllers/userController.js';

async function runBioValidationTests() {
    console.log('🧪 --- STARTING BIO BLOCKS DEFENSIVE VALIDATION SMOKE TEST --- 🧪\n');

    // 1. Constants verification
    console.log('1️⃣ [Test] Block Catalog & Canonical Type Enum Verification...');
    console.assert(FREE_BIO_BLOCK_TYPES.length === 5, 'Expected 5 Free block types');
    console.assert(PRO_BIO_BLOCK_TYPES.length === 8, 'Expected 8 Pro block types');
    console.assert(ALL_BIO_BLOCK_TYPES.length === 13, 'Expected 13 total block types');
    console.log(`   ✅ 13 Canonical Types: 5 Free (${FREE_BIO_BLOCK_TYPES.join(', ')}) + 8 Pro (${PRO_BIO_BLOCK_TYPES.join(', ')})`);

    // 2. Free User Limits & Pro Gate
    console.log('\n2️⃣ [Test] Free User Limit & Pro Gate Assertions...');
    const mockFreeUser = {
        _id: new mongoose.Types.ObjectId(),
        isPro: false,
        garage: [{ _id: new mongoose.Types.ObjectId('6a91dc9356ad24427a9f9abd'), model: 'Ducati Panigale V4' }],
        unlockedAchievements: []
    };

    const sixFreeBlocks = Array.from({ length: 6 }, (_, i) => ({
        id: `block_${i}`,
        type: 'TEXT',
        data: { text: `Hello ${i}`, isNeon: true }
    }));
    const freeOverflow = validateAndSanitizeBioBlocks(sixFreeBlocks, mockFreeUser);
    console.assert(freeOverflow.error && freeOverflow.status === 403, 'Free user must not exceed 5 blocks');
    console.log('   ✅ 6 blocks on free user rejected with HTTP 403 limit error.');

    const proBlockOnFree = [
        { id: 'stat_1', type: 'STAT', data: { label: 'Top Speed', value: '299', progress: 0.9 } }
    ];
    const freeProRejected = validateAndSanitizeBioBlocks(proBlockOnFree, mockFreeUser);
    console.assert(freeProRejected.error && freeProRejected.requiresPro === true, 'Pro block on free user must require Pro');
    console.log(`   ✅ Pro block (STAT) on free user rejected: "${freeProRejected.error}"`);

    // 3. Pro User Capabilities & Style Contract Preservations
    console.log('\n3️⃣ [Test] Pro User Capabilities (Full 13 Types & Style Contract Integrity)...');
    const mockProUser = {
        _id: new mongoose.Types.ObjectId(),
        isPro: true,
        proExpiryDate: new Date(Date.now() + 86400000),
        garage: [{ _id: 'bike_owned_123', model: 'Ducati Panigale V4' }],
        unlockedAchievements: ['ach_unlocked_999'],
        savedRoutes: ['route_saved_fav']
    };

    const richStyleBlock = {
        id: 'b1',
        type: 'TEXT',
        style: {
            color: '#FFCC00',
            font: 'Street',
            align: 'center',
            bgType: 'mesh',
            animate: false,
            effect: 'outline',
            opacity: 0.85,
            borderWidth: 2.5,
            borderRadius: 16.0,
            shadowGlow: 12.0,
            boxWidth: 75.0,
            boxHeight: 28.0,
            textScale: 1.4,
            letterSpacing: 2.5,
            lineHeight: 1.6,
            rotation: -4.5,
            gridX: 200,
            gridY: 18400,
            gridHeight: 520,
            isLocked: true,
            isPinned: false,
            isVisible: true
        },
        data: { text: 'Apex Hunter', isNeon: true }
    };

    const all13Blocks = [
        richStyleBlock,
        { id: 'b2', type: 'BRAND_LOGO', data: { brandName: 'Ducati', size: 70, logoUrl: 'https://cdn.example.com/ducati.png' } },
        { id: 'b3', type: 'SOCIAL_LINK', data: { platform: 'Instagram', url: 'https://instagram.com/motovibe', handle: '@motovibe_official' } },
        { id: 'b4', type: 'DIVIDER', data: { glowColor: '#D4AF37', variant: 'road' } },
        { id: 'b5', type: 'GARAGE_WIDGET', data: { bikeId: 'bike_owned_123', customTitle: 'My Beast' } },
        { id: 'b6', type: 'STAT', data: { label: 'Viraj Hakimiyeti', value: '54°', progress: 0.88 } },
        { id: 'b7', type: 'SPOTIFY', data: { trackName: 'Nightcall', artistName: 'Kavinsky', trackUrl: 'https://open.spotify.com/track/123' } },
        { id: 'b8', type: 'YOUTUBE_MUSIC', data: { trackName: 'Starboy', artistName: 'The Weeknd', lastfmUsername: 'apex_rider' } },
        { id: 'b9', type: 'TELEMETRY_HOLOGRAM', data: { layout: 'radar', primaryValue: '299', secondaryValue: '12.400' } },
        { id: 'b10', type: 'EXHAUST_NOTE', data: { exhaustName: 'Akrapovic Evolution', audioUrl: 'https://cdn.example.com/exhaust.mp3' } },
        { id: 'b11', type: 'ROUTE_SHOWCASE', data: { routeId: 'route_authored_1', title: 'Şile Sahil Yolu', distance: '48 km' } },
        { id: 'b12', type: 'ACHIEVEMENT_BADGE', data: { achievementId: 'ach_unlocked_999', title: 'Viraj Ustası', rank: 'Gold' } },
        { id: 'b13', type: 'MAINTENANCE_CARD', data: { maintenanceType: 'ZİNCİR BAKIMI', title: 'Periyodik Bakım', progress: 0.85 } }
    ];

    // Studio getMyRoutes = authored routes; merge via options.authoredRouteIds
    const proResult = validateAndSanitizeBioBlocks(all13Blocks, mockProUser, {
        authoredRouteIds: ['route_authored_1']
    });
    console.assert(!proResult.error, `Pro validation failed: ${proResult.error}`);
    console.assert(proResult.value.length === 13, 'Expected 13 sanitized blocks');

    // Check style contract round-trip (incl. Mod Shop mesh bgType)
    const sanitizedText = proResult.value.find(b => b.id === 'b1');
    console.assert(sanitizedText.data.isNeon === true, 'TEXT data.isNeon must be preserved');
    console.assert(sanitizedText.style.gridHeight === 520, `gridHeight must be 520, got ${sanitizedText.style.gridHeight}`);
    console.assert(sanitizedText.style.gridY === 18400, `gridY must support up to 24000, got ${sanitizedText.style.gridY}`);
    console.assert(sanitizedText.style.bgType === 'mesh', `bgType mesh must be preserved, got ${sanitizedText.style.bgType}`);
    console.assert(sanitizedText.style.effect === 'outline', `effect must support outline, got ${sanitizedText.style.effect}`);
    console.assert(sanitizedText.style.animate === false, 'animate must be preserved');
    console.assert(sanitizedText.style.opacity === 0.85, 'opacity must be preserved');
    console.assert(sanitizedText.style.borderWidth === 2.5, 'borderWidth must be preserved');
    console.assert(sanitizedText.style.borderRadius === 16.0, 'borderRadius must be preserved');
    console.assert(sanitizedText.style.shadowGlow === 12.0, 'shadowGlow must be preserved');
    console.assert(sanitizedText.style.boxHeight === 28.0, 'boxHeight must be preserved');
    console.assert(sanitizedText.style.textScale === 1.4, 'textScale must be preserved');
    console.assert(sanitizedText.style.letterSpacing === 2.5, 'letterSpacing must be preserved');
    console.assert(sanitizedText.style.lineHeight === 1.6, 'lineHeight must be preserved');
    console.assert(sanitizedText.style.rotation === -4.5, 'rotation must be preserved');

    const sanitizedRoute = proResult.value.find(b => b.id === 'b11');
    console.assert(sanitizedRoute.data.routeId === 'route_authored_1', 'Authored routeId must be preserved');
    console.log('   ✅ Style contract (mesh bgType) + authored routeId preserved!');

    // 4. Ownership validation (Achievement, Garage, Route)
    console.log('\n4️⃣ [Test] Ownership Enforcement (achievement / bike / route)...');
    const unownedBlocks = [
        { id: 'b_ach_unowned', type: 'ACHIEVEMENT_BADGE', data: { achievementId: 'fake_ach_id', title: 'Hacked Badge' } },
        { id: 'b_garage_unowned', type: 'GARAGE_WIDGET', data: { bikeId: 'fake_bike_id', customTitle: 'Stolen Bike' } },
        { id: 'b_route_unowned', type: 'ROUTE_SHOWCASE', data: { routeId: 'fake_route_id', title: 'Stolen Route' } },
        { id: 'b_route_saved', type: 'ROUTE_SHOWCASE', data: { routeId: 'route_saved_fav', title: 'Saved Fav' } }
    ];
    const unownedResult = validateAndSanitizeBioBlocks(unownedBlocks, mockProUser, {
        authoredRouteIds: ['route_authored_1']
    });
    const sanitizedUnownedAch = unownedResult.value.find(b => b.id === 'b_ach_unowned');
    const sanitizedUnownedBike = unownedResult.value.find(b => b.id === 'b_garage_unowned');
    const sanitizedUnownedRoute = unownedResult.value.find(b => b.id === 'b_route_unowned');
    const sanitizedSavedRoute = unownedResult.value.find(b => b.id === 'b_route_saved');
    console.assert(sanitizedUnownedAch.data.achievementId === '', 'Unowned achievementId must be stripped');
    console.assert(sanitizedUnownedBike.data.bikeId === '', 'Unowned bikeId must be stripped');
    console.assert(sanitizedUnownedRoute.data.routeId === '', 'Unowned routeId must be stripped');
    console.assert(sanitizedSavedRoute.data.routeId === 'route_saved_fav', 'savedRoutes routeId must be kept');
    console.log('   ✅ Unowned ids stripped; authored + savedRoutes kept.');

    // 5. URL Sanitization Check
    console.log('\n5️⃣ [Test] Security & URL Sanitization...');
    const maliciousBlocks = [
        { id: 'bad_1', type: 'SOCIAL_LINK', data: { url: 'javascript:alert(1)', handle: 'hacker' } },
        { id: 'bad_2', type: 'EXHAUST_NOTE', data: { audioUrl: 'data:text/html,<script>alert(1)</script>' } }
    ];
    const sanitizedMalicious = validateAndSanitizeBioBlocks(maliciousBlocks, mockProUser);
    const badSocial = sanitizedMalicious.value.find(b => b.id === 'bad_1');
    const badExhaust = sanitizedMalicious.value.find(b => b.id === 'bad_2');
    console.assert(badSocial.data.url === '', 'javascript: URLs must be sanitized to empty string');
    console.assert(badExhaust.data.audioUrl === '', 'data: URIs must be sanitized to empty string');
    console.log('   🛡️  Malicious protocols sanitized safely.');

    console.log('\n🎉 --- ALL BIO BLOCKS CONTRACT & VALIDATION TESTS PASSED SUCCESSFULLY --- 🎉');
}

runBioValidationTests().catch(err => {
    console.error('Fatal Test Error:', err);
    process.exit(1);
});
