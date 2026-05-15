
import { Coordinate, BenchResult } from '../types';
import { calculateSunScore, getBuildingsForArea } from './shadeService';

const getDistanceMeters = (p1: Coordinate, p2: Coordinate): number => {
  const R = 6371e3; // meters
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

export const findSunnyBenches = async (
  center: Coordinate,
  radiusMeters: number = 1000,
  date: Date = new Date()
): Promise<BenchResult[]> => {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(center.lat * (Math.PI / 180)));

  const s = center.lat - latDelta, w = center.lng - lngDelta, n = center.lat + latDelta, e = center.lng + lngDelta;
  
  const query = `[out:json][timeout:25];(node["amenity"="bench"](${s},${w},${n},${e});way["amenity"="bench"](${s},${w},${n},${e});node["leisure"="park_bench"](${s},${w},${n},${e}););out body center;`;
  
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
    "https://overpass.osm.ch/api/interpreter"
  ];

  let data = null;
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint + "?data=" + encodeURIComponent(query));
      if (response.ok) {
        data = await response.json();
        break;
      }
    } catch (err) {
      lastError = err;
      console.warn(`Overpass mirror ${endpoint} failed, trying next...`);
    }
  }

  if (!data) {
    throw new Error("OpenStreetMap servers are currently busy or unreachable across all mirrors. Please try again in a few moments.");
  }

  if (!data.elements || data.elements.length === 0) return [];
  
  const rawBenches = data.elements
    .filter((el: any) => el.lat || el.center?.lat)
    .map((el: any) => ({
      id: el.id.toString(),
      coordinate: {
        lat: el.lat || el.center?.lat,
        lng: el.lon || el.center?.lon
      },
      name: el.tags?.name || 'Public Bench',
      distanceMeters: getDistanceMeters(center, { 
        lat: el.lat || el.center?.lat, 
        lng: el.lon || el.center?.lon 
      })
    }))
    .filter((b: any) => b.distanceMeters <= radiusMeters);

  // CRITICAL OPTIMIZATION: Fetch buildings ONCE for the whole area
  const buildings = await getBuildingsForArea(center);

  // Parallel shadow processing with pre-fetched buildings passed in
  const benchPromises = rawBenches.map(async (bench: any) => {
    try {
      const sunScore = await calculateSunScore([bench.coordinate], date, 1, buildings);
      return {
        ...bench,
        isSunny: sunScore > 50
      };
    } catch (e) {
      return { ...bench, isSunny: false };
    }
  });

  const results = await Promise.all(benchPromises);
  return results.filter(bench => bench.isSunny).sort((a, b) => a.distanceMeters - b.distanceMeters);
};
