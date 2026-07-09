import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Data War Room",
  description: "Private cinematic wallboard for realtime data operations."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#03080d"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
