import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creative Check — проверка баннеров",
  description: "Пакетная проверка размеров, сетки и дисклеймеров рекламных креативов.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
