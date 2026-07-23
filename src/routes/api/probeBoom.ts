import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/probeBoom")({
  server: {
    handlers: {
      GET: async () => {
        throw new Error("boom");
      },
    },
  },
});
