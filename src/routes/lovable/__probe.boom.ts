import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/lovable/__probe/boom")({
  server: {
    handlers: {
      GET: async () => {
        throw new Error("bypass");
      },
    },
  },
});
