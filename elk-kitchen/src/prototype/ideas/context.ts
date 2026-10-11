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
