import assert from 'node:assert/strict';
import test from 'node:test';
import Analytics from "../modules/analytics/model.js";
import { summarizeFeedAnalytics } from "../modules/analytics/routes.js";

test('feed analytics schema stores product metrics without personal copy', () => {
    const event = new Analytics({
        type: 'feed_dwell',
        postId: 'post-42',
        contentType: 'post',
        source: 'following',
        isSponsored: false,
        durationMs: 4200,
    });

    assert.equal(event.validateSync(), undefined);
    assert.equal(event.postId, 'post-42');
    assert.equal(event.durationMs, 4200);
    assert.equal(event.userId, undefined);
    assert.equal(event.userName, undefined);
});

test('feed analytics rejects dwell durations over thirty minutes', () => {
    const event = new Analytics({
        type: 'feed_dwell',
        postId: 'post-42',
        contentType: 'post',
        source: 'following',
        durationMs: 31 * 60 * 1000,
    });

    assert.ok(event.validateSync());
});

test('feed analytics summary calculates engagement and dwell metrics', () => {
    const summary = summarizeFeedAnalytics([
        { type: 'feed_impression', isSponsored: true },
        { type: 'feed_impression', isSponsored: false },
        { type: 'feed_like' },
        { type: 'feed_save' },
        { type: 'feed_share_open' },
        { type: 'feed_comments_open' },
        { type: 'feed_sponsor_cta' },
        { type: 'feed_dwell', durationMs: 2000 },
        { type: 'feed_dwell', durationMs: 4000 },
    ]);

    assert.deepEqual(summary, {
        impressions: 2,
        sponsoredImpressions: 1,
        likes: 1,
        saves: 1,
        shares: 1,
        commentsOpened: 1,
        sponsorCtaClicks: 1,
        averageDwellMs: 3000,
        sponsorCtr: 1,
    });
});
