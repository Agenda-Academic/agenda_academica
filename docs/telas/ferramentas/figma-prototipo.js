// Liga o protótipo clicável no Figma ("Agenda Acadêmica — Telas").
// Rodar pelo use_figma do conector do Figma depois de cada nova importação das telas.
// Acha as telas pelo nome e os botões pelo texto; pode rodar de novo sem duplicar nada:
// apaga as seções 7, 8 e 9 e as ligações antigas antes de recriar.

const page = figma.currentPage;
const SEC_PERFIS = '7 · Protótipo — telas por perfil';
const SEC_SOBRE = '8 · Protótipo — sobreposições e avisos';
const SEC_COMP = '9 · Protótipo — componentes interativos';
const OURS = [SEC_PERFIS, SEC_SOBRE, SEC_COMP];

// execução anterior: devolve os seletores interativos a quadros comuns e apaga as seções geradas
const oldComp = page.children.find(n => n.type === 'SECTION' && n.name === SEC_COMP);
if (oldComp) {
  for (const s of page.children.filter(n => n.type === 'SECTION' && !OURS.includes(n.name))) {
    for (const inst of s.findAllWithCriteria({ types: ['INSTANCE'] })) {
      const main = await inst.getMainComponentAsync();
      if (main && main.parent && main.parent.parent === oldComp) inst.detachInstance();
    }
  }
}
for (const n of page.children.filter(n => n.type === 'SECTION' && OURS.includes(n.name))) n.remove();

const sections = page.children.filter(n => n.type === 'SECTION');
const telas = sections.flatMap(s => s.children.filter(c => c.type === 'FRAME'));
const F = name => {
  const f = telas.find(x => x.name === name);
  if (!f) throw new Error('Tela não encontrada: ' + name);
  return f;
};
const S = {
  capa: F('00 · Capa'), mapa: F('00 · Mapa de navegação'), req: F('00 · Requisitos × telas'),
  entrar: F('01 · Entrar'), criar: F('01b · Criar conta'),
  aPainel: F('02 · Painel do aluno'), cal: F('03 · Cronograma — calendário'),
  agenda: F('04 · Cronograma — agenda e detalhe'), lemb: F('05 · Lembretes'), perfil: F('06 · Perfil e preferências'),
  pPainel: F('07 · Painel do professor'), gestao: F('08 · Gestão de eventos'),
  adm: F('09 · Painel da administração'), sync: F('10 · Sincronização do calendário'),
  mPainel: F('Mobile · Painel'), mCrono: F('Mobile · Cronograma'), mDet: F('Mobile · Detalhe do evento'),
  mMenu: F('Mobile · Menu'), guia: F('Guia visual'), estados: F('Estados e feedback'),
};

// ligações antigas
for (const f of telas) {
  for (const n of [f, ...f.findAll(n => 'reactions' in n && n.reactions.length > 0)]) {
    if (n.reactions.length) await n.setReactionsAsync([]);
  }
}

// ---------- ajudantes ----------
const rgb = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 });
const NIGHT = rgb(31, 78, 140), ON_NIGHT = rgb(220, 230, 245), WHITE = rgb(255, 255, 255);
const SCRIM = [{ type: 'SOLID', color: rgb(15, 30, 58), opacity: 0.48 }];
const copy = v => JSON.parse(JSON.stringify(v));
const EASE = { type: 'EASE_OUT' };
const fade = { type: 'DISSOLVE', easing: EASE, duration: 0.2 };
const push = direction => ({ type: 'PUSH', direction, matchLayers: false, easing: EASE, duration: 0.3 });
const go = (dest, transition = fade) => ({ type: 'NODE', destinationId: dest.id, navigation: 'NAVIGATE', transition, resetScrollPosition: true });
const overlay = dest => ({ type: 'NODE', destinationId: dest.id, navigation: 'OVERLAY', transition: fade });
const swap = dest => ({ type: 'NODE', destinationId: dest.id, navigation: 'SWAP', transition: fade });
const scrollTo = node => ({ type: 'NODE', destinationId: node.id, navigation: 'SCROLL_TO', transition: { type: 'SCROLL_ANIMATE', easing: EASE, duration: 0.45 } });
const CLOSE = { type: 'CLOSE' };
const click = action => ({ trigger: { type: 'ON_CLICK' }, actions: [action] });
const key = (code, action) => ({ trigger: { type: 'ON_KEY_DOWN', device: 'KEYBOARD', keyCodes: [code] }, actions: [action] });

async function loadFonts(nodes) {
  const seen = new Set();
  for (const t of nodes) {
    for (const s of t.getStyledTextSegments(['fontName'])) {
      const k = s.fontName.family + '|' + s.fontName.style;
      if (seen.has(k)) continue;
      seen.add(k);
      await figma.loadFontAsync({ family: s.fontName.family, style: s.fontName.style });
    }
  }
}

const clickables = frame => frame.findAll(n => n.type === 'FRAME' && /^(Link|Button)/.test(n.name) && !/:align|:margin/.test(n.name));
const label = node => ({
  node,
  aria: node.name.replace(/^(Link|Button)( - )?/, '').trim(),
  txt: node.findAll(t => t.type === 'TEXT').map(t => t.characters).join(' ').replace(/\s+/g, ' ').trim(),
});

const report = {};
async function wire(frame, rules) {
  let n = 0;
  const skipped = [];
  for (const node of clickables(frame)) {
    const l = label(node);
    const rule = rules.find(([test]) => test(l));
    let action = rule && rule[1](l);
    if (action && action.navigation === 'NAVIGATE' && action.destinationId === frame.id) action = null; // item já ativo
    if (action) { await node.setReactionsAsync([click(action)]); n++; } else skipped.push(l.aria || l.txt.slice(0, 30));
  }
  report[frame.name] = { ligados: n, sem_ligacao: skipped.length };
}
async function wireNode(node, action) { if (node) await node.setReactionsAsync([click(action)]); }

// ---------- seções novas ----------
const bottom = Math.max(...sections.map(s => s.y + s.height));
const left = Math.min(...sections.map(s => s.x));
function newSection(name, y) {
  const s = figma.createSection();
  s.name = name;
  s.x = left;
  s.y = y;
  if (sections[0].fills) s.fills = copy(sections[0].fills);
  return s;
}
function place(section, node, x, y) { section.appendChild(node); node.x = x; node.y = y; }
function fitSection(section) {
  const w = Math.max(...section.children.map(c => c.x + c.width)) + 120;
  const h = Math.max(...section.children.map(c => c.y + c.height)) + 120;
  section.resizeWithoutConstraints(w, h);
}

// ---------- seletores interativos (variantes que trocam ao clicar) ----------
// Feito antes das cópias por perfil, para as cópias já levarem as instâncias.
const secComp = newSection(SEC_COMP, bottom + 300);
const morph = { type: 'SMART_ANIMATE', easing: EASE, duration: 0.18 };

function snap(node) {
  const t = node.findOne(n => n.type === 'TEXT');
  const v = node.findOne(n => n.type === 'VECTOR');
  return {
    fills: copy(node.fills), strokes: copy(node.strokes), effects: copy(node.effects),
    tFills: t && copy(t.fills), tFont: t && { family: t.fontName.family, style: t.fontName.style }, vStrokes: v && copy(v.strokes),
  };
}
function paint(node, s) {
  node.fills = copy(s.fills);
  node.strokes = copy(s.strokes);
  node.effects = copy(s.effects);
  for (const t of node.findAll(n => n.type === 'TEXT')) {
    if (s.tFills) t.fills = copy(s.tFills);
    if (s.tFont) t.fontName = s.tFont;
  }
  if (s.vStrokes) for (const v of node.findAll(n => n.type === 'VECTOR')) v.strokes = copy(s.vStrokes);
}
const option = (root, labelText) => root.findOne(n => n.type === 'FRAME' && 'children' in n && n.children.some(t => t.type === 'TEXT' && t.characters === labelText));
// o quadro cujos filhos diretos são as opções (evita pegar outro texto igual na tela)
const groupOf = (root, labels) => root.findOne(n => n.type === 'FRAME' && labels.every(l => n.children.some(c => c.type === 'FRAME' && c.children.some(t => t.type === 'TEXT' && t.characters === l))));
const combosOf = dims => dims.reduce((acc, d) => acc.flatMap(c => d.options.map((_, i) => [...c, i])), [[]]);

// dims: [{ name, options: [rótulos], selected: rótulo }]; extra(variante, combinação) ajusta o resto
async function interactive(container, setName, dims, extra) {
  await loadFonts(container.findAll(n => n.type === 'TEXT'));
  for (const d of dims) {
    d.sel = d.options.indexOf(d.selected);
    d.on = snap(option(container, d.selected));
    d.off = snap(option(container, d.options.find(o => o !== d.selected)));
  }
  const parent = container.parent;
  const idx = parent.children.indexOf(container);
  const keep = { name: container.name, x: container.x, y: container.y, h: container.layoutSizingHorizontal, v: container.layoutSizingVertical, align: container.layoutAlign, grow: container.layoutGrow };
  const base = figma.createComponentFromNode(container);
  const combos = combosOf(dims);
  const comps = combos.map((combo, k) => {
    const c = k === 0 ? base : base.clone();
    c.name = dims.map((d, j) => d.name + '=' + d.options[combo[j]]).join(', ');
    dims.forEach((d, j) => d.options.forEach((o, i) => paint(option(c, o), i === combo[j] ? d.on : d.off)));
    if (extra) extra(c, combo);
    return c;
  });
  const def = combos.findIndex(cb => cb.every((v, j) => v === dims[j].sel));
  const inst = comps[def].createInstance();
  inst.name = keep.name;
  parent.insertChild(idx, inst);
  if ('layoutMode' in parent && parent.layoutMode !== 'NONE') {
    inst.layoutAlign = keep.align;
    inst.layoutGrow = keep.grow;
    try { inst.layoutSizingHorizontal = keep.h; inst.layoutSizingVertical = keep.v; } catch (e) { /* tamanho fixo serve */ }
  } else {
    inst.x = keep.x;
    inst.y = keep.y;
  }
  const set = figma.combineAsVariants(comps, secComp);
  set.name = setName;
  const cols = dims[0].options.length;
  const w = Math.max(...comps.map(c => c.width)), h = Math.max(...comps.map(c => c.height));
  comps.forEach((c, k) => { c.x = 24 + (k % cols) * (w + 24); c.y = 24 + Math.floor(k / cols) * (h + 24); });
  set.resizeWithoutConstraints(24 + cols * (w + 24), 24 + Math.ceil(comps.length / cols) * (h + 24));
  for (const [k, combo] of combos.entries()) {
    for (const [j, d] of dims.entries()) {
      for (const [i, o] of d.options.entries()) {
        if (i === combo[j]) continue;
        const to = combos.findIndex(cb => cb.every((v, jj) => (jj === j ? v === i : v === combo[jj])));
        await option(comps[k], o).setReactionsAsync([{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: comps[to].id, navigation: 'CHANGE_TO', transition: morph }] }]);
      }
    }
  }
  return { set, inst };
}
function wrapChildren(card, kids, name) {
  if (kids.length === 1 && kids[0].name === name) return kids[0]; // já agrupado numa execução anterior
  const wrap = figma.createAutoLayout('VERTICAL', { name, itemSpacing: 0 });
  wrap.fills = [];
  card.insertChild(card.children.indexOf(kids[0]), wrap);
  for (const k of kids) wrap.appendChild(k);
  wrap.layoutSizingHorizontal = 'FILL';
  return wrap;
}
const reminderCard = frame => frame.findOne(n => n.type === 'TEXT' && n.characters === 'Lembrete pessoal').parent.parent.parent;

const OFFSETS = ['15 min', '1 hora', '3 horas', '1 dia', '2 dias', '7 dias'];
// Prova de Engenharia de Software: sex, 26/06, 19:00 — "agora" do protótipo é qui, 25/06, 07:42
const WHEN = ['amanhã, às 18:45', 'amanhã, às 18:00', 'amanhã, às 16:00', 'hoje, às 19:00', null, null];
const CHANNEL = ['e-mail', 'notificação no celular'];
const sets = {};
{
  const card = reminderCard(S.agenda);
  const kids = card.children.slice(1, -1); // rótulos, antecedência, canal e texto de ajuda
  const wrap = wrapChildren(card, kids, 'Lembrete · antecedência e canal');
  const semi = option(wrap, '1 dia').findOne(n => n.type === 'TEXT').fontName;
  sets.agenda = await interactive(wrap, 'Lembrete · antecedência e canal (desktop)', [
    { name: 'Antecedência', options: OFFSETS, selected: '1 dia' },
    { name: 'Canal', options: ['E-mail', 'Push'], selected: 'E-mail' },
  ], (c, [a, ch]) => {
    const help = c.findOne(n => n.type === 'TEXT' && /^(Você será avisado|Esse horário)/.test(n.characters));
    if (!help) return;
    if (WHEN[a]) {
      help.characters = 'Você será avisado ' + WHEN[a] + ', por ' + CHANNEL[ch] + '.';
    } else {
      help.characters = 'Esse horário de aviso já passou. Escolha uma antecedência menor.';
      help.fills = [{ type: 'SOLID', color: rgb(180, 35, 74) }];
      help.fontName = { family: semi.family, style: semi.style };
    }
    help.textAutoResize = 'HEIGHT';
    help.layoutSizingHorizontal = 'FILL';
    help.parent.layoutSizingVertical = 'HUG'; // o aviso vermelho ocupa duas linhas
  });
}
{
  const card = reminderCard(S.mDet);
  const wrap = wrapChildren(card, card.children.slice(1, -1), 'Lembrete · antecedência e canal');
  sets.mobile = await interactive(wrap, 'Lembrete · antecedência e canal (celular)', [
    { name: 'Antecedência', options: ['1 hora', '1 dia', '2 dias', '7 dias'], selected: '1 dia' },
    { name: 'Canal', options: ['E-mail', 'Push'], selected: 'E-mail' },
  ]);
}
sets.categoria = await interactive(groupOf(S.gestao, ['Prova', 'Trabalho']), 'Evento · categoria', [
  { name: 'Categoria', options: ['Prova', 'Trabalho', 'Atividade', 'Extracurricular'], selected: 'Trabalho' },
]);
sets.cadastro = await interactive(groupOf(S.criar, ['Aluno', 'Professor']), 'Cadastro · perfil', [
  { name: 'Perfil', options: ['Aluno', 'Professor'], selected: 'Aluno' },
]);
{
  let y = 120;
  for (const { set } of Object.values(sets)) { set.x = 120; set.y = y; y += set.height + 120; }
}

// ---------- telas por perfil (mesmo cronograma/lembretes/gestão, com o menu certo) ----------
const sidebarTexts = [S.aPainel, S.pPainel, S.adm].flatMap(f => f.findOne(n => n.name === 'Sidebar').findAll(n => n.type === 'TEXT'));
await loadFonts(sidebarTexts);

function setActive(sidebar, labelText) {
  const nav = sidebar.findOne(n => n.name.startsWith('Navigation'));
  for (const link of nav.findAll(n => n.type === 'FRAME' && n.name === 'Link')) {
    const texts = link.children.filter(k => k.type === 'TEXT');
    const on = texts.some(t => t.characters === labelText);
    const color = on ? NIGHT : ON_NIGHT;
    link.fills = on ? [{ type: 'SOLID', color: WHITE }] : [];
    for (const v of link.findAll(n => n.type === 'VECTOR' && n.parent.name === 'Icon')) v.strokes = [{ type: 'SOLID', color }];
    for (const t of texts) t.fills = [{ type: 'SOLID', color }];
  }
}
function roleClone(src, role, name, active) {
  const c = src.clone();
  c.name = name;
  const old = c.findOne(n => n.name === 'Sidebar');
  const sb = role.findOne(n => n.name === 'Sidebar').clone();
  old.parent.insertChild(old.parent.children.indexOf(old), sb);
  old.remove();
  sb.layoutAlign = 'STRETCH';
  setActive(sb, active);
  return c;
}

const secPerfis = newSection(SEC_PERFIS, bottom + 300);
const P = {
  cal: roleClone(S.cal, S.pPainel, '03 · Cronograma — calendário · Professor', 'Cronograma'),
  agenda: roleClone(S.agenda, S.pPainel, '04 · Cronograma — agenda e detalhe · Professor', 'Cronograma'),
  lemb: roleClone(S.lemb, S.pPainel, '05 · Lembretes · Professor', 'Lembretes'),
};
const D = {
  cal: roleClone(S.cal, S.adm, '03 · Cronograma — calendário · Administração', 'Cronograma'),
  agenda: roleClone(S.agenda, S.adm, '04 · Cronograma — agenda e detalhe · Administração', 'Cronograma'),
  gestao: roleClone(S.gestao, S.adm, '08 · Gestão de eventos · Administração', 'Gestão'),
  lemb: roleClone(S.lemb, S.adm, '05 · Lembretes · Administração', 'Lembretes'),
};
[P.cal, P.agenda, P.lemb].forEach((f, i) => place(secPerfis, f, 120 + i * 1560, 120));
const rowD = 120 + Math.max(P.cal.height, P.agenda.height, P.lemb.height) + 160;
[D.cal, D.agenda, D.gestao, D.lemb].forEach((f, i) => place(secPerfis, f, 120 + i * 1560, rowD));
fitSection(secPerfis);

// ---------- sobreposições e avisos ----------
const secSobre = newSection(SEC_SOBRE, secPerfis.y + secPerfis.height + 200);

function overlayFrame(name, w, h) {
  const f = figma.createFrame();
  f.name = name;
  f.resize(w, h);
  f.fills = [];
  return f;
}
function backdrop(frame, fills) {
  const r = figma.createRectangle();
  r.name = 'Fundo (fecha ao clicar)';
  r.resize(frame.width, frame.height);
  r.fills = fills && fills.length ? copy(fills) : SCRIM;
  frame.appendChild(r);
  r.x = 0;
  r.y = 0;
  return r;
}

// aviso (toast) no mesmo estilo do quadro "Estados e feedback"
const tplTitle = S.estados.findOne(n => n.type === 'TEXT' && n.characters === 'Lembrete ativado' && n.parent.name === 'Bold Text');
const tplToast = tplTitle.parent.parent.parent;
const tplIcon = tplToast.children[0];
const tplSub = tplToast.findOne(n => n.type === 'TEXT' && n.characters.startsWith('Aviso'));
const tplUndo = tplToast.findOne(n => n.type === 'TEXT' && n.characters === 'Desfazer');
const bellIcon = S.aPainel.findOne(n => n.name.startsWith('Button - Notificações')).findOne(n => n.name === 'Icon');
await loadFonts([tplTitle, tplSub, tplUndo]);

function toastIcon(kind) {
  const wrap = tplIcon.clone();
  if (kind !== 'info') return wrap;
  const old = wrap.findOne(n => n.name === 'Icon');
  const vec = old.findOne(n => n.type === 'VECTOR');
  const stroke = vec ? copy(vec.strokes) : [{ type: 'SOLID', color: WHITE }];
  const bell = bellIcon.clone();
  old.parent.insertChild(old.parent.children.indexOf(old), bell);
  bell.x = old.x;
  bell.y = old.y;
  for (const v of bell.findAll(n => n.type === 'VECTOR')) v.strokes = copy(stroke);
  old.remove();
  return wrap;
}
function makeToast(title, sub, opts) {
  const t = figma.createAutoLayout('HORIZONTAL', { name: 'Aviso', itemSpacing: 12, paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 12, counterAxisAlignItems: 'CENTER' });
  t.fills = copy(tplToast.fills);
  t.effects = copy(tplToast.effects);
  t.cornerRadius = typeof tplToast.cornerRadius === 'number' && tplToast.cornerRadius > 0 ? tplToast.cornerRadius : 14;
  t.resize(opts.width, t.height);
  t.primaryAxisSizingMode = 'FIXED';
  t.appendChild(toastIcon(opts.kind));
  const col = figma.createAutoLayout('VERTICAL', { name: 'Texto', itemSpacing: 2 });
  col.fills = [];
  t.appendChild(col);
  col.layoutSizingHorizontal = 'FILL';
  for (const [tpl, chars] of [[tplTitle, title], [tplSub, sub]]) {
    const x = tpl.clone();
    col.appendChild(x);
    x.characters = chars;
    x.textAutoResize = 'HEIGHT';
    x.layoutSizingHorizontal = 'FILL';
  }
  if (opts.undo) t.appendChild(tplUndo.clone());
  return t;
}
function toastOverlay(name, title, sub, opts) {
  const mobile = !!opts.mobile;
  const f = overlayFrame(name, mobile ? 390 : 1440, mobile ? 844 : 900);
  const t = makeToast(title, sub, { width: mobile ? 358 : 390, kind: opts.kind, undo: opts.undo });
  f.appendChild(t);
  t.x = f.width - (mobile ? 16 : 24) - t.width;
  t.y = f.height - (mobile ? 24 : 84) - t.height;
  return f;
}

const O = {};
// perfil como sobreposição: abre por cima da tela de qualquer perfil
{
  const dialog = S.perfil.findOne(n => n.name === 'Dialog');
  const f = overlayFrame('Sobreposição · Perfil e preferências', 1440, 900);
  const bg = backdrop(f, dialog.parent.fills);
  const d = dialog.clone();
  f.appendChild(d);
  d.x = dialog.x;
  d.y = dialog.y;
  O.perfil = f;
}
// mesma janela com os dados de demonstração do professor e da coordenação
async function perfilFor(name, swaps) {
  const f = O.perfil.clone();
  f.name = name;
  const texts = f.findAll(n => n.type === 'TEXT');
  await loadFonts(texts);
  for (const t of texts) {
    if (!(t.characters in swaps)) continue;
    if (swaps[t.characters] === null) t.parent.visible = false;
    else t.characters = swaps[t.characters];
  }
  return f;
}
O.perfilP = await perfilFor('Sobreposição · Perfil e preferências · Professor', {
  'Diogo Queiroz da Silva': 'Apio Carniello', 'diogo@agenda.test': 'apio@agenda.test', 'DQ': 'AC', 'Aluno': 'Professor', 'ALU-001': 'DOC-001',
});
O.perfilD = await perfilFor('Sobreposição · Perfil e preferências · Administração', {
  'Diogo Queiroz da Silva': 'Coordenação', 'diogo@agenda.test': 'admin@agenda.test', 'DQ': 'CA', 'Aluno': 'Administração', 'ALU-001': 'ADM-001', 'TADS 4': null,
});
// confirmação de exclusão
{
  const cardTitle = S.estados.findOne(n => n.type === 'TEXT' && n.characters.startsWith('Excluir “'));
  const card = cardTitle.parent.parent;
  const f = overlayFrame('Sobreposição · Confirmar exclusão', 1440, 900);
  const bg = backdrop(f, null);
  const c = card.clone();
  f.appendChild(c);
  c.rescale(1.2); // o cartão do quadro de estados é miniatura
  c.x = Math.round((1440 - c.width) / 2);
  c.y = Math.round((900 - c.height) / 2);
  const title = c.findOne(n => n.type === 'TEXT' && n.characters.startsWith('Excluir “'));
  await loadFonts([title]);
  title.characters = 'Excluir este evento?';
  O.confirm = f;
  O.confirmBg = bg;
  O.confirmCard = c;
}
// menu do celular como sobreposição
{
  const drawer = S.mMenu.findOne(n => n.name === 'Navigation - Menu');
  const sibs = drawer.parent.children;
  const dim = sibs[sibs.indexOf(drawer) - 1];
  const f = overlayFrame('Mobile · Sobreposição · Menu', 390, 844);
  const bg = backdrop(f, dim && dim.width >= 380 ? dim.fills : null);
  const d = drawer.clone();
  f.appendChild(d);
  d.x = 0;
  d.y = 0;
  O.mMenu = f;
  O.mMenuBg = bg;
}

const T = {
  lembUpd: toastOverlay('Aviso · Lembrete atualizado', 'Lembrete atualizado', 'Aviso hoje, às 19:00, por e-mail.', {}),
  lembRem: toastOverlay('Aviso · Lembrete removido', 'Lembrete removido', 'Ele não aparece mais nos seus lembretes.', { undo: true }),
  pref: toastOverlay('Aviso · Preferências salvas', 'Preferências salvas', 'Novos lembretes: 1 dia antes, por e-mail.', {}),
  bell: toastOverlay('Aviso · Lembrete para hoje', 'Lembrete para hoje', 'Prova de Engenharia de Software — aviso às 19:00.', { kind: 'info' }),
  criado: toastOverlay('Aviso · Evento criado', 'Evento criado', 'A turma já vê “Apresentação final do projeto integrador” na agenda.', {}),
  conc: toastOverlay('Aviso · Evento concluído', 'Evento concluído', 'A turma vê o evento como concluído.', {}),
  canc: toastOverlay('Aviso · Evento cancelado', 'Evento cancelado', 'Os alunos veem o evento como cancelado.', { undo: true }),
  reat: toastOverlay('Aviso · Evento reativado', 'Evento reativado', 'O evento voltou para a agenda da turma.', {}),
  excl: toastOverlay('Aviso · Evento excluído', 'Evento excluído', 'Os lembretes ligados a ele foram apagados.', { undo: true }),
  demo: toastOverlay('Aviso · Importação concluída', 'Importação concluída', '4 datas de demonstração publicadas com prioridade.', {}),
  json: toastOverlay('Aviso · Calendário importado', 'Calendário importado', '3 datas oficiais publicadas para todas as turmas.', {}),
  mLembUpd: toastOverlay('Mobile · Aviso · Lembrete atualizado', 'Lembrete atualizado', 'Aviso hoje, às 19:00, por e-mail.', { mobile: true }),
  mBell: toastOverlay('Mobile · Aviso · Lembrete para hoje', 'Lembrete para hoje', 'Prova de Engenharia de Software — aviso às 19:00.', { mobile: true, kind: 'info' }),
};

[O.perfil, O.perfilP, O.perfilD, O.confirm].forEach((f, i) => place(secSobre, f, 120 + i * 1560, 120));
['lembUpd', 'lembRem', 'pref', 'bell', 'criado', 'conc', 'canc', 'reat', 'excl', 'demo', 'json'].forEach((k, i) => {
  place(secSobre, T[k], 120 + (i % 4) * 1560, 120 + 1020 * (1 + Math.floor(i / 4)));
});
[O.mMenu, T.mLembUpd, T.mBell].forEach((f, i) => place(secSobre, f, 120 + i * 510, 120 + 1020 * 4));
fitSection(secSobre);

// avisos somem sozinhos (ou com um clique)
for (const t of Object.values(T)) {
  await t.setReactionsAsync([
    { trigger: { type: 'AFTER_TIMEOUT', timeout: 2.6 }, actions: [CLOSE] },
    { trigger: { type: 'ON_CLICK' }, actions: [CLOSE] },
  ]);
}

// ---------- regras de clique ----------
const isEvent = l => /^(Seg|Ter|Qua|Qui|Sex|Sáb|Dom) \d{2} /.test(l.txt);
const nav = R => [
  [l => l.txt === 'Painel', () => go(R.painel)],
  [l => l.txt === 'Cronograma', () => go(R.cal)],
  [l => /^Lembretes( \d+)?$/.test(l.txt), () => go(R.lemb)],
  [l => l.txt === 'Gestão', () => go(R.gestao)],
  [l => l.txt === 'Sincronização', () => go(S.sync)],
  [l => l.aria.startsWith('Configurações do perfil'), () => overlay(R.perfil)],
  [l => l.txt === 'Sair da conta', () => go(S.entrar)],
  [l => l.aria.startsWith('Notificações'), () => overlay(T.bell)],
];
const RA = { painel: S.aPainel, cal: S.cal, agenda: S.agenda, lemb: S.lemb, perfil: O.perfil };
const RP = { painel: S.pPainel, cal: P.cal, agenda: P.agenda, lemb: P.lemb, gestao: S.gestao, perfil: O.perfilP };
const RD = { painel: S.adm, cal: D.cal, agenda: D.agenda, lemb: D.lemb, gestao: D.gestao, perfil: O.perfilD };

const scr = {
  aPainel: R => [
    [l => l.txt === 'Ver detalhes', () => go(R.agenda)],
    [l => l.txt === 'Lembrete ativo' || l.txt === 'Gerenciar lembretes' || /\bEnvio\b/.test(l.txt), () => go(R.lemb)],
    [l => l.txt === 'Ver cronograma', () => go(R.cal)],
    [isEvent, () => go(R.agenda)],
  ],
  cal: R => [
    [l => l.txt === 'Agenda' || l.txt === 'Abrir detalhes' || /^Sexta, 26/.test(l.aria), () => go(R.agenda)],
  ],
  agenda: R => [
    [l => l.txt === 'Calendário', () => go(R.cal)],
    [l => l.txt === 'Atualizar lembrete', () => overlay(T.lembUpd)],
    [l => l.aria === 'Remover lembrete', () => overlay(T.lembRem)],
  ],
  lemb: R => [
    [l => l.txt === 'Alterar no perfil', () => overlay(R.perfil)],
    [l => l.txt === 'Remover', () => overlay(T.lembRem)],
    [l => l.node.name === 'Link', () => go(R.agenda)],
  ],
  pPainel: R => [
    [l => ['Novo evento', 'Editar evento', 'Evento', 'Ver todos na gestão'].includes(l.txt) || isEvent(l), () => go(R.gestao)],
    [l => l.txt === 'Ver no cronograma', () => go(R.cal)],
  ],
  gestao: (R, frame) => {
    const head = frame.findOne(n => n.type === 'TEXT' && n.characters === 'Publicar para a turma');
    let form = head;
    while (form && form.parent && form.parent.type === 'FRAME' && form.parent.height < 900 && form.parent !== frame) form = form.parent;
    return [
      [l => l.node.name === 'Link' && l.txt === 'Cancelar', () => go(R.painel)],
      [l => l.txt === 'Criar evento', () => overlay(T.criado)],
      [l => l.aria === 'Editar', () => (form ? scrollTo(form) : null)],
      [l => l.aria === 'Concluir', () => overlay(T.conc)],
      [l => l.aria === 'Cancelar evento', () => overlay(T.canc)],
      [l => l.txt === 'Reativar', () => overlay(T.reat)],
      [l => l.aria === 'Excluir', () => overlay(O.confirm)],
    ];
  },
  adm: R => [
    [l => ['Evento oficial', 'Novo evento oficial'].includes(l.txt), () => go(R.gestao)],
    [l => ['Sincronizar calendário', 'Abrir sincronização'].includes(l.txt) || /^Calendário /.test(l.txt), () => go(S.sync)],
    [l => l.txt === 'Ver no cronograma' || isEvent(l), () => go(R.cal)],
  ],
  sync: () => [
    [l => l.txt === 'Importar calendário de demonstração', () => overlay(T.demo)],
    [l => l.txt === 'Validar e importar JSON', () => overlay(T.json)],
  ],
};

// telas de cada perfil
await wire(S.aPainel, [...nav(RA), ...scr.aPainel(RA)]);
await wire(S.cal, [...nav(RA), ...scr.cal(RA)]);
await wire(S.agenda, [...nav(RA), ...scr.agenda(RA)]);
await wire(S.lemb, [...nav(RA), ...scr.lemb(RA)]);
await wire(S.pPainel, [...nav(RP), ...scr.pPainel(RP)]);
await wire(S.gestao, [...nav(RP), ...scr.gestao(RP, S.gestao)]);
await wire(P.cal, [...nav(RP), ...scr.cal(RP)]);
await wire(P.agenda, [...nav(RP), ...scr.agenda(RP)]);
await wire(P.lemb, [...nav(RP), ...scr.lemb(RP)]);
await wire(S.adm, [...nav(RD), ...scr.adm(RD)]);
await wire(S.sync, [...nav(RD), ...scr.sync()]);
await wire(D.cal, [...nav(RD), ...scr.cal(RD)]);
await wire(D.agenda, [...nav(RD), ...scr.agenda(RD)]);
await wire(D.gestao, [...nav(RD), ...scr.gestao(RD, D.gestao)]);
await wire(D.lemb, [...nav(RD), ...scr.lemb(RD)]);

// acesso
let entrarCount = 0;
await wire(S.entrar, [
  [l => l.txt === 'Entrar' && entrarCount++ > 0, () => go(S.aPainel)],
  [l => l.txt === 'Criar conta', () => go(S.criar)],
  [l => /^Aluno /.test(l.txt), () => go(S.aPainel)],
  [l => /^Professor /.test(l.txt), () => go(S.pPainel)],
  [l => /^Administração /.test(l.txt), () => go(S.adm)],
]);
await wire(S.criar, [
  [l => l.txt === 'Entrar', () => go(S.entrar)],
  [l => l.txt === 'Criar conta e entrar', () => go(S.aPainel)],
]);
// quadro do perfil (tela 6)
await wire(S.perfil, [
  [l => l.aria === 'Fechar' || l.txt === 'Cancelar', () => go(S.aPainel)],
  [l => l.txt === 'Salvar preferências', () => overlay(T.pref)],
  [l => l.txt === 'Sair da conta', () => go(S.entrar)],
]);

// celular
await wire(S.mPainel, [
  [l => l.aria.startsWith('Notificações'), () => overlay(T.mBell)],
  [l => l.aria === 'Abrir menu', () => overlay(O.mMenu)],
  [l => l.txt === 'Ver todos', () => go(S.mCrono, push('LEFT'))],
  [isEvent, () => go(S.mDet)],
]);
await wire(S.mCrono, [
  [l => l.aria === 'Voltar ao painel', () => go(S.mPainel, push('RIGHT'))],
  [l => l.aria === 'Abrir menu', () => overlay(O.mMenu)],
  [l => l.node.name === 'Link', () => go(S.mDet)],
]);
await wire(S.mDet, [
  [l => l.aria === 'Fechar', () => go(S.mCrono)],
  [l => l.txt === 'Atualizar lembrete', () => overlay(T.mLembUpd)],
]);
await wire(S.mMenu, [
  [l => l.aria === 'Fechar menu' || l.txt === 'Painel', () => go(S.mPainel)],
  [l => l.txt === 'Cronograma', () => go(S.mCrono)],
]);

// visão geral
await wire(S.mapa, [
  [l => /^Telas 1 e 1b/.test(l.txt), () => go(S.entrar)],
  [l => /^Telas 2, 7 e 9/.test(l.txt), () => go(S.aPainel)],
  [l => /^Telas 3 e 4/.test(l.txt), () => go(S.cal)],
  [l => /^Tela 4/.test(l.txt), () => go(S.agenda)],
  [l => /^Tela 5/.test(l.txt), () => go(S.lemb)],
  [l => /^Tela 6/.test(l.txt), () => go(S.perfil)],
  [l => /^Tela 8/.test(l.txt), () => go(S.gestao)],
  [l => /^Tela 10/.test(l.txt), () => go(S.sync)],
]);
const reqMap = {
  '1b Criar conta': S.criar, '1 Entrar': S.entrar, '6 Sair da conta': S.perfil, '3 Calendário': S.cal,
  '4 Agenda': S.agenda, '2 Aluno': S.aPainel, '7 Professor': S.pPainel, '9 Admin': S.adm, '8 Gestão': S.gestao,
  '4 Detalhe': S.agenda, '5 Lembretes': S.lemb, '10 Sincronização': S.sync, '6 Perfil': S.perfil,
  '10 Permissão': S.estados, 'Mapa': S.mapa,
};
let mobileCount = 0;
await wire(S.req, [
  [l => l.txt === 'Mobile', () => go(mobileCount++ === 0 ? S.mCrono : S.mDet)],
  [l => !!reqMap[l.txt], l => go(reqMap[l.txt])],
]);

// sobreposições
for (const f of [O.perfil, O.perfilP, O.perfilD]) {
  await wire(f, [
    [l => l.aria === 'Fechar' || l.txt === 'Cancelar', () => CLOSE],
    [l => l.txt === 'Salvar preferências', () => swap(T.pref)],
    [l => l.txt === 'Sair da conta', () => go(S.entrar)],
  ]);
  await wireNode(f.findOne(n => n.name === 'Fundo (fecha ao clicar)'), CLOSE);
}
await wire(O.mMenu, [
  [l => l.aria === 'Fechar menu', () => CLOSE],
  [l => l.txt === 'Painel', () => go(S.mPainel)],
  [l => l.txt === 'Cronograma', () => go(S.mCrono)],
]);
await wireNode(O.mMenuBg, CLOSE);
await wireNode(O.confirmBg, CLOSE);
const btn = text => {
  const t = O.confirmCard.findOne(n => n.type === 'TEXT' && n.characters === text);
  return t && t.parent;
};
await wireNode(btn('Cancelar'), CLOSE);
await wireNode(btn('Excluir evento'), swap(T.excl));

// apresentação: clique ou setas nos quadros de abertura e no guia
await S.capa.setReactionsAsync([click(go(S.mapa)), key(39, go(S.mapa))]);
await S.mapa.setReactionsAsync([key(39, go(S.req)), key(37, go(S.capa))]);
await S.req.setReactionsAsync([key(37, go(S.mapa))]);
await S.guia.setReactionsAsync([click(go(S.estados)), key(39, go(S.estados))]);
await S.estados.setReactionsAsync([key(37, go(S.guia))]);

secComp.y = secSobre.y + secSobre.height + 200;
fitSection(secComp);

page.flowStartingPoints = [
  { nodeId: S.capa.id, name: '1 · Apresentação' },
  { nodeId: S.entrar.id, name: '2 · Entrar e aluno' },
  { nodeId: S.pPainel.id, name: '3 · Professor' },
  { nodeId: S.adm.id, name: '4 · Administração' },
  { nodeId: S.mPainel.id, name: '5 · Celular' },
  { nodeId: S.guia.id, name: '6 · Guia visual e estados' },
];

return {
  secoes: { perfis: secPerfis.id, sobreposicoes: secSobre.id, componentes: secComp.id },
  seletores: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, { set: v.set.id, variantes: v.set.children.length, instancia: v.inst.id, pai: v.inst.parent.name }])),
  copias: Object.fromEntries([...Object.entries(P).map(([k, v]) => ['P.' + k, v.id]), ...Object.entries(D).map(([k, v]) => ['D.' + k, v.id])]),
  sobreposicoes: Object.fromEntries([...Object.entries(O).filter(([, v]) => v.type === 'FRAME' && v.parent === secSobre).map(([k, v]) => [k, v.id]), ...Object.entries(T).map(([k, v]) => [k, v.id])]),
  fluxos: page.flowStartingPoints.length,
  ligacoes: report,
};
