import { geoConfig } from './geoConfig.js';

const states = new Map();

const stateFor = (provider) => {
    if (!states.has(provider)) {
        states.set(provider, {
            requests: 0,
            successes: 0,
            failures: 0,
            consecutiveRetryableFailures: 0,
            lastStatusCode: null,
            lastLatencyMs: null,
            lastSuccessAt: null,
            lastFailureAt: null,
            circuitOpenUntil: null
        });
    }
    return states.get(provider);
};

export const assertProviderAvailable = (provider) => {
    const state = stateFor(provider);
    if (state.circuitOpenUntil && state.circuitOpenUntil > Date.now()) {
        const error = new Error(`${provider} gecici olarak devre disi.`);
        error.code = 'PROVIDER_CIRCUIT_OPEN';
        error.statusCode = 503;
        throw error;
    }
    if (state.circuitOpenUntil) state.circuitOpenUntil = null;
};

export const recordProviderResult = ({ provider, success, latencyMs, statusCode, retryable = false }) => {
    const state = stateFor(provider);
    state.requests += 1;
    state.lastLatencyMs = Number.isFinite(latencyMs) ? latencyMs : null;
    state.lastStatusCode = Number.isFinite(statusCode) ? statusCode : null;
    if (success) {
        state.successes += 1;
        state.consecutiveRetryableFailures = 0;
        state.lastSuccessAt = new Date().toISOString();
        return;
    }

    state.failures += 1;
    state.lastFailureAt = new Date().toISOString();
    if (!retryable) return;
    state.consecutiveRetryableFailures += 1;
    const config = geoConfig();
    if (state.consecutiveRetryableFailures >= config.limits.providerCircuitFailureThreshold) {
        state.circuitOpenUntil = Date.now() + config.limits.providerCircuitCooldownSeconds * 1000;
    }
};

export const getGeoProviderMetrics = () => Object.fromEntries([...states.entries()].map(([provider, state]) => [provider, {
    requests: state.requests,
    successes: state.successes,
    failures: state.failures,
    successRate: state.requests ? Number((state.successes / state.requests).toFixed(3)) : null,
    consecutiveRetryableFailures: state.consecutiveRetryableFailures,
    lastStatusCode: state.lastStatusCode,
    lastLatencyMs: state.lastLatencyMs,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    circuit: state.circuitOpenUntil && state.circuitOpenUntil > Date.now() ? 'open' : 'closed'
}]));

export const resetGeoProviderMetricsForTest = () => states.clear();
