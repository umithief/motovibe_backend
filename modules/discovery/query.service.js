import Post from '../posts/model.js';
import Reel from '../reels/model.js';
import Route from '../routes/model.js';
import { discoveryPostFilter,discoveryReelFilter } from './access.service.js';
import { pageDiscoveryQuery } from './cursor.service.js';
import { discoveryWindow } from './discoveryPaging.service.js';
import AppError from '../../utils/appError.js';
import { escapeRegex } from '../../utils/tagUtils.js';
const sources={posts:Post,reels:Reel,routes:Route};
// Every discovery entry point uses this source registry and access policy.
export const discoveryFilter=(source,filter={},context={})=>{
    const policy=source==='posts'?discoveryPostFilter(context):source==='reels'?discoveryReelFilter(context):{isDeleted:{$ne:true}};
    // Following permits FOLLOWERS only when the selector explicitly restricts owners.
    if(source==='posts' && filter.visibility?.$in?.includes('FOLLOWERS'))policy.visibility=filter.visibility;
    return {$and:[policy,filter]};
};
export const findDiscovery=(source,filter={},context={})=>sources[source].find(discoveryFilter(source,filter,context));
export const aggregateDiscovery=(source,pipeline,context={})=>sources[source].aggregate([{$match:discoveryFilter(source,{},context)},...pipeline]);
export const countDiscovery=(source,filter={},context={})=>sources[source].countDocuments(discoveryFilter(source,filter,context));
export const selectDiscoverySources=async({category,page,query,postsOnly,blockedUsers,followingIds,cursor})=>{
        let posts = [];
        let reels = [];
        let routes = [];

        const isVideoCategory = category === 'videos';
        const isRouteCategory = category === 'routes';
        const isTrendCategory = category === 'trend';
        const isFollowingCategory = category === 'following';
        const isForYouCategory = category === 'for_you';

        const postFilter=discoveryPostFilter({blockedUsers,includeFollowers:isFollowingCategory});
        const window = discoveryWindow(category, page);
        if (postsOnly) {
            const size = query.limit === undefined ? 20 : Number(query.limit);
            if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw new AppError('Geçersiz limit.',400);
            Object.assign(window,{postSize:size,postOffset:(page-1)*size,reelSize:0,routeSize:0});
        }
        const { postSize: postPageSize, reelSize: reelPageSize,
            postOffset, reelOffset, routeOffset } = window;

        let legacyFilter;
        if (postsOnly) {
            const filters=[{user:{$nin:blockedUsers},isDeleted:{$ne:true},type:{$ne:'reel'}}];
            if (category && !['for_you','latest','trend'].includes(category)) {
                const regex=new RegExp(escapeRegex(category),'i');
                filters.push({$or:[{tags:category},{content:regex}]});
            }
            if (query.q) {
                const regex=new RegExp(escapeRegex(String(query.q).trim()),'i');
                filters.push({$or:[{content:regex},{userName:regex}]});
            }
            legacyFilter={$and:filters,...postFilter};
            posts=await pageDiscoveryQuery(findDiscovery('posts',legacyFilter).sort({createdAt:-1,_id:-1}),cursor,'posts',postOffset).limit(postPageSize+1)
                .populate('user','name username avatar rank isVerified').lean();
        } else if (isVideoCategory) {
            reels = await pageDiscoveryQuery(findDiscovery('reels',{
                    ...discoveryReelFilter({blockedUsers}),
                userId: { $nin: blockedUsers },
                isDeleted: { $ne: true },
                isApproved: true,
                isPublic: { $ne: false }
            })
                .sort({ views: -1, createdAt: -1, _id: -1 }),cursor,'reels',reelOffset)
                .limit(reelPageSize + 1)
                .lean();
        } else if (isRouteCategory) {
            const [routeDocs, routePosts] = await Promise.all([
                pageDiscoveryQuery(findDiscovery('routes',{
                    isDeleted: { $ne: true }
                })
                    .sort({ riderCount: -1, rating: -1, createdAt: -1, _id: -1 }),cursor,'routes',routeOffset)
                    .limit(window.routeSize + 1)
                    .populate('author', 'name username avatar rank isVerified')
                    .lean(),
                pageDiscoveryQuery(findDiscovery('posts',{
                    ...postFilter,
                    user: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    type: { $ne: 'reel' },
                    $or: [
                        { linkedRoute: { $ne: null } },
                        { 'rideStats.rideId': { $ne: null } },
                        { 'rideStats.distance': { $gt: 0 } },
                        { tags: { $in: ['rota', 'route', 'rotalar', 'routes'] } }
                    ]
                })
                    .sort({ likeCount: -1, createdAt: -1, _id: -1 }),cursor,'posts',postOffset)
                    .limit(postPageSize + 1)
                    .populate('user', 'name username avatar rank')
                    .lean()
            ]);
            routes = routeDocs || [];
            posts = routePosts || [];
        } else if (isFollowingCategory) {
            const validFollowedIds = followingIds.filter(id => !blockedUsers.includes(id));
            if (validFollowedIds.length > 0) {
                [posts, reels] = await Promise.all([
                    pageDiscoveryQuery(findDiscovery('posts',{
                    ...postFilter,
                        user: { $in: validFollowedIds },
                        isDeleted: { $ne: true },
                        type: { $ne: 'reel' }
                    })
                        .sort({ createdAt: -1, _id: -1 }),cursor,'posts',postOffset)
                        .limit(postPageSize + 1)
                        .populate('user', 'name username avatar rank')
                        .lean(),
                    pageDiscoveryQuery(findDiscovery('reels',{
                    ...discoveryReelFilter({blockedUsers}),
                        userId: { $in: validFollowedIds },
                        isDeleted: { $ne: true },
                        isApproved: true,
                        isPublic: { $ne: false }
                    })
                        .sort({ createdAt: -1, _id: -1 }),cursor,'reels',reelOffset)
                        .limit(reelPageSize + 1)
                        .lean()
                ]);
            } else {
                posts = [];
                reels = [];
            }
        } else if (isTrendCategory) {
            // Trend prioritizes high engagement velocity (likes, views, comments)
            [posts, reels] = await Promise.all([
                pageDiscoveryQuery(findDiscovery('posts',{
                    ...postFilter,
                    user: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    type: { $ne: 'reel' }
                })
                    .sort({ likeCount: -1, commentCount: -1, createdAt: -1, _id: -1 }),cursor,'posts',postOffset)
                    .limit(postPageSize + 1)
                    .populate('user', 'name username avatar rank')
                    .lean(),
                pageDiscoveryQuery(findDiscovery('reels',{
                    ...discoveryReelFilter({blockedUsers}),
                    userId: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    isApproved: true,
                    isPublic: { $ne: false }
                })
                    .sort({ views: -1, likes: -1, createdAt: -1, _id: -1 }),cursor,'reels',reelOffset)
                    .limit(reelPageSize + 1)
                    .lean()
            ]);
        } else if (isForYouCategory) {
            // Sizin İçin balances recent community freshness with personalized ranking and route highlights
            const [recentPosts, recentReels, featuredRoutes] = await Promise.all([
                pageDiscoveryQuery(findDiscovery('posts',{
                    ...postFilter,
                    user: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    type: { $ne: 'reel' }
                })
                    .sort({ createdAt: -1, _id: -1 }),cursor,'posts',postOffset)
                    .limit(postPageSize + 1)
                    .populate('user', 'name username avatar rank')
                    .lean(),
                pageDiscoveryQuery(findDiscovery('reels',{
                    ...discoveryReelFilter({blockedUsers}),
                    userId: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    isApproved: true,
                    isPublic: { $ne: false }
                })
                    .sort({ createdAt: -1, _id: -1 }),cursor,'reels',reelOffset)
                    .limit(reelPageSize + 1)
                    .lean(),
                page === 1 ? pageDiscoveryQuery(findDiscovery('routes',{ isDeleted: { $ne: true } })
                    .sort({ riderCount: -1, _id: -1 }),cursor,'routes',0)
                    .limit(window.routeSize)
                    .populate('author', 'name username avatar rank isVerified')
                    .lean() : Promise.resolve([])
            ]);
            posts = recentPosts || [];
            reels = recentReels || [];
            routes = featuredRoutes || [];
        } else {
            // Custom tag or topic category (e.g. 'ekipman', 'deniz', 'cafe')
            const tagRegex = new RegExp(`^#?${escapeRegex(category)}$`, 'i');
            const captionRegex = new RegExp(`#${escapeRegex(category)}\\b`, 'i');
            const tagFilter = {
                $or: [
                    { tags: category },
                    { tags: tagRegex },
                    { caption: captionRegex }
                ]
            };
            [posts, reels] = await Promise.all([
                pageDiscoveryQuery(findDiscovery('posts',{
                    ...postFilter,
                    user: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    type: { $ne: 'reel' },
                    ...tagFilter
                })
                    .sort({ createdAt: -1, _id: -1 }),cursor,'posts',postOffset)
                    .limit(postPageSize + 1)
                    .populate('user', 'name username avatar rank')
                    .lean(),
                pageDiscoveryQuery(findDiscovery('reels',{
                    ...discoveryReelFilter({blockedUsers}),
                    userId: { $nin: blockedUsers },
                    isDeleted: { $ne: true },
                    isApproved: true,
                    isPublic: { $ne: false },
                    ...tagFilter
                })
                    .sort({ createdAt: -1, _id: -1 }),cursor,'reels',reelOffset)
                    .limit(reelPageSize + 1)
                    .lean()
            ]);
        }


    return {posts,reels,routes,window,legacyFilter,isVideoCategory,isRouteCategory,isTrendCategory,isFollowingCategory};
};
