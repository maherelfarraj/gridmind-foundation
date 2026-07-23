import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/lovable/probeBoom")({
  server: {
    handlers: {
      GET: async () => {
        throw new Error("bypass");
      },
    },
  },
});
