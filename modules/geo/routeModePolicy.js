const supportedModes = new Set(['fastest', 'shortest', 'scenic', 'curvy', 'coastal', 'mountain', 'camping', 'night_ride', 'cafe_ride', 'discovery']);

export const normalizeRoutePreferences = (raw = {}) => {
    const candidate = String(raw?.mode || raw?.routeMode || 'fastest').trim().toLowerCase();
    const mode = supportedModes.has(candidate) ? candidate : 'fastest';
    return {
        mode,
        alternatives: Boolean(raw?.alternatives),
        avoidHighways: Boolean(raw?.avoidHighways),
        avoidTolls: Boolean(raw?.avoidTolls),
        avoidFerries: Boolean(raw?.avoidFerries),
        avoidUnpaved: Boolean(raw?.avoidUnpaved)
    };
};

export const modeCapability = ({ mode, provider }) => {
    if (mode === 'fastest') return { requested: mode, status: 'applied', note: 'Varsayılan süre odaklı rota.' };
    if (mode === 'shortest') return { requested: mode, status: 'not_supported', note: 'Aktif sağlayıcıda gerçek mesafe önceliği yok.' };
    if (['scenic', 'curvy', 'coastal', 'mountain', 'camping', 'night_ride', 'cafe_ride', 'discovery'].includes(mode)) {
        return { requested: mode, status: 'analysis_only', note: `${provider} bu modu doğrudan rota ağırlığı olarak desteklemiyor; rota sonrası analiz uygulanır.` };
    }
    return { requested: mode, status: 'not_supported', note: 'Bilinmeyen rota modu.' };
};
