import type { Metadata } from "next";
import { Suspense } from "react";
import { EntitiesView } from "@/components/entities-view";
import { Loading } from "@/components/ui";

export const metadata: Metadata = { title: "Entities · Reversible entity resolution" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <EntitiesView />
    </Suspense>
  );
}
