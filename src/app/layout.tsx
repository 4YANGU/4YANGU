import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "StoYangu · WOYOYO-017 release & demo",
  description: "The WOYOYO-017 fix pack for 4YANGU, with a runnable demo of every change.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#f7f5ee] text-[#17261f] antialiased">{children}</body>
    </html>
  );
}
