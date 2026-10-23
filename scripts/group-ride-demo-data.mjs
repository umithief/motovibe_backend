// Default Route Events Seeds if database has 0 group rides
export const SEED_GROUP_RIDES = [
    {
        title: 'Şile Sahil Virajları & Sabah Gazlaması',
        description: 'Cumartesi sabahı erken saatte Şile eski sahil yolunun teknik virajlarını akıcı bir tempoda dönüyoruz. Kahve ve kahvaltı molası Saklıgöl’de.',
        coverImage: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1200&q=80',
        date: '2026-09-20',
        time: '08:30',
        meetingPoint: 'Çekmeköy Shell İstasyonu (Şile Yolu Çıkışı)',
        coordinates: { lat: 41.0345, lng: 29.1834 },
        pace: 'spirited',
        difficulty: 'hard',
        minCcRequirement: 400,
        distance: '94 km',
        estimatedDuration: '2 saat 15 dk',
        maxParticipants: 15,
        status: 'scheduled',
        waypoints: [
            { name: 'Buluşma: Çekmeköy Shell', lat: 41.0345, lng: 29.1834, type: 'start', order: 1 },
            { name: 'Ömerli Barajı Seyir Tepesi', lat: 41.0621, lng: 29.3412, type: 'scenic', order: 2 },
            { name: 'Şile Saklıgöl Kahvaltı', lat: 41.1420, lng: 29.5830, type: 'cafe', order: 3 },
            { name: 'Ağva Sahil Bitiş', lat: 41.1378, lng: 29.8456, type: 'end', order: 4 }
        ],
        routeCoordinates: [
            { lat: 41.0345, lng: 29.1834 },
            { lat: 41.0450, lng: 29.2300 },
            { lat: 41.0621, lng: 29.3412 },
            { lat: 41.0980, lng: 29.4500 },
            { lat: 41.1420, lng: 29.5830 },
            { lat: 41.1378, lng: 29.8456 }
        ]
    },
    {
        title: 'Boğaz Hattı & Rumeli Feneri Gece Sürüşü',
        description: 'Hafta içi stresini atmak için Beşiktaş’tan Sarıyer sırtlarına, oradan Rumeli Feneri sisli virajlarına gece sürüşü. Sakin ve keyifli tempo.',
        coverImage: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=1200&q=80',
        date: '2026-09-22',
        time: '21:00',
        meetingPoint: 'Kuruçeşme Parkı Otoparkı',
        coordinates: { lat: 41.0592, lng: 29.0341 },
        pace: 'chill',
        difficulty: 'easy',
        minCcRequirement: 125,
        distance: '48 km',
        estimatedDuration: '1 saat 45 dk',
        maxParticipants: 25,
        status: 'scheduled',
        waypoints: [
            { name: 'Kuruçeşme Parkı', lat: 41.0592, lng: 29.0341, type: 'start', order: 1 },
            { name: 'Tarabya Sahil Molası', lat: 41.1390, lng: 29.0560, type: 'cafe', order: 2 },
            { name: 'Rumeli Feneri Kale Noktası', lat: 41.2350, lng: 29.1410, type: 'end', order: 3 }
        ],
        routeCoordinates: [
            { lat: 41.0592, lng: 29.0341 },
            { lat: 41.0850, lng: 29.0490 },
            { lat: 41.1390, lng: 29.0560 },
            { lat: 41.1850, lng: 29.0800 },
            { lat: 41.2350, lng: 29.1410 }
        ]
    },
    {
        title: 'Tekirdağ Uçmakdere Viraj Seansı',
        description: 'Marmara Denizi manzaralı Uçmakdere yamaç paraşütü iniş pistine inen efsanevi virajlar. Orta-yüksek tempo, teknik viraj tecrübesi gerektirir.',
        coverImage: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1200&q=80',
        date: '2026-09-27',
        time: '07:30',
        meetingPoint: 'Kınalı Gişeler Opet Tesisleri',
        coordinates: { lat: 41.0821, lng: 28.1432 },
        pace: 'spirited',
        difficulty: 'expert',
        minCcRequirement: 500,
        distance: '165 km',
        estimatedDuration: '3 saat 30 dk',
        maxParticipants: 12,
        status: 'scheduled',
        waypoints: [
            { name: 'Kınalı Opet', lat: 41.0821, lng: 28.1432, type: 'start', order: 1 },
            { name: 'Yeniköy Çay Bahçesi', lat: 40.8520, lng: 27.5640, type: 'cafe', order: 2 },
            { name: 'Uçmakdere Zirve Seyir', lat: 40.7980, lng: 27.3650, type: 'summit', order: 3 },
            { name: 'Kumbağ Sahil', lat: 40.8710, lng: 27.4620, type: 'end', order: 4 }
        ],
        routeCoordinates: [
            { lat: 41.0821, lng: 28.1432 },
            { lat: 40.9700, lng: 27.8500 },
            { lat: 40.8520, lng: 27.5640 },
            { lat: 40.7980, lng: 27.3650 }
        ]
    }
];
