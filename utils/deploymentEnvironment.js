import dotenv from 'dotenv';

// Keep existing credentials on the server. Deployment may update only these
// public release controls; provider and database configuration is never copied
// from a developer's .env file.
export function mergeProductionEnvironment(original, controls) {
  const allowed = new Set(['NODE_ENV', 'PORT', 'BASE_URL', 'CORS_ORIGINS', 'SEED_DEMO_DATA']);
  const before = dotenv.parse(original);
  if (!before.MONGO_URI || !before.JWT_SECRET || before.JWT_SECRET.trim().length < 32) {
    throw new Error('Existing production database/JWT configuration is required.');
  }
  const updates = [];
  for (const [key, value] of Object.entries(controls)) {
    if (!allowed.has(key) || typeof value !== 'string' || !/^[A-Za-z0-9_:.,/-]+$/.test(value)) {
      throw new Error('Invalid public deployment control.');
    }
    updates.push(`${key}=${value}`);
  }
  if (controls.NODE_ENV !== 'production' || controls.SEED_DEMO_DATA !== 'false') {
    throw new Error('Production mode and disabled demo seeds are required.');
  }
  const merged = original + '\n# Public controls for this release\n' + updates.join('\n') + '\n';
  const after = dotenv.parse(merged);
  for (const [key, value] of Object.entries(before)) {
    if (!(key in controls) && after[key] !== value) {
      throw new Error('Existing production configuration could not be preserved.');
    }
  }
  for (const [key, value] of Object.entries(controls)) {
    if (after[key] !== value) throw new Error('Deployment control could not be applied.');
  }
  return merged;
}
