import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { QueryProvider } from "@/lib/query-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./tokens.css";

export const metadata: Metadata = {
  title: "Study Tracker",
  description: "Track CFA exam preparation against the official topic tree.",
  applicationName: "Study Tracker",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Study Tracker" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover plus safe-area padding is what stops the bottom bar sitting under the
  // home indicator on an installed iOS PWA.
  viewportFit: "cover",
  // Without this the on-screen keyboard overlays the composer instead of
  // resizing the page out from under it.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef0f8" },
    { media: "(prefers-color-scheme: dark)", color: "#070b26" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
          <QueryProvider>
            <ServiceWorkerRegistrar />
            <a href="#main" className="visually-hidden">
              Skip to content
            </a>
            <div id="main">{children}</div>
            <Toaster position="top-center" closeButton />
            {/* Both serve their scripts and beacons from this origin, so the
                same-origin CSP covers them with no exception. */}
            <Analytics />
            <SpeedInsights />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
