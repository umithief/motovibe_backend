import { geoConfig } from '../geoConfig.js';
import { cacheKey, getCached, setCached } from '../geoCache.js';
import { requestJson } from '../geoHttpClient.js';

const average = (values) => {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return null;
    return valid.reduce((total, value) => total + value, 0) / valid.length;
};

const toNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const valueAt = (values, index) => Array.isArray(values) ? toNumber(values[index]) : null;

const summarizeHourlyForecast = (entries, limit = 6) => {
    const byTime = new Map();
    for (const entry of entries) {
        const hourly = entry?.hourly || {};
        const times = Array.isArray(hourly.time) ? hourly.time : [];
        const currentTime = entry?.current?.time;
        const currentIndex = Math.max(0, times.indexOf(currentTime));
        for (let index = currentIndex; index < Math.min(times.length, currentIndex + limit); index += 1) {
            const time = times[index];
            if (!time) continue;
            const bucket = byTime.get(time) || [];
            bucket.push({
                temperature: valueAt(hourly.temperature_2m, index),
                feelsLikeTemperature: valueAt(hourly.apparent_temperature, index),
                precipitation: valueAt(hourly.precipitation, index),
                precipitationProbability: valueAt(hourly.precipitation_probability, index),
                windSpeed: valueAt(hourly.wind_speed_10m, index),
                windGusts: valueAt(hourly.wind_gusts_10m, index),
                visibilityMeters: valueAt(hourly.visibility, index),
                weatherCode: valueAt(hourly.weather_code, index)
            });
            byTime.set(time, bucket);
        }
    }
    return [...byTime.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit)
        .map(([time, values]) => ({
            time,
            temperature: average(values.map((value) => value.temperature)),
            feelsLikeTemperature: average(values.map((value) => value.feelsLikeTemperature)),
            precipitation: average(values.map((value) => value.precipitation)),
            precipitationProbability: average(values.map((value) => value.precipitationProbability)),
            windSpeed: average(values.map((value) => value.windSpeed)),
            windGusts: average(values.map((value) => value.windGusts)),
            visibilityMeters: average(values.map((value) => value.visibilityMeters)),
            weatherCodes: [...new Set(values.map((value) => value.weatherCode).filter(Number.isFinite))]
        }));
};

export const summarizeRouteWeather = (entries) => {
    const hourly = summarizeHourlyForecast(entries);
    const currentRainProbability = average(entries.map((item) => toNumber(item?.current?.precipitation_probability)));
    return {
        available: true,
        temperature: average(entries.map((item) => toNumber(item?.current?.temperature_2m))),
        feelsLikeTemperature: average(entries.map((item) => toNumber(item?.current?.apparent_temperature))),
        precipitation: average(entries.map((item) => toNumber(item?.current?.precipitation))),
        precipitationProbability: currentRainProbability ?? hourly[0]?.precipitationProbability ?? null,
        windSpeed: average(entries.map((item) => toNumber(item?.current?.wind_speed_10m))),
        windGusts: average(entries.map((item) => toNumber(item?.current?.wind_gusts_10m))),
        visibilityMeters: average(entries.map((item) => toNumber(item?.current?.visibility))),
        weatherCodes: [...new Set(entries.map((item) => item?.current?.weather_code).filter(Number.isFinite))],
        hourly,
        sampledPoints: entries.length
    };
};

export const getRouteWeather = async ({ samples, requestId = 'unknown' }) => {
    if (!samples?.length) return { available: false, reason: 'route_geometry_missing' };
    const key = cacheKey('weather', 'v2', samples.map((point) => `${point.lat.toFixed(2)},${point.lng.toFixed(2)}`).join('|'));
    const cached = await getCached(key);
    if (cached) return { ...cached, cached: true };

    const { providers } = geoConfig();
    const url = new URL(`${providers.openMeteoUrl}/forecast`);
    url.search = new URLSearchParams({
        latitude: samples.map((point) => point.lat.toFixed(4)).join(','),
        longitude: samples.map((point) => point.lng.toFixed(4)).join(','),
        current: 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,visibility,weather_code',
        hourly: 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,visibility,weather_code',
        forecast_days: '1',
        timezone: 'auto'
    }).toString();
    const payload = await requestJson({ provider: 'open_meteo', url, requestId, retries: 1 });
    const entries = Array.isArray(payload) ? payload : [payload];
    const summary = summarizeRouteWeather(entries);
    await setCached(key, summary, 15 * 60);
    return summary;
};
