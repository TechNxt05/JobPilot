import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Narrow, Martian_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const body = Archivo({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Archivo_Narrow({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const figures = Martian_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-figures", display: "swap" });

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
    <html lang="en" className={`${body.variable} ${display.variable} ${figures.variable}`}>
      <body>
        <AppShell />
        {children}
      </body>
    </html>
  );
}
