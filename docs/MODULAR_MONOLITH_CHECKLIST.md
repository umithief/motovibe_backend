# Motonom modular monolith kabul denetimi

Kaynak değişiklikleri ve Node 20 yerel kontrolleri tamamlandı. İkinci dalga/canlı kabul için güncel kayıt: [SECOND_WAVE_REPORT.md](SECOND_WAVE_REPORT.md). Cihazda yeni login 200 doğrulandı. Kullanıcı mevcut HTTP API adresiyle devam etmeyi seçti; paket aracının varsayılan HTTPS koşulu korunur. Açık onayla tek HTTP paketi repo dışında hazırlandı; yeni deployment yapılmadı.

| İstek | Son durum ve kanıt |
| --- | --- |
| Boot ve god-file ayrımı | app.js middleware/mount/capabilities/health/error; server.js env/Mongo/ADC/socket/cron/listen/shutdown; index.js lazy onRequest bağlantısı. Import sırasında listen veya DB bağlantısı yok. |
| Domain sahipliği ve servis ayrımı | Aktif uygulamalar modules/ altında. 42 controller dosyasındaki 277 işlem DTO servislerine mekanik taşındı; çıkarma sırasında AST gövde eşdeğerliği doğrulandı. Önceden ayrılan 16 event işlemi, home/feed/activity adaptörleri ve ek tema/settings servisleri de ince controller üzerinden çalışır. |
| Kapalı shop/music/forum/vlog/council/stolen/ai/1:1 call | Router import/mount yok. Bütün kapalı prefix'ler 404 FEATURE_DISABLED. Cart uygulaması attic'te; eski export adları yalnız disabled adaptörleri olarak kalır. |
| Discover × N | Feed ve eski search/trending aynı query.service kaynak kayıtlarını ve ranking.service puanlamasını kullanır. Legacy yanıt projeksiyonları korunur; ayrı eski puanlama formülleri kaldırıldı. |
| Campaign × 3, posts/social | Tek campaign mount; sponsorship alias'ları; /api/social 308 /api/posts. V2 social yönlendirmesi /api/v2/posts'a gider. |
| Ride/GroupRide/RideActivity | Yeni yazılar tek rides koleksiyonuna gider. GroupRide aynı Ride modelinin group discriminator'ıdır; group date string, solo date Date korunur. Eski grouprides ve rideactivities yalnız okunur. Group ilk değişiklikte idempotent promote edilir; toplu geçiş scripti varsayılan dry-run'dır. |
| Event/MeetupEvent | Event.js silindi; MeetupEvent model/koleksiyon ve Flutter sözleşmesi korunur. |
| Product/Showcase | Kapalı uygulamalar attic'te; runtime ve demo seed'de yok. Kapalı özellik geliştirilmedi. |
| RideActivity user/userId | Canonical user; userId uyum alanı. Canonical sahibin önceliği read/delete/leaderboard ve eski activity okumasında korunur. Body sahibi değiştiremez. |
| Tek hata kanalı | Controller catchAsync, service AppError/raiseHttpError, ortak globalErrorHandler. Beş explicit users hata yanıtı ve route rate-limit hataları merkeze bağlandı; eski gövdeler/durum kodları korunur. |
| Tek yanıt | JSON yanıtları sendResponse/sendSuccess kanalında. /api/v2/... yalnız {status,data,error?,meta?}; mevcut /api/... yolları explicit legacy alias olarak gövdelerini korur. Legacy 204 korunur; v2 200 + data:null verir. Dosya/HTML sağlayıcı yanıtları kendi içerik biçimlerini korur. |
| Feature flag mount-time | createApp kurulumunda getRuntimeCapabilities; kapalı router ikinci kez mount edilmez. |
| P0a | res.json interceptor/JSON deep clone yok. Media URL helper avatar, coverImage, image, thumbnail, imageUrl, videoUrl, media.url, emblem ve images[] için copy-on-change. |
| P0b | Kapalı mount'lar kaldırıldı; yalnız ortak disabled middleware. |
| P0c | Demo seed scripts/seed-demo.mjs; boot ve GET handler'larında seed yok. Production reddi + --apply. Group demo için açık --organizer ve mevcut development kullanıcısı gerekir. |
| P0d | İstenen ölü root/model/TS/Zod dosyaları kaldırıldı veya attic'e alındı; Supabase manifest/lock temiz; data:import seed-demo'ya bağlı. |
| P1a | RideActivity model/controller/router kaldırıldı; /api/activities uyum adaptörü Ride kullanır. |
| P1b | getExplorePosts, posts/explore, explore kökü ortak discover servisine bağlı. |
| P1c | Campaign tek mount ve social 308 HTTP testli. |
| P1d | İlk bölünmede 94 tanımın hash'i korunmuştu. Sonraki transport ayrımında 58 user işlem gövdesi AST ile doğrulandı; 80 public export aynı. Tarihsel SHA'lar ile currentFile/currentExport ayrı tutulur. Bütün user iş kuralları yeniden yazılmadı. |
| P1e | Event routes yalnız middleware/mount; controller/service içinde 16 işlem. |
| P2 message_reaction | Desteklenmiyor: messageReactions=false; socket ACK/unsupported event FEATURE_UNSUPPORTED. Sahte kalıcı reaction desteği yok. |
| P2 home/cache | 30s Redis/process cache, single-flight, private kullanıcı verisi her istekte ayrı, private/no-store. Cache hatası/TTL ve kullanıcı izolasyonu testli. |
| P2 discover cursor | Opt-in imzalı/scope-bound/snapshot cursor; createdAt + _id, skip yok. Mevcut page yolu korunur; sentinel/duplicate ve yeni kayıt testleri var. |
| P2 geo | İlk ilgili istekte lazy import, başarısız import tekrar denenebilir. |

## Son yerel doğrulama

- node --test tests/*.test.js: **163 pass, 0 fail, 0 skip**; Node **v20.20.2**, scripts/test.mjs ile portable node:test. Önceki Node 25 turu 158/158.
- GET /api/health, /api/home/summary ve /api/posts/discover: yerel HTTP'de 200. Home auth opsiyonel.
- GET /api/products, /api/forum, /api/ai ve diğer bütün kapalı prefix'ler: 404 FEATURE_DISABLED; alt yol POST da kontrol edildi.
- Auth /users/login, discover, reels, messages, packs, rides, routes, notifications, stories, events, home/summary, upload, tags mount kontrolleri: router kaynaklı 404 yok; korumalı yollar login olmadan 401 verebilir.
- Group query/save/promotion gerçek Mongoose middleware ile taklit Mongo koleksiyonları üzerinde doğrulandı; dry-run migration idempotency ve collision testleri geçti.
- 345 JS/MJS/CJS parse edildi; server/index grafiği 244 kaynak / 694 bağlantı. Eksik import veya attic bağlantısı yok. Aktif domainlerde service eksiği ve Express bağımlı servis yok.
- git diff --check geçti; 248 yeni aktif kaynak/rapor ayrıca no-index whitespace kontrolünden geçti; ikinci dalga raporları dahildir.

## Bu tamamlamadaki dosya/export/path raporu

- Kökte kalan sync_everything.js güncel içeriği korunarak attic/operations/sync_everything.js'e taşındı. Kapalı cart uygulaması attic/closed/users/cart.controller.js'e alındı; dört export adı disabled adaptöründe korundu.
- GroupRide.model.js artık Ride discriminator re-export'u. Ayrı model registration ve grouprides yazıları kaldırıldı; legacy kayıtlar silinmedi.
- Bütün işlem/export eşleşmeleri controller-service-map.json içinde. İlk user bölümü ve mevcut sahipler user-controller-export-manifest.json içinde. Private createSendToken HTTP helperı createSessionResult adlı saf sonuca ayrıldı; public user isimleri değişmedi.
- Yeni /api/v2/... uyum alias'ı ortak zarf verir. Eski path/body/status sessizce değiştirilmedi. Kapalı path'ler ve /api/social 308 istekte belirtildiği gibi uygulanmıştır.
- Yeni migration scripti: npm run data:migrate-group-rides (dry-run); uygulama için ayrıca -- --apply. Canlı dry-run ve kullanıcının açık onayıyla apply çalıştı: 7 taşındı; son dry-run 0 pending/7 existing, legacy 7 kayıt korundu.

## Bilinçli olarak dokunulmayan ve canlı doğrulanmayan kapsam

Flutter kaynakları, mevcut üretim ayarları/sırlar, service account dosyaları, uploads ve tar.gz içerikleri değiştirilmedi/kopyalanmadı. Önceki çalışma ağacı değişiklikleri korundu; deploy/fast_deploy/diag attic/operations içinde. İki yerel tar.gz repo dışında karantinaya taşındı; canlı deploy klasöründeki uploads.tar.gz de dış karantinaya taşındı ve iki eski arşivin deploy klasöründe olmadığı doğrulandı. Kapalı özellikler geliştirilmedi; mikroservis/Prisma/Supabase/framework eklenmedi. PR/commit/deployment oluşturulmadı.

Canlı Node 20.20.1, Mongo/Redis ping, group migration, cihazda yeni login 200 ve core GET 200 yanıtları doğrulandı. Index yaratma, Firebase ADC/FCM/cloud onRequest, sağlayıcılar, iki hesap arasında teslim, Yeni kaynakların deployment kabulü doğrulanmadı. HTTPS/domain yönlendirmesi kullanıcı kararıyla kapsam dışında; motonom.app üzerindeki motonom-visits yanıtları backend kabulü sayılmadı. Ayrıntılı kanıt SECOND_WAVE_REPORT.md içinde.

Toplu controller değişimi otomatik onay incelemesince reddedildi; backend'e bu toplu işlem uygulanmadı. Aynı ayrım read-only AST ön kontrolü ve ayrı ayrı onaylanan tek controller/domain adımlarıyla, her adımın ardından tam test paketi çalıştırılarak tamamlandı.

Açık HTTP paket onayı bu kaynak fingerprint ve tek çıktı için tüketildi. Varsayılan HTTPS kapısı korundu. 249 kaynak dosyası + manifest içeren arşiv repo dışındaki AppData/Local/Motonom/releases altında; SHA256 ve tam konumu SECOND_WAVE_REPORT.md içinde. Paket hazırlandı, canlı deploy yapılmadı.
