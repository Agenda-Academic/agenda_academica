# Agenda Acadêmica — telas

Telas redesenhadas a partir da documentação (PDF) e do front-end do repositório
`Agenda-Academic/agenda_academica`. São 20 quadros: capa, mapa de navegação, requisitos × telas,
16 telas do sistema (desktop e mobile), guia visual e estados.

## O que tem nesta pasta

| Item | Para quê |
| --- | --- |
| `agenda-academica-telas.html` | **Protótipo navegável.** Dê dois cliques para abrir no navegador. Botão **Apresentar** + setas do teclado passam tela a tela; **Ctrl+K** abre a busca rápida. Precisa de internet só para carregar as fontes. |
| `png/` | Cada tela como imagem PNG em alta resolução (2×), pronta para colar na documentação. |
| `figma-export.html` | Mesmas telas sem a galeria e sem script, com fontes embutidas — é o arquivo que foi importado no Figma. |
| `src/` | Partes do protótipo: estilos (`00-head`), telas (`05`…`65`), interações (`98-app`) e galeria (`99-tail`). |
| `build.sh` | Junta `src/*.html` em `agenda-academica-telas.html`. |
| `ferramentas/` | `make_export.py` (gera o `figma-export.html`), `exportar-png.mjs` (gera a pasta `png/`) e `figma-prototipo.js` (liga os cliques no Figma). |

**Figma:** https://www.figma.com/design/Hs0MthIYk9tPVQfOBFbFwX (arquivo "Agenda Acadêmica — Telas", 7 seções de telas
+ 3 seções de apoio ao protótipo).

## Protótipo clicável no Figma

No Figma, clique em **Apresentar (▶)** e escolha um roteiro no painel **Fluxos**:

| Roteiro | Começa em |
| --- | --- |
| 1 · Apresentação | Capa → (clique ou seta →) mapa → requisitos; os cartões do mapa e da tabela levam às telas |
| 2 · Entrar e aluno | Entrar: os cartões Aluno / Professor / Administração entram em cada perfil |
| 3 · Professor | Painel do professor |
| 4 · Administração | Painel da administração |
| 5 · Celular | Painel no celular |
| 6 · Guia visual e estados | Guia → estados |

**O que responde ao clique:** menu lateral de cada perfil, links e cartões de evento, abas Agenda/Calendário,
perfil (abre por cima da tela), sair da conta, sino de notificações, criar/concluir/cancelar/reativar/excluir
evento (excluir pede confirmação), importar calendário, menu e detalhe no celular. As ações mostram o mesmo
aviso do protótipo em HTML e o aviso some sozinho. Antecedência e canal do lembrete, categoria do evento e
perfil no cadastro trocam de seleção ao clicar; o texto "Você será avisado…" acompanha a escolha.

**Seções de apoio:** `7 · Protótipo — telas por perfil` (cronograma, lembretes e gestão com o menu do professor e
da administração), `8 · Protótipo — sobreposições e avisos` e `9 · Protótipo — componentes interativos`.
Filtros por categoria e abas Próximos/Passados não mudam a lista no Figma — para isso, use o protótipo em HTML.

## Telas

Entrar, Criar conta · painel, calendário, agenda + detalhe, lembretes e perfil do aluno · painel e
gestão do professor · painel e sincronização da administração · 4 telas mobile · guia visual · estados.

**Funciona no protótipo:** contas de demonstração e mostrar senha; filtros por categoria no calendário e
na agenda; período Próximos/Passados/Todos; clique no dia ou no evento abre o detalhe; lembrete com
antecedência e canal (calcula o horário do aviso, ativar/remover com Desfazer); remover lembretes;
formulário de evento com pré-visualização, categorias bloqueadas por perfil, concluir/cancelar/
reativar/excluir com confirmação; validação do JSON de importação; contagem regressiva; busca (Ctrl+K).

**Cores:** azul `#1F4E8C` (menu e destaques), verde IF `#17803F` (ações, datas e logo), verde vivo
`#4ADE80` (detalhes sobre o azul). Todas são variáveis CSS em `src/00-head.html`.

Dados fictícios no estilo do seed de demonstração; "hoje" = quinta, 25/06/2026, 07:42.

## Como regenerar

```bash
./build.sh
python ferramentas/make_export.py agenda-academica-telas.html figma-export.html <pasta-de-fontes>
node ferramentas/exportar-png.mjs figma-export.html png
```

O exportador precisa do Playwright. Se ele estiver instalado em outro projeto, use `PLAYWRIGHT_DE=<package.json desse
projeto>`; para usar um Chromium específico, `CHROMIUM_PATH=<caminho do executável>`.

Depois de reimportar as telas no Figma, rode `ferramentas/figma-prototipo.js` pelo conector do Figma (`use_figma`)
para religar o protótipo. Ele acha as telas pelo nome e os botões pelo texto, e pode rodar de novo sem duplicar nada.
