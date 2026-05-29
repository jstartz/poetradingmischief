import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PoE 2 EV Lab — Crafting & Flip Calculator",
  description: "Expected-value crafting and flip-opportunity scanner for Path of Exile 2, powered by poe2scout & the official trade API.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
