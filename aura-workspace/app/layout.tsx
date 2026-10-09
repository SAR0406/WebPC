import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AURA Workspace",
  description: "Your personal computer, accessible from anywhere. v0.1 portal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
