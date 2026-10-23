# Motonom modular monolith değişiklik raporu

**Kaynak ve Node 20 yerel kabul durumu: tamamlandı.** İkinci dalga ve canlı kabulün güncel kaydı: [SECOND_WAVE_REPORT.md](SECOND_WAVE_REPORT.md). Aşağıdaki önceki adım kanıtları tarihseldir. Canlı deployment ve sağlayıcı kabulü ayrıca doğrulanmalıdır. Madde bazında güncel durum ve açık işler: [MODULAR_MONOLITH_CHECKLIST.md](MODULAR_MONOLITH_CHECKLIST.md).

Kök: C:\repos\motovibe_backend. Flutter: C:\repos\motovibe_flutter_app; Flutter dosyaları değiştirilmedi. Çalışma ağacındaki önceki profil teması, story, event, user ve bootstrap değişiklikleri taşınan uygulamalarda korundu. fast_deploy.js önceki değişikliği korunarak attic/operations içine taşındı.

| Adım | Sonuç | node --test tests/*.test.js |
| --- | --- | --- |
| Başlangıç | Mevcut çalışma ağacı | 120/120 |
| P0 | Interceptor kaldırıldı; seed ayrıldı; kapalı mount ve ölü kaynaklar temizlendi | 124/124 |
| P1 | Domain sahipliği, user export bölümü, event service, RideActivity birleşimi, discover/campaign alias'ları | 126/126 |
| P2 | Cache, cursor, ortak hata altyapısı, lazy geo, reaction ve shutdown | 135/135 |
| Yeniden denetim | Discovery gizlilik politikası, canonical Ride read/delete/leaderboard ve bütün kapalı prefix testleri | 138/138 |
| Eksiklerin tamamlanması | 42 controller / 277 DTO işlem, tek discover query/ranking, Ride discriminator, merkezi yanıt/hata/rate-limit, legacy bridge ve migration | 158/158 |

## Dosya ve export sahipliği

app.js Express middleware, mount-time capability kapıları, router'lar, capabilities, health ve ortak hata kanalını kurar. Import etmek Mongo, Redis, socket, cron veya listen başlatmaz. server.js env doğrulaması, ADC, Mongo, Redis, Socket.IO, cron, listen ve idempotent graceful shutdown sahibidir. index.js onRequest içinde lazy Mongo bağlantısı kullanır; standalone sunucuyu import etmez.

116 mevcut kaynak domain modüllerine taşındı; sonra category ve beacon controller sahipliği de modüllere alındı. Tam dosya eşlemesi module-map.json içinde. İkinci dalgada controllers/routes/services re-export girişleri silindi; bütün tüketiciler modules'a bağlandı. Model uyum girişleri kalır; Category/Model3D istisnaları kapalı özelliklerle birlikte kaldırıldı.

userController'ın 80 public export'u eski isimleriyle korunur. 94 tanımın taşıma doğrulamasında gövde hash'i birebir korundu. Son boşluk temizliği yalnız string/template literal dışında yapıldı; normalizedSha256 değerleri de ilk bölünmede 94/94 eşleşti. Sonraki controller/service ayrımında 58 user işlem gövdesi AST ile eşdeğerlik kontrolünden geçti; tarihsel SHA ve güncel currentFile/currentExport sahipliği ayrı tutulur. İsim/dosya/SHA-256 eşlemesi user-controller-export-manifest.json içindedir. auth, profile, social, garage, business, subscription, push, achievement ve kapalı cart export'ları ayrı dosyalardadır. Business, bio ve privacy kuralları ayrı service dosyalarındadır. Cart handler isimleri uyumluluk için export edilir, route olarak bağlanmaz.

Event domaininde MeetupEvent modelinin koleksiyon adı korunur. 16 event işlemi service'e çıktı; controller yalnız HTTP adaptasyonu yapar. Auth, analytics, slides, feedback, 3D model, category ve upload fat-route callback'leri de controller'a çıktı.

## Silinen dosyalar

- models/ClanWar.js
- models/ServicePoint.js
- models/Event.js
- realtime/locationService.ts
- api/posts.ts
- validations/schemas.js
- checkUsers.js
- check_limits.cjs
- check_logs.js
- check_netstat.js
- check_output.txt
- check_out_logs.js
- check_pm2.js
- check_remote_uploads.js
- check_uploads.js
- diagnose.js
- fixUrls.js
- fix_duplicates.cjs
- fix_slide_routes.cjs
- fix_user_controller.cjs
- force_upload.js
- sync_all_files.js
- sync_everything.js
- sync_with_key.js
- test_mongo.js
- update_analytics.py
- upload_server.js
- controllers/activityController.js
- routes/activityRoutes.js
- models/RideActivity.js

package.json ve lockfile'dan @supabase/supabase-js kaldırıldı. data:destroy silindi; data:import ve data:seed-demo scripts/seed-demo.mjs'e bağlandı. Demo seed açık Route, MeetupEvent, Emoji ve achievement verisini işler; --organizer ile gerçek development kullanıcısına bağlı GroupRide demo kaydı da oluşturabilir; production'da reddedilir ve --apply gerektirir. Product required alanları için kapalı shop verisi tamamlanmadı; hatalı product/forum/showcase seed'leri kaldırıldı. Emoji enum'u REACTION olarak düzeltildi.

## Attic'e taşınan dosyalar

attic/closed altında:

- controllers/aiController.js
- controllers/orderController.js
- models/ForumTopic.js
- models/MotoVlog.js
- models/Music.js
- models/Negotiation.js
- models/Order.js
- models/Product.js
- models/Reply.js
- models/ShowcaseProduct.js
- models/StolenItem.js
- models/Thread.js
- routes/aiRoutes.js
- routes/councilRoutes.js
- routes/forumRoutes.js
- routes/lastfmRoutes.js
- routes/musicRoutes.js
- routes/negotiationRoutes.js
- routes/orderRoutes.js
- routes/productRoutes.js
- routes/showcaseRoutes.js
- routes/spotifyRoutes.js
- routes/stolenRoutes.js
- routes/vlogRoutes.js

attic/operations altında:

- download_user_controller.js
- fetch_logs.js
- local_seed.js
- run_netstat.js
- seed_events.js
- seed_posts.js
- test_apex.js
- test_db.js
- test_run.js
- test_sos_telemetry.js
- upload_uploads.cjs

Runtime import grafiğinde attic kaynağı bulunmaz. Release builder da attic'i reddeder. uploads/ veya tar.gz kopyalanmadı; .env ve service-account dosyaları yazılmadı.

## HTTP ve veri uyumluluğu

| Eski/açık yol | Davranış |
| --- | --- |
| /api/users/login ve /users/login | Aynı auth handler; prefix alias body parser'dan önce |
| /api/posts/discover | Aynı page sözleşmesi; isteğe bağlı cursor ve ek metadata |
| /api/posts/explore | Aynı posts/items yanıt alanları, limit ve q korunur; ortak discovery servisi; eski 100 kayıt havuzu sınırı kaldırıldı |
| /api/explore | Discover'a bağlı items alias'ı |
| /api/explore/search, /api/explore/trending | Flutter'ın düz alanları ve mixed posts/routes sözleşmesi korunur |
| /api/social/... | 308 /api/posts/...; query korunur, 308 metot ve gövdeyi korur |
| /api/campaigns | Tek canonical router mount |
| /api/sponsorship/campaigns, /api/sponsorship, /api/campaigns/campaigns | İç rewrite; body, method, auth ve HTTP status korunur |
| /api/sponsorship/challenges/my | /api/campaigns/my iç alias'ı |
| /api/activities ve /api/activities/latest | Rides domainindeki compatibility handler'lar; yeni yazılar Ride, eski rideactivities koleksiyonu yalnız okunur |
| /api/home/summary | checkUser opsiyonel; eski düz alanlar yanında status/data; showcaseEnabled kapalı shop için false |
| products, orders, showcase, negotiations, users/cart, music, spotify, lastfm, forum, vlogs, council, stolen-items, ai, calls | 404 FEATURE_DISABLED; kapalı router import/mount yok |

Ride'ın canonical sahip alanı user'dır. Read/delete/leaderboard canonical user'a öncelik verir; çelişen legacy userId başka kullanıcıya yetki vermez. userId mevcut Mongo belgeleri ve Flutter için okunur/yazılır uyum alanı olarak tutulur. Sahip kimliği authenticated kullanıcıdan gelir; body user/userId bunu değiştiremez. GPS içermeyen activity kaydında sahte koordinat üretmek yerine geometry yoktur. Solo telemetry Ride hâlâ geçerli LineString gerektirir. Ride ve GroupRide aynı rides deposunun solo/group discriminator'larıdır; tarih ve yanıt alanları korunur. Legacy grouprides kayıtları salt okunur aggregation köprüsüyle birleştirilir; canonical kayıt _id bazında önceliklidir. İlk mutation orijinal snapshot'ı idempotent promote eder, sonra Mongoose delta uygular. scripts/migrate-group-rides.mjs varsayılan dry-run'dır; legacy veriyi silmez; ikinci dalgada canlıda 7 kayıt kullanıcı onayıyla taşındı.

Bütün JSON yanıtları ortak sendResponse/sendSuccess kanalından geçer. /api/v2/... alias'ları yalnız {status,data,error?,meta?} verir; mevcut /api/... yolları explicit legacy adaptörleridir ve Flutter'ın düz object/liste gövdelerini, body/path/status sözleşmesini korur. Legacy 204 korunur; v2 200 ve data:null verir. Dosya ve sağlayıcı HTML yanıtları içerik biçimini korur. Beş users hata yanıtı ve bütün route rate-limit hataları catchAsync/AppError üzerinden ortak error handler'a bağlandı; eski hata gövdeleri aynen korunur.

## Performans ve destek kapsamı

- res.json override ve JSON.parse(JSON.stringify(response)) yok. serializeMediaUrls yalnız değişen dalları kopyalar, Mongoose toJSON, Date ve ObjectId türlerini korur. avatar, coverImage, image, thumbnail, imageUrl, videoUrl, media.url, emblem ve images[] desteklenir.
- Home ortak verisi Redis ve process fallback ile 30 saniye cache edilir; eşzamanlı cache miss birleşir; Redis arızası cevabı engellemez. joinedRide/isJoined ve zamanı yaklaşan sürüş sorguları her istekte kullanıcıya göre hesaplanır. HTTP yanıtı private,no-store'dur. Ortak sayılar en fazla cache TTL boyunca eski olabilir.
- GET /api/posts/discover?pagination=cursor ilk sayfayı açar. Sonraki istek cursor=data.nextCursor ile yapılır; category/limit/q değerleri aynı tutulur. HMAC imzası, bir saat süre, viewer/blocked/following/interest kapsamı ve snapshot denetlenir. Cursor sorgusu skip kullanmaz; createdAt + _id ile ilerler; ranking yalnız çekilen pencereyi sıralar. Mevcut page sıralaması değişmez. Public discovery PRIVATE/FOLLOWERS gönderilerini göstermez; FOLLOWERS yalnız following akışında geçerlidir.
- Geo router ve route intelligence controller/service ilk ilgili istekte import edilir; başarısız import sonraki istekte tekrar denenebilir.
- messageReactions=false. message_reaction kalıcılaştırılmaz; ack ve message_reaction_unsupported olayı FEATURE_UNSUPPORTED döndürür. Message şeması için sahte reaction desteği eklenmedi. directCalls=false; mevcut pack grup ses kanalı ayrı kapsamda korunur.
- Shutdown cron, radar interval, socket, HTTP, Redis ve Mongo'yu kapatır; listen hatasının cleanup yolu da vardır. Boot'ta seed/achievement insert yoktur.

## Bilinçli olarak dokunulmayanlar ve doğrulama sınırı

Canlı deployment, Mongo verisi/backfill/index yaratılması, üretim sırları, gerçek Redis/Firebase ADC/FCM, sağlayıcılar, Flutter dosyaları ve cihaz kabulü değiştirilmedi veya canlı doğrulanmadı. Testler model/provider taklitleri ve gerçek yerel HTTP listener kullanır. fast_deploy.js'in seçili dosya upload yaklaşımı bu yeni modül ağacını dağıtmak için kullanılmamalı; release:build ve deploy.js'in tam release akışı kapsamındaki statik import grafiği doğrulandı, deployment çalıştırılmadı. Node test runtime'ı bu makinede v25.2.1; production Node 20 üzerinde çalışma ayrıca doğrulanmadı.

Son kaynak doğrulaması: 433 JS/MJS/CJS parse; server/index grafiğinde 253 kaynak / 712 bağlantı; eksik import ve attic bağlantısı yok. node --test tests/*.test.js: 158 pass, 0 fail/skip. git diff --check ve yeni aktif kaynak whitespace kontrolü geçti.

Eksiklerin tamamlanması: Aktif servislerde Express/catchAsync/sendResponse bağımlılığı yok; controllers HTTP adaptörleridir. 42 controller dosyasının 277 işlem gövdesi çıkarma sırasında AST ile kontrol edildi. Settings ve profile-theme servisleri de ayrıldı. Discover tüm girişlerde tek kaynak/query ve scoring motoru kullanır; eski search/trending alanları ve mixed projection korunur. Ride/GroupRide yeni yazıları tek koleksiyona gider; eski koleksiyonlar yalnız uyumluluk okumasında kalır.

Bu tamamlamada root sync_everything.js mevcut içeriğiyle attic/operations'a; kapalı cart uygulaması attic/closed/users'a taşındı. Private createSendToken HTTP helperı createSessionResult adlı saf servis sonucuna ayrıldı; 80 public user export korunur. Yeni testler response envelope, beş explicit user hata sözleşmesi, gerçek rate-limit HTTP davranışı, group middleware/save/promotion, migration dry-run ve seed validation kapsamındadır. Tüm controller/export eşleşmeleri [controller-service-map.json](controller-service-map.json) ve güncel durum [MODULAR_MONOLITH_CHECKLIST.md](MODULAR_MONOLITH_CHECKLIST.md) içindedir.

## 2026-10-11 ikinci dalga

Node 20.20.2 üzerinde 163/163; 77 barrel silindi, 20 provider/servis taşındı. Canlı Node 20.20.1/Mongo/Redis ve cihaz core GET kontrolleri geçti; onaylanan 7 group kayıt taşındı. Cihazda yeni login 200 doğrulandı. Kullanıcının son kararıyla mevcut http://31.210.36.57 adresi korunur; paket aracının varsayılan HTTPS koşulu da korunur. Ayrıca verilen açık onayla bu sürüme ait tek HTTP paketi repo dışında hazırlandı; canlı deploy yapılmadı. Güncel ayrıntılar SECOND_WAVE_REPORT.md ve live-acceptance-evidence.json içindedir.
