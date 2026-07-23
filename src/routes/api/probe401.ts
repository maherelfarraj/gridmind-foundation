import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/probe401")({
  server: {
    handlers: {
      GET: async () => {
        throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
      },
    },
  },
});
