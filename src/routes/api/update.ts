import { createFileRoute } from "@tanstack/react-router";
import { getSession } from "../../server/auth";
import { authEnv, bindings } from "../../server/env";

export const Route = createFileRoute("/api/update")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await getSession(authEnv, request.headers)))
          return new Response("Unauthorized", { status: 401 });

        const installed = bindings.REKAP_ARTIFACT_ID;
        if (!/^[a-f0-9]{64}$/.test(installed || ""))
          return Response.json({ status: "unknown" }, { headers: { "Cache-Control": "no-store" } });

        try {
          const response = await fetch("https://install-rekap-musalabs.ptpcp.id/api/release", {
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error("Release unavailable");
          const latest = (await response.json()) as { artifactId?: unknown };
          if (typeof latest.artifactId !== "string" || !/^[a-f0-9]{64}$/.test(latest.artifactId))
            throw new Error("Invalid release");
          return Response.json(
            { status: latest.artifactId === installed ? "current" : "available" },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json({ status: "unknown" }, { headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
