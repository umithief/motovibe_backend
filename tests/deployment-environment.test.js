import assert from 'node:assert/strict';
import test from 'node:test';
import dotenv from 'dotenv';
import { mergeProductionEnvironment } from '../utils/deploymentEnvironment.js';

const original = `# Synthetic test settings, not live credentials
MONGO_URI=mongodb://example.invalid/test
JWT_SECRET=synthetic-test-key-at-least-32-characters
SMTP_PASS="test # value with spaces"
FIREBASE_CONFIG='{"test":"value"}'
UNKNOWN_PROVIDER="line one\nline two"
NODE_ENV=development
BASE_URL=http://example.invalid
`;
const controls = {NODE_ENV:'production', PORT:'5001', BASE_URL:'https://api.example.invalid',
  CORS_ORIGINS:'https://admin.example.invalid', SEED_DEMO_DATA:'false'};

test('deployment preserves credentials, unknown providers and comments', () => {
  const merged = mergeProductionEnvironment(original, controls);
  const before = dotenv.parse(original); const after = dotenv.parse(merged);
  for (const key of ['MONGO_URI','JWT_SECRET','SMTP_PASS','FIREBASE_CONFIG','UNKNOWN_PROVIDER']) {
    assert.equal(after[key], before[key]);
  }
  for (const [key,value] of Object.entries(controls)) assert.equal(after[key],value);
  assert.ok(merged.startsWith(original));
  assert.deepEqual(dotenv.parse(mergeProductionEnvironment(merged, controls)), after);
});
test('deployment refuses missing server secrets, provider overrides and injected lines', () => {
  assert.throws(() => mergeProductionEnvironment('', controls));
  assert.throws(() => mergeProductionEnvironment('MONGO_URI=test\nJWT_SECRET=short', controls));
  assert.throws(() => mergeProductionEnvironment(original, {...controls, JWT_SECRET:'replacement'}));
  assert.throws(() => mergeProductionEnvironment(original, {...controls, BASE_URL:'https://safe.invalid\nJWT_SECRET=other'}));
  assert.throws(() => mergeProductionEnvironment(original, {...controls, NODE_ENV:'development'}));
  assert.throws(() => mergeProductionEnvironment(original, {...controls, SEED_DEMO_DATA:'true'}));
});
