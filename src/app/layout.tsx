import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outpost — placement marketplace",
  description: "Browse vetted publications, buy placements, track every link to a verified live URL.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
