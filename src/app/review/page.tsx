import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewView } from "@/components/review-view";
import { Loading } from "@/components/ui";

export const metadata: Metadata = { title: "Review · Reversible entity resolution" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ReviewView />
    </Suspense>
  );
}
