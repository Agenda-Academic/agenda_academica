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

### Entrar com o Google

O botão **Entrar com o Google** entra na conta que já existe com o mesmo e-mail. Sem conta, ele cria uma só
para e-mails do Google do IFMS: `@estudante.ifms.edu.br` vira aluno e `@ifms.edu.br` vira docente (o vínculo
com as turmas continua com a administração).

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure a **Tela de
   permissão OAuth** (tipo Externo, escopos `openid`, `email` e `profile`) e crie uma credencial **ID do
   cliente OAuth** do tipo **Aplicativo da Web**.
2. Em **URIs de redirecionamento autorizados**, cadastre o endereço da API + `/api/v1/auth/google/callback`,
   um para o Render e outro para o desenvolvimento:
   - `https://<serviço-no-render>.onrender.com/api/v1/auth/google/callback`
   - `http://localhost:3333/api/v1/auth/google/callback`
3. No Render, em **Environment** do serviço `agenda-academica-api`, preencha `GOOGLE_CLIENT_ID` e
   `GOOGLE_CLIENT_SECRET` com os valores da credencial. O `render.yaml` já cria as duas chaves vazias e
   define `FRONTEND_URL` com o endereço do front no Vercel.
4. Para testar localmente, ponha as mesmas três variáveis no `backend/.env` (ver `backend/.env.example`).

O segredo fica só no Render e no `.env` local, que não vai para o Git. Sem as duas chaves, o botão avisa que o
login com o Google ainda não está disponível.

### Lembretes por e-mail

Na hora marcada, o lembrete aparece no sistema e também vai por e-mail. Com a API no ar, ela confere a cada
minuto os lembretes vencidos e envia pela API HTTP do [Brevo](https://www.brevo.com) (plano gratuito, 300
e-mails por dia). É HTTP e não SMTP porque o plano gratuito do Render bloqueia as portas de SMTP.

1. Crie a conta gratuita no Brevo e, em **Remetentes, domínios e IPs dedicados**, adicione e confirme o e-mail
   que vai aparecer como remetente.
2. Em **SMTP e API > Chaves de API**, gere uma chave.
3. No Render, em **Environment**, preencha `BREVO_API_KEY` com a chave e `MAIL_FROM` com o remetente
   confirmado. Para testar localmente, ponha os dois no `backend/.env`.

Sem as duas variáveis, o lembrete só aparece no sistema. As contas de demonstração (`@agenda.test`) nunca
recebem e-mail, e um lembrete de evento que já começou não é enviado atrasado.

> No plano grátis do Render a API dorme depois de uns 15 minutos sem acesso e o primeiro acesso leva até um
> minuto. O banco é SQLite e não fica salvo: toda vez que a API reinicia, ele volta com os dados de demonstração.
> Para a API não dormir (e os lembretes saírem na hora), o GitHub Actions acessa o endereço dela a cada 10
> minutos (`.github/workflows/manter-api-acordada.yml`).

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
