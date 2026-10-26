import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { InlineScript } from "@/components/inline-script";
import { DEFAULT_SITE_THEME, SITE_THEME_STORAGE_KEY } from "@/lib/site-theme";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const themeBootstrapScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(SITE_THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export const metadata: Metadata = {
  title: {
    default: "CUT/WEAVE — Keep the cut.",
    template: "%s — CUT/WEAVE",
  },
  description:
    "Find a face or an animated character across a video, mark the beats, write subtitles and cut out a subject, all in your browser. Your media never leaves the device.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme={DEFAULT_SITE_THEME} className={`${archivo.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <InlineScript html={themeBootstrapScript} />
      </head>
      <body>{children}</body>
    </html>
  );
}
