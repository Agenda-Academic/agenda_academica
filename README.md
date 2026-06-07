# Agenda Academica

Agenda Academica Digital Unificada para centralizar datas, provas, trabalhos, atividades, eventos institucionais e lembretes da comunidade academica.

## Escopo

- Centralizar eventos academicos em lista e calendario.
- Separar perfis de aluno, professor e administrador institucional.
- Permitir que professores criem, editem e removam eventos das turmas que ministram.
- Permitir que alunos visualizem eventos, filtrem por categoria e configurem lembretes pessoais.
- Importar datas oficiais da reitoria como fonte institucional prioritaria.
- Enviar notificacoes por e-mail e preparar suporte para push/app.
- Manter o foco em organizacao temporal, sem calcular notas, medias ou frequencia.

## Stack

- `backend`: API em AdonisJS, banco SQLite em desenvolvimento e dominio academico.
- `frontend`: aplicacao Next.js responsiva para dashboard, calendario, detalhes e gestao docente.

## Requisitos Funcionais Mapeados

- `RF01`: visualizacao de cronograma em lista e calendario.
- `RF02`: filtros por provas, trabalhos, atividades e eventos oficiais.
- `RF03`: sincronizacao/importacao automatica ou agendada do calendario institucional.
- `RF04`: gestao docente de eventos por turma/disciplina.
- `RF05`: tela de detalhes da atividade com professor, data, descricao e pontuacao informativa.
- `RF06`: lembretes configuraveis por usuario.

## Regras Principais

- Datas oficiais prevalecem sobre eventos locais quando houver conflito.
- Alunos nao alteram eventos oficiais nem eventos de professor.
- Professores so gerenciam eventos vinculados as suas disciplinas/turmas.
- Pontuacao de atividade e apenas informativa; o sistema nao faz gestao de desempenho.

## Desenvolvimento

```bash
npm install
npm run dev
```

Cada pacote tambem pode ser executado separadamente:

```bash
npm run dev:backend
npm run dev:frontend
```

## Rotinas Operacionais

```bash
cd backend
node ace calendar:sync-official
node ace calendar:sync-official --source=./calendario-oficial.json
node ace reminders:send-due
node ace reminders:send-due --dry-run
```

O formato aceito pela sincronizacao e um JSON com `sourceName` e `events`, ou diretamente um array de eventos institucionais.
