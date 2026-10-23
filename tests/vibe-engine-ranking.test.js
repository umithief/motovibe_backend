import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildDiscoveryCacheKey,
    buildViewerContext,
    calculateVibeScore,
    canonicalizeCategory,
    enrichFeedItem,
    rankDiscoveryItems,
    stableJitter,
} from "../modules/discovery/feed.service.js";

test('VibeEngine produces a stable order for the same viewer', () => {
    const items = [
        { id: 'p:1', score: 100 },
        { id: 'p:2', score: 100 },
        { id: 're:3', score: 100 },
    ];

    const first = rankDiscoveryItems(items, 'viewer-42').map(item => item.id);
    const second = rankDiscoveryItems(items, 'viewer-42').map(item => item.id);

    assert.deepEqual(first, second);
    assert.notEqual(stableJitter('viewer-42:p:1'), stableJitter('viewer-7:p:1'));
});

test('zero-engagement base score is deterministic per viewer and item', () => {
    const item = { _id: 'post-42', tags: [] };
    const first = calculateVibeScore(item, 'post', {}, null, 'viewer-42');
    const second = calculateVibeScore(item, 'post', {}, null, 'viewer-42');

    assert.equal(first, second);
    assert.ok(first >= 5 && first <= 10);
});

test('viewer context uses current garage and interest signals', () => {
    const context = buildViewerContext({
        primaryBike: 'Yamaha R6',
        bikeModel: 'legacy-bike',
        interestVector: [' Track ', 'Touring'],
    });

    assert.deepEqual(context, {
        activeBikeModel: 'Yamaha R6',
        interests: ['track', 'touring'],
    });

    const neutral = calculateVibeScore(
        { _id: 'post-1', likeCount: 1, tags: ['city'] },
        'post',
        context,
        { multipliers: { affinity: 1.3 } },
        'viewer-42'
    );
    const personalized = calculateVibeScore(
        { _id: 'post-2', likeCount: 1, tags: ['track'] },
        'post',
        context,
        { multipliers: { affinity: 1.3 } },
        'viewer-42'
    );
    const garageMatched = calculateVibeScore(
        { _id: 'post-3', likeCount: 1, bikeModel: 'R6' },
        'post',
        context,
        { multipliers: { affinity: 1.3 } },
        'viewer-42'
    );

    assert.equal(personalized, neutral * 1.3);
    assert.equal(garageMatched, neutral * 1.3);
});

test('discovery cache separates viewer personalization contexts', () => {
    const base = {
        blockedUsers: ['blocked-2', 'blocked-1'],
        viewerContext: {
            activeBikeModel: 'Yamaha R6',
            interests: ['track'],
        },
    };
    const sameContextDifferentOrder = {
        blockedUsers: ['blocked-1', 'blocked-2'],
        viewerContext: {
            activeBikeModel: 'Yamaha R6',
            interests: ['track'],
        },
    };
    const changedContext = {
        ...base,
        viewerContext: {
            activeBikeModel: 'Honda Africa Twin',
            interests: ['touring'],
        },
    };

    assert.equal(
        buildDiscoveryCacheKey('viewer-42', base),
        buildDiscoveryCacheKey('viewer-42', sameContextDifferentOrder)
    );
    assert.notEqual(
        buildDiscoveryCacheKey('viewer-42', base),
        buildDiscoveryCacheKey('viewer-42', changedContext)
    );
    assert.equal(buildDiscoveryCacheKey(null, base), 'feed:discover:global');
});

test('canonicalizeCategory maps legacy and canonical keys consistently', () => {
    assert.equal(canonicalizeCategory(''), 'for_you');
    assert.equal(canonicalizeCategory('Sizin İçin'), 'for_you');
    assert.equal(canonicalizeCategory('for_you'), 'for_you');
    assert.equal(canonicalizeCategory('Trend'), 'trend');
    assert.equal(canonicalizeCategory('trending'), 'trend');
    assert.equal(canonicalizeCategory('Videolar'), 'videos');
    assert.equal(canonicalizeCategory('videos'), 'videos');
    assert.equal(canonicalizeCategory('Rotalar'), 'routes');
    assert.equal(canonicalizeCategory('routes'), 'routes');
    assert.equal(canonicalizeCategory('Takip Edilenler'), 'following');
    assert.equal(canonicalizeCategory('following'), 'following');
});

test('discovery cache key matches between localized label and canonical key', () => {
    const context = {
        blockedUsers: [],
        viewerContext: { activeBikeModel: 'Yamaha R6', interests: ['track'] }
    };
    const keyTurkish = buildDiscoveryCacheKey('u1', { ...context, category: 'Takip Edilenler' });
    const keyCanonical = buildDiscoveryCacheKey('u1', { ...context, category: 'following' });
    assert.equal(keyTurkish, keyCanonical);

    const keyVideosTR = buildDiscoveryCacheKey('u1', { ...context, category: 'Videolar' });
    const keyVideosEN = buildDiscoveryCacheKey('u1', { ...context, category: 'videos' });
    assert.equal(keyVideosTR, keyVideosEN);
});

test('enrichFeedItem correctly resolves routes, products, and reels', () => {
    // 1. Post with linkedRoute becomes type route
    const routePost = {
        _id: 'p-route-1',
        content: 'Harika virajlar',
        linkedRoute: 'route-99',
        rideStats: { distance: 45.2 }
    };
    const enrichedRoute = enrichFeedItem(routePost, 'post', 'u1', []);
    assert.equal(enrichedRoute.type, 'route');
    assert.equal(enrichedRoute.routeId, 'route-99');
    assert.equal(enrichedRoute.routeDistance, '45.2 km');

    // 2. Product retains type product
    const productItem = {
        _id: 'sponsored_prod-1',
        productId: 'prod-1',
        type: 'product',
        isSponsored: true
    };
    const enrichedProduct = enrichFeedItem(productItem, 'post', 'u1', []);
    assert.equal(enrichedProduct.type, 'product');
    assert.equal(enrichedProduct.isSponsored, true);

    // 3. Regular post remains post
    const regularPost = {
        _id: 'p-std-1',
        content: 'Günaydın'
    };
    const enrichedRegular = enrichFeedItem(regularPost, 'post', 'u1', []);
    assert.equal(enrichedRegular.type, 'post');

    // 4. Reel gets re: prefix and type reel
    const reelItem = {
        _id: 'reel-123',
        userId: { _id: 'u2', name: 'Rider 2', username: 'rider2' },
        videoUrl: 'https://cdn.example.com/v.mp4'
    };
    const enrichedReel = enrichFeedItem(reelItem, 'reel', 'u1', []);
    assert.equal(enrichedReel.type, 'reel');
    assert.equal(enrichedReel._id, 're:reel-123');
    assert.equal(enrichedReel.userName, 'Rider 2');

    // 5. Direct Route document from Route collection
    const routeDoc = {
        _id: 'route-456',
        title: 'Şile Sahil Yolu',
        distance: '145 km',
        difficulty: 'Orta',
        riderCount: 120,
        author: { _id: 'u3', name: 'Ahmet', username: 'ahmet_rider' }
    };
    const enrichedRouteDoc = enrichFeedItem(routeDoc, 'route', 'u1', []);
    assert.equal(enrichedRouteDoc.type, 'route');
    assert.equal(enrichedRouteDoc._id, 'ro:route-456');
    assert.equal(enrichedRouteDoc.routeId, 'route-456');
    assert.equal(enrichedRouteDoc.content, 'Şile Sahil Yolu');
    assert.equal(enrichedRouteDoc.distance, '145 km');
    assert.equal(enrichedRouteDoc.userName, 'Ahmet');
});

test('calculateVibeScore scores routes according to rider count and ratings', () => {
    const routeItem = {
        _id: 'route-789',
        riderCount: 50,
        rating: 4.8,
        reviews: [{}, {}],
        tags: ['manzara', 'viraj']
    };
    const score = calculateVibeScore(routeItem, 'route', {}, null, 'viewer-1');
    assert.ok(score > 100);
});
