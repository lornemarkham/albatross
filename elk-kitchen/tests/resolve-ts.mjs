// Test-only resolve hook: src/ uses extensionless imports (what Vite
// expects); Node's type stripping needs the .ts/.tsx, so add it here.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (err) {
    if (spec.startsWith(".") && !/\\.[cm]?[jt]s$/.test(spec)) return next(spec + ".ts", ctx);
    throw err;
  }
}`));
