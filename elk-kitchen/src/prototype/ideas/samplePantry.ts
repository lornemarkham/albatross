// A pretend Pantry snapshot, shaped like what ELK Pantry would return. It is
// NOT the household's real Pantry (Kitchen doesn't read Inventory's tables —
// see README "Boundary with ELK Inventory"). Best-before dates are relative
// to today so "use soon" always has something to show.
//
// Like the real thing, it's incomplete on purpose: cupboard and freezer
// goods, no fridge items, no produce.

import type { PantryItem } from "./types";

function plusDays(today: string, n: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function samplePantry(today: string): PantryItem[] {
  const at = (n: number | null) => (n === null ? null : plusDays(today, n));
  return [
    { name: "Black Beans", onHand: 3, unit: "cans", bestBefore: at(400), location: "Pantry shelf" },
    { name: "Chickpeas", onHand: 2, unit: "cans", bestBefore: at(300), location: "Pantry shelf" },
    { name: "Diced Tomatoes", onHand: 4, unit: "cans", bestBefore: at(500), location: "Pantry shelf" },
    { name: "Kidney Beans", onHand: 0, unit: "cans", bestBefore: null, location: "Pantry shelf" },
    { name: "Chicken Stock", onHand: 2, unit: "cartons", bestBefore: at(3), location: "Pantry shelf" },
    { name: "Basmati Rice", onHand: 1, unit: "bags", bestBefore: at(200), location: "Pantry shelf" },
    { name: "Red Lentils", onHand: 1, unit: "bags", bestBefore: at(150), location: "Pantry shelf" },
    { name: "Pasta", onHand: 2, unit: "boxes", bestBefore: at(250), location: "Pantry shelf" },
    { name: "Rolled Oats", onHand: 1, unit: "bags", bestBefore: at(120), location: "Baking cupboard" },
    { name: "Peanut Butter", onHand: 1, unit: "jars", bestBefore: at(90), location: "Pantry shelf" },
    { name: "Honey", onHand: 1, unit: "jars", bestBefore: null, location: "Baking cupboard" },
    { name: "Maple Syrup", onHand: 1, unit: "bottles", bestBefore: at(60), location: "Pantry shelf" },
    { name: "Chocolate Chips", onHand: 1, unit: "bags", bestBefore: at(4), location: "Baking cupboard" },
    { name: "Salsa", onHand: 0, unit: "jars", bestBefore: null, location: "Pantry shelf" },
    { name: "Flour Tortillas", onHand: 1, unit: "packs", bestBefore: at(6), location: "Pantry shelf" },
    { name: "Boneless Chicken Thighs", onHand: 2, unit: "packs", bestBefore: at(80), location: "Chest freezer" },
    { name: "Ground Turkey", onHand: 1, unit: "packs", bestBefore: at(60), location: "Chest freezer" },
  ];
}
