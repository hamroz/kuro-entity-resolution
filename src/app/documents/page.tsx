import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentsView } from "@/components/documents-view";
import { Loading } from "@/components/ui";

export const metadata: Metadata = { title: "Documents · Reversible entity resolution" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentsView />
    </Suspense>
  );
}
