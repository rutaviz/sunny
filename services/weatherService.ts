
import { Coordinate, WeatherInfo } from '../types';

/**
 * Uses Open-Meteo to check current sky conditions and solar status.
 * No API key required for this public endpoint.
 */
export const fetchSunlightOutlook = async (coord: Coordinate): Promise<WeatherInfo> => {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coord.lat}&longitude=${coord.lng}&current=temperature_2m,is_day,weather_code&timezone=auto`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather data unavailable');
    const data = await response.json();
    const current = data.current;

    const code = current.weather_code;
    const isDay = current.is_day === 1;

    let condition: WeatherInfo['condition'] = 'clear';
    let description = 'Clear skies';

    if (!isDay) {
      condition = 'night';
      description = 'Sun is currently below the horizon';
    } else if (code >= 51) {
      condition = 'rainy';
      description = 'Rain or snow detected - shadows are diffused';
    } else if (code >= 3 && code <= 48) {
      condition = 'cloudy';
      description = 'Cloudy or foggy - sunlight may be weak';
    }

    return {
      condition,
      description,
      temp: current.temperature_2m,
      isDay
    };
  } catch (error) {
    console.error('Weather service error:', error);
    // Fallback to a safe "Clear" state if API fails to avoid blocking the app
    return {
      condition: 'clear',
      description: 'Sky status unknown - assuming clear',
      temp: 20,
      isDay: true
    };
  }
};
