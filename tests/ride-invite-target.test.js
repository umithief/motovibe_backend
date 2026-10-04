import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRideInviteMetadata } from '../utils/rideInviteTarget.js';
const id = 'a'.repeat(24), routeId = 'b'.repeat(24);
const model = ride => ({findById: () => ({select: () => ({lean: async () => ride})})});
const scheduled = {_id:id, routeId, status:'scheduled', date:'2026-10-05', time:'12:00'};
const now = new Date('2026-10-03T12:00:00Z');
test('ride invitation retains its group id and derives the linked route from storage', async () => {
    const result = await resolveRideInviteMetadata(model(scheduled), {rideId:id, routeId:'fake'}, now);
    assert.equal(result.rideId,id); assert.equal(result.routeId,routeId);
    const free = await resolveRideInviteMetadata(model({...scheduled,routeId:null}), {rideId:id}, now);
    assert.equal(free.routeId,undefined);
});
test('route-only, deleted, expired and cancelled invitations cannot appear accepted', async () => {
    for (const [ride,metadata,statusCode] of [
        [scheduled,{routeId},400], [null,{rideId:id},404],
        [{...scheduled,status:'cancelled'},{rideId:id},409],
        [{...scheduled,date:'2025-06-15'},{rideId:id},409],
    ]) await assert.rejects(resolveRideInviteMetadata(model(ride),metadata,now), {statusCode});
});
test('an ongoing group ride remains inviteable after its scheduled start', async () => {
    const result = await resolveRideInviteMetadata(model({...scheduled,status:'active',date:'2026-10-02'}),{rideId:id},now);
    assert.equal(result.rideId,id);
});
