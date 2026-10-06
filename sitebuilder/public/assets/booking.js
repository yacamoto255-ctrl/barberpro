// booking.js — widget de agendamento dos sites públicos (sem dependências)
(function () {
  'use strict';
  var root = document.getElementById('booking');
  if (!root) return;
  var slug = root.getAttribute('data-slug');
  var api = '/api/public/sites/' + encodeURIComponent(slug);
  var WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var state = { data: null, serviceId: null, professionalId: null, date: null, time: null, nextFrom: null, busy: false };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function brl(c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function dur(m) { return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); }
  function fmtDate(d) { var p = d.split('-'); var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); return WD[dt.getUTCDay()] + ', ' + p[2] + ' ' + MONTHS[+p[1] - 1]; }
  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Erro ' + r.status); return d; });
    });
  }
  function maskPhone(v) {
    var d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  var form, serviceSel, profWrap, profSel, daysBox, slotsBox, clientBox, msgBox, submitBtn, moreBtn;

  function service() { return state.data.services.find(function (s) { return s.id === state.serviceId; }); }

  function showMsg(text, isErr) {
    msgBox.textContent = '';
    if (!text) { msgBox.hidden = true; return; }
    msgBox.hidden = false;
    msgBox.className = 'msg' + (isErr ? ' err' : '');
    msgBox.textContent = text;
    msgBox.setAttribute('role', isErr ? 'alert' : 'status');
  }

  function profsForService() {
    return state.data.professionals.filter(function (p) {
      return !p.service_ids.length || p.service_ids.indexOf(state.serviceId) >= 0;
    });
  }

  function renderProfessionals() {
    if (!profSel) return;
    var list = profsForService();
    profSel.textContent = '';
    profSel.appendChild(el('option', { value: '', text: 'Sem preferência' }));
    list.forEach(function (p) { profSel.appendChild(el('option', { value: String(p.id), text: p.name + (p.title ? ' — ' + p.title : '') })); });
    if (state.professionalId && !list.some(function (p) { return p.id === state.professionalId; })) state.professionalId = null;
    profSel.value = state.professionalId ? String(state.professionalId) : '';
    profWrap.hidden = list.length === 0;
  }

  function qs(extra) {
    var q = 'service_id=' + state.serviceId + (state.professionalId ? '&professional_id=' + state.professionalId : '');
    return q + (extra || '');
  }

  function loadDays(append) {
    if (!append) { daysBox.textContent = ''; state.date = null; state.time = null; slotsBox.textContent = ''; updateSubmit(); }
    daysBox.setAttribute('aria-busy', 'true');
    return getJSON(api + '/days?' + qs(append && state.nextFrom ? '&from=' + state.nextFrom : '')).then(function (d) {
      d.days.forEach(function (day) {
        daysBox.appendChild(el('button', {
          type: 'button', class: 'slot', 'aria-pressed': 'false', disabled: day.available ? null : 'disabled',
          'data-date': day.date, title: day.available ? 'Ver horários' : 'Sem horários livres',
          on: { click: function () { pickDay(day.date); } },
        }, [fmtDate(day.date)]));
      });
      state.nextFrom = d.next_from;
      moreBtn.hidden = !d.has_more;
      if (!append) {
        var first = d.days.find(function (x) { return x.available; });
        if (first) pickDay(first.date);
        else slotsBox.appendChild(el('p', { class: 'muted', text: 'Sem horários livres nos próximos dias. Veja mais datas ou fale no WhatsApp.' }));
      }
    }).catch(function (e) { showMsg(e.message, true); }).then(function () { daysBox.removeAttribute('aria-busy'); });
  }

  function pickDay(date) {
    state.date = date; state.time = null; updateSubmit();
    Array.prototype.forEach.call(daysBox.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-date') === date ? 'true' : 'false'); });
    slotsBox.textContent = '';
    slotsBox.setAttribute('aria-busy', 'true');
    getJSON(api + '/availability?' + qs('&date=' + date)).then(function (d) {
      if (!d.slots.length) { slotsBox.appendChild(el('p', { class: 'muted', text: d.reason || 'Sem horários livres neste dia.' })); return; }
      d.slots.forEach(function (s) {
        slotsBox.appendChild(el('button', {
          type: 'button', class: 'slot', 'aria-pressed': 'false', 'data-time': s.time,
          on: { click: function () { pickTime(s.time); } },
        }, [s.time]));
      });
    }).catch(function (e) { showMsg(e.message, true); }).then(function () { slotsBox.removeAttribute('aria-busy'); });
  }

  function pickTime(time) {
    state.time = time;
    Array.prototype.forEach.call(slotsBox.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-time') === time ? 'true' : 'false'); });
    clientBox.hidden = false;
    updateSubmit();
  }

  function updateSubmit() {
    if (submitBtn) submitBtn.disabled = !(state.serviceId && state.date && state.time) || state.busy;
  }

  function success(d, cancelUrl) {
    var b = d.booking;
    var p = b.starts_at.split(' ');
    root.textContent = '';
    root.appendChild(el('div', { class: 'steps', role: 'status' }, [
      el('h3', { text: 'Agendamento confirmado! ✅' }),
      el('p', { text: b.service_name + (b.professional_name ? ' com ' + b.professional_name : '') + ' — ' + fmtDate(p[0]) + ' às ' + p[1] + (b.price_cents ? ' · ' + brl(b.price_cents) : '') }),
      el('p', { class: 'muted', text: 'Guarde este link caso precise cancelar. Se o negócio usar WhatsApp, você também recebe a confirmação por lá.' }),
      el('p', {}, [el('a', { href: cancelUrl, text: 'Link para cancelar' })]),
      el('button', { type: 'button', class: 'btn ghost', on: { click: function () { start(); } } }, ['Fazer outro agendamento']),
    ]));
  }

  function submit(ev) {
    ev.preventDefault();
    if (state.busy) return;
    var fd = new FormData(form);
    var body = {
      service_id: state.serviceId, professional_id: state.professionalId || undefined, date: state.date, time: state.time,
      client_name: (fd.get('client_name') || '').trim(), client_phone: fd.get('client_phone') || '',
      client_email: (fd.get('client_email') || '').trim() || undefined, notes: (fd.get('notes') || '').trim() || undefined,
      website: fd.get('website') || '',
    };
    if (body.client_name.length < 2) { showMsg('Informe seu nome.', true); return; }
    if (body.client_phone.replace(/\D/g, '').length < 10) { showMsg('Informe seu WhatsApp com DDD.', true); return; }
    state.busy = true; updateSubmit(); submitBtn.textContent = 'Agendando...'; showMsg('');
    fetch(api + '/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
      .then(function (res) {
        if (res.ok) return success(res.d, res.d.cancel_url);
        showMsg(res.d.error || 'Não foi possível agendar. Tente novamente.', true);
        if (res.status === 409) pickDay(state.date);
      })
      .catch(function () { showMsg('Sem conexão. Verifique a internet e tente de novo.', true); })
      .then(function () { state.busy = false; if (submitBtn) { submitBtn.textContent = 'Confirmar agendamento'; updateSubmit(); } });
  }

  function build() {
    var d = state.data;
    root.textContent = '';
    form = el('form', { class: 'steps', novalidate: 'novalidate', on: { submit: submit } });
    serviceSel = el('select', { id: 'bk-service', name: 'service_id', required: 'required' });
    d.services.forEach(function (s) {
      serviceSel.appendChild(el('option', { value: String(s.id), text: s.name + ' · ' + dur(s.duration_min) + (s.price_cents ? ' · ' + brl(s.price_cents) : '') }));
    });
    serviceSel.addEventListener('change', function () { state.serviceId = Number(serviceSel.value); renderProfessionals(); loadDays(false); });
    form.appendChild(el('div', { class: 'field' }, [el('label', { for: 'bk-service', text: '1. Serviço' }), serviceSel]));

    if (d.professionals.length) {
      profSel = el('select', { id: 'bk-prof', name: 'professional_id' });
      profSel.addEventListener('change', function () { state.professionalId = profSel.value ? Number(profSel.value) : null; loadDays(false); });
      profWrap = el('div', { class: 'field' }, [el('label', { for: 'bk-prof', text: '2. Profissional' }), profSel]);
      form.appendChild(profWrap);
    }
    daysBox = el('div', { class: 'slots days', role: 'group', 'aria-label': 'Datas disponíveis' });
    moreBtn = el('button', { type: 'button', class: 'btn ghost', hidden: 'hidden', on: { click: function () { loadDays(true); } } }, ['Ver mais datas']);
    form.appendChild(el('div', { class: 'field' }, [el('label', { text: (d.professionals.length ? '3' : '2') + '. Data' }), daysBox, moreBtn]));
    slotsBox = el('div', { class: 'slots', role: 'group', 'aria-label': 'Horários disponíveis', 'aria-live': 'polite' });
    form.appendChild(el('div', { class: 'field' }, [el('label', { text: (d.professionals.length ? '4' : '3') + '. Horário' }), slotsBox]));

    var phone = el('input', { id: 'bk-phone', name: 'client_phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', required: 'required', placeholder: '(11) 98765-4321', maxlength: '16' });
    phone.addEventListener('input', function () { phone.value = maskPhone(phone.value); });
    clientBox = el('div', { class: 'steps', hidden: 'hidden' }, [
      el('div', { class: 'row2' }, [
        el('div', { class: 'field' }, [el('label', { for: 'bk-name', text: 'Seu nome' }), el('input', { id: 'bk-name', name: 'client_name', autocomplete: 'name', required: 'required', maxlength: '120' })]),
        el('div', { class: 'field' }, [el('label', { for: 'bk-phone', text: 'WhatsApp' }), phone]),
      ]),
      el('div', { class: 'field' }, [el('label', { for: 'bk-email', text: 'E-mail (opcional)' }), el('input', { id: 'bk-email', name: 'client_email', type: 'email', autocomplete: 'email', maxlength: '254' })]),
      el('div', { class: 'field' }, [el('label', { for: 'bk-notes', text: 'Observações (opcional)' }), el('textarea', { id: 'bk-notes', name: 'notes', maxlength: '500' })]),
      el('div', { class: 'hp', 'aria-hidden': 'true' }, [el('label', { for: 'bk-website', text: 'Não preencha' }), el('input', { id: 'bk-website', name: 'website', tabindex: '-1', autocomplete: 'off' })]),
    ]);
    form.appendChild(clientBox);
    msgBox = el('p', { class: 'msg', hidden: 'hidden' });
    form.appendChild(msgBox);
    submitBtn = el('button', { type: 'submit', class: 'btn', disabled: 'disabled' }, ['Confirmar agendamento']);
    form.appendChild(submitBtn);
    root.appendChild(form);

    state.serviceId = Number(serviceSel.value);
    renderProfessionals();
    loadDays(false);
  }

  function start() {
    state = { data: state.data, serviceId: null, professionalId: null, date: null, time: null, nextFrom: null, busy: false };
    if (state.data) return build();
    root.textContent = 'Carregando agenda...';
    getJSON(api).then(function (d) {
      state.data = d;
      if (!d.services.length) { root.textContent = 'Nenhum serviço disponível para agendamento no momento.'; return; }
      build();
    }).catch(function (e) { root.textContent = 'Não foi possível carregar a agenda: ' + e.message; });
  }

  start();
})();
