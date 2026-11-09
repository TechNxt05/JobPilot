import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JobPilot",
  description: "AI career copilot: find internships, match your resume, track applications",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthNav />
        {children}
      </body>
    </html>
  );
}
