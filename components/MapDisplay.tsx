
import React, { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Coordinate, PathResult, BenchResult, CafeResult, AppMode } from '../types';
import { SHADEMAP_API_KEY } from '../constants';
import { calculateSunScore, getBuildingsForArea } from '../services/shadeService';
import MapUserIcon from './MapUserIcon';

declare const L: any;

const USER_MARKER_SIZE_PX = 80;
const MAP_FIT_AFTER_SLIDE_MS = 2050;
const PATH_PANEL_SIDE_PAD = 48;
const PATH_PANEL_BOTTOM_PAD = 180;
const SHADOW_REFRESH_MIN_DISTANCE_DEG = 0.0025;
const SHADOW_REFRESH_MIN_INTERVAL_MS = 3500;

const PATH_DOT_RADIUS_PX = 7;
/** Center-to-center: diameter + gap (gap = one circle width) */
const PATH_DOT_CENTER_SPACING_PX = PATH_DOT_RADIUS_PX * 4;

type ScreenPoint = { x: number; y: number };

const pixelDist = (a: ScreenPoint, b: ScreenPoint) =>
  Math.hypot(b.x - a.x, b.y - a.y);

const interpolatePixel = (a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});

const samplePathByPixelSpacing = (
  map: any,
  coords: Coordinate[],
  spacingPx: number
): Coordinate[] => {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [coords[0]];

  const screenPts: ScreenPoint[] = coords.map((c) => {
    const p = map.latLngToContainerPoint([c.lat, c.lng]);
    return { x: p.x, y: p.y };
  });

  let totalPx = 0;
  for (let i = 1; i < screenPts.length; i++) {
    totalPx += pixelDist(screenPts[i - 1], screenPts[i]);
  }

  const toCoord = (pt: ScreenPoint): Coordinate => {
    const ll = map.containerPointToLatLng(L.point(pt.x, pt.y));
    return { lat: ll.lat, lng: ll.lng };
  };

  const pointAtPixelDistance = (distPx: number): ScreenPoint => {
    let acc = 0;
    for (let i = 1; i < screenPts.length; i++) {
      const seg = pixelDist(screenPts[i - 1], screenPts[i]);
      if (seg === 0) continue;
      if (acc + seg >= distPx) {
        const t = (distPx - acc) / seg;
        return interpolatePixel(screenPts[i - 1], screenPts[i], t);
      }
      acc += seg;
    }
    return screenPts[screenPts.length - 1];
  };

  const samples: Coordinate[] = [coords[0]];
  for (let d = spacingPx; d < totalPx; d += spacingPx) {
    samples.push(toCoord(pointAtPixelDistance(d)));
  }

  const end = coords[coords.length - 1];
  const last = samples[samples.length - 1];
  if (last.lat !== end.lat || last.lng !== end.lng) {
    samples.push(end);
  }
  return samples;
};

const addPathDots = (map: any, coords: Coordinate[]) => {
  const group = L.layerGroup();
  samplePathByPixelSpacing(map, coords, PATH_DOT_CENTER_SPACING_PX).forEach((c) => {
    L.circleMarker([c.lat, c.lng], {
      radius: PATH_DOT_RADIUS_PX,
      fillColor: '#8BC957',
      color: '#8BC957',
      weight: 2,
      fillOpacity: 0,
      opacity: 1
    }).addTo(group);
  });
  group.addTo(map);
  return group;
};

interface MapDisplayProps {
  userLocation: Coordinate | null;
  locationSource: 'gps' | 'manual' | 'waiting';
  locationAccuracy: number | null;
  isTracking?: boolean;
  isPinningMode?: boolean;
  showAllScouts?: boolean;
  onUserLocationChange: (coord: Coordinate) => void;
  onLocateMe: () => void;
  onToggleTracking?: (tracking: boolean) => void;
  onSelectScout: (scout: PathResult) => void;
  path: PathResult | null;
  walkedTrail?: Coordinate[];
  benches?: BenchResult[];
  cafes?: CafeResult[];
  mode: AppMode;
  displayDate?: Date;
  isCurrentlySunny?: boolean;
  onNewPath?: () => void;
  onStartWalk?: () => void;
  canCyclePath?: boolean;
}

const formatPathDistance = (km: number) =>
  km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;

const CAFE_SUN_FORECAST_MAX_MIN = 8 * 60;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatSunnyDuration = (minutes: number, isSunny: boolean) => {
  if (!isSunny) return 'Not in sun right now';
  if (minutes <= 0) return 'Sunny now (briefly)';
  if (minutes >= CAFE_SUN_FORECAST_MAX_MIN) return 'Sunny for 8+ hours';
  if (minutes < 60) return `Sunny for ~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `Sunny for ~${hours}h ${mins}m` : `Sunny for ~${hours}h`;
};

const buildCafePopupHtml = (cafe: CafeResult) => {
  const { lat, lng } = cafe.coordinate;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const sunnyLabel = formatSunnyDuration(cafe.sunnyMinutesRemaining, cafe.isSunny);

  return `
    <div class="cafe-popup">
      <p class="cafe-popup-name">${escapeHtml(cafe.name || 'Outdoor spot')}</p>
      <p class="cafe-popup-meta">${Math.round(cafe.distanceMeters)} m away · ${Math.round(cafe.sunScore)}% sun</p>
      <p class="cafe-popup-sun">${sunnyLabel}</p>
      <a class="cafe-popup-link" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Show on Google Maps</a>
    </div>
  `;
};

type ShadowStatus = 'loading' | 'active' | 'error' | 'low-zoom';

const MapDisplay: React.FC<MapDisplayProps> = ({ 
  userLocation, 
  locationSource, 
  locationAccuracy, 
  isTracking, 
  isPinningMode,
  showAllScouts,
  onUserLocationChange, 
  onLocateMe, 
  onToggleTracking,
  onSelectScout,
  path, 
  walkedTrail = [],
  benches,
  cafes,
  mode,
  displayDate,
  isCurrentlySunny,
  onNewPath,
  onStartWalk,
  canCyclePath = false
}) => {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathLayerRef = useRef<any>(null);
  const trailLayerRef = useRef<any>(null);
  const scoutLayersRef = useRef<any[]>([]);
  const benchMarkersRef = useRef<any[]>([]);
  const cafeMarkersRef = useRef<any[]>([]);
  const guessedMarkersRef = useRef<any[]>([]);
  const markerRef = useRef<any>(null);
  const markerRootRef = useRef<Root | null>(null);
  const shadeMapRef = useRef<any>(null);
  const initialCenterSet = useRef<boolean>(false);
  const lastScoredPathId = useRef<string | null>(null);
  const pathCoordsRef = useRef<Coordinate[] | null>(null);
  const redrawPathDotsRef = useRef<() => void>(() => {});
  const fitMapToPathRef = useRef<(coordinates: Coordinate[]) => void>(() => {});
  const pathFitTimerRef = useRef<number | null>(null);

  const [shadowStatus, setShadowStatus] = useState<ShadowStatus>('loading');
  const [currentBuildings, setCurrentBuildings] = useState<any[]>([]);
  const [lockedScore, setLockedScore] = useState<number | null>(null);
  const shadowBuildingsRef = useRef<any[]>([]);
  const shadowFetchMetaRef = useRef<{ center: Coordinate; fetchedAt: number } | null>(null);
  const shadowFetchPromiseRef = useRef<Promise<any[]> | null>(null);

  useEffect(() => {
    shadowBuildingsRef.current = currentBuildings;
  }, [currentBuildings]);

  const pinningModeRef = useRef(isPinningMode);
  useEffect(() => {
    pinningModeRef.current = isPinningMode;
    if (containerRef.current) containerRef.current.style.cursor = isPinningMode ? 'crosshair' : '';
  }, [isPinningMode]);

  const unmountUserMarker = () => {
    markerRootRef.current?.unmount();
    markerRootRef.current = null;
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  };

  const renderUserMarkerRive = (inSun: boolean) => {
    markerRootRef.current?.render(
      <MapUserIcon className="h-full w-full" inSun={inSun} />
    );
  };

  const createUserMarkerIcon = (inSun: boolean) => {
    const host = document.createElement('div');
    host.className = 'relative flex h-20 w-20 items-center justify-center overflow-visible';

    const riveMount = document.createElement('div');
    riveMount.className = 'h-20 w-20';
    host.appendChild(riveMount);

    const root = createRoot(riveMount);
    root.render(<MapUserIcon className="h-full w-full" inSun={inSun} />);
    markerRootRef.current = root;

    return L.divIcon({
      className: 'custom-marker',
      html: host,
      iconSize: [USER_MARKER_SIZE_PX, USER_MARKER_SIZE_PX],
      iconAnchor: [USER_MARKER_SIZE_PX / 2, USER_MARKER_SIZE_PX / 2]
    });
  };

  redrawPathDotsRef.current = () => {
    const map = mapRef.current;
    const coords = pathCoordsRef.current;
    if (!map || !coords?.length) return;
    if (pathLayerRef.current) pathLayerRef.current.remove();
    pathLayerRef.current = addPathDots(map, coords);
  };

  fitMapToPathRef.current = (coordinates: Coordinate[]) => {
    const map = mapRef.current;
    if (!map || coordinates.length < 2) return;
    const bounds = L.latLngBounds(coordinates.map((c) => [c.lat, c.lng]));
    map.invalidateSize();
    map.fitBounds(bounds, {
      paddingTopLeft: [PATH_PANEL_SIDE_PAD, PATH_PANEL_SIDE_PAD],
      paddingBottomRight: [PATH_PANEL_SIDE_PAD, PATH_PANEL_BOTTOM_PAD],
      maxZoom: 17
    });
    redrawPathDotsRef.current();
  };

  const scheduleFitMapToPath = (coordinates: Coordinate[]) => {
    if (pathFitTimerRef.current !== null) {
      window.clearTimeout(pathFitTimerRef.current);
    }
    fitMapToPathRef.current(coordinates);
    pathFitTimerRef.current = window.setTimeout(() => {
      fitMapToPathRef.current(coordinates);
      pathFitTimerRef.current = null;
    }, MAP_FIT_AFTER_SLIDE_MS);
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialView: [number, number] = userLocation ? [userLocation.lat, userLocation.lng] : [52.52, 13.40]; 
    const map = L.map(containerRef.current, { zoomControl: false }).setView(initialView, userLocation ? 17 : 13);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);
    
    map.on('click', (e: any) => {
      if (!pinningModeRef.current) return;
      if (e.originalEvent && e.originalEvent._isScoutClick) return;
      onUserLocationChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    // Disable tracking on manual map interaction
    map.on('dragstart', () => {
      if (onToggleTracking) onToggleTracking(false);
    });

    map.on('zoomstart', (e: any) => {
      // Only disable tracking if it was a manual zoom (not programmatic)
      // Leaflet doesn't always provide this info clearly, but usually user interaction is the cause here
      if (onToggleTracking) onToggleTracking(false);
    });

    try {
      const sm = L.shadeMap({
        apiKey: SHADEMAP_API_KEY,
        date: displayDate || new Date(),
        color: "#1e293b",
        opacity: 0.5,
        terrainSource: {
          tileSize: 256,
          getSourceUrl: ({ x, y, z }: any) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
          getElevation: ({ r, g, b }: any) => (r * 256 + g + b / 256) - 32768
        },
        getFeatures: async () => {
          const zoom = map.getZoom();
          if (zoom < 15) {
            setShadowStatus('low-zoom');
            // Keep already-rendered shadows visible instead of clearing.
            return shadowBuildingsRef.current;
          }

          const center = map.getCenter();
          const centerCoord: Coordinate = { lat: center.lat, lng: center.lng };
          const meta = shadowFetchMetaRef.current;
          const hasCached = shadowBuildingsRef.current.length > 0;

          if (hasCached && meta) {
            const dist = Math.hypot(centerCoord.lat - meta.center.lat, centerCoord.lng - meta.center.lng);
            const age = Date.now() - meta.fetchedAt;
            if (dist < SHADOW_REFRESH_MIN_DISTANCE_DEG || age < SHADOW_REFRESH_MIN_INTERVAL_MS) {
              setShadowStatus('active');
              return shadowBuildingsRef.current;
            }
          }

          if (shadowFetchPromiseRef.current) {
            // Reuse in-flight fetch and avoid flicker.
            return hasCached ? shadowBuildingsRef.current : await shadowFetchPromiseRef.current;
          }

          if (!hasCached) {
            setShadowStatus('loading');
          } else {
            setShadowStatus('active');
          }

          shadowFetchPromiseRef.current = (async () => {
            const buildings = await getBuildingsForArea(centerCoord);
            shadowFetchMetaRef.current = { center: centerCoord, fetchedAt: Date.now() };
            shadowBuildingsRef.current = buildings;
            setCurrentBuildings(buildings);
            setShadowStatus(buildings.length > 0 ? 'active' : 'error');
            return buildings;
          })().finally(() => {
            shadowFetchPromiseRef.current = null;
          });

          return hasCached ? shadowBuildingsRef.current : await shadowFetchPromiseRef.current;
        }
      });
      sm.addTo(map);
      shadeMapRef.current = sm;
    } catch (e) { setShadowStatus('error'); }

    const onPathDotsViewChange = () => redrawPathDotsRef.current();

    map.on('zoomend', onPathDotsViewChange);
    map.on('moveend', onPathDotsViewChange);
    window.addEventListener('resize', onPathDotsViewChange);

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.off('zoomend', onPathDotsViewChange);
      map.off('moveend', onPathDotsViewChange);
      window.removeEventListener('resize', onPathDotsViewChange);
      if (pathFitTimerRef.current !== null) {
        window.clearTimeout(pathFitTimerRef.current);
        pathFitTimerRef.current = null;
      }
      unmountUserMarker();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Trail Layer (Walked Path)
  useEffect(() => {
    if (!mapRef.current) return;
    if (trailLayerRef.current) trailLayerRef.current.remove();
    if (walkedTrail.length < 2) return;

    const latLngs = walkedTrail.map(c => [c.lat, c.lng]);
    trailLayerRef.current = L.polyline(latLngs, {
      color: '#3b82f6',
      weight: 4,
      opacity: 0.6,
      dashArray: '5, 10',
      lineCap: 'round',
      zIndex: 600
    }).addTo(mapRef.current);
  }, [walkedTrail]);

  useEffect(() => {
    if (shadeMapRef.current && displayDate) {
      shadeMapRef.current.setDate(displayDate);
      if (shadeMapRef.current.redraw) shadeMapRef.current.redraw();
      else if (shadeMapRef.current._update) shadeMapRef.current._update();
    }
  }, [displayDate]);

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;
    const latlng = [userLocation.lat, userLocation.lng];
    if (!markerRef.current) {
      const avatarIcon = createUserMarkerIcon(!!isCurrentlySunny);
      markerRef.current = L.marker(latlng, { icon: avatarIcon, zIndexOffset: 1000 }).addTo(mapRef.current);
    } else {
      markerRef.current.setLatLng(latlng);
      renderUserMarkerRive(!!isCurrentlySunny);
    }

    if (isTracking || !initialCenterSet.current) {
      mapRef.current.panTo(latlng, { animate: true });
      initialCenterSet.current = true;
    }
  }, [userLocation, isTracking, locationAccuracy, locationSource, isCurrentlySunny]);

  useEffect(() => {
    if (!mapRef.current) return;
    scoutLayersRef.current.forEach(l => l.remove());
    scoutLayersRef.current = [];
    if (pathLayerRef.current) pathLayerRef.current.remove();
    pathLayerRef.current = null;
    pathCoordsRef.current = null;

    if (!path || mode !== AppMode.WALK) return;

    if (showAllScouts && path.allScouts) {
      path.allScouts.forEach(scout => {
        if (scout.id === path.id) return;
        const scoutLayer = L.polyline(scout.coordinates.map(c => [c.lat, c.lng]), { color: '#94a3b8', weight: 3, opacity: 0.4, interactive: true }).addTo(mapRef.current);
        scoutLayer.on('click', (e: any) => { if (e.originalEvent) e.originalEvent._isScoutClick = true; onSelectScout(scout); });
        scoutLayersRef.current.push(scoutLayer);
      });
    }

    pathCoordsRef.current = path.coordinates;
    pathLayerRef.current = addPathDots(mapRef.current, path.coordinates);

    if (lastScoredPathId.current !== path.id) {
      lastScoredPathId.current = path.id;
      scheduleFitMapToPath(path.coordinates);
    } else {
      window.setTimeout(() => redrawPathDotsRef.current(), 0);
    }
  }, [path, showAllScouts, mode]);

  useEffect(() => {
    if (!mapRef.current) return;
    benchMarkersRef.current.forEach(m => m.remove());
    benchMarkersRef.current = [];
    if (!benches || mode !== AppMode.SIT) return;
    benches.forEach(bench => {
      const icon = L.divIcon({
        className: 'bench-marker',
        html: `<div class="w-8 h-8 rounded-full shadow-lg border-2 border-white flex items-center justify-center ${bench.isSunny ? 'bg-amber-500' : 'bg-slate-500'}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M7 18V6"/><path d="M17 18V6"/><path d="M7 10h10"/><path d="M7 14h10"/></svg></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });
      benchMarkersRef.current.push(L.marker([bench.coordinate.lat, bench.coordinate.lng], { icon }).addTo(mapRef.current));
    });
  }, [benches, mode]);

  useEffect(() => {
    if (!mapRef.current) return;
    cafeMarkersRef.current.forEach((m) => m.remove());
    cafeMarkersRef.current = [];
    if (!cafes || mode !== AppMode.CAFE) return;

    cafes.forEach((cafe) => {
      const icon = L.divIcon({
        className: 'cafe-marker',
        html: `<div class="w-8 h-8 rounded-full shadow-lg border-2 border-white flex items-center justify-center ${cafe.isSunny ? 'bg-amber-500' : 'bg-slate-500'}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M3 8h13v8H3z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2"/><path d="M6 16v2"/><path d="M10 16v2"/></svg></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });
      const marker = L.marker([cafe.coordinate.lat, cafe.coordinate.lng], { icon })
        .bindPopup(buildCafePopupHtml(cafe), {
          className: 'cafe-popup-wrapper',
          maxWidth: 260,
          closeButton: true
        })
        .addTo(mapRef.current);
      cafeMarkersRef.current.push(marker);
    });
  }, [cafes, mode]);

  useEffect(() => {
    if (!path || mode !== AppMode.WALK) {
      setLockedScore(null);
      return;
    }
    if (shadowStatus !== 'active') return;
    setLockedScore(null);
    const runScoreUpdate = async () => {
      const score = await calculateSunScore(path.coordinates, displayDate || new Date(), 1);
      setLockedScore(score);
    };
    runScoreUpdate();
  }, [path, shadowStatus, displayDate, mode]);

  return (
    <div className={`relative w-full h-full bg-slate-100 overflow-hidden ${isPinningMode ? 'ring-inset ring-8 ring-blue-500/30' : ''}`}>
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-6 right-6 z-[1000] flex flex-col gap-2">
        <button onClick={onLocateMe} className={`p-3 rounded-full shadow-lg transition-all ${isTracking ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M12 3v3"/><path d="M12 18v3"/></svg>
        </button>
      </div>
      {mode === AppMode.WALK && path && lockedScore !== null && (
        <div className="pointer-events-auto absolute bottom-8 left-1/2 z-[1000] -translate-x-1/2">
          <div className="relative flex items-stretch gap-2.5">
          <div className="flex h-[4.875rem] w-[12.5rem] shrink-0 flex-col justify-center gap-1 rounded-2xl bg-[#BBE279] px-4 py-1.5 text-[#4A5B2E] shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <span className="font-fixel-regular text-[15px] leading-none">Sun</span>
              <span className="font-nyght-regular text-[15px] leading-none">{lockedScore.toFixed(0)}%</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-fixel-regular text-[15px] leading-none">Time</span>
              <span className="font-nyght-regular text-[15px] leading-none">{path.durationMinutes} min</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-fixel-regular text-[15px] leading-none">Distance</span>
              <span className="font-nyght-regular text-[15px] leading-none">{formatPathDistance(path.distanceKm)}</span>
            </div>
          </div>

          <div className="flex h-[4.875rem] shrink-0 flex-col justify-between gap-1.5">
            <button
              type="button"
              onClick={onNewPath}
              disabled={!onNewPath}
              className="font-nyght-regular-italic flex h-9 w-[9.75rem] items-center justify-between rounded-full bg-[#FFC0FC] px-4 text-[15px] leading-none text-[#BE44B8] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>New path</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.74 2.24" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onStartWalk}
              disabled={!onStartWalk}
              className="font-nyght-regular-italic flex h-9 w-[9.75rem] items-center justify-between rounded-full bg-[#A5DFF5] px-4 text-[15px] leading-none text-[#322F68] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>Start walk</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
          {canCyclePath && (
            <p className="font-nyght-regular pointer-events-none absolute -bottom-5 left-0 right-0 text-center text-[10px] text-slate-600">
              {(path.allScouts?.length ?? 0)} sunny routes
            </p>
          )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MapDisplay;
