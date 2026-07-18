import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, Bricolage_Grotesque, IBM_Plex_Mono } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BrainBolt — Adaptive Quiz",
  description:
    "A quiz that reads your ability and adapts. Climb the levels, hold a streak, top the board.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0f" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
  ],
};

// Applies the saved theme before first paint. Without this the page paints dark
// and flips to light after hydration.
const themeScript = `try{var t=localStorage.getItem('bb-theme');if(t!=='light'){document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${inter.variable} ${bricolage.variable} ${plexMono.variable} font-sans min-h-screen bg-bb-bg text-bb-text antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
