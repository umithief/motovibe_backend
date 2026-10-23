import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { discoveryWindow, trimDiscoverySources } from "../modules/discovery/discoveryPaging.service.js";
import { getRuntimeCapabilities } from '../config/release.js';
import { createCorsOptions } from '../middleware/securityMiddleware.js';
import GroupRide from "../modules/rides/GroupRide.model.js";

test('discovery source windows remain contiguous and disjoint through deep pages', () => {
    for (const category of ['for_you', 'trend', 'videos', 'routes', 'following']) {
        let postEnd = 0; let reelEnd = 0;
        for (let page = 1; page <= 30; page++) {
            const w = discoveryWindow(category, page);
            assert.equal(w.postOffset, postEnd);
            assert.equal(w.reelOffset, reelEnd);
            postEnd += w.postSize; reelEnd += w.reelSize;
        }
    }
});
test('discovery uses a sentinel without losing it on the next page', () => {
    const w = discoveryWindow('for_you', 1);
    const all = Array.from({length: 12}, (_, i) => i);
    const result = trimDiscoverySources(w, { posts: all.slice(0, w.postSize + 1), reels: [] });
    assert.equal(result.hasMore, true);
    assert.deepEqual(result.posts, all.slice(0, 8));
    assert.equal(discoveryWindow('for_you', 2).postOffset, 8);
    assert.equal(trimDiscoverySources(w, {posts: []}).hasMore, false);
    assert.throws(() => discoveryWindow('videos', 0), RangeError);
});
test('unpublished products are disabled regardless of environment secrets', () => {
    const c = getRuntimeCapabilities();
    for (const key of ['shop', 'music', 'forum', 'vlogMap', 'council', 'stolen', 'ai', 'directCalls']) {
        assert.equal(c[key], false);
    }
});
test('uploads use the browser origin allowlist and permit native requests', () => {
    const c = createCorsOptions(['https://admin.motonom.app']);
    c.origin('https://evil.example', error => assert.equal(error.statusCode, 403));
    c.origin(undefined, (error, allowed) => { assert.equal(error, null); assert.equal(allowed, true); });
    c.origin('https://admin.motonom.app', (error, allowed) => { assert.equal(error, null); assert.equal(allowed, true); });
    assert.ok(c.allowedHeaders.includes('Range'));
});
test('ride date/time reject invalid calendar values and non-padded strings', () => {
    const date = GroupRide.schema.path('date').validators.find(v => v.type === 'user defined').validator;
    const time = GroupRide.schema.path('time').validators.find(v => v.type === 'regexp').validator;
    for (const value of ['2026-10-03', '2024-02-29']) assert.equal(date(value), true);
    for (const value of ['2026-02-29', '2026-2-03', '2026-13-01']) assert.equal(date(value), false);
    for (const value of ['08:30', '23:59']) assert.equal(time(value), true);
    for (const value of ['8:30', '24:00', '11:60']) assert.equal(time(value), false);
});
test('Firebase secrets and demo seeds cannot load implicitly from the source tree', () => {
    const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    assert.doesNotMatch(server, /readFileSync\(serviceAccount/);
    assert.doesNotMatch(server, /Access-Control-Allow-Origin.*\*/);
    const deploy = fs.readFileSync(new URL('../attic/operations/deploy.js', import.meta.url), 'utf8');
    assert.ok(!deploy.includes('add_header Access-Control-Allow-Origin *;'));
    assert.ok(deploy.includes('map $http_origin $motonom_upload_cors_origin'));
    assert.ok(deploy.includes('allowedUploadOrigins.map'));
    assert.ok(deploy.includes("writeRemoteFile(remoteRepairPath, environmentRepairScript, 0o600)"));
    assert.ok(deploy.includes("mode, flag: 'w'"));
    assert.ok(deploy.includes("parsedBaseUrl.protocol !== 'https:'"));
    assert.ok(deploy.includes("getRemoteTlsPath('TLS_CERT_PATH')"));
    assert.ok(deploy.includes('listen 443 ssl http2;'));
    assert.ok(deploy.includes('return 308 https://$host$request_uri;'));
    assert.ok(deploy.includes('mergeProductionEnvironment(original,'));
    assert.ok(!deploy.includes('getJwtSecret()'));
    assert.ok(!deploy.includes('getMongoUri()'));
    assert.ok(deploy.includes('SSH_CONFIG.hostVerifier'));
    assert.ok(deploy.includes("writeRemoteFile('/etc/nginx/sites-available/motovibe', nginxConfig, 0o644)"));
    assert.ok(deploy.includes("console.log('API is live at: ' + baseUrl)"));
    assert.ok(deploy.includes('proxy_set_header X-Forwarded-Proto $scheme;'));
    assert.doesNotMatch(server, /seedDatabase|SEED_DEMO_DATA|ensureDefaultAchievements/);
    const seed = fs.readFileSync(new URL('../scripts/seed-demo.mjs', import.meta.url), 'utf8');
    assert.match(seed, /NODE_ENV === 'production'/);
    assert.match(seed, /--apply/);
});

test('admin slide validation rejects empty content, unsafe URLs and malformed actions', async () => {
    const { validateSlideBody } = await import('../utils/slideValidation.js');
    const valid = {title: 'Sürüş', imageUrl: 'uploads/banner.webp', actionType:'none'};
    assert.equal(validateSlideBody(valid).title, 'Sürüş');
    for (const invalid of [null, {}, {...valid,title:' '}, {...valid,imageUrl:'data:image/png,x'},
        {...valid,imageUrl:'uploads/../secret.json'}, {...valid,isActive:'true'},
        {...valid,actionType:'route',actionTarget:'no-id'}, {...valid,order:-1}]) {
        assert.throws(() => validateSlideBody(invalid));
    }
    assert.throws(() => validateSlideBody({...valid,startDate:'2026-10-04',endDate:'2026-10-03'}));
    assert.deepEqual(validateSlideBody({subtitle:'Yeni'}, {partial:true}), {subtitle:'Yeni'});
});
test('Gemini request transmits the key only in the header', async () => {
    const previousKey = process.env.GEMINI_API_KEY; const previousFetch = globalThis.fetch;
    process.env.GEMINI_API_KEY = 'test-secret-key';
    let request;
    globalThis.fetch = async (url, options) => {
        request = {url,options};
        return {ok:true, json:async () => ({candidates:[{content:{parts:[{text:'Yanıt'}]}}]})};
    };
    try {
        const { chatWithMotoVibeAi } = await import('../attic/closed/controllers/aiController.js');
        await new Promise((resolve,reject) => chatWithMotoVibeAi({body:{message:'Merhaba'}},
            {status(){return this;},json:resolve},reject));
        assert.equal(request.options.headers['x-goog-api-key'], 'test-secret-key');
        assert.equal(new URL(request.url).search, '');
        assert.ok(!request.url.includes('test-secret-key'));
    } finally {
        globalThis.fetch = previousFetch;
        if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
    }
});
