import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/__probe/401")({
  server: {
    handlers: {
      GET: async () => {
        throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
      },
    },
  },
});
