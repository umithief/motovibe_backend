import dotenv from 'dotenv';
import mongoose from 'mongoose';
import GeoPoi from "../modules/geo/model.js";
import { getMongoUri } from '../config/env.js';
import { fetchOverpassPois } from "../modules/geo/providers/overpassProvider.js";
import { createBboxTiles, resolvePoiImportBounds } from "../modules/geo/poiImportPlanner.js";

dotenv.config();

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const bboxArgument = argument('bbox');
const countryArgument = argument('country');
const tileSizeArgument = Number(argument('tileSize') || 0.8);
const maxTilesArgument = argument('maxTiles');
const startTileArgument = Number(argument('startTile') || 0);
const delayMsArgument = Number(argument('delayMs') || 1200);

if (!bboxArgument && !countryArgument) {
    console.error('Kullanim: npm run import:poi -- --bbox=south,west,north,east veya --country=TR');
    process.exit(1);
}

let bbox;
let tiles;
try {
    bbox = resolvePoiImportBounds({ bbox: bboxArgument, country: countryArgument });
    tiles = createBboxTiles(bbox, tileSizeArgument);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
const requestedMaxTiles = maxTilesArgument === undefined ? tiles.length : Number(maxTilesArgument);
if (!Number.isInteger(requestedMaxTiles) || requestedMaxTiles < 1 || !Number.isInteger(startTileArgument) || startTileArgument < 0) {
    console.error('maxTiles en az 1, startTile ise 0 veya daha buyuk bir tamsayi olmali.');
    process.exit(1);
}
const selectedTiles = tiles.slice(startTileArgument, startTileArgument + requestedMaxTiles);
if (!selectedTiles.length) {
    console.error('Secilen tile araligi bulunamadi.');
    process.exit(1);
}

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

try {
    await mongoose.connect(getMongoUri());
    const stats = { tiles: selectedTiles.length, fetched: 0, valid: 0, inserted: 0, updated: 0, rejected: 0, failedTiles: [] };
    for (const [tileOffset, tile] of selectedTiles.entries()) {
        const tileIndex = startTileArgument + tileOffset;
        try {
            const fetched = await fetchOverpassPois({ bbox: tile, requestId: `poi-import-${Date.now()}-${tileIndex}` });
            stats.fetched += fetched.length;
            const valid = fetched.filter((poi) => poi?.source && poi?.sourceId && Array.isArray(poi?.location?.coordinates));
            stats.valid += valid.length;
            stats.rejected += fetched.length - valid.length;
            for (const batch of chunk(valid, 250)) {
                const result = await GeoPoi.bulkWrite(batch.map((poi) => ({
                    updateOne: {
                        filter: { source: poi.source, sourceId: poi.sourceId },
                        update: { $set: { ...poi, importedAt: new Date() } },
                        upsert: true
                    }
                })), { ordered: false });
                stats.inserted += result.upsertedCount || 0;
                stats.updated += result.modifiedCount || 0;
            }
            console.info({ tile: `${tileIndex + 1}/${tiles.length}`, fetched: fetched.length, inserted: stats.inserted, updated: stats.updated });
        } catch (error) {
            stats.failedTiles.push({ tileIndex, message: error.message });
            console.error({ tile: `${tileIndex + 1}/${tiles.length}`, error: error.message });
        }
        if (delayMsArgument > 0 && tileOffset < selectedTiles.length - 1) await sleep(delayMsArgument);
    }
    console.info({ ...stats, complete: stats.failedTiles.length === 0 });
} catch (error) {
    console.error('POI import basarisiz:', error.message);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
