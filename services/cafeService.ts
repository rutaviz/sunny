import { CafeResult, Coordinate } from '../types';
import { calculateSunScore, getBuildingsForArea, getSunPosition } from './shadeService';

const SUNNY_THRESHOLD = 50;
const CHECK_INTERVAL_MIN = 10;
const MAX_FORECAST_MIN = 8 * 60;

const getDistanceMeters = (p1: Coordinate, p2: Coordinate): number => {
  const R = 6371e3;
  const phi1 = (p1.lat * Math.PI) / 180;
  const phi2 = (p2.lat * Math.PI) / 180;
  const deltaPhi = ((p2.lat - p1.lat) * Math.PI) / 180;
  const deltaLambda = ((p2.lng - p1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

const dedupeKey = (lat: number, lng: number) =>
  `${Math.round(lat * 1000)}_${Math.round(lng * 1000)}`;

const getPlaceName = (tags: Record<string, string> | undefined): string => {
  if (!tags) return 'Outdoor spot';
  return tags.name || tags['name:en'] || tags.brand || 'Outdoor spot';
};

export const estimateSunnyMinutesRemaining = async (
  coordinate: Coordinate,
  date: Date,
  buildings: any[]
): Promise<number> => {
  const nowScore = await calculateSunScore([coordinate], date, 1, buildings);
  if (nowScore <= SUNNY_THRESHOLD) return 0;

  const sunNow = getSunPosition(date, coordinate.lat, coordinate.lng);
  if (sunNow.altitude <= 0) return 0;

  for (let step = 1; step <= MAX_FORECAST_MIN / CHECK_INTERVAL_MIN; step++) {
    const future = new Date(date.getTime() + step * CHECK_INTERVAL_MIN * 60 * 1000);
    const sun = getSunPosition(future, coordinate.lat, coordinate.lng);
    if (sun.altitude <= 0) {
      return step * CHECK_INTERVAL_MIN;
    }

    const score = await calculateSunScore([coordinate], future, 1, buildings);
    if (score <= SUNNY_THRESHOLD) {
      return Math.max(0, (step - 1) * CHECK_INTERVAL_MIN);
    }
  }

  return MAX_FORECAST_MIN;
};

export const findSunnyCafes = async (
  center: Coordinate,
  radiusMeters: number = 1000,
  date: Date = new Date()
): Promise<CafeResult[]> => {
  const query = `[out:json][timeout:25];(
    node["amenity"~"cafe|restaurant|bar|biergarten|fast_food|ice_cream"](around:${radiusMeters},${center.lat},${center.lng});
    way["amenity"~"cafe|restaurant|bar|biergarten|fast_food|ice_cream"](around:${radiusMeters},${center.lat},${center.lng});
    node["shop"~"cafe|coffee|bakery|ice_cream"](around:${radiusMeters},${center.lat},${center.lng});
    way["shop"~"cafe|coffee|bakery|ice_cream"](around:${radiusMeters},${center.lat},${center.lng});
    node["outdoor_seating"="yes"](around:${radiusMeters},${center.lat},${center.lng});
    way["outdoor_seating"="yes"](around:${radiusMeters},${center.lat},${center.lng});
    node["terrace"="yes"](around:${radiusMeters},${center.lat},${center.lng});
    way["terrace"="yes"](around:${radiusMeters},${center.lat},${center.lng});
  );out body center;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.nchc.org.tw/api/interpreter',
    'https://overpass.osm.ch/api/interpreter'
  ];

  let data: any = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);
      if (response.ok) {
        data = await response.json();
        break;
      }
    } catch (err) {
      console.warn(`Overpass mirror ${endpoint} failed, trying next...`, err);
    }
  }

  if (!data) {
    throw new Error('OpenStreetMap cafe search is temporarily unavailable. Please try again in a few moments.');
  }

  if (!data.elements || data.elements.length === 0) return [];

  const deduped = new Map<string, { id: string; coordinate: Coordinate; name: string; distanceMeters: number }>();

  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;

    const distanceMeters = getDistanceMeters(center, { lat, lng });
    if (distanceMeters > radiusMeters) continue;

    const key = dedupeKey(lat, lng);
    const name = getPlaceName(el.tags);
    const existing = deduped.get(key);
    if (existing && existing.name !== 'Outdoor spot' && name === 'Outdoor spot') continue;

    deduped.set(key, {
      id: `${el.type}-${el.id}`,
      coordinate: { lat, lng },
      name,
      distanceMeters
    });
  }

  const rawCafes = Array.from(deduped.values());
  const buildings = await getBuildingsForArea(center);

  const cafePromises = rawCafes.map(async (cafe) => {
    try {
      const sunScore = await calculateSunScore([cafe.coordinate], date, 1, buildings);
      const sunnyMinutesRemaining = await estimateSunnyMinutesRemaining(cafe.coordinate, date, buildings);
      return {
        ...cafe,
        sunScore,
        isSunny: sunScore > SUNNY_THRESHOLD,
        sunnyMinutesRemaining
      };
    } catch {
      return {
        ...cafe,
        sunScore: 0,
        isSunny: false,
        sunnyMinutesRemaining: 0
      };
    }
  });

  const results = await Promise.all(cafePromises);
  return results.sort((a, b) => {
    if (a.isSunny !== b.isSunny) return a.isSunny ? -1 : 1;
    if (b.sunScore !== a.sunScore) return b.sunScore - a.sunScore;
    return a.distanceMeters - b.distanceMeters;
  });
};
