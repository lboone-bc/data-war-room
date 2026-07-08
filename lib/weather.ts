import type { LocalWeatherForecast, LocalWeatherState } from "@/lib/types";

const ARDEN_POINTS_URL = "https://api.weather.gov/points/35.4665,-82.5165";
const LOCATION_LABEL = "Arden, NC";
const USER_AGENT = "Data Monitoring Room local weather wallboard";
const CACHE_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 8000;

const EMPTY_WEATHER: LocalWeatherState = {
  status: "degraded",
  message: "Weather feed unavailable.",
  location: LOCATION_LABEL,
  updatedAt: null,
  current: {
    temperatureF: null,
    condition: null,
    humidity: null,
    windMph: null,
    windDirection: null,
    observedAt: null,
    station: null
  },
  forecast: []
};

let cachedWeather: { value: LocalWeatherState; at: number } | null = null;
let pendingWeather: Promise<LocalWeatherState> | null = null;

type NwsQuantitativeValue = {
  value?: unknown;
};

type NwsForecastPeriod = {
  name?: unknown;
  startTime?: unknown;
  isDaytime?: unknown;
  temperature?: unknown;
  temperatureUnit?: unknown;
  shortForecast?: unknown;
  windSpeed?: unknown;
  windDirection?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function celsiusToFahrenheit(value: number | null) {
  return value === null ? null : Math.round((value * 9) / 5 + 32);
}

function kmhToMph(value: number | null) {
  return value === null ? null : Math.round(value * 0.621371);
}

function directionFromDegrees(value: number | null) {
  if (value === null) return null;
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(value / 45) % directions.length];
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "accept": "application/geo+json, application/json",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": USER_AGENT
    }
  });

  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
}

function getPropertyUrl(record: unknown, key: string) {
  if (!record || typeof record !== "object") return null;
  const properties = (record as Record<string, unknown>).properties;
  if (!properties || typeof properties !== "object") return null;
  return stringValue((properties as Record<string, unknown>)[key]);
}

function parseStationId(stations: unknown) {
  if (!stations || typeof stations !== "object") return null;
  const features = (stations as Record<string, unknown>).features;
  if (!Array.isArray(features)) return null;

  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const properties = (feature as Record<string, unknown>).properties;
    if (!properties || typeof properties !== "object") continue;
    const id = stringValue((properties as Record<string, unknown>).stationIdentifier);
    if (id) return id;
  }

  return null;
}

function parseCurrent(observation: unknown, station: string | null): LocalWeatherState["current"] {
  if (!observation || typeof observation !== "object") {
    return { ...EMPTY_WEATHER.current, station };
  }

  const properties = (observation as Record<string, unknown>).properties;
  if (!properties || typeof properties !== "object") {
    return { ...EMPTY_WEATHER.current, station };
  }

  const record = properties as Record<string, unknown>;
  const temperature = record.temperature as NwsQuantitativeValue | undefined;
  const humidity = record.relativeHumidity as NwsQuantitativeValue | undefined;
  const windSpeed = record.windSpeed as NwsQuantitativeValue | undefined;
  const windDirection = record.windDirection as NwsQuantitativeValue | undefined;

  return {
    temperatureF: celsiusToFahrenheit(numberValue(temperature?.value)),
    condition: stringValue(record.textDescription),
    humidity: Math.round(numberValue(humidity?.value) ?? NaN) || null,
    windMph: kmhToMph(numberValue(windSpeed?.value)),
    windDirection: directionFromDegrees(numberValue(windDirection?.value)),
    observedAt: stringValue(record.timestamp),
    station
  };
}

function isForecastPeriod(value: unknown): value is NwsForecastPeriod {
  return Boolean(value && typeof value === "object");
}

function parseForecast(forecast: unknown): LocalWeatherForecast[] {
  if (!forecast || typeof forecast !== "object") return [];
  const properties = (forecast as Record<string, unknown>).properties;
  if (!properties || typeof properties !== "object") return [];
  const periods = (properties as Record<string, unknown>).periods;
  if (!Array.isArray(periods)) return [];

  const cleanPeriods = periods.filter(isForecastPeriod);
  const cards: LocalWeatherForecast[] = [];

  for (let index = 0; index < cleanPeriods.length && cards.length < 3; index += 1) {
    const period = cleanPeriods[index];
    const isDaytime = period.isDaytime === true;

    if (!isDaytime && cards.length > 0) continue;

    const nextPeriod = cleanPeriods[index + 1];
    const nightPeriod =
      isDaytime && nextPeriod?.isDaytime === false ? nextPeriod : null;
    const temp = numberValue(period.temperature);
    const nightTemp = numberValue(nightPeriod?.temperature);
    const windSpeed = stringValue(period.windSpeed);
    const windDirection = stringValue(period.windDirection);

    cards.push({
      name: stringValue(period.name) ?? "Forecast",
      startTime: stringValue(period.startTime) ?? new Date().toISOString(),
      highF: isDaytime ? temp : null,
      lowF: isDaytime ? nightTemp : temp,
      summary: stringValue(period.shortForecast) ?? "Forecast pending",
      nightSummary: nightPeriod ? stringValue(nightPeriod.shortForecast) : null,
      wind: windSpeed ? `${windDirection ? `${windDirection} ` : ""}${windSpeed}` : null
    });
  }

  return cards;
}

export async function getArdenWeather(): Promise<LocalWeatherState> {
  const now = Date.now();
  if (cachedWeather && now - cachedWeather.at < CACHE_MS) {
    return cachedWeather.value;
  }

  if (pendingWeather) return pendingWeather;

  pendingWeather = fetchArdenWeather().finally(() => {
    pendingWeather = null;
  });

  return pendingWeather;
}

async function fetchArdenWeather(): Promise<LocalWeatherState> {
  const lastGood = cachedWeather?.value ?? EMPTY_WEATHER;

  try {
    const points = await fetchJson(ARDEN_POINTS_URL);
    const forecastUrl = getPropertyUrl(points, "forecast");
    const stationsUrl = getPropertyUrl(points, "observationStations");
    if (!forecastUrl || !stationsUrl) return lastGood;

    const [forecastResult, stationsResult] = await Promise.allSettled([
      fetchJson(forecastUrl),
      fetchJson(stationsUrl)
    ]);
    const forecast =
      forecastResult.status === "fulfilled" ? parseForecast(forecastResult.value) : [];
    const station =
      stationsResult.status === "fulfilled" ? parseStationId(stationsResult.value) : null;

    const observation = station
      ? await fetchJson(`https://api.weather.gov/stations/${station}/observations/latest`).catch(
          () => null
        )
      : null;
    const current = parseCurrent(observation, station);
    const hasCurrent = current.temperatureF !== null || Boolean(current.condition);
    const status = forecast.length && hasCurrent ? "live" : "degraded";
    const value: LocalWeatherState = {
      status,
      message:
        status === "live"
          ? null
          : "Weather is partially available; showing latest cached/forecast data.",
      location: LOCATION_LABEL,
      updatedAt: new Date().toISOString(),
      current,
      forecast
    };

    cachedWeather = { value, at: Date.now() };
    return value;
  } catch {
    return lastGood;
  }
}
