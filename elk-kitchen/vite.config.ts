import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { scribeByMode } from "./src/lib/scribe/server/handleScribe";

async function readJsonBody(req: any): Promise<any> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return resolve({});
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const scribeApiPlugin = {
  name: "api-scribe",
  configureServer(server: any) {
    server.middlewares.use("/api/scribe", async (req: any, res: any) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }

      try {
        const body = await readJsonBody(req);
        const mode = body?.mode;
        const input = body?.input;

        if ((mode !== "recipe" && mode !== "mechanic") || typeof input !== "string") {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid request body. Expected { mode: 'recipe'|'mechanic', input: string }." }));
          return;
        }

        const result = await scribeByMode(mode, input);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
      } catch (e: any) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: e?.message ?? "Scribe failed" }));
      }
    });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), scribeApiPlugin],
  // Recipe photo reading lives on ELK Inventory's family-only /api/extract
  // (production uses the same rewrite, in vercel.json).
  server: {
    proxy: {
      "/api/extract": { target: "https://elk-inventory.vercel.app", changeOrigin: true },
    },
  },
});
