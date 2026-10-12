import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { EvProvider } from "@/lib/store";
import Nav from "@/components/nav";
import Boot from "@/components/boot";
import StorageBanner from "@/components/storage-banner";
import WakeWordListener from "@/components/wake-word-listener";
/* Typeface rationale (spec §visual identity): Geist Sans for UI — a
   technical grotesk that suits a suit-ops console at both micro-label and
   display sizes; Geist Mono for every machine-generated string. */

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "E.V. — Personal AI Companion",
  description:
    "E.V. console for Alfarez: assistant, voice mode, diagnostics simulation, and local memory.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-full`}
      >
        <EvProvider>
          {/* Opt-in ambient wake word — gated on the armed setting, never auto-starts. */}
          <WakeWordListener />
          <Boot />
          <div className="ev-shell">
            <Nav />
            <main className="ev-main">
              <StorageBanner />
              {children}
            </main>
          </div>
        </EvProvider>
      </body>
    </html>
  );
}
