"use client";

import { GraduationCap, Mail, PencilLine } from "lucide-react";

// Lado esquerdo da tela de entrar: uma folha de agenda do mês atual, com o dia de hoje
// circulado a caneta, uma prova marcada com marca-texto e os avisos chegando ao lado.
// É só ilustração: os eventos daqui não vêm da API.

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const DIAS_LONGOS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// distância em dias a partir de hoje -> tipo do ponto embaixo do número
const MARCAS: Record<number, "prova" | "trab" | "ativ" | "fer"> = {
  [-9]: "prova",
  [-4]: "trab",
  1: "ativ",
  2: "prova",
  4: "fer",
  8: "trab",
  11: "prova",
};

const ANEL = "M35 5C52 4 62 16 59 30C56 45 38 53 22 49C7 45 2 31 7 19C12 8 26 3 40 6C45 7 49 9 51 11";

export function LoginStage() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const primeiro = new Date(ano, mes, 1).getDay();
  const total = new Date(ano, mes + 1, 0).getDate();
  const diaProva = new Date(ano, mes, hoje.getDate() + 2);

  const dias = Array.from({ length: total }, (_, i) => {
    const dia = i + 1;
    const pos = dia - 1 + primeiro;
    const marca = MARCAS[dia - hoje.getDate()];
    return {
      dia,
      linha: Math.floor(pos / 7) + 2,
      coluna: (pos % 7) + 1,
      passado: dia < hoje.getDate(),
      hoje: dia === hoje.getDate(),
      domingo: pos % 7 === 0,
      marca,
      marcado: dia - hoje.getDate() === 2,
    };
  });

  return (
    <div className="ls-palco">
      <div className="ls-marca">
        <span className="mark">
          <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <div>
          <p className="brand-name">Agenda Acadêmica</p>
          <p className="brand-sub">Prazos, notas e lembretes</p>
        </div>
      </div>

      <p className="ls-titulo">
        Sua semana acadêmica, <em>já organizada.</em>
      </p>

      <div className="ls-cena" aria-hidden>
        <div className="ls-folha">
          <div className="ls-folha-cab">
            <p className="ls-mes">
              {MESES[mes]} <span>{ano}</span>
            </p>
          </div>
          <div className="ls-grade">
            {DIAS.map((d, i) => (
              <span key={i} className="ls-dow" style={{ gridRow: 1, gridColumn: i + 1 }}>
                {d}
              </span>
            ))}
            {dias.map((d, i) => (
              <span
                key={d.dia}
                className={[
                  "ls-dia",
                  d.passado && "passado",
                  d.hoje && "hoje",
                  d.domingo && "domingo",
                  d.marcado && "marcado",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ gridRow: d.linha, gridColumn: d.coluna, ["--k" as string]: i }}
              >
                <span className="ls-num">{d.dia}</span>
                {d.hoje ? (
                  <svg className="ls-anel" viewBox="0 0 64 56">
                    <path d={ANEL} />
                  </svg>
                ) : null}
                <i className={d.marca ? `ls-pt d-${d.marca}` : "ls-pt vazio"} />
              </span>
            ))}
          </div>
        </div>

        <div className="ls-avisos">
          <div className="ls-nota prova">
            <span className="ls-ic">
              <PencilLine className="h-[18px] w-[18px]" />
            </span>
            <span className="ls-k">
              {DIAS_LONGOS[diaProva.getDay()]}, {diaProva.getDate()}, 19:00
            </span>
            <b>Prova de Estrutura de Dados</b>
            <small>Laboratório 3, faltam 2 dias</small>
          </div>
          <div className="ls-nota email">
            <span className="ls-ic">
              <Mail className="h-[18px] w-[18px]" />
            </span>
            <span className="ls-k">Lembrete por e-mail</span>
            <b>Amanhã tem prova, às 19:00</b>
            <small>chega 1 dia antes, no seu e-mail</small>
          </div>
          <div className="ls-nota nota">
            <span className="ls-ic">
              <GraduationCap className="h-[18px] w-[18px]" />
            </span>
            <span className="ls-k">Nota publicada</span>
            <b>Matemática (P2)</b>
            <small>a professora publicou hoje</small>
            <span className="ls-valor">
              7,5<small>/10</small>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
