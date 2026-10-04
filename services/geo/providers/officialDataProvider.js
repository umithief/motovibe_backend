// Registry only: no public body is scraped. An official adapter may be added
// only after its API terms, freshness and attribution are reviewed.
export const officialRoadDataProviders = Object.freeze([
    { id: 'afad', label: 'AFAD', status: 'needs_approved_api' },
    { id: 'kgm', label: 'Karayolları Genel Müdürlüğü', status: 'needs_approved_api' },
    { id: 'municipal_open_data', label: 'Belediye açık verisi', status: 'needs_approved_api' }
]);

export const getOfficialRoadAlerts = async () => ({
    available: false,
    reason: 'no_approved_provider',
    alerts: [],
    attribution: []
});
