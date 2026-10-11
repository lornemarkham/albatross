import { useKitchen } from "../context/KitchenContext";
import { loadPantry, type PantryLoad } from "./pantry";
import { supabase } from "./supabase";
import { useLoad } from "./useLoad";

// ELK Pantry for the signed-in family member; "off" for anyone else (the
// database would refuse them anyway).
export function usePantry(): { pantry: PantryLoad | "off" | undefined; error: string | null } {
  const { member } = useKitchen();
  const { data, error } = useLoad<PantryLoad | "off">(
    async () => (member && supabase ? loadPantry(supabase) : "off"),
    [member],
  );
  return { pantry: data, error };
}
