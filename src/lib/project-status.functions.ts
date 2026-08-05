// Governed project completion and reopen server functions.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { projectStatusInput, reopenProjectInput } from "@/lib/project-status.schemas";
import {
  completeProjectStatus,
  reopenProjectStatus,
  type ProjectStatusResult,
} from "@/lib/project-status.server";

export const completeProject = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: unknown) => projectStatusInput.parse(input))
  .handler(
    async ({ data, context }): Promise<ProjectStatusResult> =>
      completeProjectStatus(context, data.projectId),
  );

export const reopenProject = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((input: unknown) => reopenProjectInput.parse(input))
  .handler(
    async ({ data, context }): Promise<ProjectStatusResult> =>
      reopenProjectStatus(context, data.projectId, data.reason),
  );
