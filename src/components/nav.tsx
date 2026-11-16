"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useER } from "./er-provider";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/documents", label: "Documents" },
  { href: "/entities", label: "Entities" },
  { href: "/review", label: "Review" },
  { href: "/audit", label: "Audit log" },
];

export function Nav() {
  const pathname = usePathname();
  const { queue, extraction, ready } = useER();
  const open = queue.filter((q) => !q.skipped).length;
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <span className="grid h-6 w-6 place-items-center rounded bg-stone-900 text-[10px] font-bold text-white">ER</span>
          Reversible entity resolution
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cx("rounded-md px-2.5 py-1", active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100")}
              >
                {l.label}
                {l.href === "/review" && ready && open > 0 && (
                  <span className={cx("ml-1.5 rounded-full px-1.5 text-[11px] font-semibold", active ? "bg-amber-400 text-stone-900" : "bg-amber-100 text-amber-900")}>
                    {open}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <span
          className={cx(
            "ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
            extraction.extractor === "llm" ? "bg-violet-50 text-violet-800 ring-violet-200" : "bg-stone-100 text-stone-700 ring-stone-200",
          )}
          title="Which extractor produced the mentions"
        >
          {extraction.running ? "Extracting…" : extraction.label}
        </span>
      </div>
    </header>
  );
}
