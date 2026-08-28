import type { Metadata } from "next";
import { LanguageProvider } from "@/i18n/language-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CUT/WEAVE LAB — Faster prep for editors",
    template: "%s — CUT/WEAVE LAB",
  },
  description:
    "Find face-matched scenes, create music and bass markers, and enhance video quality without sending your media away.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
