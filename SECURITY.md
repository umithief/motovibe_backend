# Backend guvenlik ve istemci entegrasyonu

## Zorunlu ortam degiskenleri

- `MONGO_URI`: MongoDB baglanti adresi.
- `JWT_SECRET`: En az 32 karakterli, rastgele ve ortama ozel imzalama anahtari.
- `CORS_ORIGINS`: Production ortaminda virgulle ayrilmis izinli origin listesi.

Tum desteklenen ayarlar icin `.env.example` dosyasini kullanin. Gercek sirlar `.env`
dosyasinda veya bir secret manager icinde tutulmali; repository ya da deploy scriptine
yazilmamalidir.

## Kimlik dogrulama ve yetki degisiklikleri

Asagidaki istekler `Authorization: Bearer <access-token>` ister:

- `POST /api/upload`
- `POST /api/reels/upload`
- `POST /api/reels/:id/comments`
- `PUT /api/reels/:id`
- `DELETE /api/reels/:id`

Reel guncelleme ve silmede kaynak sahibi token kimliginden belirlenir; body icindeki
`userId` yetki karari icin kullanilmaz. `POST /api/reels/:id/interact` misafir goruntuleme
ve paylasimi destekler, ancak `like` icin gecerli token gerekir.

Asagidaki yazma/raporlama yuzeyleri admin token ister:

- Kategori, urun, slide, showcase, muzik ve 3D model ekleme/guncelleme/silme
- UI ayarlari ve branding guncelleme
- Reel yonetim endpointleri (`/api/reels/admin/*`)
- `GET /api/analytics/visitors` ve `GET /api/analytics/dashboard`
- `POST /api/users/verification/update`
- `POST /api/users/achievements/seed`
- `PUT /api/posts/config`

## Upload sozlesmesi

`POST /api/upload`, `multipart/form-data` icinde `file` alanini kabul eder. Desteklenen
MIME tipleri `image/jpeg`, `image/png` ve `image/webp`'dir. Varsayilan limit 10 MiB'dir;
`UPLOAD_MAX_BYTES` ile degistirilebilir. Basarili cevap `201` ve mevcut istemcilerle
uyumlu `{"success":true,"url":"uploads/..."}` bicimindedir.

## Hata sozlesmesi

API hatalari `status`, `message` ve izleme icin `requestId` dondurur. Duplicate kayit
`409`, Mongoose validation `422`, gecersiz token `401`, yetkisiz rol `403`, buyuk istek
`413` ve bulunmayan API endpointi `404` dondurur. Beklenmeyen production hatalarinda
stack veya dahili hata mesaji istemciye verilmez.

## Operasyon notlari

- Daha once kaynak kodda bulunan tum veritabani, JWT, SSH, admin ve harici servis
  kimlik bilgilerini sızmis kabul ederek production tarafinda rotate edin.
- Admin bootstrap varsayilan olarak kapali olmalidir. Gerektiginde `SEED_ADMIN=true`
  ve guclu `ADMIN_*` degerleriyle bir kez calistirin, ardindan tekrar kapatin.
- Deploy yardimcilari `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USERNAME` ve
  `DEPLOY_PASSWORD` degiskenlerini kullanir.
