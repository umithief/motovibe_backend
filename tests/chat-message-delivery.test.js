import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageOnce } from '../utils/chatMessageDelivery.js';
import Message from '../models/Message.js';

const values = { sender: 'sender', conversationId: 'conversation', tempId: 'retry-1', type: 'TEXT', content: 'Merhaba' };

test('REST retry after a socket save returns the same message without another write', async () => {
    let saved;
    let writes = 0;
    const model = { findOne: async () => saved,
        create: async (data) => { writes++; return saved = { ...data, _id: 'message-1' }; } };
    const first = await createMessageOnce(model, values);
    const retry = await createMessageOnce(model, values);
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.message._id, first.message._id);
    assert.equal(writes, 1);
});

test('concurrent duplicate key returns the already saved message', async () => {
    let lookups = 0;
    const model = { findOne: async () => ++lookups === 1 ? null : { ...values, _id: 'saved' },
        create: async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); } };
    const result = await createMessageOnce(model, values);
    assert.equal(result.created, false);
    assert.equal(result.message._id, 'saved');
});

test('a retry key cannot move a saved message into another conversation', async () => {
    const model = { findOne: async () => ({ ...values, conversationId: 'other' }) };
    await assert.rejects(createMessageOnce(model, values), { statusCode: 409 });
});

for (const type of ['IMAGE', 'VOICE']) {
    test(`${type} rejects device paths before persistence`, async () => {
        for (const content of ['C:\\recordings\\voice.m4a', '/data/user/voice.m4a', 'file:///tmp/a', '']) {
            await assert.rejects(createMessageOnce({}, { ...values, type, content }), { statusCode: 400 });
        }
    });
    test(`${type} accepts uploaded HTTPS media`, async () => {
        const model = { findOne: async () => null, create: async (v) => v };
        const result = await createMessageOnce(model, { ...values, type, content: 'https://media.example/file' });
        assert.equal(result.created, true);
    });
}

test('legacy sends without tempId remain supported', async () => {
    const { tempId, ...legacy } = values;
    const result = await createMessageOnce({ create: async (v) => v }, legacy);
    assert.equal(result.created, true);
});

test('retry key is persisted with a partial unique sender index', () => {
    const doc = new Message({ sender: '507f1f77bcf86cd799439011', conversationId: '507f1f77bcf86cd799439012', tempId: 'retry-1', content: 'hello' });
    assert.equal(doc.toObject().tempId, 'retry-1');
    const index = Message.schema.indexes().find(([keys]) => keys.sender === 1 && keys.tempId === 1);
    assert.equal(index[1].unique, true);
    assert.deepEqual(index[1].partialFilterExpression, { tempId: { $type: 'string' } });
});
