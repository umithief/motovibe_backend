import { z } from 'zod';

// User Schema
export const UserSchema = z.object({
    username: z.string().min(3).max(20),
    email: z.string().email(),
    bio: z.string().optional(),
});

// Post Schema
export const CreatePostSchema = z.object({
    content: z.string().min(1, "Text cannot be empty").max(500),
    locationName: z.string().optional(),
    rideId: z.string().uuid().optional(),
});

// Ride Schema
export const CreateRideSchema = z.object({
    title: z.string({ required_error: "Başlık zorunludur" }).min(3, "Başlık en az 3 karakter olmalıdır"),
    description: z.string().optional(),
    startTime: z.string({ required_error: "Başlangıç zamanı zorunludur" }).datetime({ message: "Geçersiz tarih formatı" }), // ISO String
    difficulty: z.enum(['Easy', 'Moderate', 'Hard'], { required_error: "Zorluk seviyesi seçilmelidir" }),
    maxParticipants: z.number().min(2, "En az 2 katılımcı olmalı").max(100, "En fazla 100 katılımcı olabilir").default(10),
    route: z.any(),
});

// Location Schema
export const UpdateLocationSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
});
