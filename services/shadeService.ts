
import { Coordinate } from '../types';

/**
 * Advanced Astronomical Sun Position Algorithm.
 */
export const getSunPosition = (date: Date, lat: number, lng: number) => {
  const rad = Math.PI / 180;
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  const gamma = (2 * Math.PI / 365) * (day - 1 + (date.getHours() - 12) / 24);

  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) 
                 - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));

  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) 
               - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma);

  const timeOffset = eqtime + 4 * lng - 60 * (date.getTimezoneOffset() / -60);
  const tminutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + timeOffset;
  const solarTime = tminutes % 1440;
  const ha = (solarTime / 4) - 180;

  const latRad = lat * rad;
  // CRITICAL FIX: The formula for sin(altitude) uses cos(hour_angle), not sin.
  const alt = Math.asin(Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(ha * rad));
  const cosAz = (Math.sin(decl) - Math.sin(alt) * Math.sin(latRad)) / (Math.cos(alt) * Math.cos(latRad));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / rad;
  if (ha > 0) az = 360 - az;

  return { altitude: alt / rad, azimuth: az };
};

export const getSunPositionFixed = (date: Date, lat: number, lng: number) => {
  return getSunPosition(date, lat, lng);
};

export const isPointInPolygon = (point: [number, number], vs: [number, number][]) => {
  if (!vs || !vs.length) return false;
  let x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i][0], yi = vs[i][1];
    let xj = vs[j][0], yj = vs[j][1];
    let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

let cachedBuildings: any[] = [];
let lastCacheCenter: Coordinate | null = null;

export const getBuildingsForArea = async (center: Coordinate): Promise<any[]> => {
  if (lastCacheCenter) {
    const dist = Math.sqrt(Math.pow(center.lat - lastCacheCenter.lat, 2) + Math.pow(center.lng - lastCacheCenter.lng, 2));
    if (dist < 0.005 && cachedBuildings.length > 0) return cachedBuildings;
  }

  const radius = 0.015;
  const s = center.lat - radius, w = center.lng - radius, n = center.lat + radius, e = center.lng + radius;
  const query = `[out:json][timeout:60];(way["building"](${s},${w},${n},${e});relation["building"](${s},${w},${n},${e}););out body;>;out skel qt;`;
  
  const endpoints = [
    "https://overpass-api.de/api/interpreter", 
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
    "https://overpass.osm.ch/api/interpreter"
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint + "?data=" + encodeURIComponent(query));
      if (!response.ok) continue;
      const osmData = await response.json();
      const geojson = (window as any).osmtogeojson(osmData);
      
      const buildings = geojson.features.map((f: any) => {
        const t = f.properties?.tags || f.properties || {};
        let height = 18; 
        let minHeight = 0;
        let isGuessed = false;
        let guessLabel = null;

        if (t.height) {
          height = parseFloat(t.height);
          isGuessed = false;
        }
        else if (t["building:levels"]) {
          height = (parseInt(t["building:levels"]) * 3.8) + 3;
          isGuessed = false;
        }
        else {
          isGuessed = true;
          switch(t.building) {
            case 'apartments': height = 25; guessLabel = 'apartments'; break;
            case 'church': height = 35; guessLabel = 'church'; break;
            case 'commercial': height = 28; guessLabel = 'commercial'; break;
            case 'office': height = 35; guessLabel = 'office'; break;
            case 'house': height = 10; guessLabel = 'house'; break;
            default: height = 20; guessLabel = 'none';
          }
        }
        if (t.min_height) minHeight = parseFloat(t.min_height);

        let centerLat = 0, centerLng = 0;
        let count = 0;
        if (f.geometry.type === 'Polygon') {
          f.geometry.coordinates[0].forEach((c: any) => { centerLng += c[0]; centerLat += c[1]; count++; });
        } else if (f.geometry.type === 'MultiPolygon') {
          f.geometry.coordinates[0][0].forEach((c: any) => { centerLng += c[0]; centerLat += c[1]; count++; });
        }
        
        const center = count > 0 ? { lat: centerLat / count, lng: centerLng / count } : null;

        return { 
          ...f, 
          properties: { ...f.properties, height, minHeight, isGuessed, guessLabel, center } 
        };
      });

      cachedBuildings = buildings;
      lastCacheCenter = center;
      return buildings;
    } catch (err) { 
      console.warn(`Overpass mirror ${endpoint} failed for buildings, trying next...`);
    }
  }
  return cachedBuildings;
};

export const calculateSunScore = async (
  path: Coordinate[], 
  date: Date = new Date(), 
  step: number = 1,
  preFetchedBuildings?: any[]
): Promise<number> => {
  if (!path || path.length === 0) return 0;
  
  const buildings = preFetchedBuildings || await getBuildingsForArea(path[0]);
  const sun = getSunPositionFixed(date, path[0].lat, path[0].lng);
  
  if (sun.altitude <= 0) return 0; 

  const tanAlt = Math.tan(sun.altitude * (Math.PI / 180));
  const azRad = sun.azimuth * (Math.PI / 180); 
  const dx = Math.sin(azRad), dy = Math.cos(azRad);
  
  const latConv = 111320; 
  const lngConv = 111320 * Math.cos(path[0].lat * (Math.PI / 180));

  let sunnyPoints = 0;
  let totalPoints = 0;

  for (let i = 0; i < path.length; i += step) {
    const p = path[i];
    if (!p) continue;
    totalPoints++;
    let inShadow = false;

    for (const b of buildings) {
      if (!b.properties || !b.geometry) continue;

      const h = b.properties.height;
      const mh = b.properties.minHeight || 0;
      const polys = b.geometry.type === 'Polygon' ? [b.geometry.coordinates] : b.geometry.coordinates;

      if (!polys || !polys.length) continue;

      const maxShadowReach = h / tanAlt;
      const minShadowReach = mh / tanAlt;

      for (const poly of polys) {
        if (!poly || !poly[0]) continue;
        const ring = poly[0];
        if (isPointInPolygon([p.lng, p.lat], ring)) { inShadow = true; break; }

        const maxCheckDist = Math.min(maxShadowReach, 400); 
        const sampleStepMeters = 5;
        const samples = Math.ceil(maxCheckDist / sampleStepMeters);

        for (let s = 1; s <= samples; s++) {
          const dist = minShadowReach + (sampleStepMeters * s);
          if (dist > maxShadowReach) break;

          const tx = p.lng + (dist * dx) / lngConv;
          const ty = p.lat + (dist * dy) / latConv;
          
          if (isPointInPolygon([tx, ty], ring)) { inShadow = true; break; }
        }
        if (inShadow) break;
      }
      if (inShadow) break;
    }

    if (!inShadow) sunnyPoints++;
  }
  
  return totalPoints > 0 ? (sunnyPoints / totalPoints) * 100 : 0;
};
