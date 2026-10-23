export const SLIDE_EVENT_TYPES = new Set([
    'slide_view',
    'slide_click',
]);

export const FEED_EVENT_TYPES = new Set([
    'feed_impression',
    'feed_dwell',
    'feed_like',
    'feed_unlike',
    'feed_save',
    'feed_unsave',
    'feed_share_open',
    'feed_comments_open',
    'feed_sponsor_cta',
]);

export const summarizeFeedAnalytics = (events = []) => {
    const summary = {
        impressions: 0,
        sponsoredImpressions: 0,
        likes: 0,
        saves: 0,
        shares: 0,
        commentsOpened: 0,
        sponsorCtaClicks: 0,
        averageDwellMs: 0,
        sponsorCtr: 0,
    };
    let dwellTotal = 0;
    let dwellSamples = 0;

    for (const event of events) {
        if (event.type === 'feed_impression') {
            summary.impressions++;
            if (event.isSponsored === true) summary.sponsoredImpressions++;
        }
        else if (event.type === 'feed_like') summary.likes++;
        else if (event.type === 'feed_save') summary.saves++;
        else if (event.type === 'feed_share_open') summary.shares++;
        else if (event.type === 'feed_comments_open') summary.commentsOpened++;
        else if (event.type === 'feed_sponsor_cta') summary.sponsorCtaClicks++;
        else if (event.type === 'feed_dwell' && Number(event.durationMs) > 0) {
            dwellTotal += Number(event.durationMs);
            dwellSamples++;
        }
    }

    summary.averageDwellMs = dwellSamples > 0
        ? Math.round(dwellTotal / dwellSamples)
        : 0;
    summary.sponsorCtr = summary.sponsoredImpressions > 0
        ? Number((summary.sponsorCtaClicks / summary.sponsoredImpressions).toFixed(4))
        : 0;
    return summary;
};
