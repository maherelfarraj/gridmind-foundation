import { createFileRoute } from "@tanstack/react-router";

// TEMPORARY — verifies the SSR error wrapper produces a branded 500.
// Delete after verification.
export const Route = createFileRoute("/api/__test-500")({
  server: {
    handlers: {
      GET: () => {
        throw new Error("intentional test throw");
      },
    },
  },
});
