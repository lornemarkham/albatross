import { useKitchen } from "../context/KitchenContext";

// Says plainly where recipes are being saved.
export function ModeNotice() {
  const { notice, email, signOut } = useKitchen();
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-sm">
      {notice === null ? (
        <p className="text-bark/70">Family recipes — shared with everyone on the ELK family list.</p>
      ) : (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          {notice === "shared-off"
            ? "Shared family recipes aren't switched on yet, so recipes are saved on this device only. They can be imported once sharing is on."
            : "Saved on this device only."}
        </p>
      )}
      {signOut && (
        <span className="text-bark/60">
          {email} ·{" "}
          <button type="button" onClick={signOut} className="text-sage underline">Sign out</button>
        </span>
      )}
    </div>
  );
}
