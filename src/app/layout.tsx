export const metadata = { title: "Asli — prototype", description: "Trust infrastructure for relief payments (Coder's Cup 2026 prototype)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ur">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
