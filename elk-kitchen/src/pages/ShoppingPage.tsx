import { Link } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { loadShoppingList } from "../lib/companion/shopping";
import { supabase } from "../lib/supabase";
import { useLoad } from "../lib/useLoad";
import { INVENTORY_PANTRY_URL } from "./PantryPage";
import { ShoppingBox } from "./KitchenHomePage";
import { useEffect } from "react";

// The family shopping list, full screen: ELK Inventory's own list (Pantry
// owns it), so what's added or ticked here is what every phone sees.
export function ShoppingPage() {
  const { member } = useKitchen();
  const list = useLoad(async () => (member && supabase ? loadShoppingList(supabase) : null), [member]);
  // Someone else may be adding from their phone: look again every 30 seconds while this is open.
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) list.reload(); }, 30_000);
    return () => window.clearInterval(t);
  }, [list.reload]);
  const items = list.data?.status === "ready" ? list.data.items : null;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link to="/" className="text-base font-medium text-sage hover:underline">← Kitchen</Link>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-4xl font-bold text-bark">Shopping list</h1>
        {items && <p className="text-lg text-bark/70">{items.length} to buy</p>}
      </div>
      <p className="mb-4 mt-1 text-base text-bark/70">
        One list for the whole family, kept in ELK Inventory. Recipes add what they're missing; anything already on the list isn't added twice.{" "}
        <a href={INVENTORY_PANTRY_URL} className="font-semibold text-sage underline">Open it in Inventory</a>
      </p>
      <section className="rounded-3xl border border-clay bg-cream p-5 shadow-sm">
        <ShoppingBox items={items} state={list.data} reload={list.reload} />
      </section>
      {list.error && <p className="mt-3 text-red-700">{list.error}</p>}
    </div>
  );
}
