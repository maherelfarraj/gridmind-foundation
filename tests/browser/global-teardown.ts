// GC-17 browser suite — global teardown: purge the seeded tenant.
import fs from "node:fs";

import { ARTIFACT_DIR, FIXTURE_FILE, purgeFixture, readFixture } from "./fixtures";

export default async function globalTeardown() {
  if (!fs.existsSync(FIXTURE_FILE)) return;
  const fixture = readFixture();
  try {
    await purgeFixture(fixture.companyId);
    console.info(`[gc17-browser] purged tenant ${fixture.companyId}`);
  } finally {
    // Storage states carry live session tokens — never leave them on disk.
    fs.rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  }
}
