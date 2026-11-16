import type { Metadata, Viewport } from "next";
// Fonts are bundled from npm (Fontsource) instead of next/font/google, so builds never depend on Google Fonts' servers
import "@fontsource-variable/archivo/wght.css";
import "@fontsource/archivo-narrow/latin-500.css";
import "@fontsource/archivo-narrow/latin-600.css";
import "@fontsource/archivo-narrow/latin-700.css";
import "@fontsource/martian-mono/latin-400.css";
import "@fontsource/martian-mono/latin-500.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "JobPilot",
  description: "Your job search copilot: find roles that fit, prepare applications, track every follow-up",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1b3f8b" },
    { media: "(prefers-color-scheme: dark)", color: "#17336f" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell />
        {children}
      </body>
    </html>
  );
}
