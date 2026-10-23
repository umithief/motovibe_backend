// Shared visibility rules for discover and its legacy search/trending adapters.
export const discoveryPostFilter = ({blockedUsers=[],includeFollowers=false}={}) => ({
    visibility:{$in:includeFollowers ? ['PUBLIC','FOLLOWERS',null] : ['PUBLIC',null]},
    isDeleted:{$ne:true},
    user:{$nin:blockedUsers}
});
export const discoveryReelFilter = ({blockedUsers=[]}={}) => ({
    isDeleted:{$ne:true},isApproved:true,isPublic:{$ne:false},userId:{$nin:blockedUsers}
});
