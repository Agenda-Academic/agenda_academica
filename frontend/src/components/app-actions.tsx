"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import type { AcademicContext, AcademicEvent, AppNotification, LinkedStudent, User, UserRole } from "@/lib/types";
import type { View } from "./app-shell";
import type { ToastTone } from "./ui";

/**
 * Ações da página para as telas e os cards das áreas, sem passar função de prop em prop. O Provider fica em
 * app/page.tsx; as áreas usam `useAppActions()`.
 *
 *   const { token, toast, confirm, reload, navigate } = useAppActions();
 */

/** Parâmetros de uma tela, iguais aos do endereço (?tela=...&evento=...&turma=...&membro=...&aluno=...). */
export type NavigateParams = {
  /** Cronograma: abre o detalhe do evento. Notas: a avaliação a destacar (&evento=). */
  eventId?: number | null;
  /** Turmas e disciplinas: abre o painel da turma (&turma=). */
  classId?: number | null;
  /** Turmas e disciplinas: abre o painel do aluno (&membro=, id da conta do aluno), dentro da turma se houver. */
  memberId?: number | null;
  /** Responsável: troca o aluno acompanhado (&aluno=) antes de abrir a tela. */
  studentId?: number | null;
};

/** Pedido para a tela Turmas abrir já com uma turma e, dentro dela, um aluno. */
export type ClassesTarget = {
  classId: number | null;
  memberId: number | null;
  /** Muda a cada pedido (o mesmo alvo pedido de novo reabre o painel). */
  key: number;
};

export type ToastOptions = {
  /** "success" (padrão), "info" ou "danger" (erro fica até a pessoa fechar). */
  tone?: ToastTone;
  /** Botão Desfazer: o aviso fica 10 s, pausa com o mouse ou o foco e não rouba o foco. */
  undo?: () => void | Promise<unknown>;
  /** Outro botão no aviso (ex.: { label: "Ver turma", onClick }). Ignorado se houver undo. */
  action?: { label: string; onClick: () => void };
  /**
   * Assunto do aviso (ex.: "turma-3", "vinculo-7"): um aviso novo do mesmo assunto tira o antigo, com o
   * Desfazer dele.
   */
  key?: string;
  /** Tempo na tela em ms (0: até fechar). Padrão: 6 s; com botão, 10 s; erro, até fechar. */
  duration?: number;
};

export type ConfirmOptions = {
  /** "Excluir turma TADS 5?" */
  title: string;
  /** O que acontece e que não dá para desfazer. */
  message: string;
  /** "Excluir turma" */
  confirmLabel: string;
  /** "Manter turma" (o foco começa nele). Padrão: "Voltar". */
  cancelLabel?: string;
  /** "danger" (padrão) ou "primary". */
  tone?: "danger" | "primary";
  /** Roda depois de confirmar; enquanto a promessa corre, os botões ficam ocupados. */
  action: () => void | Promise<unknown>;
};

/** Registro do painel lateral de uma área no histórico (ver useBackLayer). */
export type BackLayers = {
  open: (id: string, requestClose: () => void) => void;
  close: (id: string) => void;
};

export type AppActions = {
  /** Token da sessão: vai como primeiro argumento das funções de lib/api. */
  token: string;
  user: User;
  role: UserRole;
  /** Contexto carregado (/context). Para o responsável, com linkedStudents. */
  context: AcademicContext | null;
  /** Eventos que a página carregou (os mesmos do Cronograma, com o lembrete da pessoa). */
  events: AcademicEvent[];
  /** A página está carregando dados. */
  loading: boolean;

  /** Aviso embaixo da tela (role="status"), com Desfazer opcional. */
  toast: (text: string, options?: ToastOptions) => void;
  /**
   * Aviso de erro de uma ação: a frase certa de lib/format (422 do campo, 409 e 429 com a frase da API,
   * conexão). 401 é ignorado (a página já mostra a sessão vencida). key: o assunto, como no toast.
   */
  showError: (error: unknown, key?: string) => void;
  /** Confirmação para o que não volta atrás (excluir). O foco começa no botão de manter. */
  confirm: (options: ConfirmOptions) => void;
  /** Recarrega contexto, eventos, lembretes e avisos. true se deu certo. */
  reload: () => Promise<boolean>;

  /** Troca de tela com endereço próprio (?tela=...). Telas que o papel não vê levam ao Painel. */
  navigate: (view: View, params?: NavigateParams) => void;
  /** Abre o detalhe do evento no Cronograma. */
  openEvent: (eventId: number) => void;
  /** Abre a tela Turmas e disciplinas já com uma turma e, nela, um aluno (?tela=turmas&turma=1&membro=4). */
  openClasses: (target?: { classId?: number | null; memberId?: number | null }) => void;
  /** Abre a gaveta de notas da avaliação (EventGradesDrawer). Docente da oferta e administração. */
  openGrades: (eventId: number) => void;
  /** Abre as Configurações do perfil. */
  openProfile: () => void;

  /** Responsável: todos os vínculos ativos e pendentes (context.linkedStudents). */
  linkedStudents: LinkedStudent[];
  /** Responsável: o aluno escolhido (vem de ?aluno=; padrão: o primeiro vínculo ativo). null sem vínculo ativo. */
  student: LinkedStudent | null;
  /** Responsável: troca o aluno (entra no endereço e no histórico) e recarrega. */
  chooseStudent: (studentId: number) => void;

  /** Avisos do sistema ainda não lidos (GET /notifications). */
  notices: AppNotification[];
  /** O número do menu (unreadCount da API). */
  unreadCount: number;
  /** Marca um aviso como lido (sai da lista na hora). */
  readNotice: (id: number) => Promise<void>;
  /** Marca todos como lidos. */
  readAllNotices: () => Promise<void>;
  /** Abre o endereço do aviso (?tela=perfil, ?tela=notas&evento=1...) e marca como lido. */
  openNotice: (notice: AppNotification) => void;

  /** Usado por useBackLayer. */
  backLayers: BackLayers;
};

const AppActionsContext = createContext<AppActions | null>(null);

export function AppActionsProvider({ children, value }: { children: ReactNode; value: AppActions }) {
  return <AppActionsContext.Provider value={value}>{children}</AppActionsContext.Provider>;
}

/** Ações da página. Só dentro do app (depois de entrar); fora dele, use useOptionalAppActions. */
export function useAppActions(): AppActions {
  const value = useContext(AppActionsContext);
  if (!value) {
    throw new Error("useAppActions precisa estar dentro do AppActionsProvider (app/page.tsx).");
  }
  return value;
}

/** Como useAppActions, mas devolve null fora do app (ex.: na tela de entrada). */
export function useOptionalAppActions(): AppActions | null {
  return useContext(AppActionsContext);
}

/**
 * Painel lateral (Drawer) de uma área com entrada própria no histórico: o Voltar do navegador (e o do
 * celular) fecha só o painel, sem sair da tela. `requestClose` é a mesma função do X: ela pode fechar na hora
 * ou perguntar antes de descartar (com confirm), e o painel continua aberto até ela fechar.
 *
 *   const [open, setOpen] = useState(false);
 *   useBackLayer(open, () => setOpen(false));
 *
 * Um painel por vez (nunca painel sobre painel): troque o conteúdo dele e mostre Voltar.
 */
export function useBackLayer(open: boolean, requestClose: () => void) {
  const actions = useOptionalAppActions();
  const layers = actions?.backLayers ?? null;
  const id = useId();
  const closeRef = useRef(requestClose);
  useLayoutEffect(() => {
    closeRef.current = requestClose;
  });
  useEffect(() => {
    if (!open || !layers) {
      return;
    }
    layers.open(id, () => closeRef.current());
    return () => layers.close(id);
  }, [id, layers, open]);
}
