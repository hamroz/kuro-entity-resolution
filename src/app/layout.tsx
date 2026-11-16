import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ERProvider } from "@/components/er-provider";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Reversible entity resolution for construction documents",
  description:
    "Proof-of-work demo by Hamroz Gavharov: evidence-linked, reversible entity resolution that can say “not sure”.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-stone-50 text-stone-900">
        <ERProvider>
          <Nav />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-stone-200 py-4 text-center text-xs text-stone-500">
            Built by Hamroz Gavharov · sample documents and companies are fictional
          </footer>
        </ERProvider>
      </body>
    </html>
  );
}
