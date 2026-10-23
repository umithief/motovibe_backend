# Motonom ikinci dalga ve canlı kabul — 2026-10-11

Kaynak temizliği ve onaylanan group-ride migration tamamlandı. Kullanıcının son kararıyla API http://31.210.36.57 olarak kalır. Ayrıca verilen açık onayla bu sürümün tek paketi repo dışında hazırlandı; canlı deploy yapılmadı. Cihazda yeni /api/users/login isteğinin 200 yanıtı ve ardından home/discover 200 yanıtları doğrulandı. Cihaz smoke'u mevcut kurulu uygulama ve mevcut canlı backend içindir; yeni kaynakların canlı kabulü olarak sunulmaz.

| İstek | Sonuç |
| --- | --- |
| 1. Canlı doğrulama | Sunucuda Node 20.20.1, gerçek Mongo ping ve Redis PONG geçti. Health/capabilities/home/discover/reels HTTP 200; cihazdaki yetkili messages/threads 200. Products/forum/ai 404 FEATURE_DISABLED. Negatif login 401; cihazda yeni başarılı login 200. HTTP API kullanıcı kararıyla korunur. motonom.app TLS geçerli; fakat bütün API yolları aynı motonom-visits gövdesini verir. Bu yanıtlar backend kabulü sayılmadı. |
| 2. Arşivler | Yerel release.tar.gz ve uploads.tar.gz kopyalanmadan repo dışında karantinaya taşındı; boyut ve SHA256 doğrulandı. Canlı deploy klasöründe kalan uploads.tar.gz de native rename ile /var/backups/motonom/quarantine/2026-10-11 içine taşındı; aynı SHA256 ve boyut doğrulandı. Son canlı envanterde iki tar.gz de deploy klasöründe yok. uploads/ taşınmadı veya kopyalanmadı. |
| 3. Bağımlılıklar | ssh2 devDependencies ve lockfile dev graph'ında. Node 20 ile ayrı temiz production kurulumunda ssh2 yok. Dockerfile npm ci --omit=dev kullanır; Docker engine bulunmadığı için image build yapılmadı. firebase-functions, istenen index.js onRequest sözleşmesi sürdüğü için korundu. |
| 4. Eski klasörler | controllers/, routes/, services/ yok. 77 re-export silindi; 20 gerçek servis dosyası domain içine taşındı. 45 import düzenlemesi; 39 dosyanın uygulama/import taşıması. Gövdeler korundu, user modülü 80 public export'u koruyor. |
| 5. Categories / 3D | Flutter lib içinde bu endpoint çağrıları bulunmadı. categories/models3d modüllerindeki 8 dosya attic/closed içine taşındı; iki eski model re-export'u silindi. Capabilities false; legacy ve v2 prefix'ler 404 FEATURE_DISABLED. |
| 6. Ride.bikeId | Olmayan UserBike ref/populate kaldırıldı. Kayıt yalnız sahibinin User.garage._id değerine bağlanır. Geçersiz/yabancı opsiyonel bikeId sürüş status/body sözleşmesini bozmaz; bağlantı kaydedilmez. Detay mevcut populated bikeId biçiminde yalnız public garaj alanlarını verir; silinen motosiklet null. Eski depodaki orphan ID'ler topluca değiştirilmedi. |
| 7. Tag helper | tagExtractor.js silindi; mergeNormalizedTags, syncTagUsage, extractAndUpdateTags tagUtils.js içinde. Bütün aktif import'lar yeni helper'a gider; sayaç davranışı regresyonla doğrulandı. |
| 8. Operations | deploy.js, fast_deploy.js, diag.js attic/operations'a taşındı; mevcut içerikleri ve bağımlılık yolları korundu. Yeniden kökte görünen sync_everything.js de güncel içeriğiyle attic'e alındı. Bu tarihsel araçlar yeni release için çalıştırılmadı. |
| 9. Root health | GET / metni Motonom Backend API Çalışıyor!; HTTP regresyonu var. /api/health zarfı ve service alanı Flutter uyumluluğu için korunur. |
| 10. Migration | Önce canlı dry-run: 7 pending, 0 invalid, 0 collision. Kullanıcının açık --apply onayından sonra 7 upsert. Son dry-run: 7 existing, 0 pending. Eski grouprides koleksiyonundaki 7 kayıt korundu; yeni yazıların canlı model tarafından solo sorgulardan ayrıldığı doğrulandı. |

## Dosya, export ve path kaydı

Tam silinen barrel ve taşıma listesi: [second-wave-import-moves.json](second-wave-import-moves.json). Güncel domain karşılıkları: [module-map.json](module-map.json). 18 geo dosyası modules/geo altında; email/SMS providers modules/notifications altında.

HTTP değişikliği yalnız istekteki kapalı /api/categories ve /api/models prefix'leri, v2 karşılıkları ve kök marka metnidir. /users/login, posts/discover, reels, messages, packs, rides, routes, notifications, stories, events, home/summary, upload ve tags kaybolmadı. Önceki social 308, sponsorship, activity ve v2 alias'ları korunur. Silinen dosya import'larının HTTP path'lerle ilişkisi yoktur; bütün aktif tüketiciler modules'a bağlandı.

Arşiv konumu: C:\Users\ishak\AppData\Local\Motonom\quarantine\2026-10-11. Dış klasördeki archive-manifest.json iki dosyanın SHA256 ve boyutunu içerir. SSH public pin: C:\Users\ishak\AppData\Local\Motonom\operations\motonom-host-pin.json; kullanıcının ilk kayıt talebiyle ssh-keyscan'den alındı ve bağlantı bu Ed25519 anahtarına sabitlendi. Production .env indirilmedi/yazılmadı; sır veya serviceAccountKey eklenmedi.

## Doğrulama

- Node 20.20.2: **163 pass, 0 fail, 0 skip**. Node 20 Windows wildcard açmadığı için npm test portable scripts/test.mjs üzerinden yine node:test çalıştırır.
- Node 25 ara doğrulaması: 158/158; Node 20 ve canlı kanıt bununla ikame edilmedi.
- 345 aktif JS/MJS/CJS parse; runtime grafiği 244 dosya / 694 bağlantı; eksik import, attic bağlantısı veya Express bağımlı servis yok. 94 user tanımı ve 80 public export kontrol edildi.
- git diff --check ve yeni aktif dosyalar için no-index whitespace kontrolü geçti. Moved provider yorumlarındaki eski trailing whitespace temizlendi.
- Yeni 5 test garaj sahipliği/gizli alanlar/orphan toleransı, tag sayaçları, release kabul kapısı ve tek seferlik HTTP paket onayının sınırlarını doğrular. Kapalı endpointler ve Motonom kök metni mevcut HTTP testlerine eklendi.

## Paket kapısı ve açık kabul

npm run release:build -- --plan yalnız kaynak grafiği ve fingerprint üretir. Gerçek build --acceptance=PATH ister; güncel kaynak fingerprint'i, 24 saatten yeni checkedAt ve health/capabilities/login/discover/reels/messages/https/node20/mongo/redis/flutter kontrollerinin hepsi true olmadan dosya veya tar.gz oluşturmaz. Çıktı repo dışında olmak zorundadır; varsayılan geçici Motonom release dizinidir. Eksik kanıtla paket üretmeme davranışı testlidir. Varsayılan HTTPS koşulu korunur. Kullanıcının ayrıca açıkça onayladığı tek seferlik HTTP paket onayı kaynak fingerprint, API adresi, çıktı yolu ve en çok bir saatlik süreye bağlıdır; .used kaydı paket kopyalama başlamadan atomik oluşturulur. Başka kaynak/çıktı/host, eksik diğer kontroller, süresi geçmiş veya tekrar kullanılan onay reddedilir. Bu istisna deployment yetkisi vermez.

[live-acceptance-evidence.json](live-acceptance-evidence.json) gerçek durum kodlarını, başarılı yeni cihaz loginini, migration sonucunu ve HTTP ile devam etme kararını içerir. Mevcut canlı HTTP API kontrolü tamamlandı; varsayılan HTTPS koşulu korunarak tek seferlik açık HTTP paket onayı kullanıldı ve tüketildi. checks.https false olarak kalır; TLS kabulü yapılmış gibi gösterilmez. Bu kaynak fingerprint kaydı, aday kaynakların canlıya kurulduğu anlamına gelmez. Yeni source deployment, Firebase ADC/FCM/cloud onRequest, iki hesap arasında mesaj teslimi ve Docker image build bu çalışmada doğrulanmadı. Flutter kaynakları, üretim ayarları/sırlar ve uploads/ değiştirilmedi. Commit veya PR oluşturulmadı; yalnız kaynak paketi hazırlandı.

Alan adı incelemesi: https://motonom.app üzerindeki health/capabilities/home/discover/reels/products/forum/ai istekleri TLS doğrulamasıyla 200 verdi, fakat hepsinin servis adı motonom-visits ve yanıt SHA256 değeri aynıydı. api.motonom.app çözümlenemedi. Origin IP’ye Host: motonom.app ile erişim gerçek backend health/capabilities 200 ve products 404 verdi. HTTPS/domain yönlendirme değişikliği kullanıcının son HTTP kararıyla bu turun kapsamı dışındadır.

Otomatik onay incelemesi, zorunlu HTTPS paket kontrolünün kaldırılmasını reddetti: mevcut HTTP adresini koruma kararının kalıcı kontrol kaldırma yetkisi vermediğini belirtti. Bu kalıcı kontrol kaldırma değişikliği uygulanmadı. Kullanıcı daha sonra “Bu sürüm için HTTP ile paketlemeyi onaylıyorum” dedi; kaynak/host/çıktı/süre ile sınırlanan, yalnız bir kez tüketilen paket onayı eklendi. Varsayılan HTTPS kontrolü yerinde kaldı ve yeni regresyon testi geçti.

## Hazırlanan paket

- Konum: C:/Users/ishak/AppData/Local/Motonom/releases/2026-10-11T10-57-17-958Z/motonom-backend.tar.gz
- Kaynak fingerprint: 28c95ca8a0fa872d120132972c21671c25580f13563bd9630ac36ae015e80ff5
- Arşiv SHA256: cf9fc3f8b05cba0a15af6e0b08665e65ce13e71d0e354eca191858cbb63c1748
- Boyut: 278914 byte; 249 kaynak/manifest girdisi + release-manifest.json, toplam 250 dosya.
- tar listesi kaynak planıyla karşılaştırıldı; uploads, attic, eski controllers/routes/services, node_modules, .env, serviceAccount ve iç içe tar.gz yok. Production bağımlılık kurulumu ayrıca ssh2 içermediğini doğruladı.
- HTTP onayı tüketildi; deploy/restart yapılmadı.
