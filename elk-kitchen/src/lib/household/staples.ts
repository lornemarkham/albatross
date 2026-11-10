// Household staples and dressings as ordinary recipes in the book. They are
// put there once per name: a recipe already in the book under the same name
// (including one someone deleted) is never replaced or brought back.

import { blankDetails } from "../meat";
import type { RecipeStore } from "../recipeStorage";
import type { RecipeInput } from "../../types/recipe";
import { findExisting, SEED_RECIPES as SAUSAGE_RECIPES } from "../sausage/today";

const FROM = "A household staple, written for the family book. Edit it to match how you make it.";

function staple(title: string, ingredients: string[], steps: string[], tags: string[], notes = ""): RecipeInput {
  return {
    title, authorName: "", ingredients: ingredients.join("\n"),
    instructions: steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    notes: notes ? `${notes}\n\n${FROM}` : FROM,
    tags: ["staple", ...tags], suggestedTags: [], approxCalories: null,
    kind: "general", category: "Staples & dressings", photos: [], details: blankDetails(),
  };
}

export const STAPLE_RECIPES: RecipeInput[] = [
  { ...staple("Pork Chops with Mushroom Pan Sauce", ["4 bone-in pork chops", "250 g mushrooms, sliced", "2 tbsp butter", "1 onion, sliced", "2 garlic cloves", "120 ml chicken stock", "60 ml cream", "1 tsp fresh thyme", "Salt and pepper"],
    ["Pat the chops dry and season both sides.", "Sear in a hot pan 4 minutes a side. Rest on a plate.", "Melt the butter in the same pan. Cook the mushrooms and onion until golden, about 8 minutes.", "Add the garlic and thyme for 1 minute, then the stock. Reduce by half.", "Stir in the cream, return the chops, and warm through until they reach 63 °C inside."],
    ["dinner", "pork", "weeknight"], "Serve with mash or rice. The pan sauce uses stock: see the Chicken Stock staple."), category: "Dinners" },
  staple("House Vinaigrette", ["120 ml olive oil", "40 ml red wine vinegar", "1 tsp Dijon mustard", "1 tsp honey", "1 small garlic clove, grated", "Salt and pepper"],
    ["Put everything in a jar.", "Shake hard for 20 seconds, until it thickens slightly.", "Taste on a lettuce leaf and adjust the salt or vinegar."],
    ["dressing", "salad", "quick"], "Keeps a week in the fridge. Shake again before using."),
  staple("Ranch Dressing", ["120 g sour cream", "120 g mayonnaise", "120 ml buttermilk", "1 tsp dried dill", "1 tsp dried chives", "1/2 tsp garlic powder", "1/2 tsp onion powder", "Salt and pepper"],
    ["Whisk the sour cream, mayonnaise and buttermilk until smooth.", "Stir in the herbs and powders.", "Rest 30 minutes in the fridge, then taste and adjust."],
    ["dressing", "dip", "salad"], "Thin it with a splash of buttermilk for a salad, leave it thick for a dip."),
  staple("Soy-Ginger Dressing", ["60 ml soy sauce", "30 ml sesame oil", "45 ml rice vinegar", "1 tbsp fresh grated ginger", "1 tsp honey", "Optional chili oil"],
    ["Whisk everything together.", "Taste: add honey if it is too sharp, vinegar if too salty."],
    ["dressing", "asian", "salad"], "The dressing for the ELK Crunch Bowl."),
  staple("Honey Mustard Dressing", ["60 g Dijon mustard", "60 ml honey", "60 ml olive oil", "30 ml apple cider vinegar", "Salt"],
    ["Whisk the mustard, honey and vinegar.", "Whisk in the oil in a thin stream.", "Season with salt."],
    ["dressing", "salad", "sauce"]),
  staple("Chicken Stock", ["1 chicken carcass, or 900 g bones", "2 carrots", "2 celery stalks", "1 onion, halved", "2 bay leaves", "6 peppercorns", "2 litres cold water"],
    ["Put everything in a large pot and bring to a gentle simmer.", "Skim the foam in the first 20 minutes.", "Simmer 3 to 4 hours, uncovered, never boiling hard.", "Strain, cool quickly, then refrigerate or freeze in portions."],
    ["stock", "soup", "freezer"], "Use within 4 days in the fridge, or 3 months frozen."),
  staple("Basic Tomato Sauce", ["800 g canned whole tomatoes", "60 ml olive oil", "4 garlic cloves, sliced", "1 small onion, finely diced", "1 tsp dried oregano", "Salt", "Fresh basil, if you have it"],
    ["Soften the onion in the oil over medium heat, about 8 minutes.", "Add the garlic for 1 minute.", "Add the tomatoes, crushing them by hand, and the oregano.", "Simmer 25 minutes, stirring now and then.", "Season with salt and finish with basil."],
    ["sauce", "pasta", "freezer"], "Freezes well in jars or bags."),
  staple("Pizza Dough", ["500 g bread flour", "325 ml warm water", "7 g instant yeast", "10 g salt", "15 ml olive oil"],
    ["Mix the flour, yeast and salt. Add the water and oil.", "Knead 8 to 10 minutes until smooth.", "Cover and let rise 1 to 2 hours, until doubled.", "Divide in two, shape, top and bake at the hottest oven setting for 8 to 12 minutes."],
    ["dough", "baking", "weekend"], "Makes two 30 cm pizzas. A night in the fridge makes better flavour."),
  staple("Quick Pickled Red Onions", ["1 red onion, thinly sliced", "120 ml white or cider vinegar", "120 ml warm water", "1 tbsp sugar", "1 tsp salt"],
    ["Pack the onion into a jar.", "Stir the vinegar, water, sugar and salt until dissolved, and pour over.", "Leave 30 minutes. Keep in the fridge for up to 2 weeks."],
    ["pickle", "topping", "quick"], "Good on tacos, bowls and sandwiches."),
];

// The staples, plus the sausage cards (those four recipes are the family's, not a
// date-limited extra), so the book always has them. Returns how many were added.
let running: Promise<number> | null = null;
export function ensureHouseholdRecipes(store: RecipeStore): Promise<number> {
  // Two screens asking at once (or a double render) must not both add the same recipe.
  running ??= addMissing(store).finally(() => { running = null; });
  return running;
}

async function addMissing(store: RecipeStore): Promise<number> {
  const book = [...(await store.listRecipes()), ...(await store.listRemoved())];
  let added = 0;
  for (const input of [...STAPLE_RECIPES, ...SAUSAGE_RECIPES]) {
    if (findExisting(book, input)) continue;
    book.push((await store.createRecipe(input)) as (typeof book)[number]);
    added++;
  }
  return added;
}
