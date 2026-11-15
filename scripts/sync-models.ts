/**
 * Automated script to synchronize models from Command Code upstream into the catalog.
 */

import { refreshCatalog } from "../src/dynamic-catalog.js";

async function main() {
  console.log("[sync-models] Checking live Command Code upstream models...");
  const { models, newCount } = await refreshCatalog();
  console.log(`[sync-models] Upstream scan complete. Total models: ${models.length}, New detected: ${newCount}`);
}

main().catch((err) => {
  console.error("[sync-models] Error:", err);
  process.exit(1);
});
