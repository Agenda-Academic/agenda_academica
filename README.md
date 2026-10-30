# Agenda Acadêmica

Trabalho do curso de TADS do IFMS, Campus Três Lagoas (2026). O sistema junta num lugar só as provas, os trabalhos,
as atividades e as datas oficiais do campus, e avisa o aluno antes de cada prazo.

Sistema no ar: <https://agenda-academica-chi.vercel.app>. As contas de demonstração aparecem na tela de login.

## Equipe

- Diogo Queiroz da Silva
- Gabriel Alves Saran Audácio
- Gabriel da Silva Marques
- Jonathan Patrocinio dos Santos
- Luis Felipe Andrade Dias
- Railson Henrique Martins da Silva

Professora: Profa. Maraísa.

## O que o sistema faz

- O aluno vê no painel o próximo compromisso e os prazos das próximas semanas.
- O cronograma mostra os eventos em lista ou em calendário mensal, com filtro por categoria e por período.
- O aluno cria um lembrete pessoal para qualquer evento, de 15 minutos a 7 dias antes. O aviso é por e-mail: hoje o
  lembrete fica registrado no horário certo e o envio do e-mail ainda está previsto.
- O professor cadastra, edita, conclui, cancela e exclui eventos das turmas em que dá aula.
- A administração importa o calendário oficial da reitoria, que tem prioridade sobre os eventos das turmas.
- Cada perfil vê só o menu e as ações que lhe cabem, e a API confere a permissão antes de salvar.
- O sistema não calcula notas, médias nem frequência. A pontuação das atividades é só informativa.

As telas foram desenhadas antes no Figma (protótipo clicável) e o front segue o mesmo visual.

## Tecnologias

- `frontend`: Next.js e React, publicado no Vercel.
- `backend`: API REST em AdonisJS com banco SQLite, publicada no Render em Docker.

## Contas de demonstração

| Perfil    | E-mail                | Senha         |
| --------- | --------------------- | ------------- |
| Aluno     | `diogo@agenda.test`   | `password123` |
| Professor | `maraisa@agenda.test` | `password123` |
| Admin     | `admin@agenda.test`   | `password123` |

## Requisitos funcionais

Mesma numeração do documento das telas (`docs/telas`).

| RF     | Requisito                     | Telas                              |
| ------ | ----------------------------- | ---------------------------------- |
| `RF01` | Cadastro de conta             | Criar conta                        |
| `RF02` | Autenticação                  | Entrar, sair da conta              |
| `RF03` | Visualização do cronograma    | Agenda, calendário mensal, celular |
| `RF04` | Filtragem de conteúdo         | Agenda, calendário mensal          |
| `RF05` | Painel por perfil             | Painéis do aluno, professor e admin |
| `RF06` | Gestão de eventos             | Gestão                             |
| `RF07` | Detalhamento de evento        | Detalhe do evento                  |
| `RF08` | Lembretes pessoais            | Detalhe do evento, lembretes       |
| `RF09` | Sincronização institucional   | Sincronização                      |
| `RF10` | Preferências do usuário       | Perfil                             |
| `RF11` | Controle de acesso por perfil | Gestão, menu por perfil            |
| `RF12` | Processamento de lembretes    | Lembretes                          |

## Regras principais

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

## Deploy (Vercel + Render)

O front (Next.js) fica no **Vercel** e a API (AdonisJS) no **Render**, os dois no plano grátis. Os dois
publicam sozinhos a cada push na `main`.

1. **API no Render:** em [dashboard.render.com](https://dashboard.render.com), **New > Blueprint**, escolha este
   repositório e confirme. O `render.yaml` cria o serviço `agenda-academica-api` com a chave `APP_KEY` gerada
   pelo próprio Render. Quando terminar, copie o endereço do serviço (algo como
   `https://agenda-academica-api.onrender.com`) e abra-o: deve aparecer `"status": "ok"`.
2. **Front no Vercel:** em [vercel.com/new](https://vercel.com/new), importe este repositório, chame o projeto
   de `agenda-academica`, troque **Root Directory** para `frontend` e crie a variável
   `NEXT_PUBLIC_API_URL` = endereço da API + `/api/v1`. Clique em **Deploy**.
3. **Ligar os dois:** o Render já aceita chamadas de `https://agenda-academica*.vercel.app`. Se o projeto no
   Vercel tiver outro nome, ajuste `CORS_ORIGIN` em **Environment** no serviço do Render.

Para entrar, use as [contas de demonstração](#contas-de-demonstração).

> No plano grátis do Render a API dorme depois de uns 15 minutos sem acesso e o primeiro acesso leva até um
> minuto. O banco é SQLite e não fica salvo: toda vez que a API reinicia, ele volta com os dados de demonstração.

## Testes

```bash
npm test
```

A suíte do backend usa um banco SQLite separado (`backend/tmp/test.sqlite3`),
então rodar os testes não apaga os dados de desenvolvimento.

## Rotinas do servidor

```bash
cd backend
node ace calendar:sync-official
node ace calendar:sync-official --source=./calendario-oficial.json
node ace reminders:send-due
node ace reminders:send-due --dry-run
```

O formato aceito pela sincronização é um JSON com `sourceName` e `events`, ou diretamente um array de eventos institucionais.
