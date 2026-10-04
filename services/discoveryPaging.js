// Each source owns a disjoint database window; ranking only reorders that window.
export const discoveryWindow = (category, page) => {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
        throw new RangeError('Invalid discovery page');
    }
    const first = page === 1;
    const forYou = category === 'for_you';
    const postSize = forYou && first ? 8 : 10;
    const reelSize = category === 'videos' ? 20 : forYou && first ? 9 : 10;
    return {
        postSize, reelSize, routeSize: category === 'routes' ? 10 : first && forYou ? 3 : 0,
        postOffset: forYou && !first ? 8 + (page - 2) * 10 : (page - 1) * postSize,
        reelOffset: forYou && !first ? 9 + (page - 2) * 10 : (page - 1) * reelSize,
        routeOffset: (page - 1) * 10
    };
};

export const trimDiscoverySources = (window, { posts = [], reels = [], routes = [] }) => ({
    hasMore: posts.length > window.postSize || reels.length > window.reelSize ||
        (window.routeSize > 0 && routes.length > window.routeSize),
    posts: posts.slice(0, window.postSize),
    reels: reels.slice(0, window.reelSize),
    routes: routes.slice(0, window.routeSize)
});
