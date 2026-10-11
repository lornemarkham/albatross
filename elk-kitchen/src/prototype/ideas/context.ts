// The moment: what Kitchen can know without asking (the date) and what it
// must be told (weather, time, equipment). There is no weather feed and no
// household location, so nothing here guesses either.

import type { Weather } from "./types";

export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// Northern-hemisphere meteorological seasons (an assumption — noted in the UI).
export function seasonOf(iso: string): "winter" | "spring" | "summer" | "autumn" {
  const m = Number(iso.slice(5, 7));
  if (m === 12 || m <= 2) return "winter";
  if (m <= 5) return "spring";
  if (m <= 8) return "summer";
  return "autumn";
}

// nth weekday (0 = Sunday) of a month, as YYYY-MM-DD.
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type Holiday = { name: string; date: string };

// Fixed rules only — no location is known, so both Thanksgivings are listed
// with their country.
export function holidaysIn(year: number): Holiday[] {
  return [
    { name: "Valentine's Day", date: `${year}-02-14` },
    { name: "Canada Day", date: `${year}-07-01` },
    { name: "Independence Day (US)", date: `${year}-07-04` },
    { name: "Thanksgiving (Canada)", date: nthWeekday(year, 10, 1, 2) },
    { name: "Halloween", date: `${year}-10-31` },
    { name: "Thanksgiving (US)", date: nthWeekday(year, 11, 4, 4) },
    { name: "Christmas", date: `${year}-12-25` },
    { name: "New Year's Eve", date: `${year}-12-31` },
  ];
}

export function upcomingHolidays(today: string, withinDays = 14): (Holiday & { inDays: number })[] {
  const year = Number(today.slice(0, 4));
  const t = Date.UTC(year, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return [...holidaysIn(year), ...holidaysIn(year + 1)]
    .map((h) => {
      const [y, m, d] = h.date.split("-").map(Number);
      return { ...h, inDays: Math.round((Date.UTC(y, m - 1, d) - t) / 86_400_000) };
    })
    .filter((h) => h.inDays >= 0 && h.inDays <= withinDays);
}

export function whenLabel(inDays: number, date: string): string {
  if (inDays === 0) return "today";
  if (inDays === 1) return "tomorrow";
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en", { weekday: "long", timeZone: "UTC" });
  return inDays < 7 ? `on ${weekday}` : `in ${inDays} days`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 11) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export const WEATHER_LABEL: Record<Weather, string> = {
  hot: "Hot out",
  mild: "Mild",
  cold: "Chilly",
  rainy: "Rainy",
};

// Opt-in local weather. Only runs when the person taps "Check the weather";
// their position is rounded to ~10 km and goes only to Open-Meteo (free, no
// key, no account). Nothing is stored.
export type WeatherReading = { tempC: number; code: number };

// WMO weather codes (Open-Meteo): 51–67 drizzle/rain, 71–77 snow, 80–86
// showers, 95–99 thunder.
export function weatherFromReading({ tempC, code }: WeatherReading): { weather: Weather; note: string } {
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  const weather: Weather = snow || tempC <= 8 ? "cold" : wet ? "rainy" : tempC >= 25 ? "hot" : "mild";
  const sky = snow ? "snow" : wet ? "rain" : code <= 1 ? "clear" : code <= 3 ? "cloudy" : code <= 48 ? "fog" : "";
  return { weather, note: `${Math.round(tempC)}°C${sky ? `, ${sky}` : ""} nearby · Open-Meteo` };
}

export async function fetchLocalWeather(): Promise<WeatherReading> {
  const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error("This browser can't share a location."));
    else navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Location wasn't shared, so Kitchen can't look up the weather.")), { maximumAge: 30 * 60_000, timeout: 10_000 });
  });
  const round = (n: number) => Math.round(n * 10) / 10;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${round(pos.coords.latitude)}&longitude=${round(pos.coords.longitude)}&current=temperature_2m,weather_code&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't reach the weather service.");
  const j = await res.json() as { current?: { temperature_2m?: number; weather_code?: number } };
  if (typeof j.current?.temperature_2m !== "number") throw new Error("The weather service didn't answer.");
  return { tempC: j.current.temperature_2m, code: j.current.weather_code ?? 0 };
}
