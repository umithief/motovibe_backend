import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const prisma = new PrismaClient();
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

/**
 * Updates a user's live location and broadcasts it to nearby riders.
 */
export async function updateLocation(userId: string, latitude: number, longitude: number) {
    // 1. Update Database
    // Use raw query if using native PostGIS geometry column for maximum performance
    // await prisma.$executeRaw`
    //   INSERT INTO "LiveLocation" ("userId", "coordinates", "updatedAt")
    //   VALUES (${userId}, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326), NOW())
    //   ON CONFLICT ("userId") 
    //   DO UPDATE SET "coordinates" = EXCLUDED.coordinates, "updatedAt" = NOW();
    // `;

    // For this schema version using float columns:
    const location = await prisma.liveLocation.upsert({
        where: { userId },
        update: { latitude, longitude },
        create: { userId, latitude, longitude },
    });

    // 2. Broadcast to "global" or specific spatial channel via Supabase Realtime
    // In a real app, you might use a geohash channel (e.g., 'riders:u4pru') to only notify relevant users
    await supabase
        .channel('live-locations')
        .send({
            type: 'broadcast',
            event: 'location-update',
            payload: { userId, latitude, longitude, updatedAt: new Date() },
        });

    return location;
}

/**
 * Helper: Find riders within radius using PostGIS
 */
export async function getNearbyRiders(lat: number, lng: number, radiusKm: number) {
    // Raw SQL is essential here for PostGIS 'ST_DWithin' usage
    // The distance is in meters, so radiusKm * 1000
    // Assumes we have a 'coordinates' geometry column or we construct points on the fly

    /*
    const riders = await prisma.$queryRaw`
      SELECT 
        u.id, 
        u.username, 
        u.avatar, 
        l.latitude, 
        l.longitude
      FROM "LiveLocation" l
      JOIN "User" u ON l."userId" = u.id
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(l.longitude, l.latitude), 4326)::geography, 
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, 
        ${radiusKm * 1000}
      );
    `;
    */

    // Mock implementation for the TS file without active DB connection
    // Simulating what the result would be
    return [];
}
