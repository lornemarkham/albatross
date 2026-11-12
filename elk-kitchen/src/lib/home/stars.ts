// Family ratings are stored as 0–10 (kitchen.sql, unchanged since v5), so
// every rating ever given keeps its meaning. Kitchen asks and shows them as
// 1–5 stars: a star is two points. Nothing is rescaled in the database.

export const MAX_STARS = 5;

export const starsToRating = (stars: number) => Math.max(0, Math.min(10, Math.round(stars) * 2));

// 8 → 4, 9 → 4.5, 7.7 → 3.9 (one decimal).
export const ratingToStars = (rating: number) => Math.round((rating / 2) * 10) / 10;

// How many whole stars a picker lights up for a stored rating (9 → 5, 7 → 4).
export const litStars = (rating: number | null) => (rating == null ? 0 : Math.max(0, Math.min(MAX_STARS, Math.round(rating / 2))));

export function starText(rating: number): string {
  const s = ratingToStars(rating);
  const whole = Math.round(s);
  return `${"★".repeat(whole)}${"☆".repeat(MAX_STARS - whole)} ${s}`;
}
