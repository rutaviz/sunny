
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Header from './components/Header';
import MapDisplay from './components/MapDisplay';
import LoadingScreen from './components/LoadingScreen';
import { Coordinate, PathResult, BenchResult, AppStatus, WeatherInfo, AppMode, SunTrackingState } from './types';
import { findOptimalSunnyPath } from './services/pathService';
import { findSunnyBenches } from './services/benchService';
import { fetchSunlightOutlook } from './services/weatherService';
import { calculateSunScore } from './services/shadeService';

const SUN_GOAL_MINUTES = 10;
const SUN_MILESTONE_MINUTES = 2;

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [mode, setMode] = useState<AppMode>(AppMode.WALK);
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [locationSource, setLocationSource] = useState<'gps' | 'manual' | 'waiting'>('waiting');
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [duration, setDuration] = useState<number>(30);
  const [generatedPath, setGeneratedPath] = useState<PathResult | null>(null);
  const [foundBenches, setFoundBenches] = useState<BenchResult[] | null>(null);
  const [showAllScouts, setShowAllScouts] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [isPinningMode, setIsPinningMode] = useState(false);
  const [isLocationTimedOut, setIsLocationTimedOut] = useState(false);
  const [minLoadingPassed, setMinLoadingPassed] = useState(false);
  
  // Exposure Tracking State
  const [tracking, setTracking] = useState<SunTrackingState>({
    totalSeconds: 0,
    isCurrentlyInSun: false,
    hasAchievedMilestone: false,
    hasAchievedGoal: false,
    walkedTrail: []
  });
  const [showCongrats, setShowCongrats] = useState(false);
  const [showMilestoneToast, setShowMilestoneToast] = useState(false);
  const [isWakeLocked, setIsWakeLocked] = useState(false);

  // Mobile UI States
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [isTracking, setIsTracking] = useState(true); 
  
  const watchIdRef = useRef<number | null>(null);
  const locationAttemptsRef = useRef<number>(0);
  const locationTimeoutRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Refs for background stability
  const userLocationRef = useRef<Coordinate | null>(null);
  const isTrackingRef = useRef<boolean>(true);
  const appStatusRef = useRef<AppStatus>(AppStatus.IDLE);
  const effectiveTimeRef = useRef<Date>(new Date());
  const lastSunCheckTimeRef = useRef<number>(0);
  const lastTickTimestampRef = useRef<number>(Date.now());

  useEffect(() => { userLocationRef.current = userLocation; }, [userLocation]);
  useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);
  useEffect(() => { appStatusRef.current = status; }, [status]);

  // Simulation State
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedTimeStr, setSimulatedTimeStr] = useState("12:00");

  const effectiveTime = useMemo(() => {
    if (!isSimulating) return currentTime;
    const [hours, minutes] = simulatedTimeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }, [isSimulating, simulatedTimeStr, currentTime]);

  useEffect(() => { effectiveTimeRef.current = effectiveTime; }, [effectiveTime]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    
    // Minimum loading time for Rive animation
    const loadingTimer = setTimeout(() => {
      setMinLoadingPassed(true);
    }, 10000);

    return () => {
      clearInterval(timer);
      clearTimeout(loadingTimer);
    };
  }, []);

  // SILENT AUDIO ENGINE: Keeps process alive when screen is locked
  const startSilentAudio = useCallback(() => {
    if (audioContextRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.001; // Silent
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      audioContextRef.current = ctx;
      console.log("Silent audio engine engaged for background tracking.");
    } catch (e) {
      console.warn("Audio context failed", e);
    }
  }, []);

  // Wake Lock Logic
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsWakeLocked(true);
        startSilentAudio(); // Pair wake lock with audio for better persistence
        wakeLockRef.current.addEventListener('release', () => setIsWakeLocked(false));
      } catch (err) { console.warn("Wake Lock failed:", err); }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsWakeLocked(false);
    }
  };

  const toggleWakeLock = () => {
    if (isWakeLocked) releaseWakeLock();
    else requestWakeLock();
  };

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        if (isWakeLocked) await requestWakeLock();
        const loc = userLocationRef.current;
        if (loc && appStatusRef.current === AppStatus.READY) {
          try {
            const score = await calculateSunScore([loc], effectiveTimeRef.current, 1);
            setTracking(prev => ({ ...prev, isCurrentlyInSun: score > 50 }));
          } catch (e) { console.warn("Catch-up sun check failed", e); }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isWakeLocked, startSilentAudio]);

  // Main Tracking Tick (Time + Sun Status)
  useEffect(() => {
    const ticker = setInterval(async () => {
      const loc = userLocationRef.current;
      const active = isTrackingRef.current;
      const statusOk = appStatusRef.current === AppStatus.READY;
      const now = Date.now();
      const deltaMs = now - lastTickTimestampRef.current;
      const deltaSeconds = Math.floor(deltaMs / 1000);
      
      if (deltaSeconds < 1) return;
      lastTickTimestampRef.current = now;
      if (!loc || !active || !statusOk) return;
      
      if (now - lastSunCheckTimeRef.current > 5000 || lastSunCheckTimeRef.current === 0) {
        lastSunCheckTimeRef.current = now;
        try {
          const score = await calculateSunScore([loc], effectiveTimeRef.current, 1);
          setTracking(prev => ({ ...prev, isCurrentlyInSun: score > 50 }));
        } catch (e) { console.warn("Sun check failed", e); }
      }

      setTracking(prev => {
        if (!prev.isCurrentlyInSun) return prev;
        const newTotal = prev.totalSeconds + deltaSeconds;
        let updates: Partial<SunTrackingState> = { totalSeconds: newTotal };
        if (newTotal >= SUN_MILESTONE_MINUTES * 60 && !prev.hasAchievedMilestone) {
          setShowMilestoneToast(true);
          updates.hasAchievedMilestone = true;
          setTimeout(() => setShowMilestoneToast(false), 4000);
        }
        if (newTotal >= SUN_GOAL_MINUTES * 60 && !prev.hasAchievedGoal) {
          setShowCongrats(true);
          updates.hasAchievedGoal = true;
        }
        return { ...prev, ...updates };
      });
    }, 1000);
    return () => clearInterval(ticker);
  }, []);

  const checkConditions = useCallback(async (location: Coordinate) => {
    setStatus(AppStatus.CHECKING_WEATHER);
    setLoadingMessage('Checking sky conditions...');
    try {
      const outlook = await fetchSunlightOutlook(location);
      setWeather(outlook);
    } catch (err) { console.warn("Weather failed", err); }
    setStatus(AppStatus.READY);
  }, []);

  const stopWatchingLocation = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (locationTimeoutRef.current) {
      window.clearTimeout(locationTimeoutRef.current);
      locationTimeoutRef.current = null;
    }
  }, []);

  const handleManualLocationChange = (coord: Coordinate) => {
    stopWatchingLocation();
    setUserLocation(coord);
    setLocationSource('manual');
    setLocationAccuracy(null);
    setIsTracking(false); 
    setIsLocationTimedOut(false);
    checkConditions(coord);
    setGeneratedPath(null);
    setFoundBenches(null);
    setError(null);
    setIsPinningMode(false); 
  };

  const locateUser = useCallback(() => {
    stopWatchingLocation();
    setStatus(AppStatus.LOCATING);
    setLocationSource('waiting');
    setIsTracking(true);
    setIsLocationTimedOut(false);
    setLoadingMessage('Initializing GPS...');
    setError(null);
    locationAttemptsRef.current = 0;

    locationTimeoutRef.current = window.setTimeout(() => setIsLocationTimedOut(true), 30000);
    
    if (!navigator.geolocation) {
      setError('Geolocation not supported.');
      setStatus(AppStatus.ERROR);
      return;
    }

    let hasInitiallySettled = false;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        locationAttemptsRef.current++;
        const coord = { lat: position.coords.latitude, lng: position.coords.longitude };
        const accuracy = position.coords.accuracy;
        
        setUserLocation(coord);
        setLocationAccuracy(accuracy);
        setLocationSource('gps');
        
        // RECORD PATH BREADCRUMB
        setTracking(prev => {
          const lastPoint = prev.walkedTrail[prev.walkedTrail.length - 1];
          // Only add if we moved at least ~2 meters to avoid noise
          if (!lastPoint || (Math.abs(lastPoint.lat - coord.lat) > 0.00002 || Math.abs(lastPoint.lng - coord.lng) > 0.00002)) {
            return { ...prev, walkedTrail: [...prev.walkedTrail, coord] };
          }
          return prev;
        });
        
        if (!hasInitiallySettled && (accuracy < 80 || locationAttemptsRef.current > 5)) {
          hasInitiallySettled = true;
          if (locationTimeoutRef.current) window.clearTimeout(locationTimeoutRef.current);
          setIsLocationTimedOut(false);
          checkConditions(coord);
        } else if (!hasInitiallySettled) {
          setLoadingMessage(`Refining position... (${Math.round(accuracy)}m)`);
        }
      },
      (err) => {
        if (err.code === 3 && userLocationRef.current) {
          hasInitiallySettled = true;
          if (locationTimeoutRef.current) window.clearTimeout(locationTimeoutRef.current);
          checkConditions(userLocationRef.current);
          return;
        }
        setError('Location lost.');
        setStatus(AppStatus.ERROR);
        setIsTracking(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }, [checkConditions, stopWatchingLocation]);

  useEffect(() => { locateUser(); return () => stopWatchingLocation(); }, []);

  const handleAction = async () => {
    if (!userLocation) return;
    setStatus(AppStatus.GENERATING);
    setError(null);
    try {
      if (mode === AppMode.WALK) {
        const path = await findOptimalSunnyPath(userLocation, duration, (msg) => setLoadingMessage(msg), isSimulating ? effectiveTime : undefined);
        setGeneratedPath(path);
        if (path.sunScore < 30) setShowAllScouts(true);
      } else {
        setLoadingMessage('Searching for benches...');
        const benches = await findSunnyBenches(userLocation, 1000, isSimulating ? effectiveTime : undefined);
        setFoundBenches(benches);
      }
      setStatus(AppStatus.READY);
      if (window.innerWidth < 768) setIsSidebarOpen(false);
    } catch (err: any) {
      setError(err.message || 'Search failed.');
      setStatus(AppStatus.ERROR);
    }
  };

  const isBlocked = !minLoadingPassed || status === AppStatus.LOCATING || status === AppStatus.GENERATING || status === AppStatus.CHECKING_WEATHER;
  const sunnyMinutes = Math.floor(tracking.totalSeconds / 60);
  const sunnyRemainingSeconds = Math.floor(tracking.totalSeconds % 60);

  return (
    <div className="flex flex-col h-screen max-h-screen relative overflow-hidden">
      {isBlocked && <LoadingScreen message={loadingMessage || 'Loading...'} />}
      <Header />
      <main className="flex-1 flex overflow-hidden relative">
        {showCongrats && (
          <div className="fixed inset-0 z-[5000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white rounded-[3rem] p-10 shadow-2xl border-4 border-amber-400 max-w-sm text-center transform scale-100 animate-in zoom-in-95">
              <div className="w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-500 animate-bounce">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2">Sun Master!</h2>
              <p className="text-slate-500 font-medium mb-8">Congrats! You've soaked up <span className="text-amber-600 font-bold">{SUN_GOAL_MINUTES} minutes</span>.</p>
              <button onClick={() => setShowCongrats(false)} className="w-full sunny-gradient py-4 rounded-2xl text-white font-black">Keep Glowing</button>
            </div>
          </div>
        )}

        {showMilestoneToast && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[5001] bg-emerald-500 text-white px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-in slide-in-from-top-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
            <span className="font-black text-sm uppercase tracking-wider">2 Min Reached!</span>
          </div>
        )}

        <div className={`
          fixed md:relative z-[2000] h-[calc(100vh-72px)] w-[85%] md:w-96 
          bg-white/95 md:bg-white backdrop-blur-xl md:backdrop-blur-none
          border-r border-slate-200 p-6 flex flex-col gap-6 shadow-2xl md:shadow-none 
          transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:-translate-x-80'}
        `}>
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="absolute top-1/2 -translate-y-1/2 -right-8 w-8 h-20 bg-white border border-slate-200 border-l-0 rounded-r-2xl flex items-center justify-center shadow-lg text-slate-400 hover:text-blue-500 z-[2001]">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 ${isSidebarOpen ? 'rotate-0' : 'rotate-180'}`}><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>

          <section className="overflow-y-auto custom-scrollbar pr-2 flex-1">
            <div className="mb-6 p-5 rounded-[2rem] bg-amber-50 border border-amber-100 shadow-sm relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 w-20 h-20 bg-amber-200/20 rounded-full group-hover:scale-150 transition-transform duration-700"></div>
              
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${tracking.isCurrentlyInSun ? 'bg-amber-400 text-white animate-pulse' : 'bg-slate-200 text-slate-400'}`}>
                    {tracking.isCurrentlyInSun ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                    )}
                  </div>
                  <div>
                    <h3 className="text-[10px] font-black uppercase text-amber-700 tracking-widest leading-none mb-1">Sun Exposure</h3>
                    <p className="text-xl font-black text-slate-800 leading-none">{sunnyMinutes}m {sunnyRemainingSeconds}s</p>
                  </div>
                </div>

                <button 
                  onClick={toggleWakeLock}
                  title={isWakeLocked ? "Background Tracking Active" : "Allow Sleep"}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isWakeLocked ? 'bg-amber-500 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={isWakeLocked ? "animate-pulse" : ""}><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>
                </button>
              </div>
              
              <div className="w-full h-3 bg-slate-200 rounded-full relative overflow-hidden mb-2">
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-white/60 z-10" 
                  style={{ left: `${(SUN_MILESTONE_MINUTES / SUN_GOAL_MINUTES) * 100}%` }}
                ></div>
                <div 
                  className={`h-full transition-all duration-1000 ${tracking.hasAchievedMilestone ? 'bg-emerald-400' : 'bg-amber-400'}`} 
                  style={{ width: `${Math.min(100, (tracking.totalSeconds / (SUN_GOAL_MINUTES * 60)) * 100)}%` }}
                ></div>
              </div>
              <div className="flex justify-between items-center text-[9px] font-black uppercase">
                <span className={`${tracking.hasAchievedMilestone ? 'text-emerald-600' : 'text-slate-400'}`}>Min: 2m</span>
                <span className="text-slate-400">Trail: {tracking.walkedTrail.length} pts</span>
                <span className="text-slate-400">Goal: 10m</span>
              </div>
              {isWakeLocked && (
                <p className="text-[8px] font-bold text-amber-600 mt-2 text-center animate-pulse uppercase">Background Persistence Active</p>
              )}
            </div>

            <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-6 shadow-inner">
               <button onClick={() => setMode(AppMode.WALK)} className={`flex-1 py-3 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${mode === AppMode.WALK ? 'bg-white text-amber-600 shadow-md scale-100' : 'text-slate-500 opacity-60'}`}>Walk</button>
               <button onClick={() => setMode(AppMode.SIT)} className={`flex-1 py-3 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${mode === AppMode.SIT ? 'bg-white text-amber-600 shadow-md scale-100' : 'text-slate-500 opacity-60'}`}>Sit</button>
            </div>

            <div className={`mb-4 p-4 rounded-2xl border transition-all ${isSimulating ? 'bg-indigo-50 border-indigo-200 ring-2 ring-indigo-500/20' : 'bg-slate-50 border-slate-100'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isSimulating ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300'}`}></div>
                  <span className="text-xs font-black uppercase tracking-tight text-slate-700">Simulation</span>
                </div>
                <button onClick={() => setIsSimulating(!isSimulating)} className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${isSimulating ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isSimulating ? 'translate-x-6' : 'translate-x-1'}`} /></button>
              </div>
              {isSimulating && (
                <input type="time" value={simulatedTimeStr} onChange={(e) => setSimulatedTimeStr(e.target.value)} className="w-full bg-white border border-indigo-200 rounded-lg px-3 py-2 text-sm font-bold text-indigo-900 outline-none" />
              )}
            </div>

            <div className="space-y-4">
              {mode === AppMode.WALK && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2 flex justify-between">
                    <span>Walking Duration</span>
                    <span className="text-amber-600 font-bold">{duration} min</span>
                  </label>
                  <input type="range" min="10" max="120" step="5" value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} disabled={isBlocked || !userLocation} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-30" />
                </div>
              )}

              <button disabled={isBlocked || !userLocation} onClick={handleAction} className={`w-full py-4 px-6 text-white font-bold rounded-2xl shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 ${!userLocation ? 'bg-slate-300 cursor-not-allowed' : isSimulating ? 'bg-indigo-600' : 'sunny-gradient'} disabled:opacity-50`}>
                {status === AppStatus.GENERATING ? 'Scouting Sunshine...' : mode === AppMode.WALK ? 'Generate Sunny Loop' : 'Find Sunny Benches'}
              </button>
            </div>
            {error && (
              <div className="mt-4 p-4 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 text-[11px] font-bold leading-relaxed flex gap-2">
                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                 {error}
              </div>
            )}
          </section>

          <div className="mt-auto pt-6 border-t border-slate-100 flex items-center justify-between text-slate-400">
             <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${locationSource === 'gps' ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
                <span className="text-[10px] font-black uppercase text-slate-500">{locationSource === 'gps' ? 'GPS Active' : 'Manual'}</span>
             </div>
             <button onClick={() => { if (locationSource === 'gps') setIsTracking(!isTracking); else locateUser(); }} className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${isTracking ? 'text-blue-600 bg-blue-50' : 'text-slate-500 bg-slate-100'}`}>{isTracking ? 'Following' : 'Follow'}</button>
          </div>
        </div>

        <div className="flex-1 relative h-full">
          <MapDisplay 
            userLocation={userLocation} 
            locationSource={locationSource}
            locationAccuracy={locationAccuracy}
            isTracking={isTracking}
            isPinningMode={isPinningMode}
            onUserLocationChange={handleManualLocationChange}
            onLocateMe={locateUser}
            onToggleTracking={setIsTracking}
            path={generatedPath} 
            walkedTrail={tracking.walkedTrail}
            benches={foundBenches || undefined}
            mode={mode}
            showAllScouts={showAllScouts}
            onSelectScout={(s) => setGeneratedPath(prev => prev ? { ...s, allScouts: prev.allScouts } : null)}
            displayDate={effectiveTime}
            isCurrentlySunny={tracking.isCurrentlyInSun}
          />
        </div>
      </main>
    </div>
  );
};

export default App;
