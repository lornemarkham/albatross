// ELK Home: one household interface, many places in the house. Each location
// is a set of screens inside an app that already owns that place's data; ELK
// Home adds no database of its own (docs/decisions/0004). Kitchen is the only
// one built. The others are named so the shell and navigation are shaped for
// them, and are shown as "not yet" rather than as empty screens.

export type LocationKey = "kitchen" | "workshop" | "household" | "power";

export type HomeLocation = {
  key: LocationKey;
  label: string;
  icon: string;
  // Where its screens live today (null = not built).
  home: string | null;
  // The app that owns its data.
  ownedBy: string;
};

export const LOCATIONS: HomeLocation[] = [
  { key: "kitchen", label: "Kitchen", icon: "🍳", home: "/", ownedBy: "ELK Kitchen + ELK Inventory (Pantry)" },
  { key: "workshop", label: "Workshop", icon: "🔧", home: null, ownedBy: "ELK Wrench + ELK Inventory" },
  { key: "household", label: "Household", icon: "🏡", home: null, ownedBy: "ELK Inventory" },
  { key: "power", label: "Power", icon: "⚡", home: null, ownedBy: "ELK Prepared" },
];

export type NavItem = { to: string; icon: string; label: string; match: (path: string) => boolean };

// Kitchen's persistent navigation: few, big, always the same.
export const KITCHEN_NAV: NavItem[] = [
  { to: "/", icon: "🏠", label: "Today", match: (p) => p === "/" },
  { to: "/recipes", icon: "📖", label: "Recipes", match: (p) => p.startsWith("/recipes") || p.startsWith("/recipe/") },
  { to: "/pantry", icon: "🥫", label: "Pantry", match: (p) => p.startsWith("/pantry") },
  { to: "/shopping", icon: "🛒", label: "Shopping", match: (p) => p.startsWith("/shopping") },
  { to: "/cook", icon: "🎤", label: "Cook", match: (p) => p === "/cook" },
  { to: "/food", icon: "➕", label: "Add", match: (p) => p.startsWith("/food") },
];

// Full-screen cooking keeps the whole screen for the recipe.
export const showsNav = (path: string) => !/^\/cook\/[^/]+$/.test(path) && !/^\/ideas\/cook\//.test(path) && !/^\/sausage-day\/[^/]+$/.test(path);
