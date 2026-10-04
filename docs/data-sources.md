# MotoVibe geographic data sources

| Provider | Use | Attribution / licence status | Configuration |
| --- | --- | --- | --- |
| OpenStreetMap / Overpass | Server-side POI import and road/place metadata | Display `© OpenStreetMap contributors`; check the current ODbL requirements before redistributing derived datasets | `OVERPASS_API_URL` |
| Open-Meteo | Route weather summary | Verify the current Open-Meteo attribution and commercial-use terms before release | `OPENMETEO_BASE_URL` |
| Open-Meteo Elevation / Copernicus DEM GLO-90 | Sampled route elevation profile, ascent and descent | Verify the current Open-Meteo attribution and commercial-use terms before release | `OPENMETEO_ELEVATION_BASE_URL`; display Open-Meteo and Copernicus attribution where elevation is shown |
| NASA FIRMS | Optional route-corridor satellite thermal anomaly warnings | Display/retain NASA FIRMS attribution. A thermal anomaly is not a confirmed fire or road closure. | `NASA_FIRMS_MAP_KEY`, `GEO_WILDFIRE_ENABLED`, `NASA_FIRMS_SOURCE` |
| Wikidata | Optional route discovery places, resolved to Turkish/English labels through the official MediaWiki API | Wikidata structured data is CC0; do not imply editorial endorsement. Preserve the source label/link. | `GEO_DISCOVERY_ENABLED`, `WIKIDATA_API_URL` |
| TomTom Traffic Flow / Incidents | Optional sampled route flow, speed, provider-reported closures and current incident details | Keep TomTom attribution; verify current commercial plan, quota and caching terms before enabling in production. Traffic is unavailable unless both the feature flag and key are configured. | `GEO_TRAFFIC_ENABLED`, `TOMTOM_API_KEY`, `TOMTOM_TRAFFIC_BASE_URL` |
| Mapbox | Existing routing integration | Existing Mapbox account, token scope, attribution and billing rules apply | `MAPBOX_DIRECTIONS_ACCESS_TOKEN` |
| OpenRouteService | Optional routing provider | **NEEDS LEGAL / LICENSE REVIEW** for the intended production use and cache policy | `OPENROUTESERVICE_API_KEY` |
| Valhalla | Future self-hosted routing provider | Self-hosting data licences depend on the imported data sources | `VALHALLA_BASE_URL` |
| Overture Maps Foundation | Optional secondary POI enrichment through a MotoVibe-controlled normalized endpoint | Verify the current Overture data licence, update policy and attribution requirements before production. No mobile client calls Overture directly. | `GEO_OVERTURE_ENABLED`, `OVERTURE_API_URL` |
| AFAD / KGM / municipal open data | Future official road and incident adapters | **NEEDS APPROVED API / LEGAL REVIEW**. No website scraping is implemented. | `GEO_OFFICIAL_DATA_ENABLED` |

The mobile client never receives private provider credentials. Provider responses are normalized by the backend and source attribution is kept with imported POIs.

## Controlled POI imports

Use `npm run import:poi -- --bbox=south,west,north,east` for a bounded import or `npm run import:poi -- --country=TR` for the Turkish envelope. Country imports are split into small sequential tiles, use bulk upserts, pause between requests, and report failed tiles so a run can resume with `--startTile=`. They never send a national bounding box to Overpass in one request.
