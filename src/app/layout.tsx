import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "recall",
  description:
    "A chat demo whose memory survives the session ending, with the stored facts and the exact model payload on screen so you can check it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
