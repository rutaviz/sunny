
import React, { useEffect, useRef, useState } from 'react';
import { Coordinate, PathResult, BenchResult, AppMode } from '../types';
import { SHADEMAP_API_KEY } from '../constants';
import { calculateSunScore, getBuildingsForArea } from '../services/shadeService';

declare const L: any;

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
  mode: AppMode;
  displayDate?: Date;
  isCurrentlySunny?: boolean;
}

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
  mode,
  displayDate,
  isCurrentlySunny
}) => {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathLayerRef = useRef<any>(null);
  const trailLayerRef = useRef<any>(null);
  const scoutLayersRef = useRef<any[]>([]);
  const benchMarkersRef = useRef<any[]>([]);
  const guessedMarkersRef = useRef<any[]>([]);
  const markerRef = useRef<any>(null);
  const accuracyCircleRef = useRef<any>(null);
  const shadeMapRef = useRef<any>(null);
  const initialCenterSet = useRef<boolean>(false);
  const lastScoredPathId = useRef<string | null>(null);

  const [shadowStatus, setShadowStatus] = useState<ShadowStatus>('loading');
  const [currentBuildings, setCurrentBuildings] = useState<any[]>([]);
  const [lockedScore, setLockedScore] = useState<number | null>(null);

  const pinningModeRef = useRef(isPinningMode);
  useEffect(() => {
    pinningModeRef.current = isPinningMode;
    if (containerRef.current) containerRef.current.style.cursor = isPinningMode ? 'crosshair' : '';
  }, [isPinningMode]);

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
          if (map.getZoom() < 15) { setShadowStatus('low-zoom'); return []; }
          setShadowStatus('loading');
          const buildings = await getBuildingsForArea(map.getCenter());
          setShadowStatus(buildings.length > 0 ? 'active' : 'error');
          setCurrentBuildings(buildings);
          return buildings;
        }
      });
      sm.addTo(map);
      shadeMapRef.current = sm;
    } catch (e) { setShadowStatus('error'); }

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
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
      const avatarIcon = L.divIcon({
        className: 'custom-marker',
        iconSize: [60, 60],
        iconAnchor: [30, 30],
        html: `
          <div class="relative w-full h-full flex items-center justify-center">
            <div class="absolute w-full h-full rounded-full bg-blue-400 opacity-20 animate-ping"></div>
            <div class="user-sun-indicator absolute top-0 right-0 w-5 h-5 bg-amber-400 rounded-full border-2 border-white shadow-lg transition-transform scale-0 flex items-center justify-center text-[10px]">☀️</div>
            <div class="w-12 h-12 rounded-full bg-[url('https://raw.githubusercontent.com/rutaviz/glitch-hello-website/refs/heads/master/Untitled_Artwork_79_1_99x100.png')] bg-cover bg-center shadow-2xl z-10"></div>
          </div>
        `
      });
      markerRef.current = L.marker(latlng, { icon: avatarIcon, zIndexOffset: 1000 }).addTo(mapRef.current);
    } else {
      markerRef.current.setLatLng(latlng);
    }

    const indicator = markerRef.current._icon?.querySelector('.user-sun-indicator');
    if (indicator) {
      indicator.classList.toggle('scale-100', !!isCurrentlySunny);
      indicator.classList.toggle('scale-0', !isCurrentlySunny);
    }

    if (locationAccuracy && locationSource === 'gps') {
      if (!accuracyCircleRef.current) {
        accuracyCircleRef.current = L.circle(latlng, { radius: locationAccuracy, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1 }).addTo(mapRef.current);
      } else {
        accuracyCircleRef.current.setLatLng(latlng).setRadius(locationAccuracy);
      }
    } else if (accuracyCircleRef.current) {
      accuracyCircleRef.current.remove();
      accuracyCircleRef.current = null;
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
    if (!path || mode !== AppMode.WALK) return;

    if (showAllScouts && path.allScouts) {
      path.allScouts.forEach(scout => {
        if (scout.id === path.id) return;
        const scoutLayer = L.polyline(scout.coordinates.map(c => [c.lat, c.lng]), { color: '#94a3b8', weight: 3, opacity: 0.4, interactive: true }).addTo(mapRef.current);
        scoutLayer.on('click', (e: any) => { if (e.originalEvent) e.originalEvent._isScoutClick = true; onSelectScout(scout); });
        scoutLayersRef.current.push(scoutLayer);
      });
    }

    const latLngs = path.coordinates.map(c => [c.lat, c.lng]);
    pathLayerRef.current = L.polyline(latLngs, { color: '#10b981', weight: 6, opacity: 0.9, lineCap: 'round', zIndex: 500 }).addTo(mapRef.current);
    if (!lastScoredPathId.current?.startsWith(path.id || 'best')) {
       mapRef.current.fitBounds(L.latLngBounds(latLngs as any), { padding: [50, 50] });
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
    if (!path || shadowStatus !== 'active' || mode !== AppMode.WALK) return;
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
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[1000] w-[calc(100%-48px)] max-w-sm bg-white/95 backdrop-blur-md p-5 rounded-[2.5rem] shadow-2xl border border-white">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-amber-50 p-3 rounded-3xl border border-amber-100 text-center"><p className="text-[9px] uppercase font-black text-amber-600 mb-1">Sun</p><p className="text-xl font-black text-amber-600">{lockedScore.toFixed(0)}%</p></div>
            <div className="bg-slate-50 p-3 rounded-3xl border border-slate-100 text-center"><p className="text-[9px] uppercase font-black text-slate-400 mb-1">Time</p><p className="text-xl font-black text-slate-800">{path.durationMinutes}<span className="text-xs ml-0.5">m</span></p></div>
            <div className="bg-slate-50 p-3 rounded-3xl border border-slate-100 text-center"><p className="text-[9px] uppercase font-black text-slate-400 mb-1">Dist</p><p className="text-xl font-black text-slate-800">{path.distanceKm.toFixed(1)}<span className="text-xs ml-0.5">k</span></p></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapDisplay;
