import * as z from "zod";
export const projectStatusInput = z.object({ projectId: z.string().uuid() });

export const reopenProjectInput = projectStatusInput.extend({
  reason: z.string().trim().min(1).max(2000),
});
