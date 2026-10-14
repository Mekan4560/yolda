/* Yoʻlda — рабочая версия (PWA). Без сборки: обычный JS + Supabase. */
(function () {
  'use strict';

  var cfg = window.YOLDA_CONFIG || {};
  var view = document.getElementById('view');
  var tabs = document.getElementById('tabs');
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1;
  var sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  var me = null; // { id, email, name, phone, role, is_admin, blocked }

  // Удобства хранятся в базе узбекскими ключами, на экране — перевод
  var OPTIONS = [
    { key: 'Konditsioner', t: 'opt_ac' },
    { key: 'Chekilmaydi', t: 'opt_nosmoke' },
    { key: 'Yuk uchun joy', t: 'opt_luggage' },
    { key: 'Faqat ayollar uchun', t: 'opt_women' }
  ];

  // ---------- язык ----------
  var lang = (function () {
    try { var s = localStorage.getItem('yolda-lang'); if (s === 'uz' || s === 'ru') return s; } catch (e) {}
    return (navigator.language || '').toLowerCase().indexOf('ru') === 0 ? 'ru' : 'uz';
  })();
  function setLang(l) {
    lang = l; try { localStorage.setItem('yolda-lang', l); } catch (e) {}
    document.documentElement.lang = l;
    route();
  }
  function t(key, vars) {
    var s = (window.I18N[lang] && window.I18N[lang][key]);
    if (s == null) s = window.I18N.uz[key];
    if (s == null) return key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }
  function optLabel(k) {
    var o = OPTIONS.filter(function (x) { return x.key === k; })[0];
    return o ? t(o.t) : k;
  }
  function langSwitch() {
    return '<div class="langs" role="group" aria-label="' + esc(t('language')) + '">' +
      '<button type="button" data-lang="uz" class="' + (lang === 'uz' ? 'on' : '') + '">Oʻzbekcha</button>' +
      '<button type="button" data-lang="ru" class="' + (lang === 'ru' ? 'on' : '') + '">Русский</button></div>';
  }
  function bindLang() {
    $all('[data-lang]').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); }); });
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel) { return view.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(view.querySelectorAll(sel)); }
  function initials(name) { return esc(String(name || '?').trim().slice(0, 2) || '?'); }
  function money(n) { return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ' + t('som'); }
  function hm(d) { d = new Date(d); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function dayLabel(d) { d = new Date(d); return d.getDate() + ' ' + t('months')[d.getMonth()]; }
  function isoDate(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function tomorrow() { var d = new Date(); d.setDate(d.getDate() + 1); return isoDate(d); }
  function place(region, district) { return esc(district) + '<span class="muted small">, ' + esc(region) + '</span>'; }
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 2600);
  }
  function loading() { view.innerHTML = '<div class="spinner" aria-label="' + esc(t('loading')) + '"></div>'; }
  function errorBox(e) { return '<div class="err">' + esc((e && (e.message || e.error_description)) || t('error')) + '</div>'; }
  function back(href) {
    return '<a class="icon-btn" href="' + href + '" aria-label="' + esc(t('back')) + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></a>';
  }
  function regionOptions(sel) {
    return Object.keys(window.REGIONS).map(function (r) {
      return '<option' + (r === sel ? ' selected' : '') + '>' + esc(r) + '</option>';
    }).join('');
  }
  function districtOptions(region, sel, withAll) {
    var list = (window.REGIONS[region] || []).map(function (d) { return { v: d, l: d }; });
    if (withAll) list.unshift({ v: '*', l: t('all') });
    return list.map(function (d) {
      return '<option value="' + esc(d.v) + '"' + (d.v === sel ? ' selected' : '') + '>' + esc(d.l) + '</option>';
    }).join('');
  }
  function bindRegion(regionId, districtId, withAll) {
    var r = document.getElementById(regionId), d = document.getElementById(districtId);
    r.addEventListener('change', function () { d.innerHTML = districtOptions(r.value, null, withAll); });
  }
  function params(q) {
    var o = {};
    (q || '').split('&').forEach(function (kv) {
      if (!kv) return; var p = kv.split('=');
      o[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
    });
    return o;
  }
  function qs(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function logo(fill, road, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 140 140" aria-hidden="true"><path d="M70 26c-18 0-32 14-32 32 0 24 32 56 32 56s32-32 32-56c0-18-14-32-32-32z" fill="' + fill + '"/><path d="M60 92 C 64 74, 76 64, 74 46" stroke="' + road + '" stroke-width="9" fill="none" stroke-linecap="round"/></svg>';
  }
  function isDriver() { return me && me.role === 'driver'; }
  function homeHash() { return isDriver() ? '#/requests' : '#/search'; }

  // ---------- нижнее меню (зависит от роли) ----------
  var ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    mine: '<path d="M5 17h14l-1.5-6.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5z"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    admin: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    requests: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>'
  };
  function setTab(name) {
    if (!me) { tabs.hidden = true; return; }
    var list = isDriver() ? ['requests', 'mine', 'add', 'profile'] : ['search', 'mine', 'profile'];
    if (me.is_admin) list.push('admin');
    tabs.hidden = false;
    tabs.innerHTML = '<div class="tabs-in" style="grid-template-columns:repeat(' + list.length + ',minmax(0,1fr))">' +
      list.map(function (k) {
        return '<a class="tab' + (k === name ? ' on' : '') + '" href="#/' + k + '"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[k] + '</svg>' + esc(t('tab_' + k)) + '</a>';
      }).join('') + '</div>';
  }

  // ---------- вход ----------
  async function loadMe() {
    var s = await sb.auth.getSession();
    var user = s.data.session && s.data.session.user;
    if (!user) { me = null; return; }
    var p = await sb.rpc('me');
    var row = (p.data && p.data[0]) || {};
    me = { id: user.id, email: user.email, name: row.name || '', phone: row.phone || '', role: row.role || 'passenger', is_admin: !!row.is_admin, blocked: !!row.blocked };
  }

  function renderLogin() {
    setTab(null);
    var mode = renderLogin.mode || 'in';
    var role = renderLogin.role || 'passenger';
    view.innerHTML = langSwitch() +
      '<div class="hero"><span class="brand">' + logo('#FFFFFF', '#0B6E79', 28) + 'yoʻlda</span>' +
      '<span class="big">' + esc(t('tagline')) + '</span></div>' +
      '<div class="seg" role="tablist"><button type="button" data-mode="in" class="' + (mode === 'in' ? 'on' : '') + '">' + esc(t('login')) + '</button>' +
      '<button type="button" data-mode="up" class="' + (mode === 'up' ? 'on' : '') + '">' + esc(t('signup')) + '</button></div>' +
      (mode === 'up'
        ? '<span class="section-label">' + esc(t('who_are_you')) + '</span><div class="roles">' +
          roleCard('passenger', role) + roleCard('driver', role) + '</div>'
        : '') +
      '<form class="card form" id="authForm">' +
      (mode === 'up'
        ? '<div class="f"><div class="grow"><label for="aName">' + esc(t('name')) + '</label><input id="aName" required autocomplete="name" placeholder="' + esc(t('name_ph')) + '"></div></div>' +
          '<div class="f"><div class="grow"><label for="aPhone">' + esc(t('phone')) + '</label><input id="aPhone" required type="tel" autocomplete="tel" placeholder="+998 90 123 45 67"></div></div>'
        : '') +
      '<div class="f"><div class="grow"><label for="aEmail">' + esc(t('email')) + '</label><input id="aEmail" required type="email" autocomplete="email" placeholder="siz@mail.uz"></div></div>' +
      '<div class="f"><div class="grow"><label for="aPass">' + esc(t('password')) + '</label><input id="aPass" required type="password" minlength="6" autocomplete="' + (mode === 'up' ? 'new-password' : 'current-password') + '" placeholder="' + esc(t('pass_ph')) + '"></div></div>' +
      '<div id="authMsg"></div>' +
      '<button class="btn" type="submit">' + esc(mode === 'up' ? t('signup') : t('login')) + '</button></form>' +
      '<p class="small muted">' + esc(t('test_note')) + '</p>';

    bindLang();
    $all('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { renderLogin.mode = b.getAttribute('data-mode'); renderLogin(); });
    });
    $all('[data-role]').forEach(function (b) {
      b.addEventListener('click', function () {
        renderLogin.role = b.getAttribute('data-role');
        $all('[data-role]').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      });
    });
    $('#authForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = this.querySelector('button[type=submit]'); btn.disabled = true;
      var msg = $('#authMsg'); msg.innerHTML = '';
      var email = $('#aEmail').value.trim(), pass = $('#aPass').value;
      try {
        if (mode === 'up') {
          var r = await sb.auth.signUp({ email: email, password: pass, options: {
            emailRedirectTo: location.origin + location.pathname,
            data: { name: $('#aName').value.trim(), phone: $('#aPhone').value.trim(), role: renderLogin.role || 'passenger' }
          } });
          if (r.error) throw r.error;
          if (!r.data.session) { msg.innerHTML = '<div class="info">' + esc(t('email_sent')) + '</div>'; btn.disabled = false; return; }
        } else {
          var r2 = await sb.auth.signInWithPassword({ email: email, password: pass });
          if (r2.error) throw r2.error;
        }
        await loadMe();
        renderLogin.mode = 'in';
        location.hash = homeHash();
      } catch (err) {
        msg.innerHTML = errorBox(err.message === 'Invalid login credentials' ? { message: t('bad_login') } : err);
        btn.disabled = false;
      }
    });
  }
  function roleCard(r, sel) {
    var icon = r === 'driver'
      ? '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 14v7M10 12H3.5M14 12h6.5"/>'
      : '<circle cx="12" cy="7" r="4"/><path d="M5 21c1.2-4 3.8-6 7-6s5.8 2 7 6"/>';
    return '<button type="button" class="role' + (r === sel ? ' on' : '') + '" data-role="' + r + '" aria-pressed="' + (r === sel) + '">' +
      '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icon + '</svg>' +
      '<span class="t">' + esc(t(r)) + '</span><span class="small muted">' + esc(t(r + '_desc')) + '</span></button>';
  }
  function blockedBanner() { return me && me.blocked ? '<div class="err">' + esc(t('blocked_note')) + '</div>' : ''; }

  // ---------- поиск ----------
  function renderSearch() {
    setTab('search');
    var last = renderSearch.last || { from: 'Toshkent shahri', fromD: '*', to: 'Samarqand', toD: '*', date: tomorrow() };
    view.innerHTML = blockedBanner() +
      '<div class="hero"><span class="brand">' + logo('#FFFFFF', '#0B6E79', 28) + 'yoʻlda</span>' +
      '<span class="big">' + esc(t('hello')) + (me.name ? ', ' + esc(me.name) : '') + '! ' + esc(t('where_go')) + '</span></div>' +
      '<form class="card form" id="sForm">' +
      '<div class="f"><span class="dot o"></span><div class="grow"><label for="sFrom">' + esc(t('from')) + '</label><select id="sFrom">' + regionOptions(last.from) + '</select>' +
      '<label for="sFromD" style="margin-top:8px">' + esc(t('district')) + '</label><select id="sFromD">' + districtOptions(last.from, last.fromD, true) + '</select></div></div>' +
      '<div class="f"><span class="dot f"></span><div class="grow"><label for="sTo">' + esc(t('to')) + '</label><select id="sTo">' + regionOptions(last.to) + '</select>' +
      '<label for="sToD" style="margin-top:8px">' + esc(t('district')) + '</label><select id="sToD">' + districtOptions(last.to, last.toD, true) + '</select></div></div>' +
      '<div class="f"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>' +
      '<div class="grow"><label for="sDate">' + esc(t('date')) + '</label><input id="sDate" type="date" min="' + isoDate() + '" value="' + esc(last.date) + '"></div></div>' +
      '<button class="btn" type="submit">' + esc(t('search_btn')) + '</button></form>' +
      '<button class="btn sec" type="button" id="toRequest">' + esc(t('req_new_btn')) + '</button>' +
      '<p class="small muted">' + esc(t('req_hint')) + '</p>';
    bindRegion('sFrom', 'sFromD', true);
    bindRegion('sTo', 'sToD', true);
    $('#sForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = { from: $('#sFrom').value, fromD: $('#sFromD').value, to: $('#sTo').value, toD: $('#sToD').value, date: $('#sDate').value || tomorrow() };
      renderSearch.last = q;
      location.hash = '#/results?' + qs(q);
    });
    $('#toRequest').addEventListener('click', function () {
      var q = { from: $('#sFrom').value, fromD: $('#sFromD').value, to: $('#sTo').value, toD: $('#sToD').value, date: $('#sDate').value || tomorrow() };
      renderSearch.last = q;
      location.hash = '#/request/new?' + qs(q);
    });
  }

  async function renderResults(q) {
    setTab('search');
    loading();
    var start = new Date(q.date + 'T00:00:00'), end = new Date(q.date + 'T23:59:59');
    var query = sb.from('trips').select('*, driver:profiles(name)')
      .eq('status', 'open').gt('seats_free', 0)
      .eq('from_region', q.from).eq('to_region', q.to)
      .gte('depart_at', start.toISOString()).lte('depart_at', end.toISOString())
      .order('depart_at');
    if (q.fromD && q.fromD !== '*') query = query.eq('from_district', q.fromD);
    if (q.toD && q.toD !== '*') query = query.eq('to_district', q.toD);
    var r = await query;
    var head = '<div class="row">' + back('#/search') + '<div class="grow"><h1>' + esc(q.from) + ' → ' + esc(q.to) + '</h1>' +
      '<span class="small muted">' + esc(dayLabel(start)) + ' · ' + esc(t('trips_count', { n: r.data ? r.data.length : 0 })) + '</span></div></div>';
    if (r.error) { view.innerHTML = head + errorBox(r.error); return; }
    var reqBtn = '<a class="btn' + (r.data.length ? ' sec' : '') + '" href="#/request/new?' + qs(q) + '">' + esc(t('req_new_btn')) + '</a>';
    if (!r.data.length) { view.innerHTML = head + '<div class="card empty">' + t('none_found') + '</div>' + reqBtn; return; }
    view.innerHTML = head + r.data.map(tripCard).join('') + reqBtn; return;
    view.innerHTML = head + r.data.map(tripCard).join('');
  }

  function tripCard(x) {
    var name = (x.driver && x.driver.name) || t('driver');
    return '<a class="trip" href="#/trip/' + x.id + '">' +
      '<div class="times"><span class="time num">' + hm(x.depart_at) + '</span><span class="line"></span><span class="small muted">' + esc(dayLabel(x.depart_at)) + '</span></div>' +
      '<div class="row between small"><span>' + place(x.from_region, x.from_district) + '</span><span style="text-align:right">' + place(x.to_region, x.to_district) + '</span></div>' +
      '<div class="row"><span class="ava">' + initials(name) + '</span>' +
      '<div class="grow"><span class="t">' + esc(name) + '</span><span class="small muted">' + esc(x.car || '') + '</span></div>' +
      '<span class="price num">' + money(x.price) + '</span></div>' +
      '<div class="row wrap" style="gap:8px"><span class="tag">' + esc(t('seats_free', { n: x.seats_free })) + '</span>' +
      (x.options || []).map(function (o) { return '<span class="tag">' + esc(optLabel(o)) + '</span>'; }).join('') + '</div></a>';
  }

  // ---------- поездка (пассажир) ----------
  async function renderTrip(id) {
    setTab(isDriver() ? 'search' : 'search');
    loading();
    var r = await sb.from('trips').select('*, driver:profiles(name)').eq('id', id).maybeSingle();
    if (r.error || !r.data) { view.innerHTML = '<div class="row">' + back('#/search') + '<h1>' + esc(t('trip_details')) + '</h1></div>' + errorBox(r.error || { message: t('not_found') }); return; }
    var x = r.data;
    if (x.driver_id === me.id) { location.hash = '#/driver/' + x.id; return; }
    var b = await sb.from('bookings').select('*').eq('trip_id', id).eq('passenger_id', me.id).maybeSingle();
    var booking = b.data;
    var name = (x.driver && x.driver.name) || t('driver');
    var driverPhone = '';
    if (booking && booking.status === 'accepted') {
      var c = await sb.rpc('trip_contacts', { p_trip: Number(id) });
      var d = (c.data || []).filter(function (y) { return y.user_id === x.driver_id; })[0];
      driverPhone = d ? d.phone : '';
    }

    var html = '<div class="row">' + back('javascript:history.back()') + '<h1>' + esc(t('trip_details')) + '</h1></div>' + blockedBanner() +
      '<div class="card pad">' +
      '<div class="stop"><span class="time num" style="font-size:16px">' + hm(x.depart_at) + '</span><div class="rail"><span class="dot"></span><span class="bar"></span></div>' +
      '<div><div class="t">' + esc(x.from_district) + '</div><div class="small muted">' + esc(x.from_region) + (x.meeting_point ? ' · ' + esc(x.meeting_point) : '') + '</div></div></div>' +
      '<div class="stop" style="min-height:0"><span class="small muted">' + esc(dayLabel(x.depart_at)) + '</span><div class="rail"><span class="dot" style="background:var(--accent)"></span></div>' +
      '<div><div class="t">' + esc(x.to_district) + '</div><div class="small muted">' + esc(x.to_region) + '</div></div></div></div>' +
      '<div class="card pad"><div class="row"><span class="ava">' + initials(name) + '</span><div class="grow"><span class="t">' + esc(name) + '</span>' +
      '<span class="small muted">' + esc(x.car || '') + '</span></div></div>' +
      (driverPhone ? '<div class="info">' + esc(t('driver_phone')) + ': <b class="num">' + esc(driverPhone) + '</b></div>' : '') +
      ((x.options || []).length ? '<div class="row wrap" style="gap:8px">' + x.options.map(function (o) { return '<span class="tag">' + esc(optLabel(o)) + '</span>'; }).join('') + '</div>' : '') +
      '</div>';

    if (booking && booking.status !== 'cancelled') {
      html += '<div class="card pad"><div class="row between"><span class="t">' + esc(t('your_request')) + '</span><span class="tag ' + booking.status + '">' + esc(t('st_' + booking.status)) + '</span></div>' +
        '<span class="small muted">' + esc(t('seats_n', { n: booking.seats })) + ' · ' + money(booking.seats * x.price) + '</span>' +
        (booking.status === 'pending' || booking.status === 'accepted' ? '<button class="btn sec sm" id="cancelBtn">' + esc(t('cancel')) + '</button>' : '') + '</div>';
    } else if (booking && booking.status === 'cancelled') {
      html += '<div class="card empty">' + esc(t('prev_cancelled')) + '</div>';
    } else if (x.seats_free > 0 && x.status === 'open' && !me.blocked) {
      var opts = '';
      for (var i = 1; i <= Math.min(x.seats_free, 4); i++) opts += '<option value="' + i + '">' + esc(t('seats_n', { n: i })) + '</option>';
      html += '<div class="card pad"><div class="row between"><label for="seatCount" class="t">' + esc(t('how_many')) + '</label><span class="small muted">' + esc(t('free_n', { n: x.seats_free })) + '</span></div>' +
        '<select id="seatCount" class="btn sec sm" style="font-weight:600">' + opts + '</select>' +
        '<div class="row between"><span class="muted">' + esc(t('total')) + '</span><span class="price num" id="total">' + money(x.price) + '</span></div>' +
        '<div id="bookMsg"></div><button class="btn" id="bookBtn">' + esc(t('book')) + '</button></div>';
    } else if (!me.blocked) {
      html += '<div class="card empty">' + esc(t('no_seats')) + '</div>';
    }
    view.innerHTML = html;

    var seatSel = $('#seatCount');
    if (seatSel) seatSel.addEventListener('change', function () { $('#total').textContent = money(seatSel.value * x.price); });
    var bookBtn = $('#bookBtn');
    if (bookBtn) bookBtn.addEventListener('click', async function () {
      bookBtn.disabled = true;
      var ins = await sb.from('bookings').insert({ trip_id: x.id, passenger_id: me.id, seats: Number(seatSel.value) });
      if (ins.error) { $('#bookMsg').innerHTML = errorBox(ins.error); bookBtn.disabled = false; return; }
      toast(t('request_sent'));
      renderTrip(id);
    });
    var cancelBtn = $('#cancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', async function () {
      cancelBtn.disabled = true;
      var up = await sb.from('bookings').update({ status: 'cancelled' }).eq('id', booking.id);
      if (up.error) { toast(up.error.message); cancelBtn.disabled = false; return; }
      toast(t('cancelled_t'));
      renderTrip(id);
    });
  }

  // ---------- новая поездка (водитель) ----------
  function renderAdd() {
    setTab('add');
    if (!isDriver()) {
      view.innerHTML = '<h1>' + esc(t('add_title')) + '</h1><div class="card empty">' + esc(t('driver_only')) + '</div>' +
        '<a class="btn sec" href="#/profile">' + esc(t('to_profile')) + '</a>';
      return;
    }
    if (me.blocked) { view.innerHTML = '<h1>' + esc(t('add_title')) + '</h1>' + blockedBanner(); return; }
    var chosen = {};
    view.innerHTML = '<h1>' + esc(t('add_title')) + '</h1>' +
      '<form class="card form" id="addForm">' +
      '<div class="f"><span class="dot o"></span><div class="grow"><label for="tFrom">' + esc(t('from')) + '</label><select id="tFrom">' + regionOptions('Toshkent shahri') + '</select>' +
      '<label for="tFromD" style="margin-top:8px">' + esc(t('district')) + '</label><select id="tFromD">' + districtOptions('Toshkent shahri') + '</select></div></div>' +
      '<div class="f"><span class="dot f"></span><div class="grow"><label for="tTo">' + esc(t('to')) + '</label><select id="tTo">' + regionOptions('Samarqand') + '</select>' +
      '<label for="tToD" style="margin-top:8px">' + esc(t('district')) + '</label><select id="tToD">' + districtOptions('Samarqand') + '</select></div></div>' +
      '<div class="f"><div class="grow two"><div><label for="tDate">' + esc(t('date')) + '</label><input id="tDate" type="date" required min="' + isoDate() + '" value="' + tomorrow() + '"></div>' +
      '<div><label for="tTime">' + esc(t('depart_time')) + '</label><input id="tTime" type="time" required value="07:00"></div></div></div>' +
      '<div class="f"><div class="grow"><label for="tMeet">' + esc(t('meet')) + '</label><input id="tMeet" placeholder="' + esc(t('meet_ph')) + '"></div></div>' +
      '<div class="f"><div class="grow"><label for="tCar">' + esc(t('car')) + '</label><input id="tCar" required placeholder="' + esc(t('car_ph')) + '"></div></div>' +
      '<div class="f"><div class="grow two"><div><label for="tSeats">' + esc(t('seats_lbl')) + '</label><select id="tSeats"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option><option>6</option></select></div>' +
      '<div><label for="tPrice">' + esc(t('price_lbl')) + '</label><input id="tPrice" type="number" inputmode="numeric" min="0" step="1000" required placeholder="' + esc(t('price_ph')) + '"></div></div></div>' +
      '<div class="f" style="flex-direction:column;align-items:stretch;gap:10px"><span class="lbl">' + esc(t('options')) + '</span><div class="chips">' +
      OPTIONS.map(function (o) { return '<button type="button" class="chip" data-opt="' + esc(o.key) + '">' + esc(t(o.t)) + '</button>'; }).join('') + '</div></div>' +
      '<div id="addMsg"></div><button class="btn" type="submit">' + esc(t('publish')) + '</button></form>';
    bindRegion('tFrom', 'tFromD');
    bindRegion('tTo', 'tToD');
    $all('[data-opt]').forEach(function (c) {
      c.addEventListener('click', function () { var o = c.getAttribute('data-opt'); chosen[o] = !chosen[o]; c.classList.toggle('on', chosen[o]); });
    });
    $('#addForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = this.querySelector('button[type=submit]'); btn.disabled = true;
      var depart = new Date($('#tDate').value + 'T' + $('#tTime').value + ':00');
      var msg = $('#addMsg'); msg.innerHTML = '';
      if (depart < new Date()) { msg.innerHTML = errorBox({ message: t('time_passed') }); btn.disabled = false; return; }
      if ($('#tFrom').value === $('#tTo').value && $('#tFromD').value === $('#tToD').value) { msg.innerHTML = errorBox({ message: t('same_place') }); btn.disabled = false; return; }
      var seats = Number($('#tSeats').value);
      var ins = await sb.from('trips').insert({
        driver_id: me.id,
        from_region: $('#tFrom').value, from_district: $('#tFromD').value,
        to_region: $('#tTo').value, to_district: $('#tToD').value,
        depart_at: depart.toISOString(),
        meeting_point: $('#tMeet').value.trim(), car: $('#tCar').value.trim(),
        seats_total: seats, seats_free: seats,
        price: Number($('#tPrice').value),
        options: OPTIONS.filter(function (o) { return chosen[o.key]; }).map(function (o) { return o.key; })
      }).select('id').single();
      if (ins.error) { msg.innerHTML = errorBox(ins.error); btn.disabled = false; return; }
      toast(t('published'));
      location.hash = '#/driver/' + ins.data.id;
    });
  }

  // ---------- моя поездка (водитель) ----------
  async function renderDriver(id) {
    setTab('mine');
    loading();
    var r = await sb.from('trips').select('*').eq('id', id).maybeSingle();
    if (r.error || !r.data || r.data.driver_id !== me.id) { view.innerHTML = '<div class="row">' + back('#/mine') + '<h1>' + esc(t('my_trip')) + '</h1></div>' + errorBox(r.error || { message: t('not_found') }); return; }
    var x = r.data;
    var b = await sb.from('bookings').select('*, passenger:profiles(name)').eq('trip_id', id).order('created_at');
    var list = b.data || [];
    var contacts = await sb.rpc('trip_contacts', { p_trip: Number(id) });
    var phoneOf = {};
    (contacts.data || []).forEach(function (y) { phoneOf[y.user_id] = y.phone; });
    var taken = x.seats_total - x.seats_free;
    var pending = list.filter(function (y) { return y.status === 'pending'; });
    var accepted = list.filter(function (y) { return y.status === 'accepted'; });

    view.innerHTML = '<div class="row">' + back('#/mine') + '<h1>' + esc(t('my_trip')) + '</h1></div>' +
      '<div class="hero" style="gap:12px"><div class="row between"><span class="small">' + esc(x.status === 'open' ? t('published_lbl') : t('cancelled_lbl')) + '</span>' +
      '<span class="small t">' + esc(dayLabel(x.depart_at)) + ' · ' + hm(x.depart_at) + '</span></div>' +
      '<span class="big">' + esc(x.from_district) + ' → ' + esc(x.to_district) + '</span>' +
      '<div class="row between"><span class="small">' + esc(t('booked_seats')) + '</span><span class="t num">' + taken + ' / ' + x.seats_total + '</span></div>' +
      '<div style="height:8px;border-radius:4px;background:rgba(255,255,255,.25);overflow:hidden"><div style="height:100%;width:' + Math.round(taken / x.seats_total * 100) + '%;background:#FFFFFF;border-radius:4px"></div></div></div>' +
      '<h2>' + esc(t('new_requests')) + '</h2>' +
      (pending.length ? pending.map(function (y) {
        var n = (y.passenger && y.passenger.name) || t('passenger');
        return '<div class="card pad"><div class="row"><span class="ava">' + initials(n) + '</span><div class="grow"><span class="t">' + esc(n) + '</span>' +
          '<span class="small muted">' + esc(t('seats_n', { n: y.seats })) + '</span></div></div>' +
          '<div class="two"><button class="btn sec sm" data-act="rejected" data-id="' + y.id + '">' + esc(t('reject')) + '</button>' +
          '<button class="btn sm" data-act="accepted" data-id="' + y.id + '">' + esc(t('accept')) + '</button></div></div>';
      }).join('') : '<div class="card empty">' + esc(t('no_requests')) + '</div>') +
      '<h2>' + esc(t('passengers')) + '</h2>' +
      (accepted.length ? '<div class="card">' + accepted.map(function (y) {
        var n = (y.passenger && y.passenger.name) || t('passenger');
        return '<div class="row" style="padding:14px 16px"><span class="ava">' + initials(n) + '</span><div class="grow"><span class="t">' + esc(n) + '</span>' +
          '<span class="small muted num">' + esc(t('seats_n', { n: y.seats })) + ' · ' + esc(phoneOf[y.passenger_id] || '') + '</span></div></div>';
      }).join('') + '</div>' : '<div class="card empty">' + esc(t('no_passengers')) + '</div>') +
      (x.status === 'open' ? '<button class="btn sec" id="cancelTrip">' + esc(t('cancel_trip')) + '</button>' : '');

    $all('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        $all('[data-act]').forEach(function (z) { z.disabled = true; });
        var act = btn.getAttribute('data-act');
        var up = await sb.from('bookings').update({ status: act }).eq('id', btn.getAttribute('data-id'));
        if (up.error) toast(up.error.message.indexOf('мест') > -1 ? t('not_enough') : up.error.message);
        else toast(act === 'accepted' ? t('accepted_t') : t('rejected_t'));
        renderDriver(id);
      });
    });
    var ct = $('#cancelTrip');
    if (ct) ct.addEventListener('click', async function () {
      if (ct.getAttribute('data-sure') !== '1') { ct.setAttribute('data-sure', '1'); ct.textContent = t('confirm_cancel'); return; }
      ct.disabled = true;
      var up = await sb.from('trips').update({ status: 'cancelled' }).eq('id', id);
      if (up.error) { toast(up.error.message); ct.disabled = false; return; }
      toast(t('trip_cancelled'));
      renderDriver(id);
    });
  }

  // ---------- мои поездки ----------
  async function renderMine() {
    setTab('mine');
    loading();
    var res = await Promise.all([
      sb.from('bookings').select('*, trip:trips(*, driver:profiles(name))').eq('passenger_id', me.id).order('created_at', { ascending: false }),
      sb.from('trips').select('*, bookings(status)').eq('driver_id', me.id).order('depart_at', { ascending: false }),
      sb.from('ride_requests').select('*, offers(status)').eq('passenger_id', me.id).order('created_at', { ascending: false }),
      sb.from('offers').select('*, request:ride_requests(*)').eq('driver_id', me.id).order('created_at', { ascending: false })
    ]);
    var bookings = res[0].data || [], trips = res[1].data || [], reqs = res[2].data || [], myOffers = res[3].data || [];
    var html = '<h1>' + esc(t('mine')) + '</h1>' + blockedBanner();
    if (res[0].error || res[1].error) html += errorBox(res[0].error || res[1].error);

    var driverPart = '<span class="section-label">' + esc(t('as_driver')) + '</span>' +
      (trips.length ? trips.map(function (x) {
        var waiting = (x.bookings || []).filter(function (y) { return y.status === 'pending'; }).length;
        return '<a class="trip" href="#/driver/' + x.id + '"><div class="row between"><span class="t">' + esc(dayLabel(x.depart_at)) + ' · ' + hm(x.depart_at) + '</span>' +
          (x.status !== 'open' ? '<span class="tag cancelled">' + esc(t('cancelled_lbl')) + '</span>'
            : waiting ? '<span class="tag pending">' + esc(t('requests_n', { n: waiting })) + '</span>'
            : '<span class="tag">' + esc(t('booked_x', { a: x.seats_total - x.seats_free, b: x.seats_total })) + '</span>') + '</div>' +
          '<div class="t">' + esc(x.from_district) + ' → ' + esc(x.to_district) + '</div>' +
          '<span class="small muted">' + money(x.price) + ' ' + esc(t('per_seat')) + '</span></a>';
      }).join('') : '<div class="card empty">' + esc(t('no_trips')) + '</div>' + (isDriver() && !me.blocked ? '<a class="btn" href="#/add">' + esc(t('add_title')) + '</a>' : ''));

    var passengerPart = '<span class="section-label">' + esc(t('as_passenger')) + '</span>' +
      (bookings.length ? bookings.map(function (b) {
        var x = b.trip; if (!x) return '';
        return '<a class="trip" href="#/trip/' + x.id + '"><div class="row between"><span class="t">' + esc(dayLabel(x.depart_at)) + ' · ' + hm(x.depart_at) + '</span>' +
          '<span class="tag ' + b.status + '">' + esc(t('st_' + b.status)) + '</span></div>' +
          '<div class="t">' + esc(x.from_district) + ' → ' + esc(x.to_district) + '</div>' +
          '<span class="small muted">' + esc((x.driver && x.driver.name) || '') + ' · ' + esc(t('seats_n', { n: b.seats })) + '</span></a>';
      }).join('') : '<div class="card empty">' + esc(t('no_bookings')) + '</div>');

    var reqPart = '<span class="section-label">' + esc(t('my_requests')) + '</span>' +
      (reqs.length ? reqs.map(function (r) {
        var cnt = (r.offers || []).filter(function (o) { return o.status !== 'withdrawn'; }).length;
        var tag = r.status === 'open'
          ? '<span class="tag' + (cnt ? ' pending' : '') + '">' + esc(t('offers_n', { n: cnt })) + '</span>'
          : '<span class="tag' + (r.status === 'cancelled' ? ' cancelled' : '') + '">' + esc(t('rq_' + r.status)) + '</span>';
        return requestCard(r, tag);
      }).join('') : '<div class="card empty">' + esc(t('no_requests_my')) + '</div>' + (!me.blocked ? '<a class="btn sec" href="#/request/new">' + esc(t('req_new_btn')) + '</a>' : ''));

    var offerPart = '<span class="section-label">' + esc(t('my_offers')) + '</span>' +
      (myOffers.length ? myOffers.map(function (o) {
        if (!o.request) return '';
        var cls = o.status === 'accepted' ? '' : o.status === 'pending' ? ' pending' : ' cancelled';
        return requestCard(o.request, '<span class="tag' + cls + '">' + esc(t('of_' + o.status)) + '</span>');
      }).join('') : '<div class="card empty">' + esc(t('no_offers_my')) + '</div>');

    // Порядок блоков зависит от роли; второстепенные блоки показываем, только если в них что-то есть
    if (isDriver()) html += offerPart + driverPart + (bookings.length ? passengerPart : '') + (reqs.length ? reqPart : '');
    else html += reqPart + passengerPart + (trips.length ? driverPart : '') + (myOffers.length ? offerPart : '');
    view.innerHTML = html;
  }

  // ---------- профиль ----------
  function renderProfile() {
    setTab('profile');
    view.innerHTML = '<h1>' + esc(t('profile')) + '</h1>' + blockedBanner() +
      '<span class="section-label">' + esc(t('language')) + '</span>' + langSwitch() +
      '<span class="section-label">' + esc(t('role')) + '</span><div class="roles">' + roleCard('passenger', me.role) + roleCard('driver', me.role) + '</div>' +
      '<form class="card form" id="pForm">' +
      '<div class="f"><div class="grow"><label for="pName">' + esc(t('name')) + '</label><input id="pName" required value="' + esc(me.name) + '"></div></div>' +
      '<div class="f"><div class="grow"><label for="pPhone">' + esc(t('phone')) + '</label><input id="pPhone" type="tel" required value="' + esc(me.phone) + '"></div></div>' +
      '<div class="f"><div class="grow"><span class="lbl">' + esc(t('email')) + '</span><span class="t">' + esc(me.email) + '</span></div></div>' +
      '<button class="btn" type="submit">' + esc(t('save')) + '</button></form>' +
      '<p class="small muted">' + esc(t('phone_note')) + '</p>' +
      '<button class="btn sec" id="logout">' + esc(t('logout')) + '</button>';
    bindLang();
    $all('[data-role]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var role = b.getAttribute('data-role');
        if (role === me.role) return;
        var up = await sb.from('profiles').update({ role: role }).eq('id', me.id);
        if (up.error) { toast(up.error.message); return; }
        me.role = role; toast(t('role_changed')); renderProfile();
      });
    });
    $('#pForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = $('#pName').value.trim(), phone = $('#pPhone').value.trim();
      var up = await sb.from('profiles').update({ name: name, phone: phone }).eq('id', me.id);
      if (up.error) { toast(up.error.message); return; }
      me.name = name; me.phone = phone; toast(t('saved'));
    });
    $('#logout').addEventListener('click', async function () {
      renderLogin.mode = 'in';
      await sb.auth.signOut(); me = null; location.hash = '#/login';
    });
  }

  // ---------- заявки пассажиров ----------
  function dateLabel(isoD) { return dayLabel(new Date(isoD + 'T12:00:00')); }
  function requestCard(r, extra) {
    return '<a class="trip" href="#/request/' + r.id + '">' +
      '<div class="row between"><span class="t">' + esc(dateLabel(r.ride_date)) + ' · ' + esc(t('tp_' + r.time_pref)) + '</span>' + (extra || '') + '</div>' +
      '<div class="row between small"><span>' + place(r.from_region, r.from_district) + '</span><span style="text-align:right">' + place(r.to_region, r.to_district) + '</span></div>' +
      '<div class="row wrap" style="gap:8px"><span class="tag">' + esc(t('people_n', { n: r.seats })) + '</span>' +
      (r.budget ? '<span class="price num" style="font-size:13px;padding:4px 8px">' + money(r.budget) + '</span>' : '') + '</div>' +
      (r.comment ? '<span class="small muted">' + esc(r.comment) + '</span>' : '') + '</a>';
  }

  function renderRequestNew(q) {
    setTab(isDriver() ? 'requests' : 'search');
    if (me.blocked) { view.innerHTML = '<h1>' + esc(t('req_new_title')) + '</h1>' + blockedBanner(); return; }
    var from = q.from || 'Toshkent shahri', to = q.to || 'Samarqand';
    view.innerHTML = '<div class="row">' + back('#/search') + '<h1>' + esc(t('req_new_title')) + '</h1></div>' +
      '<div class="info">' + esc(t('req_hint')) + '</div>' +
      '<form class="card form" id="rForm">' +
      '<div class="f"><span class="dot o"></span><div class="grow"><label for="rFrom">' + esc(t('from')) + '</label><select id="rFrom">' + regionOptions(from) + '</select>' +
      '<label for="rFromD" style="margin-top:8px">' + esc(t('district')) + '</label><select id="rFromD">' + districtOptions(from, q.fromD) + '</select></div></div>' +
      '<div class="f"><span class="dot f"></span><div class="grow"><label for="rTo">' + esc(t('to')) + '</label><select id="rTo">' + regionOptions(to) + '</select>' +
      '<label for="rToD" style="margin-top:8px">' + esc(t('district')) + '</label><select id="rToD">' + districtOptions(to, q.toD) + '</select></div></div>' +
      '<div class="f"><div class="grow two"><div><label for="rDate">' + esc(t('date')) + '</label><input id="rDate" type="date" required min="' + isoDate() + '" value="' + esc(q.date || tomorrow()) + '"></div>' +
      '<div><label for="rTime">' + esc(t('time_pref')) + '</label><select id="rTime">' +
      ['any', 'morning', 'day', 'evening'].map(function (k) { return '<option value="' + k + '">' + esc(t('tp_' + k)) + '</option>'; }).join('') + '</select></div></div></div>' +
      '<div class="f"><div class="grow two"><div><label for="rSeats">' + esc(t('seats_need')) + '</label><select id="rSeats"><option>1</option><option>2</option><option>3</option><option>4</option></select></div>' +
      '<div><label for="rBudget">' + esc(t('budget')) + '</label><input id="rBudget" type="number" inputmode="numeric" min="0" step="1000" placeholder="' + esc(t('budget_ph')) + '"></div></div></div>' +
      '<div class="f"><div class="grow"><label for="rComment">' + esc(t('comment')) + '</label><input id="rComment" maxlength="300" placeholder="' + esc(t('comment_ph')) + '"></div></div>' +
      '<div id="rMsg"></div><button class="btn" type="submit">' + esc(t('req_publish')) + '</button></form>';
    bindRegion('rFrom', 'rFromD');
    bindRegion('rTo', 'rToD');
    $('#rForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = this.querySelector('button[type=submit]'); btn.disabled = true;
      var msg = $('#rMsg'); msg.innerHTML = '';
      if ($('#rFrom').value === $('#rTo').value && $('#rFromD').value === $('#rToD').value) { msg.innerHTML = errorBox({ message: t('same_place') }); btn.disabled = false; return; }
      var budget = $('#rBudget').value ? Number($('#rBudget').value) : null;
      var ins = await sb.from('ride_requests').insert({
        passenger_id: me.id,
        from_region: $('#rFrom').value, from_district: $('#rFromD').value,
        to_region: $('#rTo').value, to_district: $('#rToD').value,
        ride_date: $('#rDate').value, time_pref: $('#rTime').value,
        seats: Number($('#rSeats').value), budget: budget, comment: $('#rComment').value.trim()
      }).select('id').single();
      if (ins.error) { msg.innerHTML = errorBox(ins.error); btn.disabled = false; return; }
      toast(t('req_published'));
      location.hash = '#/request/' + ins.data.id;
    });
  }

  async function renderRequest(id) {
    loading();
    var r = await sb.from('ride_requests').select('*, passenger:profiles(name)').eq('id', id).maybeSingle();
    if (r.error || !r.data) { setTab('mine'); view.innerHTML = '<div class="row">' + back('#/mine') + '<h1>' + esc(t('request')) + '</h1></div>' + errorBox(r.error || { message: t('not_found') }); return; }
    var req = r.data;
    var mineReq = req.passenger_id === me.id;
    setTab(mineReq ? 'mine' : 'requests');
    var statusTag = '<span class="tag' + (req.status === 'cancelled' ? ' cancelled' : '') + '">' + esc(t('rq_' + req.status)) + '</span>';
    var head = '<div class="row">' + back(mineReq ? '#/mine' : '#/requests') + '<h1>' + esc(t('request')) + '</h1></div>' + blockedBanner() +
      '<div class="card pad">' +
      '<div class="row between"><span class="t">' + esc(dateLabel(req.ride_date)) + ' · ' + esc(t('tp_' + req.time_pref)) + '</span>' + statusTag + '</div>' +
      '<div class="stop"><span class="small muted">' + esc(t('from')) + '</span><div class="rail"><span class="dot"></span><span class="bar"></span></div>' +
      '<div><div class="t">' + esc(req.from_district) + '</div><div class="small muted">' + esc(req.from_region) + '</div></div></div>' +
      '<div class="stop" style="min-height:0"><span class="small muted">' + esc(t('to')) + '</span><div class="rail"><span class="dot" style="background:var(--accent)"></span></div>' +
      '<div><div class="t">' + esc(req.to_district) + '</div><div class="small muted">' + esc(req.to_region) + '</div></div></div>' +
      '<div class="row wrap" style="gap:8px"><span class="tag">' + esc(t('people_n', { n: req.seats })) + '</span>' +
      (req.budget ? '<span class="price num" style="font-size:13px;padding:4px 8px">' + esc(t('budget_lbl')) + ': ' + money(req.budget) + '</span>' : '') + '</div>' +
      (req.comment ? '<p class="small muted">' + esc(req.comment) + '</p>' : '') +
      (!mineReq ? '<span class="small muted">' + esc(t('passenger')) + ': ' + esc((req.passenger && req.passenger.name) || '') + '</span>' : '') +
      '</div>';

    if (mineReq) return renderRequestPassenger(req, head);
    return renderRequestDriver(req, head);
  }

  async function renderRequestPassenger(req, head) {
    var o = await sb.from('offers').select('*, driver:profiles(name)').eq('request_id', req.id).order('price');
    var offers = (o.data || []).filter(function (x) { return x.status !== 'withdrawn'; });
    var phone = '';
    if (req.status === 'closed') {
      var c = await sb.rpc('request_contacts', { p_request: Number(req.id) });
      phone = (c.data && c.data[0] && c.data[0].phone) || '';
    }
    var html = head + '<h2>' + esc(t('offers')) + '</h2>';
    if (!offers.length) html += '<div class="card empty">' + esc(req.status === 'open' ? t('no_offers') : t('req_closed_note')) + '</div>';
    html += offers.map(function (x) {
      var n = (x.driver && x.driver.name) || t('driver');
      var chosen = x.status === 'accepted';
      return '<div class="card pad' + (chosen ? ' chosen' : '') + '"><div class="row"><span class="ava">' + initials(n) + '</span>' +
        '<div class="grow"><span class="t">' + esc(n) + '</span><span class="small muted">' + esc(x.car) + ' · ' + esc(x.depart_time) + '</span></div>' +
        '<span class="price num">' + money(x.price) + '</span></div>' +
        (x.comment ? '<span class="small muted">' + esc(x.comment) + '</span>' : '') +
        (chosen ? '<span class="tag" style="align-self:flex-start">' + esc(t('rq_closed')) + '</span>' + (phone ? '<div class="info">' + esc(t('driver_phone')) + ': <b class="num">' + esc(phone) + '</b></div>' : '') : '') +
        (req.status === 'open' && x.status === 'pending' && !me.blocked ? '<button class="btn sm" data-choose="' + x.id + '">' + esc(t('choose')) + '</button>' : '') +
        '</div>';
    }).join('');
    if (req.status === 'open') html += '<button class="btn sec" id="cancelReq">' + esc(t('cancel_req')) + '</button>';
    view.innerHTML = html;

    $all('[data-choose]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = t('choose_confirm'); return; }
        $all('[data-choose]').forEach(function (z) { z.disabled = true; });
        var res = await sb.rpc('choose_offer', { p_offer: Number(b.getAttribute('data-choose')) });
        if (res.error) { toast(res.error.message); renderRequest(req.id); return; }
        toast(t('chosen_toast')); renderRequest(req.id);
      });
    });
    var cr = $('#cancelReq');
    if (cr) cr.addEventListener('click', async function () {
      if (cr.getAttribute('data-sure') !== '1') { cr.setAttribute('data-sure', '1'); cr.textContent = t('confirm_q'); return; }
      cr.disabled = true;
      var up = await sb.from('ride_requests').update({ status: 'cancelled' }).eq('id', req.id);
      if (up.error) { toast(up.error.message); cr.disabled = false; return; }
      toast(t('cancelled_t')); renderRequest(req.id);
    });
  }

  async function renderRequestDriver(req, head) {
    var o = await sb.from('offers').select('*').eq('request_id', req.id).eq('driver_id', me.id).maybeSingle();
    var my = o.data;
    var html = head;
    if (my) {
      var phone = '';
      if (my.status === 'accepted') {
        var c = await sb.rpc('request_contacts', { p_request: Number(req.id) });
        phone = (c.data && c.data[0] && c.data[0].phone) || '';
      }
      var cls = my.status === 'accepted' ? '' : my.status === 'pending' ? ' pending' : ' cancelled';
      html += '<div class="card pad"><div class="row between"><span class="t">' + esc(t('your_offer')) + '</span><span class="tag' + cls + '">' + esc(t('of_' + my.status)) + '</span></div>' +
        '<span class="small muted">' + esc(my.depart_time) + ' · ' + esc(my.car) + ' · ' + money(my.price) + '</span>' +
        (phone ? '<div class="info">' + esc(t('passenger_phone')) + ': <b class="num">' + esc(phone) + '</b></div>' : '') +
        (my.status === 'pending' ? '<button class="btn sec sm" id="withdraw">' + esc(t('withdraw')) + '</button>' : '') + '</div>';
    } else if (req.status !== 'open') {
      html += '<div class="card empty">' + esc(t('req_closed_note')) + '</div>';
    } else if (!isDriver()) {
      html += '<div class="card empty">' + esc(t('driver_needed')) + '</div><a class="btn sec" href="#/profile">' + esc(t('to_profile')) + '</a>';
    } else if (!me.blocked) {
      var defTime = { morning: '07:00', day: '12:00', evening: '18:00', any: '09:00' }[req.time_pref];
      html += '<form class="card form" id="oForm">' +
        '<div class="f"><div class="grow two"><div><label for="oPrice">' + esc(t('offer_price')) + '</label><input id="oPrice" type="number" inputmode="numeric" min="0" step="1000" required value="' + esc(req.budget || '') + '" placeholder="' + esc(t('price_ph')) + '"></div>' +
        '<div><label for="oTime">' + esc(t('depart_time')) + '</label><input id="oTime" type="time" required value="' + defTime + '"></div></div></div>' +
        '<div class="f"><div class="grow"><label for="oCar">' + esc(t('car')) + '</label><input id="oCar" required maxlength="80" placeholder="' + esc(t('car_ph')) + '"></div></div>' +
        '<div class="f"><div class="grow"><label for="oComment">' + esc(t('comment')) + '</label><input id="oComment" maxlength="300"></div></div>' +
        '<div id="oMsg"></div><button class="btn" type="submit">' + esc(t('send_offer')) + '</button></form>';
    }
    view.innerHTML = html;

    var of = $('#oForm');
    if (of) of.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = of.querySelector('button[type=submit]'); btn.disabled = true;
      var ins = await sb.from('offers').insert({
        request_id: req.id, driver_id: me.id, price: Number($('#oPrice').value),
        depart_time: $('#oTime').value, car: $('#oCar').value.trim(), comment: $('#oComment').value.trim()
      });
      if (ins.error) { $('#oMsg').innerHTML = errorBox(ins.error); btn.disabled = false; return; }
      toast(t('offer_sent')); renderRequest(req.id);
    });
    var wd = $('#withdraw');
    if (wd) wd.addEventListener('click', async function () {
      wd.disabled = true;
      var up = await sb.from('offers').update({ status: 'withdrawn' }).eq('id', my.id);
      if (up.error) { toast(up.error.message); wd.disabled = false; return; }
      toast(t('withdrawn_t')); renderRequest(req.id);
    });
  }

  async function renderFeed(q) {
    setTab('requests');
    loading();
    var region = q.from || '*';
    var query = sb.from('ride_requests').select('*').eq('status', 'open').gte('ride_date', isoDate()).order('ride_date').limit(100);
    if (region !== '*') query = query.eq('from_region', region);
    var res = await Promise.all([query, sb.from('offers').select('request_id').eq('driver_id', me.id)]);
    var offered = {};
    (res[1].data || []).forEach(function (x) { offered[x.request_id] = true; });
    var html = '<h1>' + esc(t('feed_title')) + '</h1>' + blockedBanner() +
      '<div class="card form"><div class="f"><div class="grow"><label for="fFrom">' + esc(t('from')) + '</label><select id="fFrom">' +
      '<option value="*">' + esc(t('any_region')) + '</option>' + regionOptions(region) + '</select></div></div></div>';
    if (res[0].error) html += errorBox(res[0].error);
    var list = (res[0].data || []).filter(function (r) { return r.passenger_id !== me.id; });
    html += list.length ? list.map(function (r) {
      return requestCard(r, offered[r.id] ? '<span class="tag pending">' + esc(t('of_pending')) + '</span>' : '');
    }).join('') : '<div class="card empty">' + esc(t('feed_empty')) + '</div>';
    view.innerHTML = html;
    $('#fFrom').addEventListener('change', function () { location.hash = '#/requests?' + qs({ from: this.value }); });
  }

  // ---------- мастер-аккаунт ----------
  async function renderAdmin(tab) {
    setTab('admin');
    if (!me.is_admin) { location.hash = homeHash(); return; }
    tab = tab || renderAdmin.tab || 'users';
    renderAdmin.tab = tab;
    loading();
    var res = await Promise.all([sb.rpc('admin_stats'), tab === 'users' ? sb.rpc('admin_users') : sb.rpc('admin_trips')]);
    if (res[0].error || res[1].error) { view.innerHTML = '<h1>' + esc(t('admin_title')) + '</h1>' + errorBox(res[0].error || res[1].error); return; }
    var s = res[0].data[0] || {};
    function stat(label, val) { return '<div class="stat"><span class="num">' + (val || 0) + '</span><span class="small muted">' + esc(t(label)) + '</span></div>'; }
    var html = '<h1>' + esc(t('admin_title')) + '</h1>' +
      '<div class="stats">' + stat('s_users', s.users) + stat('s_drivers', s.drivers) + stat('s_passengers', s.passengers) + stat('s_blocked', s.blocked) +
      stat('s_trips_open', s.trips_open) + stat('s_trips_total', s.trips_total) + stat('s_bookings', s.bookings_total) + stat('s_accepted', s.bookings_accepted) + '</div>' +
      '<div class="seg"><button type="button" data-atab="users" class="' + (tab === 'users' ? 'on' : '') + '">' + esc(t('a_users')) + '</button>' +
      '<button type="button" data-atab="trips" class="' + (tab === 'trips' ? 'on' : '') + '">' + esc(t('a_trips')) + '</button></div>';

    if (tab === 'users') {
      html += (res[1].data || []).map(function (u) {
        var self = u.id === me.id;
        return '<div class="card pad"><div class="row"><span class="ava">' + initials(u.name) + '</span><div class="grow">' +
          '<span class="t">' + esc(u.name || '—') + (self ? ' <span class="muted small">(' + esc(t('you')) + ')</span>' : '') + '</span>' +
          '<span class="small muted">' + esc(u.email) + ' · <span class="num">' + esc(u.phone) + '</span></span></div></div>' +
          '<div class="row wrap" style="gap:8px"><span class="tag">' + esc(t(u.role)) + '</span>' +
          (u.is_admin ? '<span class="tag">' + esc(t('admin_badge')) + '</span>' : '') +
          (u.blocked ? '<span class="tag cancelled">' + esc(t('blocked_badge')) + '</span>' : '') + '</div>' +
          (self ? '' : '<button class="btn sec sm" data-block="' + u.id + '" data-val="' + (!u.blocked) + '">' + esc(u.blocked ? t('unblock') : t('block')) + '</button>') +
          '</div>';
      }).join('');
    } else {
      html += (res[1].data || []).map(function (x) {
        return '<div class="card pad"><div class="row between"><span class="t">' + esc(dayLabel(x.depart_at)) + ' · ' + hm(x.depart_at) + '</span>' +
          (x.status === 'open' ? '<span class="tag">' + esc(t('booked_x', { a: x.seats_total - x.seats_free, b: x.seats_total })) + '</span>' : '<span class="tag cancelled">' + esc(t('cancelled_lbl')) + '</span>') + '</div>' +
          '<div class="t">' + esc(x.from_district) + ' → ' + esc(x.to_district) + '</div>' +
          '<span class="small muted">' + esc(x.driver_name) + ' · <span class="num">' + esc(x.driver_phone) + '</span> · ' + money(x.price) + '</span>' +
          (Number(x.pending) ? '<span class="tag pending" style="align-self:flex-start">' + esc(t('requests_n', { n: x.pending })) + '</span>' : '') +
          (x.status === 'open' ? '<button class="btn sec sm" data-cancel="' + x.id + '">' + esc(t('cancel_trip')) + '</button>' : '') + '</div>';
      }).join('') || '<div class="card empty">—</div>';
    }
    view.innerHTML = html;

    $all('[data-atab]').forEach(function (b) { b.addEventListener('click', function () { renderAdmin(b.getAttribute('data-atab')); }); });
    $all('[data-block]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = t('confirm_q'); return; }
        b.disabled = true;
        var r = await sb.rpc('admin_set_blocked', { p_user: b.getAttribute('data-block'), p_blocked: b.getAttribute('data-val') === 'true' });
        if (r.error) { toast(r.error.message); b.disabled = false; return; }
        toast(t('saved')); renderAdmin('users');
      });
    });
    $all('[data-cancel]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = t('confirm_q'); return; }
        b.disabled = true;
        var r = await sb.rpc('admin_cancel_trip', { p_trip: Number(b.getAttribute('data-cancel')) });
        if (r.error) { toast(r.error.message); b.disabled = false; return; }
        toast(t('trip_cancelled')); renderAdmin('trips');
      });
    });
  }

  // ---------- без настроек ----------
  function renderSetup() {
    tabs.hidden = true;
    view.innerHTML = '<div class="hero"><span class="brand">' + logo('#FFFFFF', '#0B6E79', 28) + 'yoʻlda</span><span class="big">' + esc(t('setup_title')) + '</span></div>' +
      '<div class="card pad"><p>' + esc(t('setup_text')) + '</p></div>';
  }

  // ---------- маршрутизация ----------
  async function route() {
    document.documentElement.lang = lang;
    if (!sb) { renderSetup(); return; }
    var h = location.hash.replace(/^#\/?/, '');
    if (!h) { location.hash = me ? homeHash() : '#/login'; return; }
    var path = h.split('?')[0], q = params(h.split('?')[1]);
    var parts = path.split('/');
    if (!me && parts[0] !== 'login') { location.hash = '#/login'; return; }
    if (me && parts[0] === 'login') { location.hash = homeHash(); return; }
    window.scrollTo(0, 0);
    try {
      switch (parts[0]) {
        case 'login': renderLogin(); break;
        case 'results': await renderResults(q); break;
        case 'trip': await renderTrip(parts[1]); break;
        case 'add': renderAdd(); break;
        case 'driver': await renderDriver(parts[1]); break;
        case 'mine': await renderMine(); break;
        case 'profile': renderProfile(); break;
        case 'admin': await renderAdmin(); break;
        case 'requests': await renderFeed(q); break;
        case 'request': if (parts[1] === 'new') renderRequestNew(q); else await renderRequest(parts[1]); break;
        default: renderSearch();
      }
    } catch (e) {
      view.innerHTML = errorBox(e) + '<a class="btn sec" href="' + homeHash() + '">' + esc(t('home')) + '</a>';
    }
  }

  window.addEventListener('hashchange', route);
  (async function start() {
    if (sb) {
      await loadMe();
      sb.auth.onAuthStateChange(function (evt) {
        if (evt === 'SIGNED_OUT') { me = null; location.hash = '#/login'; }
      });
    }
    route();
  })();
})();
