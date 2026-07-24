// P-060 — Printable IFC release certificate.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { Printer } from "lucide-react";

import { getIfcRelease } from "@/lib/ifc-release.functions";
import { ifcReleaseDetailOptions } from "@/lib/ifc-release-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/engineering/ifc-release/$releaseId/certificate",
)({
  component: CertificatePage,
});

function CertificatePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Certificate />
    </Suspense>
  );
}

function Certificate() {
  const { releaseId } = Route.useParams();
  const fn = useServerFn(getIfcRelease);
  const { data } = useSuspenseQuery(ifcReleaseDetailOptions(fn, releaseId));
  const r = data.release;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 bg-background p-6 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-xl font-semibold">Release certificate</h1>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Print
        </Button>
      </div>

      <div className="rounded-lg border border-border p-8">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Issued for Construction — Release Certificate
          </p>
          <h2 className="mt-1 text-2xl font-semibold">{r.package_name}</h2>
          <p className="text-sm text-muted-foreground">
            Status: {r.status.toUpperCase()}
            {r.released_at
              ? ` · Released ${new Date(r.released_at).toLocaleString()}`
              : ""}
          </p>
        </header>

        {r.notes && (
          <section className="mb-6">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="text-sm">{r.notes}</p>
          </section>
        )}

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">
            Revision snapshot ({r.revision_snapshot.length})
          </h3>
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Drawing</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Discipline</th>
                <th className="px-3 py-2 text-left">Revision</th>
              </tr>
            </thead>
            <tbody>
              {r.revision_snapshot.map((row) => (
                <tr key={row.revision_id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.drawing_number}
                  </td>
                  <td className="px-3 py-2">{row.title}</td>
                  <td className="px-3 py-2 text-xs">{row.discipline}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.revision_code}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">Sign-offs</h3>
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Signature</th>
                <th className="px-3 py-2 text-left">Signed at</th>
              </tr>
            </thead>
            <tbody>
              {data.signoffs.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-3 py-2">{s.role_label}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{s.signature_text}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({s.signer_name})
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(s.signed_at).toLocaleString()}
                  </td>
                </tr>
              ))}
              {data.signoffs.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-3 py-2 text-center text-xs text-muted-foreground"
                  >
                    No sign-offs recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {r.distribution_list.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Distribution</h3>
            <ul className="text-sm">
              {r.distribution_list.map((d, i) => (
                <li key={i} className="border-t border-border py-1.5">
                  {d.name}
                  {d.email ? ` · ${d.email}` : ""}
                  {d.org ? ` · ${d.org}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
