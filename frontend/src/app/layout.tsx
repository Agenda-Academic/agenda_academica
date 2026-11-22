import type { Metadata } from "next";
import { JetBrains_Mono, Onest, Sora } from "next/font/google";
import "./globals.css";

// Rodada 10 (Pantanal forte): Sora nos títulos e números (contagens, notas, indicadores, selo de data) e Onest no
// texto. As duas são variáveis (pesos 400 a 800 usados). A mono fica para códigos e atalhos.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin", "latin-ext"],
  display: "swap",
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
    <html lang="pt-BR" className={`${sora.variable} ${onest.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
