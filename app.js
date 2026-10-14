/* Yoʻlda — рабочая версия (PWA). Без сборки: обычный JS + Supabase. */
(function () {
  'use strict';

  var cfg = window.YOLDA_CONFIG || {};
  var view = document.getElementById('view');
  var tabs = document.getElementById('tabs');
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1;
  var sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  var me = null; // { id, email, name, phone }

  var OPTIONS = ['Konditsioner', 'Chekilmaydi', 'Yuk uchun joy', 'Faqat ayollar uchun'];
  var MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  var STATUS = { pending: 'Kutilmoqda', accepted: 'Tasdiqlandi', rejected: 'Rad etildi', cancelled: 'Bekor qilindi' };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel) { return view.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(view.querySelectorAll(sel)); }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return esc((p[0] || '?').slice(0, 2));
  }
  function money(n) { return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + ' soʻm'; }
  function hm(d) { d = new Date(d); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function dayLabel(d) { d = new Date(d); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function isoDate(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function tomorrow() { var d = new Date(); d.setDate(d.getDate() + 1); return isoDate(d); }
  function place(region, district) { return esc(district) + '<span class="muted small">, ' + esc(region) + '</span>'; }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function loading() { view.innerHTML = '<div class="spinner" aria-label="Yuklanmoqda"></div>'; }
  function errorBox(e) {
    var msg = (e && (e.message || e.error_description)) || 'Xatolik yuz berdi';
    return '<div class="err">' + esc(msg) + '</div>';
  }
  function back(href) {
    return '<a class="icon-btn" href="' + href + '" aria-label="Orqaga"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></a>';
  }
  function regionOptions(sel) {
    return Object.keys(window.REGIONS).map(function (r) {
      return '<option' + (r === sel ? ' selected' : '') + '>' + esc(r) + '</option>';
    }).join('');
  }
  function districtOptions(region, sel, withAll) {
    var list = (window.REGIONS[region] || []).slice();
    if (withAll) list.unshift('Barchasi');
    return list.map(function (d) {
      return '<option' + (d === sel ? ' selected' : '') + '>' + esc(d) + '</option>';
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
  function qs(o) {
    return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
  }
  function setTab(name) {
    tabs.hidden = !me;
    Array.prototype.forEach.call(tabs.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('on', t.getAttribute('data-tab') === name);
    });
  }

  // ---------- auth ----------
  async function loadMe() {
    var s = await sb.auth.getSession();
    var user = s.data.session && s.data.session.user;
    if (!user) { me = null; return; }
    var p = await sb.rpc('my_profile');
    var row = (p.data && p.data[0]) || {};
    me = { id: user.id, email: user.email, name: row.name || '', phone: row.phone || '' };
  }

  function renderLogin() {
    setTab(null);
    var mode = renderLogin.mode || 'in';
    view.innerHTML =
      '<div class="hero"><span class="brand">' + logo('#FFFFFF', '#0B6E79', 28) + 'yoʻlda</span>' +
      '<span class="big">Shahardan shaharga — birga va arzonroq</span></div>' +
      '<div class="seg" role="tablist"><button type="button" data-mode="in" class="' + (mode === 'in' ? 'on' : '') + '">Kirish</button>' +
      '<button type="button" data-mode="up" class="' + (mode === 'up' ? 'on' : '') + '">Roʻyxatdan oʻtish</button></div>' +
      '<form class="card form" id="authForm">' +
      (mode === 'up'
        ? '<div class="f"><div class="grow"><label for="aName">Ism</label><input id="aName" required autocomplete="name" placeholder="Ismingiz"></div></div>' +
          '<div class="f"><div class="grow"><label for="aPhone">Telefon</label><input id="aPhone" required type="tel" autocomplete="tel" placeholder="+998 90 123 45 67"></div></div>'
        : '') +
      '<div class="f"><div class="grow"><label for="aEmail">Email</label><input id="aEmail" required type="email" autocomplete="email" placeholder="siz@mail.uz"></div></div>' +
      '<div class="f"><div class="grow"><label for="aPass">Parol</label><input id="aPass" required type="password" minlength="6" autocomplete="' + (mode === 'up' ? 'new-password' : 'current-password') + '" placeholder="Kamida 6 belgi"></div></div>' +
      '<div id="authMsg"></div>' +
      '<button class="btn" type="submit">' + (mode === 'up' ? 'Roʻyxatdan oʻtish' : 'Kirish') + '</button></form>' +
      '<p class="small muted">Sinov versiyasi: hozircha email orqali kirish. SMS orqali kirish keyinroq qoʻshiladi.</p>';

    $all('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { renderLogin.mode = b.getAttribute('data-mode'); renderLogin(); });
    });
    $('#authForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = this.querySelector('button[type=submit]'); btn.disabled = true;
      var msg = $('#authMsg'); msg.innerHTML = '';
      var email = $('#aEmail').value.trim(), pass = $('#aPass').value;
      try {
        if (mode === 'up') {
          var r = await sb.auth.signUp({ email: email, password: pass, options: { data: { name: $('#aName').value.trim(), phone: $('#aPhone').value.trim() } } });
          if (r.error) throw r.error;
          if (!r.data.session) {
            msg.innerHTML = '<div class="info">Emailingizga tasdiqlash xati yuborildi. Havolani bosing, soʻng shu yerda kiring.</div>';
            btn.disabled = false; return;
          }
        } else {
          var r2 = await sb.auth.signInWithPassword({ email: email, password: pass });
          if (r2.error) throw r2.error;
        }
        await loadMe();
        location.hash = '#/search';
      } catch (err) {
        msg.innerHTML = errorBox(err.message === 'Invalid login credentials' ? { message: 'Email yoki parol notoʻgʻri' } : err);
        btn.disabled = false;
      }
    });
  }

  function logo(fill, road, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 140 140" aria-hidden="true"><path d="M70 26c-18 0-32 14-32 32 0 24 32 56 32 56s32-32 32-56c0-18-14-32-32-32z" fill="' + fill + '"/><path d="M60 92 C 64 74, 76 64, 74 46" stroke="' + road + '" stroke-width="9" fill="none" stroke-linecap="round"/></svg>';
  }

  // ---------- search ----------
  function renderSearch() {
    setTab('search');
    var last = renderSearch.last || { from: 'Toshkent shahri', fromD: 'Barchasi', to: 'Samarqand', toD: 'Barchasi', date: tomorrow() };
    view.innerHTML =
      '<div class="hero"><span class="brand">' + logo('#FFFFFF', '#0B6E79', 28) + 'yoʻlda</span>' +
      '<span class="big">Salom' + (me.name ? ', ' + esc(me.name) : '') + '! Qayerga boramiz?</span></div>' +
      '<form class="card form" id="sForm">' +
      '<div class="f"><span class="dot o"></span><div class="grow"><label for="sFrom">Qayerdan</label><select id="sFrom">' + regionOptions(last.from) + '</select>' +
      '<label for="sFromD" style="margin-top:8px">Tuman / shahar</label><select id="sFromD">' + districtOptions(last.from, last.fromD, true) + '</select></div></div>' +
      '<div class="f"><span class="dot f"></span><div class="grow"><label for="sTo">Qayerga</label><select id="sTo">' + regionOptions(last.to) + '</select>' +
      '<label for="sToD" style="margin-top:8px">Tuman / shahar</label><select id="sToD">' + districtOptions(last.to, last.toD, true) + '</select></div></div>' +
      '<div class="f"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>' +
      '<div class="grow"><label for="sDate">Sana</label><input id="sDate" type="date" min="' + isoDate() + '" value="' + esc(last.date) + '"></div></div>' +
      '<button class="btn" type="submit">Safar qidirish</button></form>';
    bindRegion('sFrom', 'sFromD', true);
    bindRegion('sTo', 'sToD', true);
    $('#sForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = { from: $('#sFrom').value, fromD: $('#sFromD').value, to: $('#sTo').value, toD: $('#sToD').value, date: $('#sDate').value || tomorrow() };
      renderSearch.last = q;
      location.hash = '#/results?' + qs(q);
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
    if (q.fromD && q.fromD !== 'Barchasi') query = query.eq('from_district', q.fromD);
    if (q.toD && q.toD !== 'Barchasi') query = query.eq('to_district', q.toD);
    var r = await query;
    var head = '<div class="row">' + back('#/search') + '<div class="grow"><h1>' + esc(q.from) + ' → ' + esc(q.to) + '</h1>' +
      '<span class="small muted">' + esc(dayLabel(start)) + ' · ' + (r.data ? r.data.length : 0) + ' ta safar</span></div></div>';
    if (r.error) { view.innerHTML = head + errorBox(r.error); return; }
    if (!r.data.length) {
      view.innerHTML = head + '<div class="card empty">Bu kunga safar topilmadi.<br>Boshqa sanani tanlang yoki oʻzingiz safar eʼlon qiling.</div>' +
        '<a class="btn sec" href="#/add">Safar eʼlon qilish</a>';
      return;
    }
    view.innerHTML = head + r.data.map(tripCard).join('');
  }

  function tripCard(t) {
    var name = (t.driver && t.driver.name) || 'Haydovchi';
    return '<a class="trip" href="#/trip/' + t.id + '">' +
      '<div class="times"><span class="time num">' + hm(t.depart_at) + '</span><span class="line"></span><span class="small muted">' + esc(dayLabel(t.depart_at)) + '</span></div>' +
      '<div class="row between small"><span>' + place(t.from_region, t.from_district) + '</span><span style="text-align:right">' + place(t.to_region, t.to_district) + '</span></div>' +
      '<div class="row"><span class="ava">' + initials(name) + '</span>' +
      '<div class="grow"><span class="t">' + esc(name) + '</span><span class="small muted">' + esc(t.car || '') + '</span></div>' +
      '<span class="price num">' + money(t.price) + '</span></div>' +
      '<div class="row wrap" style="gap:8px"><span class="tag">' + t.seats_free + ' joy boʻsh</span>' +
      (t.options || []).map(function (o) { return '<span class="tag">' + esc(o) + '</span>'; }).join('') + '</div></a>';
  }

  // ---------- trip detail (passenger) ----------
  async function renderTrip(id) {
    setTab('search');
    loading();
    var r = await sb.from('trips').select('*, driver:profiles(name)').eq('id', id).maybeSingle();
    if (r.error || !r.data) { view.innerHTML = '<div class="row">' + back('#/search') + '<h1>Safar</h1></div>' + errorBox(r.error || { message: 'Safar topilmadi' }); return; }
    var t = r.data;
    if (t.driver_id === me.id) { location.hash = '#/driver/' + t.id; return; }
    var b = await sb.from('bookings').select('*').eq('trip_id', id).eq('passenger_id', me.id).maybeSingle();
    var booking = b.data;
    var name = (t.driver && t.driver.name) || 'Haydovchi';
    var driverPhone = '';
    if (booking && booking.status === 'accepted') {
      var c = await sb.rpc('trip_contacts', { p_trip: Number(id) });
      var d = (c.data || []).filter(function (x) { return x.user_id === t.driver_id; })[0];
      driverPhone = d ? d.phone : '';
    }

    var html = '<div class="row">' + back('javascript:history.back()') + '<h1>Safar tafsilotlari</h1></div>' +
      '<div class="card pad">' +
      '<div class="stop"><span class="time num" style="font-size:16px">' + hm(t.depart_at) + '</span><div class="rail"><span class="dot"></span><span class="bar"></span></div>' +
      '<div><div class="t">' + esc(t.from_district) + '</div><div class="small muted">' + esc(t.from_region) + (t.meeting_point ? ' · ' + esc(t.meeting_point) : '') + '</div></div></div>' +
      '<div class="stop" style="min-height:0"><span class="small muted">' + esc(dayLabel(t.depart_at)) + '</span><div class="rail"><span class="dot" style="background:var(--accent)"></span></div>' +
      '<div><div class="t">' + esc(t.to_district) + '</div><div class="small muted">' + esc(t.to_region) + '</div></div></div></div>' +
      '<div class="card pad"><div class="row"><span class="ava">' + initials(name) + '</span><div class="grow"><span class="t">' + esc(name) + '</span>' +
      '<span class="small muted">' + esc(t.car || '') + '</span></div></div>' +
      (driverPhone ? '<div class="info">Haydovchi telefoni: <b class="num">' + esc(driverPhone) + '</b></div>' : '') +
      ((t.options || []).length ? '<div class="row wrap" style="gap:8px">' + t.options.map(function (o) { return '<span class="tag">' + esc(o) + '</span>'; }).join('') + '</div>' : '') +
      '</div>';

    if (booking && booking.status !== 'cancelled') {
      html += '<div class="card pad"><div class="row between"><span class="t">Sizning soʻrovingiz</span><span class="tag ' + booking.status + '">' + STATUS[booking.status] + '</span></div>' +
        '<span class="small muted">' + booking.seats + ' joy · ' + money(booking.seats * t.price) + '</span>' +
        (booking.status === 'pending' || booking.status === 'accepted' ? '<button class="btn sec sm" id="cancelBtn">Bekor qilish</button>' : '') + '</div>';
    } else if (t.seats_free > 0 && t.status === 'open') {
      var opts = '';
      for (var i = 1; i <= Math.min(t.seats_free, 4); i++) opts += '<option value="' + i + '">' + i + ' joy</option>';
      html += '<div class="card pad"><div class="row between"><label for="seatCount" class="t">Necha joy?</label><span class="small muted">' + t.seats_free + ' ta boʻsh</span></div>' +
        '<select id="seatCount" class="btn sec sm" style="font-weight:600">' + opts + '</select>' +
        '<div class="row between"><span class="muted">Jami</span><span class="price num" id="total">' + money(t.price) + '</span></div>' +
        '<div id="bookMsg"></div><button class="btn" id="bookBtn">Joy band qilish</button></div>' +
        (booking && booking.status === 'cancelled' ? '<p class="small muted">Oldingi soʻrovingiz bekor qilingan. Qayta band qilish uchun haydovchiga yozing.</p>' : '');
    } else {
      html += '<div class="card empty">Boʻsh joy qolmagan.</div>';
    }
    view.innerHTML = html;

    var seatSel = $('#seatCount');
    if (seatSel) seatSel.addEventListener('change', function () { $('#total').textContent = money(seatSel.value * t.price); });
    var bookBtn = $('#bookBtn');
    if (bookBtn && !booking) bookBtn.addEventListener('click', async function () {
      bookBtn.disabled = true;
      var ins = await sb.from('bookings').insert({ trip_id: t.id, passenger_id: me.id, seats: Number(seatSel.value) });
      if (ins.error) { $('#bookMsg').innerHTML = errorBox(ins.error); bookBtn.disabled = false; return; }
      toast('Soʻrov yuborildi');
      renderTrip(id);
    });
    if (bookBtn && booking) { bookBtn.disabled = true; }
    var cancelBtn = $('#cancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', async function () {
      cancelBtn.disabled = true;
      var up = await sb.from('bookings').update({ status: 'cancelled' }).eq('id', booking.id);
      if (up.error) { toast(up.error.message); cancelBtn.disabled = false; return; }
      toast('Bekor qilindi');
      renderTrip(id);
    });
  }

  // ---------- add trip (driver) ----------
  function renderAdd() {
    setTab('add');
    var chosen = {};
    view.innerHTML = '<h1>Safar qoʻshish</h1>' +
      '<form class="card form" id="addForm">' +
      '<div class="f"><span class="dot o"></span><div class="grow"><label for="tFrom">Qayerdan</label><select id="tFrom">' + regionOptions('Toshkent shahri') + '</select>' +
      '<label for="tFromD" style="margin-top:8px">Tuman / shahar</label><select id="tFromD">' + districtOptions('Toshkent shahri') + '</select></div></div>' +
      '<div class="f"><span class="dot f"></span><div class="grow"><label for="tTo">Qayerga</label><select id="tTo">' + regionOptions('Samarqand') + '</select>' +
      '<label for="tToD" style="margin-top:8px">Tuman / shahar</label><select id="tToD">' + districtOptions('Samarqand') + '</select></div></div>' +
      '<div class="f"><div class="grow two"><div><label for="tDate">Sana</label><input id="tDate" type="date" required min="' + isoDate() + '" value="' + tomorrow() + '"></div>' +
      '<div><label for="tTime">Joʻnash vaqti</label><input id="tTime" type="time" required value="07:00"></div></div></div>' +
      '<div class="f"><div class="grow"><label for="tMeet">Uchrashuv joyi</label><input id="tMeet" placeholder="Masalan: Olmazor metro bekati"></div></div>' +
      '<div class="f"><div class="grow"><label for="tCar">Mashina</label><input id="tCar" required placeholder="Masalan: Chevrolet Cobalt, oq"></div></div>' +
      '<div class="f"><div class="grow two"><div><label for="tSeats">Boʻsh joylar</label><select id="tSeats"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option><option>6</option></select></div>' +
      '<div><label for="tPrice">Bir joy narxi, soʻm</label><input id="tPrice" type="number" inputmode="numeric" min="0" step="1000" required placeholder="Narx"></div></div></div>' +
      '<div class="f" style="flex-direction:column;align-items:stretch;gap:10px"><span class="lbl">Qulayliklar</span><div class="chips">' +
      OPTIONS.map(function (o) { return '<button type="button" class="chip" data-opt="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>' +
      '<div id="addMsg"></div><button class="btn" type="submit">Safarni eʼlon qilish</button></form>';
    bindRegion('tFrom', 'tFromD');
    bindRegion('tTo', 'tToD');
    $all('[data-opt]').forEach(function (c) {
      c.addEventListener('click', function () {
        var o = c.getAttribute('data-opt'); chosen[o] = !chosen[o]; c.classList.toggle('on', chosen[o]);
      });
    });
    $('#addForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = this.querySelector('button[type=submit]'); btn.disabled = true;
      var depart = new Date($('#tDate').value + 'T' + $('#tTime').value + ':00');
      var msg = $('#addMsg'); msg.innerHTML = '';
      if (depart < new Date()) { msg.innerHTML = errorBox({ message: 'Joʻnash vaqti oʻtib ketgan' }); btn.disabled = false; return; }
      if ($('#tFrom').value === $('#tTo').value && $('#tFromD').value === $('#tToD').value) { msg.innerHTML = errorBox({ message: 'Qayerdan va qayerga bir xil' }); btn.disabled = false; return; }
      var seats = Number($('#tSeats').value);
      var row = {
        driver_id: me.id,
        from_region: $('#tFrom').value, from_district: $('#tFromD').value,
        to_region: $('#tTo').value, to_district: $('#tToD').value,
        depart_at: depart.toISOString(),
        meeting_point: $('#tMeet').value.trim(), car: $('#tCar').value.trim(),
        seats_total: seats, seats_free: seats,
        price: Number($('#tPrice').value),
        options: OPTIONS.filter(function (o) { return chosen[o]; })
      };
      var ins = await sb.from('trips').insert(row).select('id').single();
      if (ins.error) { msg.innerHTML = errorBox(ins.error); btn.disabled = false; return; }
      toast('Safar eʼlon qilindi');
      location.hash = '#/driver/' + ins.data.id;
    });
  }

  // ---------- driver: my trip + requests ----------
  async function renderDriver(id) {
    setTab('mine');
    loading();
    var r = await sb.from('trips').select('*').eq('id', id).maybeSingle();
    if (r.error || !r.data || r.data.driver_id !== me.id) { view.innerHTML = '<div class="row">' + back('#/mine') + '<h1>Reys</h1></div>' + errorBox(r.error || { message: 'Reys topilmadi' }); return; }
    var t = r.data;
    var b = await sb.from('bookings').select('*, passenger:profiles(name)').eq('trip_id', id).order('created_at');
    var list = b.data || [];
    var contacts = await sb.rpc('trip_contacts', { p_trip: Number(id) });
    var phoneOf = {};
    (contacts.data || []).forEach(function (x) { phoneOf[x.user_id] = x.phone; });
    var taken = t.seats_total - t.seats_free;
    var pending = list.filter(function (x) { return x.status === 'pending'; });
    var accepted = list.filter(function (x) { return x.status === 'accepted'; });

    var html = '<div class="row">' + back('#/mine') + '<h1>Mening reysim</h1></div>' +
      '<div class="hero" style="gap:12px"><div class="row between"><span class="small">' + (t.status === 'open' ? 'Eʼlon qilindi' : 'Bekor qilingan') + '</span>' +
      '<span class="small t">' + esc(dayLabel(t.depart_at)) + ' · ' + hm(t.depart_at) + '</span></div>' +
      '<span class="big">' + esc(t.from_district) + ' → ' + esc(t.to_district) + '</span>' +
      '<div class="row between"><span class="small">Band qilingan joylar</span><span class="t num">' + taken + ' / ' + t.seats_total + '</span></div>' +
      '<div style="height:8px;border-radius:4px;background:rgba(255,255,255,.25);overflow:hidden"><div style="height:100%;width:' + Math.round(taken / t.seats_total * 100) + '%;background:#FFFFFF;border-radius:4px"></div></div></div>' +
      '<h2>Yangi soʻrovlar</h2>' +
      (pending.length ? pending.map(function (x) {
        var n = (x.passenger && x.passenger.name) || 'Yoʻlovchi';
        return '<div class="card pad"><div class="row"><span class="ava">' + initials(n) + '</span><div class="grow"><span class="t">' + esc(n) + '</span>' +
          '<span class="small muted">' + x.seats + ' joy</span></div></div>' +
          '<div class="two"><button class="btn sec sm" data-act="rejected" data-id="' + x.id + '">Rad etish</button>' +
          '<button class="btn sm" data-act="accepted" data-id="' + x.id + '">Qabul qilish</button></div></div>';
      }).join('') : '<div class="card empty">Hozircha yangi soʻrov yoʻq.</div>') +
      '<h2>Yoʻlovchilar</h2>' +
      (accepted.length ? '<div class="card">' + accepted.map(function (x) {
        var n = (x.passenger && x.passenger.name) || 'Yoʻlovchi';
        return '<div class="row" style="padding:14px 16px"><span class="ava">' + initials(n) + '</span><div class="grow"><span class="t">' + esc(n) + '</span>' +
          '<span class="small muted num">' + x.seats + ' joy · ' + esc(phoneOf[x.passenger_id] || '') + '</span></div></div>';
      }).join('') + '</div>' : '<div class="card empty">Tasdiqlangan yoʻlovchi yoʻq.</div>') +
      (t.status === 'open' ? '<button class="btn sec" id="cancelTrip">Reysni bekor qilish</button>' : '');
    view.innerHTML = html;

    $all('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        $all('[data-act]').forEach(function (x) { x.disabled = true; });
        var up = await sb.from('bookings').update({ status: btn.getAttribute('data-act') }).eq('id', btn.getAttribute('data-id'));
        if (up.error) toast(up.error.message.indexOf('мест') > -1 ? 'Boʻsh joy yetarli emas' : up.error.message);
        else toast(btn.getAttribute('data-act') === 'accepted' ? 'Qabul qilindi' : 'Rad etildi');
        renderDriver(id);
      });
    });
    var ct = $('#cancelTrip');
    if (ct) ct.addEventListener('click', async function () {
      if (ct.getAttribute('data-sure') !== '1') { ct.setAttribute('data-sure', '1'); ct.textContent = 'Tasdiqlash: reysni bekor qilish'; return; }
      ct.disabled = true;
      var up = await sb.from('trips').update({ status: 'cancelled' }).eq('id', id);
      if (up.error) { toast(up.error.message); ct.disabled = false; return; }
      toast('Reys bekor qilindi');
      renderDriver(id);
    });
  }

  // ---------- my trips ----------
  async function renderMine() {
    setTab('mine');
    loading();
    var res = await Promise.all([
      sb.from('bookings').select('*, trip:trips(*, driver:profiles(name))').eq('passenger_id', me.id).order('created_at', { ascending: false }),
      sb.from('trips').select('*, bookings(status)').eq('driver_id', me.id).order('depart_at', { ascending: false })
    ]);
    var bookings = res[0].data || [], trips = res[1].data || [];
    var html = '<h1>Safarlarim</h1>';
    if (res[0].error || res[1].error) html += errorBox(res[0].error || res[1].error);

    html += '<span class="section-label">Yoʻlovchi sifatida</span>';
    html += bookings.length ? bookings.map(function (b) {
      var t = b.trip; if (!t) return '';
      return '<a class="trip" href="#/trip/' + t.id + '"><div class="row between"><span class="t">' + esc(dayLabel(t.depart_at)) + ' · ' + hm(t.depart_at) + '</span>' +
        '<span class="tag ' + b.status + '">' + STATUS[b.status] + '</span></div>' +
        '<div class="t">' + esc(t.from_district) + ' → ' + esc(t.to_district) + '</div>' +
        '<span class="small muted">' + esc((t.driver && t.driver.name) || '') + ' · ' + b.seats + ' joy</span></a>';
    }).join('') : '<div class="card empty">Siz hali joy band qilmagansiz.</div>';

    html += '<span class="section-label">Haydovchi sifatida</span>';
    html += trips.length ? trips.map(function (t) {
      var waiting = (t.bookings || []).filter(function (x) { return x.status === 'pending'; }).length;
      return '<a class="trip" href="#/driver/' + t.id + '"><div class="row between"><span class="t">' + esc(dayLabel(t.depart_at)) + ' · ' + hm(t.depart_at) + '</span>' +
        (t.status !== 'open' ? '<span class="tag cancelled">Bekor qilingan</span>' : waiting ? '<span class="tag pending">' + waiting + ' ta soʻrov</span>' : '<span class="tag">' + (t.seats_total - t.seats_free) + '/' + t.seats_total + ' band</span>') + '</div>' +
        '<div class="t">' + esc(t.from_district) + ' → ' + esc(t.to_district) + '</div>' +
        '<span class="small muted">' + money(t.price) + ' / joy</span></a>';
    }).join('') : '<div class="card empty">Siz hali safar eʼlon qilmagansiz.</div>';
    view.innerHTML = html;
  }

  // ---------- profile ----------
  function renderProfile() {
    setTab('profile');
    view.innerHTML = '<h1>Profil</h1>' +
      '<form class="card form" id="pForm">' +
      '<div class="f"><div class="grow"><label for="pName">Ism</label><input id="pName" required value="' + esc(me.name) + '"></div></div>' +
      '<div class="f"><div class="grow"><label for="pPhone">Telefon</label><input id="pPhone" type="tel" required value="' + esc(me.phone) + '"></div></div>' +
      '<div class="f"><div class="grow"><span class="lbl">Email</span><span class="t">' + esc(me.email) + '</span></div></div>' +
      '<button class="btn" type="submit">Saqlash</button></form>' +
      '<p class="small muted">Telefon raqamingiz faqat tasdiqlangan safar ishtirokchilariga koʻrinadi.</p>' +
      '<button class="btn sec" id="logout">Chiqish</button>';
    $('#pForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = $('#pName').value.trim(), phone = $('#pPhone').value.trim();
      var up = await sb.from('profiles').update({ name: name, phone: phone }).eq('id', me.id);
      if (up.error) { toast(up.error.message); return; }
      me.name = name; me.phone = phone; toast('Saqlandi');
    });
    $('#logout').addEventListener('click', async function () {
      renderLogin.mode = 'in';
      await sb.auth.signOut(); me = null; location.hash = '#/login';
    });
  }

  // ---------- setup screen (no config yet) ----------
  function renderSetup() {
    tabs.hidden = true;
    view.innerHTML = '<div class="hero"><span class="brand">' + logo('#FFFFFF', '#0B6E79', 28) + 'yoʻlda</span><span class="big">Sozlash kerak</span></div>' +
      '<div class="card pad"><p>Supabase hali ulanmagan. <b>config.js</b> faylida <b>SUPABASE_URL</b> va <b>SUPABASE_ANON_KEY</b> qiymatlarini kiriting.</p>' +
      '<p class="small muted">Batafsil: README.md</p></div>';
  }

  // ---------- router ----------
  async function route() {
    if (!sb) { renderSetup(); return; }
    var h = location.hash.replace(/^#\/?/, '') || 'search';
    var path = h.split('?')[0], q = params(h.split('?')[1]);
    var parts = path.split('/');
    if (!me && parts[0] !== 'login') { location.hash = '#/login'; return; }
    if (me && parts[0] === 'login') { location.hash = '#/search'; return; }
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
        default: renderSearch();
      }
    } catch (e) {
      view.innerHTML = errorBox(e) + '<a class="btn sec" href="#/search">Bosh sahifa</a>';
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
