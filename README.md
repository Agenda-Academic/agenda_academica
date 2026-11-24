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
- O aluno cria um lembrete pessoal para qualquer evento, de 15 minutos a 7 dias antes. Na hora marcada, o aviso
  aparece no sistema e chega por e-mail.
- O professor cadastra, edita, conclui, cancela e exclui eventos das turmas em que dá aula.
- O professor importa as notas de uma prova ou trabalho (CSV do SUAP, do Moodle, do Google Classroom ou do modelo da
  Agenda), confere a prévia e publica para alunos e responsáveis.
- A administração cria as turmas e as disciplinas e liga os professores a elas. O aluno entra na turma pelo código da
  turma, na hora, sem pedido para aprovar. A turma já nasce com o código ligado; os docentes veem e copiam o código, e
  só a coordenação troca ou desliga, porque ele vale para todos. A docente só consulta a lista de alunos: incluir e
  tirar da turma é da coordenação, e quem foi tirado não volta sozinho com o mesmo código.
- O responsável (pai, mãe) acompanha a agenda e as notas do aluno vinculado, pelo código que o aluno gera no perfil.
- A administração importa o calendário oficial arrastando o PDF do Calendário Acadêmico do IFMS (ou por JSON). As
  datas oficiais têm prioridade sobre os eventos das turmas.
- Aluno e docente entram com a conta Google do IFMS, e a conta é criada no primeiro acesso. O cadastro com e-mail e
  senha é só do responsável, que também pode pedir uma senha nova por e-mail.
- Cada perfil vê só o menu e as ações que lhe cabem, e a API confere a permissão antes de salvar.
- O sistema guarda as notas, mas não calcula médias nem frequência.

As telas foram desenhadas antes no Figma (protótipo clicável) e o front segue o mesmo visual.

## Tecnologias

- `frontend`: Next.js e React, publicado no Vercel.
- `backend`: API REST em AdonisJS, publicada no Render em Docker. O banco é Postgres (Supabase) em produção e
  SQLite no computador e nos testes.

## Contas de demonstração

Todas usam a senha `password123`. A tela de login tem atalhos para as quatro primeiras.

| Perfil                                         | Nome                  | E-mail                    |
| ---------------------------------------------- | --------------------- | ------------------------- |
| Aluno (TADS 5)                                 | Lucas Ferreira        | `aluno@agenda.test`       |
| Professora (TADS 5 e TADS 3)                   | Profa. Maraísa        | `maraisa@agenda.test`     |
| Admin                                          | Coordenação Acadêmica | `admin@agenda.test`       |
| Responsável (mãe do Lucas, da Sofia e do Pedro) | Juliana Ferreira      | `responsavel@agenda.test` |
| Aluna menor de idade (INF 3A)                  | Ana Clara Ribeiro     | `ana@agenda.test`         |
| Responsável (pai da Ana)                       | Carlos Ribeiro        | `carlos@agenda.test`      |
| Professora (TADS 5 e INF 3A)                   | Profa. Marina Souza   | `marina@agenda.test`      |

Além delas, o seed monta uma escola de demonstração (`backend/database/seeders/escola_demo_seeder.ts`): as turmas
TADS 5, TADS 3, INF 3A e INF 1A, cinco docentes, quase 50 alunos, três que acabaram de entrar pelo código, um pai
esperando a secretaria, notas publicadas, uma prova que já passou sem nota lançada, um evento cancelado e o
Calendário Acadêmico 2026 do campus, importado do PDF em `backend/database/seeders/data/` como a tela faria (sem as
datas só de servidores). O de 2027 entra do mesmo jeito. Os outros alunos e docentes seguem o padrão `nome.sobrenome@agenda.test` (por exemplo,
`sofia.ferreira@agenda.test`) ou `nome@agenda.test` para os docentes (`ricardo@`, `helena@`, `andre@`). Os testes usam
só as contas da tabela.

Essas contas nunca recebem e-mail (o domínio `.test` é reservado).

Como essas contas têm a senha pública, elas não podem existir no banco com dados reais. Por isso o sistema roda em
**dois ambientes**, cada um com o seu banco (um projeto do Supabase para cada):

- **Produção** (`agenda-academica-api` no Render e o projeto principal no Vercel): contas de demonstração desligadas,
  entrada só pelo Google da instituição (e responsáveis pelo cadastro). A tela de entrar mostra o link
  "Abrir a demonstração" quando o Vercel da produção tem `NEXT_PUBLIC_DEMO_URL`.
- **Demonstração** (`agenda-academica-demo-api` no Render, no `render.yaml`, e um segundo projeto no Vercel com
  `NEXT_PUBLIC_API_URL` apontando para ela): todas as contas da tabela acima ligadas, sem Google e sem e-mail. O botão
  "Entrar com o Google" aparece mesmo assim, para mostrar que o sistema tem o Google: como a API não tem as chaves,
  ele abre uma janela que explica que o Google funciona no sistema, com o botão "Ir para o sistema"
  (`NEXT_PUBLIC_PRODUCTION_URL` no Vercel da demonstração) e o caminho de volta para as contas prontas.

As duas APIs importam sozinhas os Calendários Acadêmicos 2026 e 2027 do campus (`backend/database/seeders/data`).

Na produção, as contas de demonstração ficam desligadas no Render, em **Environment**:

- `DEMO_ACCOUNTS=false`: as contas `@agenda.test` deixam de entrar, as sessões abertas delas caem e os atalhos somem
  da tela de login. Sem a variável, elas ficam ligadas.
- `ADMIN_EMAILS=seu.email@exemplo.com`: quem entra com o Google usando um desses e-mails (separados por vírgula)
  vira administração, mesmo fora do IFMS. Vale só pelo Google, que confirma que o e-mail é da pessoa.

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

Depois do documento das telas, a segunda fase pedida pela professora trouxe: cadastro de turmas e disciplinas,
perfil de responsável, importação e publicação de notas, leitura do PDF do Calendário Acadêmico, entrada com o Google
e "Esqueci minha senha".

## Regras principais

- Datas oficiais prevalecem sobre eventos locais quando houver conflito.
- Alunos não alteram eventos oficiais nem eventos de professor.
- Professores só gerenciam eventos e notas das turmas e disciplinas em que dão aula.
- Só a administração cria, edita e arquiva turmas e disciplinas e liga professores a elas.
- Cada aluno vê só as próprias notas, e só depois que o professor publica.
- O responsável vê só o aluno vinculado. As notas de aluno maior de idade aparecem só se ele compartilhar; as de aluno
  menor aparecem sempre. O vínculo com aluno menor feito pelo código do aluno espera a confirmação da secretaria.
- O sistema guarda as notas, mas não calcula médias nem frequência.

## Notas

1. Numa prova ou trabalho de uma turma, o professor abre **Notas** e escolhe **Importar notas** (ou digita nota por
   nota).
2. Escolhe de onde vem o arquivo (Modelo da Agenda, SUAP, Moodle ou Google Classroom) e envia o CSV. O Modelo da
   Agenda já vem com os alunos da turma, só falta preencher a nota. Planilha do Excel precisa ser salva como CSV.
3. Indica a coluna do aluno (e-mail ou matrícula) e a coluna da nota. A escolha fica salva para a próxima vez.
4. Confere a prévia antes de gravar: nota nova, alterada ou igual, aluno não encontrado, fora da turma, nota inválida,
   linha repetida ou nota mudada na Agenda depois da última importação.
5. Aplica e, quando quiser, publica para alunos e responsáveis. A publicação pode ser desfeita.

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
> interpretadas no fuso da instituição (`APP_TIMEZONE`, padrão `America/Campo_Grande`,
> o horário de Mato Grosso do Sul). O frontend sempre envia ISO com offset.
>
> No frontend, a tela conta o tempo pelo relógio de MS e não pelo do computador (veja
> `frontend/src/lib/zone.ts`). Todo `Date` do front é "de parede": `getHours()` etc. mostram a hora
> de MS. O `apiFetch` converte os instantes ISO na ida e na volta. Para o "agora", use `zonedNow()`
> ou `zonedNowMs()`; o ESLint barra `new Date()` e `Date.now()`. `npm test` (na pasta `frontend`)
> confere a conversão com o relógio do computador em seis fusos diferentes.

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

### Banco Postgres (Supabase)

Em produção a API grava num Postgres do [Supabase](https://supabase.com) (plano grátis, 500 MB), e os dados
ficam salvos entre os reinícios. No computador e nos testes o banco continua SQLite, sem nada para instalar.

1. No Supabase, crie um projeto na região **East US (North Virginia)**, a mesma do Render, e guarde a senha
   do banco.
2. Em **Connect**, copie o endereço do **Session pooler** (o direto só funciona com IPv6, e o Render usa IPv4).
3. No Render, em **Environment**, cole o endereço em `DATABASE_URL`, trocando `[YOUR-PASSWORD]` pela senha.
   O `render.yaml` já define `DB_CONNECTION=pg`.

A cada início a API aplica as migrations e, só se o banco não tiver nenhum usuário, cria as
[contas de demonstração](#contas-de-demonstração) (`node ace db:seed-if-empty`). Um banco com a demonstração
de antes de 23/11/2026 (contas `diogo@` e `maria@`) é atualizado uma vez: as duas contas viram `aluno@` e
`responsavel@`, com o mesmo id, e a escola de demonstração é completada. A conexão usa TLS.

### Entrar com o Google

O botão **Entrar com o Google** entra na conta que já existe com o mesmo e-mail. Sem conta, ele cria uma só
para e-mails do Google do IFMS: `@estudante.ifms.edu.br` vira aluno e `@ifms.edu.br` vira docente (o vínculo
com as turmas continua com a administração). Aluno e docente só criam conta por aqui; o cadastro com e-mail e
senha é do responsável. E-mails da lista `ADMIN_EMAILS` entram como administração.

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

### Calendário acadêmico em PDF

A administração arrasta o PDF do Calendário Acadêmico publicado pelo IFMS para qualquer tela do app (ou usa
**Escolher PDF** em **Importar calendário**). A API lê o texto do PDF (`unpdf`), sem gravar nada, e a tela mostra
as datas para conferir: feriados, recessos e datas institucionais, com os intervalos ("01 a 05", "31/05 a 05/06")
e a virada do ano ("Janeiro/2028"). Assuntos só de servidores (PIT, RAD, diários, planejamento) vêm desmarcados.
Só depois de conferir a administração importa.

O leitor segue o modelo do IFMS: duas colunas por página, o mês como título e a data à esquerda do texto. A
página da grade colorida é ignorada, porque repete as listas. PDF escaneado (imagem) não tem texto para ler.
O teste usa o calendário de 2027 do Campus Três Lagoas (`backend/tests/fixtures`).

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

### Esqueci minha senha

Na tela de entrar, **Esqueci minha senha** manda por e-mail (pelo mesmo Brevo) um link de uso único que vale por
1 hora. O link abre **Criar senha nova**. Depois de salvar, a pessoa já entra, e as outras sessões da conta
acabam. A resposta do pedido é a mesma com ou sem conta, e o mesmo e-mail pode pedir até 3 links a cada 15 minutos.
Em desenvolvimento, sem e-mail configurado ou com conta `@agenda.test`, o link aparece no log da API.

> No plano grátis do Render a API dorme depois de uns 15 minutos sem acesso e o primeiro acesso leva até um
> minuto.
> Para a API não dormir (e os lembretes saírem na hora), o próprio banco da produção acessa o endereço dela a
> cada 10 minutos, das 6h às 23h no horário de MS: um agendamento do `pg_cron` com `pg_net` no Supabase,
> criado no editor SQL do projeto:
>
> ```sql
> create extension if not exists pg_cron with schema pg_catalog;
> create extension if not exists pg_net with schema extensions;
> select cron.schedule('acordar-api', '*/10 10-23,0-2 * * *',
>   $$select net.http_get(url := 'https://agenda-academica-api-ql31.onrender.com/', timeout_milliseconds := 60000)$$);
> ```
>
> O horário do agendador é GMT (MS fica 4 horas atrás). De madrugada a API pode dormir: assim ela gasta cerca de
> 530 das 750 horas grátis que o Render dá por mês para os dois serviços juntos, e ligada 24 horas passaria do
> limite nos meses de 31 dias. O GitHub Actions também acessa a API
> (`.github/workflows/manter-api-acordada.yml`), mas o GitHub atrasa os agendamentos e ele só roda umas 4 vezes
> por dia.

## Testes

```bash
npm test
```

A suíte do backend usa um banco SQLite separado (`backend/tmp/test.sqlite3`),
então rodar os testes não apaga os dados de desenvolvimento.

Para rodar a mesma suíte num Postgres (como o de produção), suba um Postgres local e aponte para ele. A suíte
apaga as tabelas, então nunca use o endereço do Supabase:

```bash
docker run -d --rm --name agenda-pg-test -e POSTGRES_PASSWORD=agenda_test -e POSTGRES_DB=agenda_tests -p 55432:5432 postgres:17-alpine
cd backend
DB_CONNECTION=pg DB_SSL=false DATABASE_URL=postgres://postgres:agenda_test@127.0.0.1:55432/agenda_tests node ace test
```

## Rotinas do servidor

```bash
cd backend
node ace calendar:sync-official
node ace calendar:sync-official --source=./calendario-oficial.json
node ace reminders:send-due
node ace reminders:send-due --dry-run
```

O formato aceito pela sincronização é um JSON com `sourceName` e `events`, ou diretamente um array de eventos institucionais.
