import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Space_Mono, Noto_Nastaliq_Urdu } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono-face", display: "swap" });
const nastaliq = Noto_Nastaliq_Urdu({ subsets: ["arabic"], weight: ["400", "600"], variable: "--font-nastaliq", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Asli — is it real?", template: "%s · Asli" },
  description: "Relief payments people can trust: signed messages, human-owned money, and help in Urdu by voice. Prototype — not an official service.",
};

export const viewport: Viewport = { themeColor: "#191A23", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${mono.variable} ${nastaliq.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
