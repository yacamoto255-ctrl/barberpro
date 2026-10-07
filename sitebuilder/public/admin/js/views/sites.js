// views/sites.js — lista, criação e edição completa dos sites
import { get, post, patch, put, del, api } from '../api.js';
import {
  h, clear, toast, field, onSubmit, dialog, confirmDialog, formValues, showFieldErrors, fmt, table, pageHead, emptyState,
} from '../ui.js';
import { go, session } from '../main.js';

const CATEGORY_LABEL = {
  barbearia: 'Barbearia', salao: 'Salão de beleza', estetica: 'Estética', clinica: 'Clínica', odontologia: 'Odontologia',
  psicologia: 'Psicologia', nutricao: 'Nutrição', estudio_tatuagem: 'Estúdio de tatuagem', pet: 'Pet shop', fitness: 'Academia / treino',
  fotografia: 'Fotografia', consultoria: 'Consultoria', aulas: 'Aulas / cursos', outro: 'Outro',
};
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const TABS = [['dados', 'Dados'], ['servicos', 'Serviços'], ['equipe', 'Equipe'], ['horarios', 'Horários'],
  ['aparencia', 'Aparência'], ['imagens', 'Imagens'], ['agendamento', 'Agendamento']];
const MAX_IMG = 2 * 1024 * 1024;

const categoryOptions = (cats) => cats.map((c) => [c, CATEGORY_LABEL[c] || c]);
const publicUrl = (slug) => `${location.origin}/s/${slug}`;

/* ── Lista ─────────────────────────────────────────────── */
export async function sitesView(root) {
  const { sites } = await get('/sites');
  const cards = sites.map((s) => h('div', { class: 'card site-card' },
    h('div', { class: 'top' },
      h('div', {}, h('h2', { text: s.name }), h('div', { class: 'small muted', text: CATEGORY_LABEL[s.category] || s.category })),
      h('div', {}, s.is_demo ? h('span', { class: 'pill pending', text: 'Demonstração' }) : null, ' ',
        h('span', { class: `pill ${s.published ? 'on' : 'off'}`, text: s.published ? 'Publicado' : 'Rascunho' }))),
    h('div', { class: 'swatches', 'aria-hidden': 'true' }, ['bg', 'surface', 'primary', 'accent', 'text'].map((k) => h('span', { style: { background: s.theme.palette[k] } }))),
    h('div', { class: 'url' }, s.published ? h('a', { href: publicUrl(s.slug), target: '_blank', rel: 'noopener', text: publicUrl(s.slug) }) : h('span', { class: 'muted', text: `/s/${s.slug}` })),
    h('div', { class: 'small muted', text: `${s.services_count} serviço(s) ativo(s) · ${s.upcoming_count} agendamento(s) futuro(s)` }),
    h('div', { class: 'form-actions' }, h('a', { class: 'btn', href: `#/sites/${s.id}` }, 'Editar'),
      h('a', { class: 'btn ghost', href: `#/agenda?site=${s.id}` }, 'Agenda'))));
  clear(root).append(
    pageHead('Sites', { actions: [h('a', { class: 'btn ghost', href: '/modelos', target: '_blank', rel: 'noopener' }, 'Ver modelos ↗'), h('a', { class: 'btn ghost', href: '/exemplos', target: '_blank', rel: 'noopener' }, 'Ver portfólio ↗'), h('a', { class: 'btn primary', href: '#/sites/novo' }, '+ Novo site')], subtitle: 'Cada negócio ganha um site com agendamento online.' }),
    sites.length ? h('div', { class: 'grid g3' }, cards)
      : h('div', { class: 'card' }, emptyState('Nenhum site ainda', 'Crie o primeiro site para um cliente da agência.', h('a', { class: 'btn primary', href: '#/sites/novo' }, 'Criar site'))),
  );
}

/* ── Novo ──────────────────────────────────────────────── */
export async function siteNewView(root) {
  const { categories, ufs } = await get('/sites');
  const catalog = await get('/models').catch(() => ({ models: [] }));
  const modelSelect = h('select', { id: 'new-model', name: 'model_id' });
  const modelHint = h('div', { class: 'hint' });
  const fillModels = (category) => {
    const list = catalog.models.filter((m) => m.category === category);
    modelSelect.replaceChildren(h('option', { value: '' }, list.length ? 'Sem modelo (tema padrão)' : 'Sem modelos para esta categoria'),
      ...list.map((m) => h('option', { value: m.id }, `${String(m.number).padStart(2, '0')} · ${m.name}`)));
    modelSelect.disabled = !list.length;
    modelHint.replaceChildren(list.length ? 'Aplica cores, fontes, textos e capa do modelo. Dá para trocar depois na aba Aparência. ' : '',
      list.length ? h('a', { href: `/modelos#${category}`, target: '_blank', rel: 'noopener' }, 'Ver os modelos ↗') : '');
  };
  const form = h('form', { class: 'form card', novalidate: true },
    field({ label: 'Nome do negócio', name: 'name', required: true, maxlength: 120 }),
    h('div', { class: 'row' },
      field({ label: 'Categoria', name: 'category', type: 'select', options: categoryOptions(categories), value: 'outro' }),
      field({ label: 'Endereço do site', name: 'slug', maxlength: 60, placeholder: 'gerado a partir do nome', hint: 'Letras minúsculas, números e hífen. Ex.: barbearia-do-ze' })),
    h('div', { class: 'row' },
      field({ label: 'WhatsApp do negócio', name: 'whatsapp', type: 'tel', placeholder: '(11) 98765-4321' }),
      field({ label: 'Cidade', name: 'city', maxlength: 80 }),
      field({ label: 'UF', name: 'state', type: 'select', options: [['', '—'], ...ufs.map((u) => [u, u])] })),
    h('div', { class: 'field' }, h('label', { for: 'new-model', text: 'Modelo de site (opcional)' }), modelSelect, modelHint),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Criar site'), h('a', { class: 'btn ghost', href: '#/sites' }, 'Cancelar')));
  const catSelect = form.querySelector('[name="category"]');
  catSelect.addEventListener('change', () => fillModels(catSelect.value));
  fillModels(catSelect.value);
  onSubmit(form, async (v) => {
    const { model_id: modelId, ...rest } = v;
    const body = Object.fromEntries(Object.entries(rest).filter(([, x]) => x !== ''));
    const { site } = await post('/sites', body);
    if (modelId) {
      try {
        await post(`/sites/${site.id}/apply-model`, { model_id: modelId });
      } catch (e) {
        toast(`Site criado, mas o modelo não foi aplicado: ${e.message} Aplique na aba Aparência.`, 'err');
        go(`/sites/${site.id}/aparencia`);
        return;
      }
    }
    toast(modelId ? 'Site criado com o modelo escolhido. Agora cadastre serviços e horários.' : 'Site criado. Agora cadastre serviços e horários.', 'ok');
    go(`/sites/${site.id}/servicos`);
  });
  clear(root).append(pageHead('Novo site', { crumbs: h('a', { href: '#/sites' }, 'Sites') }), form);
  form.querySelector('input').focus();
}

/* ── Edição ────────────────────────────────────────────── */
export async function siteEditView(root, id, tab = 'dados') {
  if (!TABS.some(([t]) => t === tab)) tab = 'dados';
  const data = await get(`/sites/${id}`);
  const meta = await get('/sites');
  const site = data.site;

  const publishBtn = h('button', { type: 'button', class: `btn ${site.published ? 'ghost' : 'primary'}` }, site.published ? 'Despublicar' : 'Publicar site');
  publishBtn.addEventListener('click', async () => {
    if (!site.published && !data.services.some((s) => s.active)) {
      const ok = await confirmDialog('Publicar sem serviços?', 'O site não tem serviços ativos, então o agendamento online não aparece. Publicar mesmo assim?');
      if (!ok) return;
    }
    try {
      await patch(`/sites/${id}`, { published: !site.published });
      toast(site.published ? 'Site despublicado.' : 'Site publicado! 🎉', 'ok');
      siteEditView(root, id, tab);
    } catch (e) { toast(e.message, 'err'); }
  });
  const previewBtn = h('button', { type: 'button', class: 'btn ghost' }, site.published ? 'Abrir site ↗' : 'Pré-visualizar ↗');
  previewBtn.addEventListener('click', async () => {
    const w = window.open('', '_blank');
    try { const { url } = await get(`/sites/${id}/preview-link`); if (w) w.location = url; else location.href = url; } catch (e) { w?.close(); toast(e.message, 'err'); }
  });

  const content = h('div');
  clear(root).append(
    pageHead(site.name, {
      crumbs: h('a', { href: '#/sites' }, 'Sites'),
      subtitle: site.published ? publicUrl(site.slug) : `Rascunho — /s/${site.slug}`,
      actions: [previewBtn, publishBtn],
    }),
    h('nav', { class: 'tabs', 'aria-label': 'Seções do site' }, TABS.map(([t, label]) => h('a', { href: `#/sites/${id}/${t}`, 'aria-current': t === tab ? 'page' : null }, label))),
    content,
  );
  const reload = () => siteEditView(root, id, tab);
  const views = { dados: tabDados, servicos: tabServicos, equipe: tabEquipe, horarios: tabHorarios, aparencia: tabAparencia, imagens: tabImagens, agendamento: tabAgendamento };
  return views[tab](content, data, meta, reload);
}

function tabDados(root, data, meta, reload) {
  const s = data.site;
  const form = h('form', { class: 'form card', novalidate: true },
    h('h2', { text: 'Dados do negócio' }),
    h('div', { class: 'row' },
      field({ label: 'Nome', name: 'name', required: true, value: s.name, maxlength: 120 }),
      field({ label: 'Categoria', name: 'category', type: 'select', options: categoryOptions(meta.categories), value: s.category }),
      field({ label: 'Endereço do site', name: 'slug', value: s.slug, maxlength: 60, hint: 'Mudar o endereço quebra links já divulgados.' })),
    field({ label: 'Frase de efeito', name: 'tagline', value: s.tagline || '', maxlength: 160, hint: 'Aparece no topo do site e no Google.' }),
    field({ label: 'Descrição', name: 'description', type: 'textarea', value: s.description || '', maxlength: 2000, hint: 'Conte a história, diferenciais, público. A IA usa este texto para criar o site.' }),
    h('h2', { text: 'Contato' }),
    h('div', { class: 'row' },
      field({ label: 'WhatsApp', name: 'whatsapp', type: 'tel', value: s.whatsapp || '' }),
      field({ label: 'Telefone', name: 'phone', type: 'tel', value: s.phone || '' }),
      field({ label: 'E-mail', name: 'email', type: 'email', value: s.email || '', maxlength: 254 }),
      field({ label: 'Instagram', name: 'instagram', value: s.instagram ? `@${s.instagram}` : '', placeholder: '@perfil' })),
    h('h2', { text: 'Endereço e empresa' }),
    h('div', { class: 'row' },
      field({ label: 'CEP', name: 'cep', type: 'cep', value: s.cep || '', placeholder: '00000-000' }),
      field({ label: 'Endereço', name: 'address', value: s.address || '', maxlength: 200, placeholder: 'Rua, número, bairro' })),
    h('div', { class: 'row' },
      field({ label: 'Cidade', name: 'city', value: s.city || '', maxlength: 80 }),
      field({ label: 'UF', name: 'state', type: 'select', options: [['', '—'], ...meta.ufs.map((u) => [u, u])], value: s.state || '' }),
      field({ label: 'CNPJ', name: 'cnpj', type: 'cnpj', value: s.cnpj || '', hint: 'Opcional. Aceita o formato alfanumérico novo.' })),
    h('h2', { text: 'Profissão regulamentada (saúde)' }),
    h('p', { class: 'muted small', text: 'Dentistas, médicos, psicólogos e nutricionistas: os conselhos exigem nome e registro do responsável técnico na divulgação. No caso do CFO (odontologia), anunciar preços é vedado.' }),
    h('div', { class: 'row' },
      field({ label: 'Responsável técnico', name: 'responsible_name', value: s.responsible_name || '', maxlength: 120, placeholder: 'Dra. Ana Souza' }),
      field({ label: 'Registro do responsável', name: 'responsible_registration', value: s.responsible_registration || '', maxlength: 40, placeholder: 'CRO-PR 12345' }),
      field({ label: 'Registro da clínica no conselho', name: 'company_registration', value: s.company_registration || '', maxlength: 40, placeholder: 'CRO-PR EPAO 1234', hint: 'Opcional.' })),
    field({ label: 'Ocultar preços no site (continuam no painel e nos relatórios)', name: 'hide_prices', type: 'checkbox', value: !!s.hide_prices }),
    h('h2', { text: 'Portfólio' }),
    field({ label: 'Site de demonstração (negócio fictício para mostrar a clientes)', name: 'is_demo', type: 'checkbox', value: !!s.is_demo,
      hint: 'Mostra a faixa "Site de demonstração", deixa os contatos sem link, simula o agendamento sem gravar nada, tira o site do Google e o lista em /exemplos quando publicado.' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar dados')));

  // CEP: busca endereço no ViaCEP quando o campo fica completo (se falhar, segue manual)
  const cepInput = form.querySelector('[name="cep"]');
  cepInput.addEventListener('blur', async () => {
    const d = cepInput.value.replace(/\D/g, '');
    if (d.length !== 8 || form.querySelector('[name="address"]').value) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = await r.json();
      if (j.erro) return;
      form.querySelector('[name="address"]').value = [j.logradouro, j.bairro].filter(Boolean).join(', ');
      form.querySelector('[name="city"]').value = j.localidade || '';
      form.querySelector('[name="state"]').value = j.uf || '';
    } catch (_) { /* sem ViaCEP: preenchimento manual */ }
  });
  onSubmit(form, async (v) => {
    await patch(`/sites/${s.id}`, v);
    toast('Dados salvos.', 'ok');
    reload();
  });

  root.append(form);
  if (session.user.role === 'admin') {
    const danger = h('div', { class: 'card' }, h('h2', { text: 'Excluir site' }),
      h('p', { class: 'muted', text: 'Apaga o site, serviços, equipe, imagens e todos os agendamentos dele. Não dá para desfazer (só restaurando um backup).' }),
      h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        const input = h('input', { 'aria-label': 'Endereço do site', placeholder: s.slug, class: 'field' });
        const wrap = h('div', { class: 'field' }, h('p', {}, 'Digite ', h('strong', { text: s.slug }), ' para confirmar:'), input);
        await dialog({
          title: 'Excluir site definitivamente', body: wrap,
          actions: [{ label: 'Voltar', value: false }, { label: 'Excluir', class: 'danger', handler: async () => {
            try { await del(`/sites/${s.id}`, { confirm: input.value.trim() }); toast('Site excluído.', 'ok'); go('/sites'); return true; } catch (e) { toast(e.message, 'err'); return false; }
          } }],
        });
      } }, 'Excluir site'));
    root.append(danger);
  }
}

function serviceDialog(siteId, svc, reload) {
  const form = h('form', { class: 'form', novalidate: true },
    field({ label: 'Nome do serviço', name: 'name', required: true, value: svc?.name || '', maxlength: 120 }),
    field({ label: 'Descrição', name: 'description', type: 'textarea', rows: 3, value: svc?.description || '', maxlength: 500 }),
    h('div', { class: 'row' },
      field({ label: 'Duração (minutos)', name: 'duration_min', type: 'number', required: true, min: 5, max: 720, step: 5, value: svc?.duration_min ?? 30 }),
      field({ label: 'Preço (R$)', name: 'price', type: 'money', required: true, value: svc?.price_cents ?? 0, hint: '0,00 = "Consulte"' }),
      field({ label: 'Ordem', name: 'sort_order', type: 'number', min: 0, max: 9999, value: svc?.sort_order ?? 0 })),
    field({ label: 'Ativo (aparece no site)', name: 'active', type: 'checkbox', value: svc ? !!svc.active : true }));
  return dialog({
    title: svc ? 'Editar serviço' : 'Novo serviço', body: form,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Salvar', class: 'primary', handler: async () => {
      const v = formValues(form);
      try {
        if (svc) await patch(`/sites/${siteId}/services/${svc.id}`, v); else await post(`/sites/${siteId}/services`, v);
        toast('Serviço salvo.', 'ok'); reload(); return true;
      } catch (e) { if (!showFieldErrors(form, e)) toast(e.message, 'err'); return false; }
    } }],
  });
}

function tabServicos(root, data, meta, reload) {
  const id = data.site.id;
  if (data.site.hide_prices) root.append(h('div', { class: 'alert info', text: 'Preços ocultos no site público (aba Dados). Eles continuam valendo no painel e nos relatórios.' }));
  root.append(h('div', { class: 'page-head' }, h('p', { class: 'muted', text: 'Serviços que o cliente escolhe ao agendar. Preço e duração definem a agenda.' }),
    h('button', { class: 'btn primary', type: 'button', onclick: () => serviceDialog(id, null, reload) }, '+ Novo serviço')),
  table([
    { label: 'Serviço', render: (s) => h('div', {}, h('strong', { text: s.name }), s.description ? h('div', { class: 'small muted', text: s.description }) : null) },
    { label: 'Duração', render: (s) => `${s.duration_min} min` },
    { label: 'Preço', num: true, render: (s) => (s.price_cents ? fmt.brl(s.price_cents) : 'Consulte') },
    { label: 'Status', render: (s) => h('span', { class: `pill ${s.active ? 'on' : 'off'}`, text: s.active ? 'Ativo' : 'Inativo' }) },
    { label: 'Ações', render: (s) => h('div', { class: 'cell-actions' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => serviceDialog(id, s, reload) }, 'Editar'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Excluir serviço', `Excluir "${s.name}"? Agendamentos antigos continuam no histórico.`, { danger: true, ok: 'Excluir' }))) return;
        try { await del(`/sites/${id}/services/${s.id}`); toast('Serviço excluído.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
      } }, 'Excluir')) },
  ], data.services, { empty: 'Nenhum serviço cadastrado. Sem serviços ativos o site não mostra a agenda.' }));
}

function professionalDialog(siteId, services, p, reload) {
  const checks = services.length ? h('fieldset', { class: 'field' }, h('legend', { class: 'small', text: 'Serviços que atende (nenhum marcado = todos)' }),
    services.map((s) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: String(s.id), 'data-svc': '1', checked: p?.service_ids.includes(s.id) }), s.name))) : null;
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'row' },
      field({ label: 'Nome', name: 'name', required: true, value: p?.name || '', maxlength: 120 }),
      field({ label: 'Função', name: 'title', value: p?.title || '', maxlength: 80, placeholder: 'Ex.: Barbeiro, Cirurgiã-dentista' }),
      field({ label: 'Registro profissional', name: 'registration', value: p?.registration || '', maxlength: 40, placeholder: 'Ex.: CRO-PR 12345', hint: 'Obrigatório na divulgação de profissionais de saúde.' })),
    field({ label: 'Apresentação', name: 'bio', type: 'textarea', rows: 3, value: p?.bio || '', maxlength: 600 }),
    h('div', { class: 'row' },
      field({ label: 'Ordem', name: 'sort_order', type: 'number', min: 0, max: 9999, value: p?.sort_order ?? 0 }),
      field({ label: 'Ativo (recebe agendamentos)', name: 'active', type: 'checkbox', value: p ? !!p.active : true })),
    checks);
  return dialog({
    title: p ? 'Editar profissional' : 'Novo profissional', body: form,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Salvar', class: 'primary', handler: async () => {
      const v = formValues(form);
      v.service_ids = [...form.querySelectorAll('input[data-svc]:checked')].map((c) => Number(c.value));
      try {
        if (p) await patch(`/sites/${siteId}/professionals/${p.id}`, v); else await post(`/sites/${siteId}/professionals`, v);
        toast('Profissional salvo.', 'ok'); reload(); return true;
      } catch (e) { if (!showFieldErrors(form, e)) toast(e.message, 'err'); return false; }
    } }],
  });
}

function filePicker(onFile, { multiple = false } = {}) {
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, multiple: multiple || null });
  input.addEventListener('change', async () => {
    for (const f of input.files) {
      if (f.size > MAX_IMG) { toast(`"${f.name}" passa de 2 MB. Reduza a imagem e tente de novo.`, 'err'); continue; }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { toast(`"${f.name}" não é PNG, JPG ou WebP.`, 'err'); continue; }
      await onFile(f);
    }
    input.value = '';
  });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60_000);
}

function tabEquipe(root, data, meta, reload) {
  const id = data.site.id;
  const svcName = Object.fromEntries(data.services.map((s) => [s.id, s.name]));
  root.append(h('div', { class: 'page-head' },
    h('p', { class: 'muted', text: 'Quem atende. Sem equipe cadastrada, a agenda funciona como um único atendimento por vez.' }),
    h('button', { class: 'btn primary', type: 'button', onclick: () => professionalDialog(id, data.services, null, reload) }, '+ Novo profissional')),
  table([
    { label: 'Foto', render: (p) => (p.photo_image_id ? h('img', { class: 'thumb', src: `/img/${p.photo_image_id}`, alt: '' }) : h('span', { class: 'thumb', 'aria-hidden': 'true' })) },
    { label: 'Profissional', render: (p) => h('div', {}, h('strong', { text: p.name }), p.title ? h('div', { class: 'small muted', text: p.title }) : null) },
    { label: 'Serviços', render: (p) => (p.service_ids.length ? p.service_ids.map((s) => svcName[s]).filter(Boolean).join(', ') : 'Todos') },
    { label: 'Status', render: (p) => h('span', { class: `pill ${p.active ? 'on' : 'off'}`, text: p.active ? 'Ativo' : 'Inativo' }) },
    { label: 'Ações', render: (p) => h('div', { class: 'cell-actions' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => professionalDialog(id, data.services, p, reload) }, 'Editar'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => filePicker(async (f) => {
        try { await api('POST', `/sites/${id}/professionals/${p.id}/photo`, f); toast('Foto enviada.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
      }) }, 'Foto'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Excluir profissional', `Excluir ${p.name}?`, { danger: true, ok: 'Excluir' }))) return;
        try { await del(`/sites/${id}/professionals/${p.id}`); toast('Profissional excluído.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
      } }, 'Excluir')) },
  ], data.professionals, { empty: 'Nenhum profissional cadastrado.' }));
}

function tabHorarios(root, data, meta, reload) {
  const id = data.site.id;
  const byDay = WEEKDAYS.map((_, wd) => data.hours.filter((x) => x.weekday === wd).map((x) => ({ open: x.open_time, close: x.close_time })));
  const editor = h('div');
  function rangeRow(wd, r, i) {
    const o = h('input', { type: 'time', value: r.open, 'aria-label': `${WEEKDAYS[wd]} abre`, step: 300 });
    const c = h('input', { type: 'time', value: r.close, 'aria-label': `${WEEKDAYS[wd]} fecha`, step: 300 });
    o.addEventListener('change', () => { r.open = o.value; });
    c.addEventListener('change', () => { r.close = c.value; });
    return h('div', { class: 'range' }, o, h('span', { text: 'às' }), c,
      h('button', { type: 'button', class: 'btn sm ghost', 'aria-label': 'Remover faixa', onclick: () => { byDay[wd].splice(i, 1); draw(); } }, '✕'));
  }
  function draw() {
    clear(editor).append(...WEEKDAYS.map((label, wd) => h('div', { class: 'hours-day' },
      h('strong', { text: label }),
      h('div', { class: 'ranges' },
        byDay[wd].length ? byDay[wd].map((r, i) => rangeRow(wd, r, i)) : h('span', { class: 'muted', text: 'Fechado' }),
        byDay[wd].length < 4 ? h('button', { type: 'button', class: 'link', onclick: () => {
          const last = byDay[wd][byDay[wd].length - 1];
          byDay[wd].push(last ? { open: last.close < '22:00' ? last.close : '09:00', close: '18:00' } : { open: '09:00', close: '18:00' });
          draw();
        } }, byDay[wd].length ? '+ faixa (ex.: depois do almoço)' : '+ abrir neste dia') : null))));
  }
  draw();
  const save = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    const hours = byDay.flatMap((ranges, wd) => ranges.map((r) => ({ weekday: wd, open_time: r.open, close_time: r.close })));
    try { await put(`/sites/${id}/hours`, { hours }); toast('Horários salvos.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
  } }, 'Salvar horários');

  const blockForm = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'row' },
      field({ label: 'Início', name: 'starts', type: 'datetime-local', required: true }),
      field({ label: 'Fim', name: 'ends', type: 'datetime-local', required: true }),
      field({ label: 'Profissional', name: 'professional_id', type: 'select', options: [['', 'Todo o negócio'], ...data.professionals.map((p) => [p.id, p.name])] }),
      field({ label: 'Motivo', name: 'reason', maxlength: 160, placeholder: 'Feriado, férias, folga…' })),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Adicionar bloqueio')));
  onSubmit(blockForm, async (v) => {
    const toLocal = (x) => (x ? x.replace('T', ' ').slice(0, 16) : '');
    const body = { starts_at: toLocal(v.starts), ends_at: toLocal(v.ends), reason: v.reason || undefined };
    if (v.professional_id) body.professional_id = Number(v.professional_id);
    try { await post(`/sites/${id}/blocks`, body); } catch (e) {
      if (e.fields) e.fields = { starts: e.fields.starts_at, ends: e.fields.ends_at, ...e.fields };
      throw e;
    }
    toast('Bloqueio adicionado.', 'ok'); reload();
  });
  const profName = Object.fromEntries(data.professionals.map((p) => [p.id, p.name]));

  root.append(
    h('div', { class: 'card' }, h('h2', { text: 'Horário de funcionamento' }), h('p', { class: 'muted small', text: 'Até 4 faixas por dia. Os horários oferecidos no site respeitam a duração de cada serviço.' }), editor, h('div', { class: 'form-actions', style: { marginTop: '14px' } }, save)),
    h('div', { class: 'card' }, h('h2', { text: 'Bloqueios (folgas, feriados, férias)' }), blockForm, h('div', { style: { height: '12px' } }),
      table([
        { label: 'Período', render: (b) => `${fmt.dt(b.starts_at)} → ${fmt.dt(b.ends_at)}` },
        { label: 'Quem', render: (b) => (b.professional_id ? profName[b.professional_id] || '—' : 'Todo o negócio') },
        { label: 'Motivo', key: 'reason' },
        { label: 'Ações', render: (b) => h('div', { class: 'cell-actions' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          try { await del(`/sites/${id}/blocks/${b.id}`); toast('Bloqueio removido.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
        } }, 'Remover')) },
      ], data.blocks, { empty: 'Nenhum bloqueio futuro.' })),
  );
}

async function tabAparencia(root, data, meta, reload) {
  const id = data.site.id;
  const opts = await get('/themes');
  let theme = structuredClone(data.site.theme);
  let undo = null;
  const frame = h('iframe', { class: 'preview-frame', title: 'Pré-visualização do site', loading: 'lazy' });
  async function refreshPreview() {
    try { const { url } = await get(`/sites/${id}/preview-link`); frame.src = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`; } catch (_) { /* sem prévia */ }
  }

  const presets = h('div', { class: 'theme-presets' }, opts.presets.map((p) => h('button', {
    type: 'button', class: 'preset', 'aria-pressed': theme.preset === p.id ? 'true' : 'false',
    onclick: () => { const copy = theme.copy; theme = structuredClone(p.theme); theme.copy = copy; drawEditor(); presets.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', 'false')); },
  }, h('div', { class: 'sw' }, ['bg', 'surface', 'primary', 'accent', 'text'].map((k) => h('span', { style: { background: p.theme.palette[k] } }))),
  h('strong', { text: p.label }), h('div', { class: 'small muted', text: `${p.theme.fonts.heading} + ${p.theme.fonts.body}` }))));

  // Modelos da Versal (catálogo): escolha por nicho, prévia e aplicação
  const catalog = await get('/models').catch(() => ({ categories: [], models: [] }));
  const nicheSelect = h('select', { id: 'model-niche' }, catalog.categories.map((cat) => h('option', { value: cat.category }, `${cat.label} (${cat.count})`)));
  nicheSelect.value = catalog.categories.some((cat) => cat.category === data.site.category) ? data.site.category : (catalog.categories[0]?.category || '');
  const modelGrid = h('div', { class: 'model-grid' });
  const modelUndo = h('button', { type: 'button', class: 'btn ghost', hidden: true, onclick: () => undoBtn.click() }, 'Desfazer modelo');
  async function applyModel(m) {
    const copyBox = h('input', { type: 'checkbox', checked: true });
    const coverBox = h('input', { type: 'checkbox', checked: !!m.cover_url, disabled: m.cover_url ? null : true });
    const body = h('div', { class: 'form' },
      h('p', { class: 'muted', text: `Cores, fontes e layout do modelo "${m.name}" substituem os atuais.` }),
      h('label', { class: 'check' }, copyBox, 'Usar também os textos do modelo (título, subtítulo, sobre…)'),
      h('label', { class: 'check' }, coverBox, 'Usar a ilustração de capa do modelo (substitui a capa atual; o "Desfazer" não traz a capa antiga de volta)'));
    await dialog({
      title: `Aplicar modelo ${String(m.number).padStart(2, '0')} · ${m.name}`, body,
      actions: [{ label: 'Cancelar', value: false }, { label: 'Aplicar modelo', class: 'primary', handler: async () => {
        try {
          const r = await post(`/sites/${id}/apply-model`, { model_id: m.id, copy: copyBox.checked, cover: coverBox.checked });
          undo = r.previous_theme; undoBtn.hidden = false; modelUndo.hidden = false;
          theme = r.site.theme; drawEditor();
          clear(warnBox).append(r.warnings.length ? h('div', { class: 'alert warn', text: r.warnings.join(' ') }) : null);
          toast(`Modelo "${m.name}" aplicado.`, 'ok'); refreshPreview();
          return true;
        } catch (e) { toast(e.message, 'err'); return false; }
      } }],
    });
  }
  function drawModels() {
    const list = catalog.models.filter((m) => m.category === nicheSelect.value);
    clear(modelGrid).append(...list.map((m) => h('article', { class: 'model-card' },
      m.thumb_url ? h('img', { src: m.thumb_url, alt: '', loading: 'lazy' }) : null,
      h('div', { class: 'info' },
        h('span', { class: 'small muted', text: `Modelo ${String(m.number).padStart(2, '0')} · ${m.fonts.heading} + ${m.fonts.body}` }),
        h('strong', { text: m.name }),
        h('div', { class: 'swatches', 'aria-hidden': 'true' }, ['bg', 'surface', 'primary', 'accent', 'text'].map((k) => h('span', { style: { background: m.palette[k] } }))),
        h('span', { class: 'small muted', text: m.style }),
        h('div', { class: 'acts' },
          h('a', { class: 'btn sm ghost', href: m.preview_url, target: '_blank', rel: 'noopener' }, 'Prévia ↗'),
          h('button', { class: 'btn sm primary', type: 'button', onclick: () => applyModel(m) }, 'Aplicar'))))));
  }
  nicheSelect.addEventListener('change', drawModels);
  drawModels();

  const editor = h('div', { class: 'form' });
  const LABELS = { bg: 'Fundo', surface: 'Cartões', text: 'Texto', muted: 'Texto secundário', primary: 'Cor principal (botões)', on_primary: 'Texto dos botões', accent: 'Destaque' };
  const COPY = { headline: 'Título principal', subheadline: 'Subtítulo', about: 'Texto "Sobre"', cta: 'Texto do botão', services_title: 'Título de serviços', team_title: 'Título da equipe', booking_title: 'Título do agendamento' };
  function drawEditor() {
    const colorInputs = Object.keys(LABELS).map((k) => {
      const inp = h('input', { type: 'color', value: theme.palette[k], id: `c-${k}` });
      inp.addEventListener('input', () => { theme.palette[k] = inp.value; theme.preset = 'custom'; });
      return h('div', { class: 'field' }, h('label', { for: `c-${k}`, text: LABELS[k] }), inp);
    });
    const sel = (label, key, list, sub) => {
      const s = h('select', { id: `s-${key}` }, list.map((x) => h('option', { value: x }, x)));
      s.value = sub ? theme[sub][key] : theme[key];
      s.addEventListener('change', () => { if (sub) theme[sub][key] = s.value; else theme[key] = s.value; theme.preset = 'custom'; });
      return h('div', { class: 'field' }, h('label', { for: `s-${key}`, text: label }), s);
    };
    const copyInputs = Object.entries(COPY).map(([k, label]) => {
      const max = opts.copy_limits[k];
      const inp = k === 'about' ? h('textarea', { id: `t-${k}`, maxlength: max, rows: 5 }) : h('input', { id: `t-${k}`, maxlength: max });
      inp.value = theme.copy[k] || '';
      inp.addEventListener('input', () => { theme.copy[k] = inp.value; });
      return h('div', { class: 'field' }, h('label', { for: `t-${k}`, text: label }), inp, h('div', { class: 'hint', text: `Até ${max} caracteres. Vazio = usa os dados do site.` }));
    });
    clear(editor).append(
      h('h3', { text: 'Cores' }), h('div', { class: 'row' }, colorInputs),
      h('h3', { text: 'Tipografia e estilo' }),
      h('div', { class: 'row' }, sel('Fonte dos títulos', 'heading', opts.heading_fonts, 'fonts'), sel('Fonte do texto', 'body', opts.body_fonts, 'fonts'),
        sel('Topo (hero)', 'hero_layout', opts.hero_layouts), sel('Cantos', 'radius', opts.radii), sel('Fundo', 'background', opts.backgrounds)),
      h('h3', { text: 'Textos' }), ...copyInputs);
  }
  drawEditor();

  const warnBox = h('div');
  const save = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    try {
      const r = await put(`/sites/${id}/theme`, { theme });
      theme = r.site.theme; drawEditor();
      clear(warnBox).append(r.warnings.length ? h('div', { class: 'alert warn', text: r.warnings.join(' ') }) : null);
      toast('Aparência salva.', 'ok'); refreshPreview();
    } catch (e) { toast(e.message, 'err'); }
  } }, 'Salvar aparência');

  const hint = h('input', { id: 'ai-hint', maxlength: 300, placeholder: 'Opcional: "rústico com madeira", "minimalista e claro", "anos 80 neon"…' });
  const aiBtn = h('button', { type: 'button', class: 'btn primary', disabled: opts.ai_available ? null : true });
  aiBtn.textContent = '✨ Gerar com IA';
  const undoBtn = h('button', { type: 'button', class: 'btn ghost', hidden: true, onclick: async () => {
    if (!undo) return;
    try { await put(`/sites/${id}/theme`, { theme: undo }); theme = undo; undo = null; undoBtn.hidden = true; modelUndo.hidden = true; drawEditor(); toast('Tema anterior restaurado.', 'ok'); refreshPreview(); } catch (e) { toast(e.message, 'err'); }
  } }, 'Desfazer');
  aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    aiBtn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Criando tema… (até 1 min)');
    try {
      const r = await post(`/sites/${id}/theme/generate`, { hint: hint.value.trim() });
      undo = r.previous_theme; undoBtn.hidden = false;
      theme = r.site.theme; drawEditor();
      clear(warnBox).append(r.warnings.length ? h('div', { class: 'alert warn', text: r.warnings.join(' ') }) : null);
      toast('Tema criado com IA e salvo.', 'ok'); refreshPreview();
    } catch (e) { toast(e.message, 'err'); } finally { aiBtn.disabled = false; aiBtn.textContent = '✨ Gerar com IA'; }
  });

  root.append(
    h('div', { class: 'card' }, h('h2', { text: 'Criar com IA' }),
      opts.ai_available
        ? h('p', { class: 'muted small', text: 'O Claude escolhe cores, fontes e escreve os textos com base na descrição e nos serviços do negócio. O tema é salvo na hora; use "Desfazer" se não gostar.' })
        : h('div', { class: 'alert info' }, 'Para gerar com IA, um administrador precisa cadastrar a chave da Anthropic em ', h('a', { href: '#/configuracoes' }, 'Configurações'), '. Enquanto isso, use os modelos prontos abaixo.'),
      h('div', { class: 'field' }, h('label', { for: 'ai-hint', text: 'Orientação de estilo' }), hint),
      h('div', { class: 'form-actions' }, aiBtn, undoBtn)),
    catalog.models.length ? h('div', { class: 'card' }, h('h2', { text: 'Modelos da Versal' }),
      h('p', { class: 'muted small', text: 'Sites completos por nicho: cores, fontes, layout, textos e capa ilustrada. Abra a prévia para ver o modelo funcionando; ao aplicar, você pode desfazer.' }),
      h('div', { class: 'model-pick' }, h('div', { class: 'field' }, h('label', { for: 'model-niche', text: 'Nicho' }), nicheSelect),
        h('a', { class: 'btn ghost', href: '/modelos', target: '_blank', rel: 'noopener' }, 'Ver todos os modelos ↗'), modelUndo),
      modelGrid) : null,
    h('div', { class: 'card' }, h('h2', { text: 'Paletas rápidas' }), presets),
    h('div', { class: 'card' }, h('h2', { text: 'Ajuste fino' }), warnBox, editor, h('div', { class: 'form-actions', style: { marginTop: '14px' } }, save)),
    h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('h2', { text: 'Pré-visualização' }), h('button', { type: 'button', class: 'btn sm ghost', onclick: refreshPreview }, 'Atualizar')), frame),
  );
  refreshPreview();
}

function tabImagens(root, data, meta, reload) {
  const id = data.site.id;
  const s = data.site;
  const upload = (kind) => filePicker(async (f) => {
    try { await api('POST', `/sites/${id}/images?kind=${kind}`, f); toast('Imagem enviada.', 'ok'); } catch (e) { toast(e.message, 'err'); }
    reload();
  }, { multiple: kind === 'gallery' });
  const remove = async (imgId) => {
    if (!(await confirmDialog('Remover imagem', 'Remover esta imagem do site?', { danger: true, ok: 'Remover' }))) return;
    try { await del(`/sites/${id}/images/${imgId}`); toast('Imagem removida.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const single = (label, kind, imgId, hint) => h('div', { class: 'card' }, h('h2', { text: label }), h('p', { class: 'muted small', text: hint }),
    imgId ? h('div', { class: 'img-grid' }, h('figure', {}, h('img', { src: `/img/${imgId}`, alt: label }), h('figcaption', {}, h('span', { text: 'Atual' }), h('button', { class: 'link', type: 'button', onclick: () => remove(imgId) }, 'Remover')))) : null,
    h('div', { class: 'form-actions', style: { marginTop: '10px' } }, h('button', { class: 'btn', type: 'button', onclick: () => upload(kind) }, imgId ? 'Trocar imagem' : 'Enviar imagem')));
  const gallery = data.images.filter((i) => i.kind === 'gallery');
  root.append(
    h('div', { class: 'alert info', text: 'Formatos: PNG, JPG ou WebP, até 2 MB cada.' }),
    h('div', { class: 'grid g2' },
      single('Logo', 'logo', s.logo_image_id, 'Aparece no topo e como ícone da aba. Ideal: quadrado ou horizontal, fundo transparente.'),
      single('Imagem de capa', 'hero', s.hero_image_id, 'Usada no topo dos layouts "banner", "split", "split_left" e "stacked". Ideal: 1600×1000 px.')),
    h('div', { class: 'card' }, h('h2', { text: `Galeria (${gallery.length}/12)` }),
      gallery.length ? h('div', { class: 'img-grid' }, gallery.map((g) => h('figure', {}, h('img', { src: `/img/${g.id}`, alt: '', loading: 'lazy' }),
        h('figcaption', {}, h('span', { text: `${Math.round(g.size / 1024)} KB` }), h('button', { class: 'link', type: 'button', onclick: () => remove(g.id) }, 'Remover'))))) : emptyState('Galeria vazia', 'Fotos do espaço e de trabalhos feitos aumentam a confiança.'),
      h('div', { class: 'form-actions', style: { marginTop: '10px' } }, h('button', { class: 'btn', type: 'button', disabled: gallery.length >= 12 ? true : null, onclick: () => upload('gallery') }, 'Adicionar fotos'))),
  );
}

function tabAgendamento(root, data, meta, reload) {
  const s = data.site;
  const form = h('form', { class: 'form card', novalidate: true },
    h('h2', { text: 'Regras da agenda online' }),
    field({ label: 'Receber agendamentos pelo site', name: 'booking_enabled', type: 'checkbox', value: !!s.booking_enabled }),
    h('div', { class: 'row' },
      field({ label: 'Intervalo entre horários', name: 'slot_interval_min', type: 'select', value: s.slot_interval_min,
        options: [10, 15, 20, 30, 45, 60, 90, 120].map((m) => [m, `${m} min`]) }),
      field({ label: 'Antecedência mínima', name: 'min_notice_min', type: 'select', value: s.min_notice_min,
        options: [[0, 'Nenhuma'], [30, '30 min'], [60, '1 hora'], [120, '2 horas'], [180, '3 horas'], [360, '6 horas'], [720, '12 horas'], [1440, '1 dia'], [2880, '2 dias']] }),
      field({ label: 'Agenda aberta até (dias)', name: 'max_days_ahead', type: 'number', min: 1, max: 365, value: s.max_days_ahead })),
    h('h2', { text: 'Avisos por WhatsApp' }),
    h('p', { class: 'muted small', text: 'Usa a Evolution API configurada pelo administrador. O alerta no painel sempre acontece.' }),
    field({ label: 'Avisar o negócio a cada novo agendamento/cancelamento', name: 'notify_whatsapp', type: 'checkbox', value: !!s.notify_whatsapp, hint: s.whatsapp ? `Vai para ${fmt.phone(s.whatsapp)}` : 'Cadastre o WhatsApp do negócio na aba Dados.' }),
    field({ label: 'Enviar confirmação ao cliente (com link para cancelar)', name: 'notify_client_whatsapp', type: 'checkbox', value: !!s.notify_client_whatsapp }),
    field({ label: 'Instância Evolution deste site (opcional)', name: 'evolution_instance', value: s.evolution_instance || '', maxlength: 80, hint: 'Vazio = usa a instância padrão da agência.' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar regras')));
  onSubmit(form, async (v) => {
    v.slot_interval_min = Number(v.slot_interval_min); v.min_notice_min = Number(v.min_notice_min); v.max_days_ahead = Number(v.max_days_ahead);
    await patch(`/sites/${s.id}`, v);
    toast('Regras salvas.', 'ok'); reload();
  });
  root.append(form);
}
