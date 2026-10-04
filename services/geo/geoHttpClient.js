const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

import { assertProviderAvailable, recordProviderResult } from './geoProviderMonitor.js';

export class GeoProviderError extends Error {
    constructor(provider, message, { statusCode, retryable = false, cause } = {}) {
        super(message);
        this.name = 'GeoProviderError';
        this.provider = provider;
        this.statusCode = statusCode;
        this.retryable = retryable;
        this.cause = cause;
    }
}

const request = async ({
    provider,
    url,
    options = {},
    timeoutMs = 8000,
    retries = 1,
    requestId = 'unknown',
    responseType = 'json'
}) => {
    let lastError;
    try {
        assertProviderAvailable(provider);
    } catch (error) {
        throw new GeoProviderError(provider, `${provider} gecici olarak kullanilamiyor.`, {
            statusCode: error.statusCode || 503,
            retryable: true,
            cause: error
        });
    }

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const startedAt = Date.now();
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    Accept: responseType === 'text' ? 'text/csv,text/plain;q=0.9,*/*;q=0.8' : 'application/json',
                    'X-Request-Id': requestId,
                    ...(options.headers || {})
                },
                signal: AbortSignal.timeout(timeoutMs)
            });
            const body = responseType === 'text'
                ? await response.text().catch(() => '')
                : await response.json().catch(() => null);
            const retryable = response.status === 429 || response.status >= 500;

            console.info('[GeoProvider]', {
                provider,
                requestId,
                status: response.status,
                latencyMs: Date.now() - startedAt,
                attempt
            });

            if (!response.ok) {
                throw new GeoProviderError(provider, `${provider} istegi basarisiz oldu.`, {
                    statusCode: response.status,
                    retryable,
                    cause: body
                });
            }
            recordProviderResult({ provider, success: true, latencyMs: Date.now() - startedAt, statusCode: response.status });
            return body;
        } catch (error) {
            lastError = error instanceof GeoProviderError
                ? error
                : new GeoProviderError(provider, `${provider} kullanilamiyor.`, {
                    retryable: error?.name === 'TimeoutError' || error?.name === 'AbortError',
                    cause: error
                });
            if (!lastError.retryable || attempt === retries) break;
            await sleep(250 * (2 ** attempt));
        }
    }

    recordProviderResult({
        provider,
        success: false,
        latencyMs: undefined,
        statusCode: lastError?.statusCode,
        retryable: lastError?.retryable === true
    });
    throw lastError;
};

export const requestJson = (options) => request({ ...options, responseType: 'json' });

export const requestText = (options) => request({ ...options, responseType: 'text' });
