import type { Metadata } from "next";
import { JetBrains_Mono, Open_Sans } from "next/font/google";
import "./globals.css";

// Mesma fonte do protótipo no Figma: Open Sans no texto e nos títulos.
const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agenda Acadêmica",
  description: "Agenda acadêmica digital para prazos, provas, trabalhos e eventos oficiais.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${openSans.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
