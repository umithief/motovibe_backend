import mongoose from 'mongoose';

const meetupEventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    type: { type: String, default: 'ride' }, // 'ride', 'tour', 'night-ride', 'coffee', 'track-day', 'buddy-search', 'workshop', 'race'
    date: { type: String, required: true },
    time: { type: String, required: true },
    endTime: { type: String, default: '' }, // Bitiş saati
    location: { type: String, required: true },
    meetingPoint: { type: String, default: '' }, // Net buluşma noktası
    coordinates: {
        lat: { type: Number, default: 41.0082 },
        lng: { type: Number, default: 28.9784 }
    },
    organizer: { type: String, default: 'MotoVibe Rider' },
    organizerId: { type: String, default: '' },
    organizerName: { type: String, default: '' },
    organizerAvatar: { type: String, default: '' },
    attendees: { type: Number, default: 0 },
    maxAttendees: { type: Number, default: 0 }, // 0 = sınırsız
    image: {
        type: String,
        default: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1200&q=80'
    },
    description: { type: String, default: '' },
    tags: [{ type: String }], // Etiketler: ['sport', 'adventure', 'cafe', 'viraj']
    difficulty: { type: String, default: 'medium' }, // 'easy', 'medium', 'hard', 'extreme'
    routeType: { type: String, default: 'all_roads' }, // 'scenic_twists', 'track', 'city_cruise', 'highway', 'offroad', 'coastal', 'all_roads'
    pace: { type: String, default: 'moderate' }, // 'chill', 'moderate', 'spirited'
    distance: { type: String, default: '' }, // Tahmini mesafe: "120 km"
    isFeatured: { type: Boolean, default: false }, // Öne çıkan etkinlik
    isCancelled: { type: Boolean, default: false }, // İptal durumu
    status: {
        type: String,
        enum: ['scheduled', 'active', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    waypoints: [{ type: String }],
    routeCoordinates: [{
        lat: Number,
        lng: Number
    }],
    liveGroupRide: {
        isActive: { type: Boolean, default: false },
        startedAt: { type: Date },
        finishedAt: { type: Date },
        currentLeader: { type: String, default: '' },
        activeRiders: [{
            userId: String,
            name: String,
            avatar: String,
            lat: Number,
            lng: Number,
            speed: Number,
            heading: Number,
            updatedAt: { type: Date, default: Date.now }
        }]
    },
    attendeeList: [{
        userId: { type: String },
        name: { type: String },
        avatar: { type: String },
        joinedAt: { type: Date, default: Date.now }
    }],
    messages: [{
        id: String,
        userId: String,
        userName: String,
        userAvatar: String,
        text: String,
        time: String,
        createdAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// Performans indeksleri
meetupEventSchema.index({ date: 1, isCancelled: 1 });
meetupEventSchema.index({ isFeatured: 1, isCancelled: 1 });
meetupEventSchema.index({ organizer: 1 });
meetupEventSchema.index({ 'attendeeList.userId': 1 });

// Tarih+saat bazlı sıralama kolaylığı için virtual
meetupEventSchema.virtual('startDateTime').get(function () {
    try {
        return new Date(`${this.date}T${this.time}:00`);
    } catch {
        return null;
    }
});

// JSON serialize ederken virtual alanları dahil et
meetupEventSchema.set('toJSON', { virtuals: true });
meetupEventSchema.set('toObject', { virtuals: true });

const MeetupEvent = mongoose.model('MeetupEvent', meetupEventSchema);
export default MeetupEvent;
