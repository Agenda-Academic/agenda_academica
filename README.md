# Agenda Acadêmica

Agenda Acadêmica Digital Unificada para centralizar datas, provas, trabalhos, atividades, eventos institucionais e lembretes da comunidade acadêmica.

## Escopo

- Centralizar eventos acadêmicos em lista e calendário mensal.
- Separar perfis de aluno, professor e administrador institucional.
- Permitir que professores criem, editem, concluam, cancelem e removam eventos das turmas que ministram.
- Permitir que alunos visualizem eventos, filtrem por categoria/período e configurem lembretes pessoais.
- Importar datas oficiais da reitoria como fonte institucional prioritária.
- Enviar notificações por e-mail e preparar suporte para push/app.
- Manter o foco em organização temporal, sem calcular notas, médias ou frequência.

## Stack

- `backend`: API em AdonisJS, banco SQLite em desenvolvimento e domínio acadêmico.
- `frontend`: aplicação Next.js responsiva (mobile com drawer, desktop com sidebar) para dashboard, cronograma, calendário mensal, gestão docente, lembretes e sincronização.

## Funcionalidades da interface

- **Login e cadastro** com contas de demonstração (aluno, professor e admin).
- **Painel**: próximo compromisso em destaque, fila de atenção, agenda da semana, distribuição por categoria e lembretes pendentes.
- **Cronograma**: lista com filtros (busca, categorias, próximos/passados/todos) e **calendário mensal** com navegação, eventos multi-dia e legenda.
- **Detalhe do evento**: painel lateral no desktop e modal no mobile, com lembrete pessoal (criar/atualizar/remover) e ações de gestão (editar, excluir com confirmação, concluir/cancelar/reativar).
- **Gestão docente**: formulário com escopo por vínculo (professor só vê as turmas/disciplinas que ministra; admin cria eventos oficiais sem turma) e lista "meus eventos".
- **Lembretes**: central com pendentes e enviados, remoção e atalho para o evento.
- **Sincronização (admin)**: importação de demonstração, importação de JSON personalizado e histórico de importações.
- **Perfil**: nome, lembrete padrão e canal de notificação.
- Toasts de feedback, sessão expirada com logout automático, acentuação PT-BR consistente.

## Contas de demonstração (seed)

| Perfil    | E-mail              | Senha         |
| --------- | ------------------- | ------------- |
| Aluno     | `diogo@agenda.test` | `password123` |
| Professor | `apio@agenda.test`  | `password123` |
| Admin     | `admin@agenda.test` | `password123` |

## Requisitos Funcionais Mapeados

- `RF01`: visualização de cronograma em lista e calendário.
- `RF02`: filtros por provas, trabalhos, atividades e eventos oficiais.
- `RF03`: sincronização/importação automática ou agendada do calendário institucional.
- `RF04`: gestão docente de eventos por turma/disciplina.
- `RF05`: tela de detalhes da atividade com professor, data, descrição e pontuação informativa.
- `RF06`: lembretes configuráveis por usuário.

## Regras Principais

- Datas oficiais prevalecem sobre eventos locais quando houver conflito.
- Alunos não alteram eventos oficiais nem eventos de professor.
- Professores só gerenciam eventos vinculados às suas disciplinas/turmas.
- Pontuação de atividade é apenas informativa; o sistema não faz gestão de desempenho.

## Desenvolvimento

```bash
npm install
npm run dev
```

Cada pacote também pode ser executado separadamente:

```bash
npm run dev:backend   # API em http://localhost:3333
npm run dev:frontend  # App em http://localhost:3000
```

Primeira execução do backend:

```bash
cd backend
cp .env.example .env
node ace generate:key
node ace migration:run
node ace db:seed
```

> Datas: o backend normaliza datas para UTC ao gravar; entradas sem offset são
> interpretadas como `America/Sao_Paulo`. O frontend sempre envia ISO com offset.

## Testes

```bash
npm test
```

A suíte do backend usa um banco SQLite separado (`backend/tmp/test.sqlite3`),
então rodar os testes não apaga os dados de desenvolvimento.

## Rotinas Operacionais

```bash
cd backend
node ace calendar:sync-official
node ace calendar:sync-official --source=./calendario-oficial.json
node ace reminders:send-due
node ace reminders:send-due --dry-run
```

O formato aceito pela sincronização é um JSON com `sourceName` e `events`, ou diretamente um array de eventos institucionais.
