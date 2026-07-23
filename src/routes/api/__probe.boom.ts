import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/__probe/boom")({
  server: {
    handlers: {
      GET: async () => {
        throw new Error("boom");
      },
    },
  },
});
