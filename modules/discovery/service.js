import { calculateVibeScore,rankDiscoveryItems } from './ranking.service.js';
// Compatibility exports share the same score calculation as posts/discover.
export const calculateRouteFeaturedScore=route=>route?calculateVibeScore(route,'route'):0;
export const calculateTelemetryFeaturedScore=post=>post?calculateVibeScore(post,'post'):0;
export function rankAndInterleaveTrending(posts,routes,options={}) {
    const rank=(items,type,max)=>rankDiscoveryItems((items || []).map(item=>({id:String(item._id),score:calculateVibeScore(item,type,options.viewerContext,options.config,options.seed),data:item})),options.seed).slice(0,max).map(item=>({...item.data,[type==='post'?'telemetryScore':'routeScore']:item.score}));
    const rankedPosts=rank(posts,'post',options.maxPosts || 12);
    const rankedRoutes=rank(routes,'route',options.maxRoutes || 6);
    // 2. Formatla
    const formattedPosts = rankedPosts.map(post => ({
        _id: post._id,
        type: 'post',
        imageUrl: post.media?.[0]?.url || post.images?.[0] || post.mediaUrl,
        userName: post.user?.name || post.userName,
        userAvatar: post.user?.avatar || post.userAvatar,
        isVerified: post.user?.isVerified || post.isVerified || false,
        caption: post.caption || post.content,
        likeCount: post.likeCount || (post.likes ? post.likes.length : 0),
        commentCount: post.commentCount || 0,
        telemetry: post.telemetry,
        rideStats: post.rideStats,
        createdAt: post.createdAt,
        hotnessScore: post.telemetryScore
    }));

    const formattedRoutes = rankedRoutes.map(route => ({
        _id: route._id,
        type: 'route',
        imageUrl: route.image || route.photos?.[0],
        title: route.title,
        description: route.description,
        difficulty: route.difficulty,
        distance: route.distance || (route.distanceMeters ? `${Math.round(route.distanceMeters / 1000)} km` : null),
        rating: route.rating,
        location: route.location,
        hotnessScore: route.routeScore
    }));

    // 3. Akıllı 2:1 Interleaving (2 Telemetri : 1 Rota)
    const items = [];
    let pi = 0;
    let ri = 0;
    while (pi < formattedPosts.length || ri < formattedRoutes.length) {
        if (pi < formattedPosts.length) items.push(formattedPosts[pi++]);
        if (pi < formattedPosts.length) items.push(formattedPosts[pi++]);
        if (ri < formattedRoutes.length) items.push(formattedRoutes[ri++]);
    }

    return items;
}
