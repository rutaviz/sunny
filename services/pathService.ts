
import { Coordinate, PathResult } from '../types';
import { EARTH_RADIUS_KM, AVERAGE_WALKING_SPEED_KMH } from '../constants';
import { calculateSunScore, getBuildingsForArea, getSunPosition } from './shadeService';

const toRadians = (degrees: number) => degrees * (Math.PI / 180);
const toDegrees = (radians: number) => radians * (180 / Math.PI);

const getDistance = (p1: Coordinate, p2: Coordinate): number => {
  const dLat = toRadians(p2.lat - p1.lat);
  const dLng = toRadians(p2.lng - p1.lng);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRadians(p1.lat)) * Math.cos(toRadians(p2.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const destinationPoint = (start: Coordinate, distanceKm: number, bearingDegrees: number): Coordinate => {
  const dist = distanceKm / EARTH_RADIUS_KM;
  const brng = toRadians(bearingDegrees);
  const lat1 = toRadians(start.lat);
  const lon1 = toRadians(start.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist) + Math.cos(lat1) * Math.sin(dist) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(dist) * Math.cos(lat1), Math.cos(dist) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDegrees(lat2), lng: toDegrees(lon2) };
};

export const fetchRoadBasedPath = async (start: Coordinate, waypoints: Coordinate[]) => {
  const allCoords = [start, ...waypoints, start];
  const coordString = allCoords.map(c => `${c.lng},${c.lat}`).join(';');
  const baseUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordString}?overview=full&geometries=geojson&continue_straight=false`;

  try {
    const snapTiers = ['60', '150', '300']; 
    let data = null;
    for (const tier of snapTiers) {
      const radiusString = allCoords.map(() => tier).join(';');
      const response = await fetch(`${baseUrl}&radiuses=${radiusString}`);
      if (!response.ok) continue;
      data = await response.json();
      if (data && data.routes && data.routes.length > 0) break;
    }
    
    if (data && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const rawCoords = route.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
      let finalDistKm = 0;
      for (let i = 0; i < rawCoords.length - 1; i++) {
        finalDistKm += getDistance(rawCoords[i], rawCoords[i + 1]);
      }
      return {
        coordinates: rawCoords,
        actualDurationMin: Math.round((finalDistKm / AVERAGE_WALKING_SPEED_KMH) * 60),
        actualDistanceKm: finalDistKm
      };
    }
    return null;
  } catch (error) { return null; }
};

export const findOptimalSunnyPath = async (
  start: Coordinate, 
  durationMin: number, 
  onProgress: (msg: string) => void,
  simulationDate?: Date
): Promise<PathResult> => {
  const date = simulationDate || new Date();
  onProgress("Scanning skyline for sunlight...");
  
  const buildings = await getBuildingsForArea(start);
  const sun = getSunPosition(date, start.lat, start.lng);
  
  if (sun.altitude <= 0) {
    throw new Error("The sun is currently below the horizon. Try simulating a different time of day.");
  }

  const targetDistanceKm = (durationMin / 60) * AVERAGE_WALKING_SPEED_KMH;
  const baseSideLength = targetDistanceKm / 4.0; 
  
  let bestCandidate: PathResult | null = null;
  let maxEffectiveScore = -Infinity;
  
  const scouts: PathResult[] = [];
  const sunAz = sun.azimuth;

  // Search bearings: every 30 degrees + sun direction
  const bearings = Array.from({ length: 12 }, (_, i) => (i * 30) % 360);
  if (!bearings.includes(Math.round(sunAz))) bearings.push(Math.round(sunAz));

  for (let i = 0; i < bearings.length; i++) {
    const bearing = bearings[i];
    onProgress(`Scouting routes... (${Math.round((i / bearings.length) * 100)}%)`);

    // Try a loop in this direction
    const p1 = destinationPoint(start, baseSideLength * 1.2, (bearing - 25 + 360) % 360);
    const p2 = destinationPoint(start, baseSideLength * 1.2, (bearing + 25) % 360);
    
    const roadData = await fetchRoadBasedPath(start, [p1, p2]);
    if (!roadData) continue;

    const sunScore = await calculateSunScore(roadData.coordinates, date, 4, buildings);
    
    const scoutPath: PathResult = {
      id: `scout-${bearing}`,
      coordinates: roadData.coordinates,
      sunScore: sunScore,
      durationMinutes: roadData.actualDurationMin,
      distanceKm: roadData.actualDistanceKm
    };

    const durationDiff = Math.abs(scoutPath.durationMinutes - durationMin);
    const durationPenalty = durationDiff > 10 ? (durationDiff - 10) * 2 : 0;
    
    // Heuristic: Prefer high sunlight, penalize duration mismatches
    const effectiveScore = sunScore - durationPenalty;

    if (effectiveScore > maxEffectiveScore) {
      maxEffectiveScore = effectiveScore;
      bestCandidate = scoutPath;
    }
    
    // Always include the path if it has some sunlight
    if (sunScore > 1) {
      scouts.push(scoutPath);
    }
  }

  if (!bestCandidate) {
    if (scouts.length > 0) {
       bestCandidate = scouts.sort((a,b) => b.sunScore - a.sunScore)[0];
    } else {
       throw new Error("Unable to map a sunny loop here. Try a different duration or starting spot.");
    }
  }

  onProgress("Polishing route...");
  // Full resolution score for the winner
  const finalSunScore = await calculateSunScore(bestCandidate.coordinates, date, 1, buildings);

  return { ...bestCandidate, sunScore: finalSunScore, allScouts: scouts };
};
