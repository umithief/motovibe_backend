import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import Post, { MAX_MEDIA_TAGS } from "../modules/posts/model.js";
import User from "../modules/users/model.js";
import { parseMentionHandles, sanitizeMediaTags } from "../modules/posts/tagging.service.js";

const oid = () => new mongoose.Types.ObjectId();

test('parseMentionHandles extracts unique lowercase handles and skips e-mails', () => {
    const text = '@Ali_R1 ve @mehmet.k ile sürüş! Yine @ali_r1. İletişim: info@motonom.com @x';
    assert.deepEqual(parseMentionHandles(text), ['ali_r1', 'mehmet.k']);
    // Repeated calls must not leak regex state.
    assert.deepEqual(parseMentionHandles('@ayse'), ['ayse']);
    assert.deepEqual(parseMentionHandles(''), []);
    assert.deepEqual(parseMentionHandles(null), []);
});

test('post mediaTags enforce coordinate bounds and per-media uniqueness', () => {
    const user = oid();
    const ok = new Post({ user, mediaTags: [{ taggedUser: user, x: 50, y: 12.5 }] });
    assert.equal(ok.validateSync(), undefined);
    assert.equal(ok.mediaTags[0].isApproved, true);

    const outOfBounds = new Post({ user, mediaTags: [{ taggedUser: user, x: 140, y: -2 }] });
    assert.ok(outOfBounds.validateSync());

    const duplicate = new Post({ user, mediaTags: [{ taggedUser: user, x: 10, y: 10 }, { taggedUser: user, x: 80, y: 80 }] });
    assert.match(duplicate.validateSync().message, /birden fazla/);

    const otherSlide = new Post({ user, mediaTags: [{ taggedUser: user, x: 10, y: 10 }, { taggedUser: user, x: 80, y: 80, mediaIndex: 1 }] });
    assert.equal(otherSlide.validateSync(), undefined);

    const tooMany = new Post({ user, mediaTags: Array.from({ length: MAX_MEDIA_TAGS + 1 }, () => ({ taggedUser: oid(), x: 1, y: 1 })) });
    assert.ok(tooMany.validateSync());
});

test('sanitizeMediaTags clamps, dedupes, snapshots identity and drops blocked users', async (t) => {
    const author = { _id: oid(), blockedUsers: [] };
    const pro = { _id: oid(), username: 'apex', name: 'Apex Rider', avatar: 'a.png', isPro: true, blockedUsers: [] };
    const blocker = { _id: oid(), username: 'blocker', blockedUsers: [author._id] };
    const original = User.find;
    t.after(() => { User.find = original; });
    User.find = () => ({ select: () => ({ lean: async () => [pro, blocker] }) });

    const tags = await sanitizeMediaTags(JSON.stringify([
        { taggedUser: String(pro._id), x: 120, y: -4, taggedBike: '  Yamaha R1M  ', mediaIndex: 9 },
        { taggedUser: String(pro._id), x: 30, y: 30, mediaIndex: 1 },
        { taggedUser: String(blocker._id), x: 50, y: 50 },
        { taggedUser: 'not-an-id', x: 50, y: 50 }
    ]), { author, mediaCount: 2 });

    assert.equal(tags.length, 1);
    assert.deepEqual(
        { x: tags[0].x, y: tags[0].y, mediaIndex: tags[0].mediaIndex, bike: tags[0].taggedBike, apex: tags[0].isApexPro, username: tags[0].username },
        { x: 100, y: 0, mediaIndex: 1, bike: 'Yamaha R1M', apex: true, username: 'apex' }
    );
});
