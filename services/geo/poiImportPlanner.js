const supportedCountryBounds = Object.freeze({
    // Broad Turkish national envelope. Imports are always split into tiles;
    // this is never sent as one Overpass request.
    TR: [35.8, 25.6, 42.2, 45.1]
});

export const resolvePoiImportBounds = ({ bbox, country }) => {
    if (bbox) {
        const values = bbox.split(',').map(Number);
        if (values.length === 4 && values.every(Number.isFinite) && values[0] < values[2] && values[1] < values[3]) return values;
        throw new Error('bbox south,west,north,east biciminde olmali.');
    }
    const normalizedCountry = String(country || '').trim().toUpperCase();
    if (supportedCountryBounds[normalizedCountry]) return supportedCountryBounds[normalizedCountry];
    throw new Error('Bir --bbox veya desteklenen --country gereklidir. Desteklenen: TR');
};

export const createBboxTiles = (bbox, tileSizeDegrees = 0.8) => {
    const [south, west, north, east] = bbox;
    const size = Number(tileSizeDegrees);
    if (!Number.isFinite(size) || size <= 0 || size > 2) throw new Error('tileSize 0 ile 2 derece arasinda olmali.');
    const tiles = [];
    for (let lat = south; lat < north; lat += size) {
        for (let lng = west; lng < east; lng += size) {
            tiles.push([
                Number(lat.toFixed(6)),
                Number(lng.toFixed(6)),
                Number(Math.min(lat + size, north).toFixed(6)),
                Number(Math.min(lng + size, east).toFixed(6))
            ]);
        }
    }
    return tiles;
};
