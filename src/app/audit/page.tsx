import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditView } from "@/components/audit-view";
import { Loading } from "@/components/ui";

export const metadata: Metadata = { title: "Audit log · Reversible entity resolution" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <AuditView />
    </Suspense>
  );
}
