import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "@fontsource-variable/space-grotesk";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource-variable/noto-nastaliq-urdu";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Asli — is it real?", template: "%s · Asli" },
  description: "Relief payments people can trust: signed messages, human-owned money, and help in Urdu by voice. Prototype — not an official service.",
};

export const viewport: Viewport = { themeColor: "#191A23", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
