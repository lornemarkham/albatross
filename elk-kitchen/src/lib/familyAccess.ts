// Who may use ELK is decided by the database: the ELK family list
// (public.elk_family_members, owned by ELK Inventory's
// supabase-family-access.sql). This only reads the answer so a signed-in
// stranger sees "not on the family list" instead of an empty page — hiding
// the UI is a courtesy, not the protection.

export type FamilyAccess =
  | { status: "member" }
  | { status: "not-member" }
  // The family list doesn't exist yet. Shared recipes stay off (kitchen.sql
  // refuses to run without it), so the app keeps using this device.
  | { status: "not-set-up" }
  | { status: "error"; error: string };

export function classifyAccess(
  data: unknown,
  error: { code?: string; message?: string } | null,
): FamilyAccess {
  if (error) {
    // PGRST202 = PostgREST can't find the function.
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
      return { status: "not-set-up" };
    }
    return { status: "error", error: error.message ?? "Unknown error" };
  }
  return data === true ? { status: "member" } : { status: "not-member" };
}
