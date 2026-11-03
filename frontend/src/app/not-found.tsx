import { CalendarX2, GraduationCap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Página não encontrada | Agenda Acadêmica",
};

/** Endereço que não existe: a mesma cara do sistema e o caminho de volta para o Painel. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-login px-4 py-6 text-ink">
      <section className="card rise w-full max-w-md p-8 text-center" aria-labelledby="pagina-nao-encontrada">
        <div className="flex items-center justify-center gap-3">
          <span className="mark">
            <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
          </span>
          <div className="min-w-0 text-left">
            <p className="brand-name">Agenda Acadêmica</p>
            <p className="brand-sub text-muted">IFMS, Campus Três Lagoas</p>
          </div>
        </div>
        <span className="empty-ico mx-auto mt-8">
          <CalendarX2 className="h-6 w-6" aria-hidden />
        </span>
        <h1 id="pagina-nao-encontrada" className="disp mt-4 text-[30px] font-bold leading-tight">
          Página não encontrada
        </h1>
        <p className="mt-2 text-[14.5px] leading-6 text-muted">O endereço não existe ou mudou.</p>
        <Link className="btn btn-p mt-6 w-full" href="/">
          Ir para o Painel
        </Link>
      </section>
    </main>
  );
}
