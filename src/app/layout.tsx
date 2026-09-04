import type { Metadata } from "next";
import { InlineScript } from "@/components/inline-script";
import { DEFAULT_SITE_THEME, SITE_THEME_STORAGE_KEY } from "@/lib/site-theme";
import "./globals.css";

const themeBootstrapScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(SITE_THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

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
    <html lang="en" data-theme={DEFAULT_SITE_THEME} suppressHydrationWarning>
      <head>
        <InlineScript html={themeBootstrapScript} />
      </head>
      <body>{children}</body>
    </html>
  );
}
