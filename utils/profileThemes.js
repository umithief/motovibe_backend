import { hasActiveApexAccess } from './apexAccess.js';

export const PROFILE_THEME_CATALOG_VERSION = 1;
export const PROFILE_THEMES = Object.freeze([
  ['default', 'Signal Deck', 'Mevcut profil görünümü.', 'Standart', false],
  ['midnight-carbon', 'Midnight Carbon', 'Karbon yüzeyler ve kompakt yarış göstergeleri.', 'Sport', true],
  ['apex-racing', 'Apex Racing', 'Asimetrik pist kimliği ve telemetri kartları.', 'Sport', true],
  ['canyon-expedition', 'Canyon Expedition', 'Geniş kapak, rota çizgileri ve mesafe odağı.', 'Adventure', true],
  ['neon-velocity', 'Neon Velocity', 'Gece ışığı, sakin cam yüzeyler ve mavi halka.', 'Urban', true],
  ['heritage-machine', 'Heritage Machine', 'Sıcak krem, pirinç çerçeve ve dergi düzeni.', 'Classic', true],
  ['atlas-mono', 'Atlas Mono', 'Gümüş çizgiler, geniş boşluklar ve sade bilgi düzeni.', 'Touring', true],
  ['nordic-horizon', 'Nordic Horizon', 'Kuzey dinginliği, platin hatlar ve sessiz lüks minimalizm.', 'Minimal', true],
  ['obsidian-noir', 'Obsidian Noir', 'Saf monokrom siyah, fırçalanmış titanyum ve şampanya detaylar.', 'Minimal', true],
  ['atelier-koto', 'Atelier Koto', 'Japon wabi-sabi estetiği, sıcak bazalt ve asimetrik boşluklar.', 'Minimal', true],
  ['mountain-course', 'Mountain Course', 'Road racing yeşili, sarı yarış plakası ve parkur haritası.', 'Sport', true],
  ['endurance-24', 'Endurance 24', 'Gece stinti, far sarısı ve yirmi dört saatlik tur kadranı.', 'Sport', true],
  ['flat-track', 'Flat Track', 'Toprak oval, kil rengi ve krem-siyah damalı bayrak.', 'Sport', true],
  ['electric-volt', 'Voltaj', 'Elektrik limonu, devre izleri ve şarj göstergeleri.', 'Sport', true],
  ['stelvio-48', 'Stelvio 48', 'Alp geçidi, buzul beyazı ve numaralı saç tokası virajlar.', 'Touring', true],
  ['silk-road', 'İpek Yolu', 'Lacivert gece, İznik turkuazı ve sekiz köşeli yıldızlar.', 'Adventure', true],
  ['mother-road', 'Mother Road', 'Gün batımı mercanı, motel turkuazı ve çizgili akşam güneşi.', 'Touring', true],
  ['shop-manual', 'Shop Manual', 'Servis kitabı kâğıdı, kırmızı mürekkep ve teknik çizim ızgarası.', 'Classic', true],
  ['chopper-69', 'Chopper ’69', 'Metalflake kırmızı, krom kadranlar ve el çekimi pinstripe.', 'Classic', true],
  ['sidecar-42', 'Sepetli ’42', 'Zeytin yeşili sac, perçinli paneller ve pirinç detaylar.', 'Classic', true],
].map(([id,name,description,category,requiresPro]) => Object.freeze({
  id,name,description,category,requiresPro,version:1,isDeprecated:false,
})));

export const findProfileTheme = (id) => typeof id === 'string'
  ? PROFILE_THEMES.find(theme => theme.id === id) : undefined;

export function effectiveProfileThemeId(user, now = new Date()) {
  const theme = findProfileTheme(user?.profileThemeId || 'default');
  if (!theme || theme.isDeprecated || (user.profileThemeConfigVersion ?? 1) !== theme.version) return 'default';
  if (theme.requiresPro && !hasActiveApexAccess(user,now)) return 'default';
  return theme.id;
}

// Additive read migration: old documents render safely without a destructive backfill.
// Entitlement is resolved BEFORE public response sanitization removes isAdmin.
export function addProfileThemeResponse(user, now = new Date()) {
  user.effectiveProfileThemeId = effectiveProfileThemeId(user,now);
  user.isPro = hasActiveApexAccess(user,now);
  if (user.isAdmin) user.proExpiryDate = null; // Admin access is a lifetime grant in the existing resolver.
  user.profileThemeId = typeof user.profileThemeId === 'string' ? user.profileThemeId : 'default';
  user.profileThemeConfigVersion = Number.isInteger(user.profileThemeConfigVersion) ? user.profileThemeConfigVersion : 1;
  user.profileThemeUpdatedAt = user.profileThemeUpdatedAt || null;
  return user;
}

export function profileThemeEntitlementQuery(now) {
  return { $or: [
    { isAdmin:true },
    { $and: [
      { $or:[{isPro:true},{isPremium:true}] },
      { $or:[{proExpiryDate:null},{proExpiryDate:{$gt:now}}] },
    ] },
  ] };
}
