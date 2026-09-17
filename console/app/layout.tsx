import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
export const metadata: Metadata = {
  title: "MedAI — Agent Console",
  description: "Every call starts with an onchain receipt.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
