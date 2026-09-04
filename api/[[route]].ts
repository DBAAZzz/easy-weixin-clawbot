// Vercel catch-all function for /api/*.
// The implementation lives in @clawbot/server (see src/api/vercel-demo.ts);
// this file only exists so Vercel's `api/` filesystem routing picks it up.
export { default } from "../packages/server/dist/api/vercel-demo.js";
