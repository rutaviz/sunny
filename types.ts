
export interface Coordinate {
  lat: number;
  lng: number;
}

export interface PathResult {
  id: string;
  coordinates: Coordinate[];
  sunScore: number;
  durationMinutes: number;
  distanceKm: number;
  allScouts?: PathResult[];
}

export interface BenchResult {
  id: string;
  coordinate: Coordinate;
  isSunny: boolean;
  name?: string;
  distanceMeters: number;
}

export interface WeatherInfo {
  condition: 'clear' | 'cloudy' | 'rainy' | 'night';
  description: string;
  temp: number;
  isDay: boolean;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOCATING = 'LOCATING',
  CHECKING_WEATHER = 'CHECKING_WEATHER',
  GENERATING = 'GENERATING',
  READY = 'READY',
  NO_SUNLIGHT = 'NO_SUNLIGHT',
  ERROR = 'ERROR'
}

export enum AppMode {
  WALK = 'WALK',
  SIT = 'SIT'
}

export interface SunTrackingState {
  totalSeconds: number;
  isCurrentlyInSun: boolean;
  hasAchievedMilestone: boolean;
  hasAchievedGoal: boolean;
  walkedTrail: Coordinate[];
}
