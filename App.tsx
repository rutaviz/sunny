
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import FlowerMascot from './components/FlowerMascot';
import LoadingScreen from './components/LoadingScreen';
import MapDisplay from './components/MapDisplay';
import { Coordinate, PathResult, BenchResult, AppStatus, WeatherInfo, AppMode, SunTrackingState } from './types';
import { findOptimalSunnyPath, pickNextScoutPath } from './services/pathService';
import { findSunnyBenches } from './services/benchService';
import { fetchSunlightOutlook } from './services/weatherService';
import { calculateSunScore } from './services/shadeService';

const SUN_GOAL_MINUTES = 10;
const SUN_MILESTONE_MINUTES = 2;
const SHOW_SUN_TIME_LABEL = false;
const MAP_SLIDE_MS = 2000;
const ACTION_BUTTON_EXIT_TOTAL_MS = 2500;

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
  const [showDurationPanel, setShowDurationPanel] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [mapSettled, setMapSettled] = useState(false);
  const [isMapClosing, setIsMapClosing] = useState(false);
  const [mapSlideReady, setMapSlideReady] = useState(false);
  const [buttonsExiting, setButtonsExiting] = useState(false);
  const [buttonsExitComplete, setButtonsExitComplete] = useState(false);
  const [exitLeadButton, setExitLeadButton] = useState<'walk' | 'sit' | null>(null);

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
  const walkBtnRef = useRef<HTMLButtonElement>(null);
  const sitBtnRef = useRef<HTMLButtonElement>(null);
  const buttonsExitTimerRef = useRef<number | null>(null);

  const resetButtonExitState = useCallback(() => {
    if (buttonsExitTimerRef.current !== null) {
      window.clearTimeout(buttonsExitTimerRef.current);
      buttonsExitTimerRef.current = null;
    }
    setButtonsExiting(false);
    setButtonsExitComplete(false);
    setExitLeadButton(null);
  }, []);

  useEffect(() => {
    return () => {
      if (buttonsExitTimerRef.current !== null) {
        window.clearTimeout(buttonsExitTimerRef.current);
      }
    };
  }, []);

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

  const handleSelectScout = useCallback((scout: PathResult) => {
    setGeneratedPath((prev) =>
      prev?.allScouts ? { ...scout, allScouts: prev.allScouts } : scout
    );
  }, []);

  const handleStartWalk = useCallback(() => {
    setIsTracking(true);
  }, []);

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

  const handleAction = async (selectedMode: AppMode = mode) => {
    if (!userLocation) return;
    setMode(selectedMode);
    setStatus(AppStatus.GENERATING);
    setError(null);
    try {
      if (selectedMode === AppMode.WALK) {
        const path = await findOptimalSunnyPath(userLocation, duration, (msg) => setLoadingMessage(msg), isSimulating ? effectiveTime : undefined);
        setGeneratedPath(path);
        if (path.sunScore < 30) setShowAllScouts(true);
      } else {
        setLoadingMessage('Searching for benches...');
        const benches = await findSunnyBenches(userLocation, 1000, isSimulating ? effectiveTime : undefined);
        setFoundBenches(benches);
      }
      setStatus(AppStatus.READY);
      setIsMapOpen(true);
      setIsMapClosing(false);
      setMapSettled(false);
      if (window.innerWidth < 768) setIsSidebarOpen(false);
    } catch (err: any) {
      setError(err.message || 'Search failed.');
      setStatus(AppStatus.ERROR);
      resetButtonExitState();
    }
  };

  const handleNewPath = useCallback(() => {
    if (!generatedPath) return;
    if (generatedPath.allScouts && generatedPath.allScouts.length > 1) {
      const next = pickNextScoutPath(generatedPath);
      if (next) setGeneratedPath(next);
      return;
    }
    if (!userLocation) return;
    void handleAction(AppMode.WALK);
  }, [generatedPath, userLocation]);

  const handleActionWithExit = useCallback(
    (selectedMode: AppMode) => {
      if (!userLocation || buttonsExiting) return;

      [walkBtnRef, sitBtnRef].forEach((ref) => {
        const el = ref.current;
        if (el) {
          el.style.setProperty('--btn-exit-shift', `-${el.offsetWidth / 3}px`);
        }
      });

      setExitLeadButton(selectedMode === AppMode.WALK ? 'walk' : 'sit');
      setButtonsExiting(true);
      setButtonsExitComplete(false);
      if (buttonsExitTimerRef.current !== null) {
        window.clearTimeout(buttonsExitTimerRef.current);
      }
      buttonsExitTimerRef.current = window.setTimeout(() => {
        setButtonsExitComplete(true);
        buttonsExitTimerRef.current = null;
      }, ACTION_BUTTON_EXIT_TOTAL_MS);

      void handleAction(selectedMode);
    },
    [userLocation, buttonsExiting, handleAction]
  );

  const isBlocked = !minLoadingPassed || status === AppStatus.LOCATING || status === AppStatus.GENERATING || status === AppStatus.CHECKING_WEATHER;

  const isInitialBlocked =
    !minLoadingPassed ||
    status === AppStatus.LOCATING ||
    status === AppStatus.CHECKING_WEATHER;

  const showActionButtons = !isInitialBlocked && !buttonsExitComplete;

  const mascotCondition = useMemo(() => {
    if (!minLoadingPassed || status === AppStatus.LOCATING || status === AppStatus.CHECKING_WEATHER) {
      return 0;
    }
    if (status === AppStatus.GENERATING) {
      return 2;
    }
    return 1;
  }, [minLoadingPassed, status]);

  const sunnyMinutes = Math.floor(tracking.totalSeconds / 60);
  const sunnyRemainingSeconds = Math.floor(tracking.totalSeconds % 60);
  const weatherLabel = weather ? `${Math.round(weather.temp)} °C` : '-- °C';

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMapSlideReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!isMapOpen) {
      setMapSettled(false);
      return;
    }
    setMapSettled(false);
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, MAP_SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [isMapOpen]);

  const handleMapPanelTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== 'transform') return;
    if (isMapOpen) {
      setMapSettled(true);
    } else {
      setIsMapClosing(false);
    }
  };

  const openMap = () => {
    setIsMapOpen(true);
    setIsMapClosing(false);
    setMapSettled(false);
  };

  const closeMap = () => {
    setIsMapOpen(false);
    setIsMapClosing(true);
    setMapSettled(false);
    resetButtonExitState();
  };

  const showSettledBackButton = isMapOpen && mapSettled && !isMapClosing;
  const showMapCircleControl = isMapOpen || isMapClosing;

  const mapCircleTransformClass = showSettledBackButton
    ? 'translate-x-0'
    : '-translate-x-1/2';

  return (
    <div className="h-screen max-h-screen relative overflow-x-hidden overflow-y-visible bg-[#e7e5e0] text-[#101010]">
      {isBlocked && <LoadingScreen message={loadingMessage || 'Loading...'} />}

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
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[5001] bg-emerald-500 text-white px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-in slide-in-from-top-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
          <span className="font-black text-sm uppercase tracking-wider">2 Min Reached!</span>
        </div>
      )}

      <main className="relative z-10 flex h-full w-full flex-col items-center justify-between overflow-visible px-8 pb-8 pt-7">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_25%,rgba(255,255,255,0.55),transparent_32rem)]" />

        <button
          type="button"
          onClick={() => setShowDurationPanel((value) => !value)}
          className="absolute left-5 top-6 z-20 flex h-11 w-11 items-center justify-center rounded-full border-2 border-black bg-transparent transition-transform active:scale-95"
          aria-label="Set walking duration"
        >
          <span className="text-xl leading-none">☺</span>
        </button>

        {showDurationPanel && (
          <div className="absolute left-5 top-20 z-30 w-72 rounded-[2rem] border border-black bg-[#f3f1ec] p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-nyght-light-italic text-lg">walk length</span>
              <span className="text-sm font-semibold">{duration} min</span>
            </div>
            <input
              type="range"
              min="10"
              max="120"
              step="5"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="w-full accent-black"
            />
          </div>
        )}

        <div className="absolute right-5 top-8 z-20 flex items-center gap-2 text-sm font-medium">
          <span>{weatherLabel}</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        </div>

        <section className="relative z-10 flex h-full w-full max-w-[430px] flex-col items-center justify-between overflow-visible">
          <div className="mt-20 w-full text-center">
            <h1 className="tracking-[-0.12em] text-[6.8rem] leading-[0.58] sm:text-[7.7rem]">
              <span className="font-nyght-light-italic block">enjoy</span>
              <span className="font-fixel-light block tracking-[-0.16em] text-[5.9rem] sm:text-[6.7rem]">sun</span>
            </h1>
          </div>

          <div className="relative z-20 -mt-4 flex w-full min-h-[265px] flex-1 items-center justify-center overflow-visible">
            <FlowerMascot
              condition={mascotCondition}
              className="h-[39.7vh] min-h-[265px] w-full max-w-[340px] origin-center scale-[1.89] -translate-y-[70px]"
            />
          </div>

          <div className="mt-4 w-full max-w-[285px]">
            <div className="flex min-h-[4.375rem] flex-col space-y-1.5">
              {showActionButtons && (
                <>
                  <button
                    ref={walkBtnRef}
                    type="button"
                    disabled={!userLocation || buttonsExiting}
                    onClick={() => handleActionWithExit(AppMode.WALK)}
                    className={`font-nyght-regular flex h-8 w-full items-center justify-between rounded-full border border-black bg-transparent px-6 text-base leading-none disabled:cursor-not-allowed disabled:opacity-40 ${
                      buttonsExiting
                        ? exitLeadButton === 'walk'
                          ? 'animate-action-button-exit'
                          : 'animate-action-button-exit-delayed'
                        : 'animate-slide-up-fade-in transition-all hover:bg-black hover:text-white active:scale-[0.98]'
                    }`}
                  >
                    <span>take a walk</span>
                    <span aria-hidden="true">→</span>
                  </button>
                  <button
                    ref={sitBtnRef}
                    type="button"
                    disabled={!userLocation || buttonsExiting}
                    onClick={() => handleActionWithExit(AppMode.SIT)}
                    className={`font-nyght-regular flex h-8 w-full items-center justify-between rounded-full border border-black bg-transparent px-6 text-base leading-none disabled:cursor-not-allowed disabled:opacity-40 ${
                      buttonsExiting
                        ? exitLeadButton === 'sit'
                          ? 'animate-action-button-exit'
                          : 'animate-action-button-exit-delayed'
                        : 'animate-slide-up-fade-in-delayed transition-all hover:bg-black hover:text-white active:scale-[0.98]'
                    }`}
                  >
                    <span>sit in the sun</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </>
              )}
            </div>
            {SHOW_SUN_TIME_LABEL && (
              <p className="pt-1 text-center text-[11px] font-medium text-black/55">
                {locationSource === 'waiting'
                  ? 'finding your location...'
                  : `${sunnyMinutes}m ${sunnyRemainingSeconds}s in sun today`}
              </p>
            )}
            {error && (
              <p className="rounded-2xl border border-black/20 bg-white/40 px-4 py-3 text-center text-xs font-semibold text-rose-700">
                {error}
              </p>
            )}
          </div>
        </section>
      </main>

      {!isMapOpen && !isMapClosing && (
        <button
          type="button"
          onClick={openMap}
          aria-label="Open map"
          className="fixed right-0 top-1/2 z-[55] flex h-12 w-6 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-black bg-[#f3f1ec] shadow-md active:scale-95"
        />
      )}

      <div
        onTransitionEnd={handleMapPanelTransitionEnd}
        className={`map-slide-panel fixed inset-0 z-50 bg-slate-100 ${
          mapSlideReady ? 'transition-transform duration-[2000ms] ease-out' : ''
        } ${isMapOpen ? 'translate-x-0' : 'translate-x-full'} ${
          !isMapOpen && !isMapClosing ? 'pointer-events-none' : ''
        }`}
      >
        <div className={isMapOpen ? 'h-full w-full' : 'pointer-events-none h-full w-full'}>
          <MapDisplay
            userLocation={userLocation}
            locationSource={locationSource}
            locationAccuracy={locationAccuracy}
            isTracking={isTracking}
            isPinningMode={isPinningMode}
            showAllScouts={showAllScouts}
            onUserLocationChange={handleManualLocationChange}
            onLocateMe={locateUser}
            onToggleTracking={setIsTracking}
            onSelectScout={handleSelectScout}
            path={generatedPath}
            walkedTrail={tracking.walkedTrail}
            benches={foundBenches ?? undefined}
            mode={mode}
            displayDate={isSimulating ? effectiveTime : undefined}
            isCurrentlySunny={tracking.isCurrentlyInSun}
            onNewPath={handleNewPath}
            onStartWalk={handleStartWalk}
            canCyclePath={(generatedPath?.allScouts?.length ?? 0) > 1}
          />
        </div>

        {showMapCircleControl && (
          <div
            className={`pointer-events-auto absolute left-0 top-1/2 z-[1001] -translate-y-1/2 ${mapCircleTransformClass}`}
            aria-expanded={isMapOpen}
          >
            {showSettledBackButton ? (
              <button
                type="button"
                onClick={closeMap}
                aria-label="Back to main menu"
                className="flex h-12 w-6 items-center justify-center rounded-r-full border border-l-0 border-black bg-[#f3f1ec] shadow-md active:scale-95"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
              </button>
            ) : (
              <div className="flex h-12 w-12 overflow-hidden rounded-full border border-black bg-[#f3f1ec] shadow-md">
                <div
                  className="flex h-12 w-6 items-center justify-center bg-[#f3f1ec]"
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={closeMap}
                  aria-label="Back to main menu"
                  className="flex h-12 w-6 items-center justify-center bg-[#f3f1ec] active:scale-95"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 12H5" />
                    <path d="m12 19-7-7 7-7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
