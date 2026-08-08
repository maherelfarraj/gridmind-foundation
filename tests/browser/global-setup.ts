// GC-17 browser suite — global setup: seed the isolated tenant once.
import { envReady, seedFixture } from "./fixtures";

export default async function globalSetup() {
  if (!envReady()) {
    throw new Error(
      "GC-17 browser suite needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  const fixture = await seedFixture();
  console.info(`[gc17-browser] seeded tenant ${fixture.companyId} (project ${fixture.projectId})`);
}
