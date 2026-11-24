/* SIGEFER · interfaz. Todo el texto que viene de la base pasa por esc() antes de llegar al DOM. */
'use strict';

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONOS = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01"/>',
  boxes: '<path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h4l4 4v3h-8zM6 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8zM7.5 8.5h.01"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  mal: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  dinero: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2 0 0 0-2.5-1.5c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2A2.5 2 0 0 1 9.5 15M12 6v1.5M12 16.5V18"/>',
  alerta: '<path d="M12 4l10 17H2zM12 10v5M12 18h.01"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/>',
  server: '<rect x="4" y="3" width="16" height="8" rx="2"/><rect x="4" y="13" width="16" height="8" rx="2"/><path d="M8 7h.01M8 17h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  building: '<path d="M4 21V5l8-3 8 3v16M4 21h16M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01"/>',
  dock: '<path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6M9 17h6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
};
const ico = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}">${ICONOS[n] || ''}</svg>`;

const fmt = {
  money: n => n == null ? '—' : 'C$ ' + Number(n).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  num: n => n == null ? '—' : Number(n).toLocaleString('es-NI', { maximumFractionDigits: 3 }),
  int: n => n == null ? '—' : Number(n).toLocaleString('es-NI', { maximumFractionDigits: 0 }),
};
const BADGES = {
  PAGADA: 'green', COBRADA: 'green', AUTORIZADA: 'green', FACTURADO: 'green', OK: 'green',
  PENDIENTE: 'yellow', SOLICITADA: 'yellow',
  ANULADA: 'red', ANULADO: 'red', RECHAZADA: 'red', BAJO: 'red',
  VENCIDA: 'orange',
  DESPACHADA: 'blue', CONTADO: 'steel', A_CREDITO: 'blue', CREDITO: 'blue',
  EN_TRANSITO: 'purple', RECIBIDA: 'emerald', RECIBIDO: 'emerald',
  INSERT: 'green', UPDATE: 'yellow', DELETE: 'red',
};
const badge = v => v == null || v === '' ? '<span class="dim">—</span>'
  : `<span class="badge b-${BADGES[String(v).toUpperCase()] || 'gray'}">${esc(String(v).replace('_', ' '))}</span>`;

const api = async (ruta, opciones = {}) => {
  const o = { method: 'GET', headers: {}, ...opciones };
  if (o.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  let r;
  try { r = await fetch('/api' + ruta, { ...o, credentials: 'same-origin' }); }
  catch { throw Object.assign(new Error('No hay conexión con el servidor de la aplicación.'), { estado: 0 }); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && ruta !== '/login') cerrarLocal(datos.error);
    throw Object.assign(new Error(datos.error || 'Error ' + r.status), { estado: r.status });
  }
  return datos;
};

function toast(tipo, titulo, detalle = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.innerHTML = `${ico(tipo === 'ok' ? 'ok' : 'mal')}<div><b>${esc(titulo)}</b>${esc(detalle)}</div>`;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), tipo === 'ok' ? 4500 : 8000);
}

/* ---------- modales ---------- */
function modal({ titulo, cuerpo, clase = '', pie = '', alMontar }) {
  const raiz = $('#modal-root');
  const f = document.createElement('div');
  f.className = 'fondo';
  f.innerHTML = `<div class="modal ${clase}" role="dialog" aria-modal="true">
    <div class="modal-cab"><h3>${esc(titulo)}</h3><button class="icono-btn" data-cerrar aria-label="Cerrar">${ico('x')}</button></div>
    <div class="modal-cuerpo">${cuerpo}</div>${pie ? `<div class="modal-pie">${pie}</div>` : ''}</div>`;
  const cerrar = () => { f.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape') cerrar(); };
  f.addEventListener('mousedown', e => { if (e.target === f) cerrar(); });
  f.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) cerrar(); });
  document.addEventListener('keydown', esc_);
  raiz.append(f);
  const api_ = { el: f, cerrar, $: s => $(s, f), error(m) {
    let e = $('.error-modal', f);
    if (!e) { e = document.createElement('div'); e.className = 'alerta error-modal'; $('.modal-cuerpo', f).prepend(e); }
    e.textContent = m; e.hidden = !m;
  } };
  if (alMontar) alMontar(api_);
  return api_;
}

function confirmar(titulo, mensaje, textoBoton = 'Confirmar', claseBoton = 'btn-primario') {
  return new Promise(res => {
    const m = modal({
      titulo, clase: 'chico', cuerpo: `<p style="margin:0">${mensaje}</p>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn ${claseBoton}" id="ok-conf">${esc(textoBoton)}</button>`,
    });
    let hecho = false;
    m.$('#ok-conf').onclick = () => { hecho = true; m.cerrar(); res(true); };
    new MutationObserver(() => { if (!m.el.isConnected && !hecho) { hecho = true; res(false); } }).observe($('#modal-root'), { childList: true });
  });
}

/* ---------- tabla genérica con buscador ---------- */
function tabla(cont, cols, filas, { acciones, alClic, vacio = 'No hay registros para mostrar.', buscar = true, titulo = '', extraCab = '', pie } = {}) {
  const celda = (c, f) => {
    const v = f[c.k];
    switch (c.t) {
      case 'money': return `<td class="r ${c.neg && v > 0 ? 'neg' : ''}">${fmt.money(v)}</td>`;
      case 'num': return `<td class="r">${fmt.num(v)}</td>`;
      case 'int': return `<td class="r">${fmt.int(v)}</td>`;
      case 'badge': return `<td>${badge(v)}</td>`;
      case 'mono': return `<td class="mono">${esc(v)}</td>`;
      case 'dim': return `<td class="dim">${esc(v ?? '—')}</td>`;
      case 'corto': return `<td class="dim" title="${esc(v)}">${esc(String(v ?? '—').slice(0, 46))}${String(v ?? '').length > 46 ? '…' : ''}</td>`;
      case 'dias': return `<td class="r ${v > 0 ? 'neg' : 'dim'}">${v == null ? '—' : v > 0 ? v + ' d' : 'al día'}</td>`;
      case 'stock': return `<td class="r ${f.minimo != null && v <= f.minimo ? 'neg' : ''}">${fmt.num(v)}</td>`;
      default: return `<td>${esc(v ?? '—')}</td>`;
    }
  };
  const th = cols.map(c => `<th class="${['money', 'num', 'int', 'dias', 'stock'].includes(c.t) ? 'r' : ''}">${esc(c.l)}</th>`).join('') + (acciones ? '<th></th>' : '');
  const cuerpo = filas.map((f, i) => `<tr data-i="${i}" class="${alClic ? 'clic' : ''}">${cols.map(c => celda(c, f)).join('')}${acciones ? `<td><div class="acc">${acciones(f).map((a, j) =>
    `<button class="btn btn-sm ${a.cls || ''}" data-i="${i}" data-a="${j}">${esc(a.txt)}</button>`).join('')}</div></td>` : ''}</tr>`).join('');
  cont.innerHTML = `<div class="panel">
    <div class="panel-cab"><h3>${esc(titulo)}</h3><span class="muted" data-cuenta>${filas.length} registro${filas.length === 1 ? '' : 's'}</span><span class="grow"></span>${extraCab}
      ${buscar ? `<label class="buscador">${ico('search')}<input type="search" placeholder="Buscar…" aria-label="Buscar"></label>` : ''}</div>
    ${filas.length ? `<div class="scroll"><table><thead><tr>${th}</tr></thead><tbody>${cuerpo}</tbody>${pie ? `<tfoot>${pie}</tfoot>` : ''}</table></div>`
      : `<div class="vacio">${ico('inbox')}<b>Sin resultados</b>${esc(vacio)}</div>`}</div>`;
  const tb = $('tbody', cont);
  if (!tb) return;
  const buscador = $('.buscador input', cont);
  if (buscador) buscador.addEventListener('input', () => {
    const q = buscador.value.trim().toLowerCase();
    let n = 0;
    for (const tr of tb.rows) { const ok = !q || tr.textContent.toLowerCase().includes(q); tr.hidden = !ok; if (ok) n++; }
    $('[data-cuenta]', cont).textContent = `${n} registro${n === 1 ? '' : 's'}`;
  });
  tb.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (b) { e.stopPropagation(); const f = filas[+b.dataset.i]; acciones(f)[+b.dataset.a].fn(f, b); return; }
    const tr = e.target.closest('tr');
    if (tr && alClic) alClic(filas[+tr.dataset.i]);
  });
}

const bloqueo = (cont, e) => {
  const denegado = e.estado === 403;
  cont.innerHTML = `<div class="panel"><div class="vacio bloqueo">${ico(denegado ? 'lock' : 'alerta')}
    <b>${denegado ? 'SQL Server rechazó el acceso' : 'No se pudo cargar'}</b>${esc(e.message)}
    ${denegado ? '<br><span class="dim" style="font-size:12px">La app oculta lo que no corresponde a tu perfil, pero quien decide es el motor.</span>' : ''}</div></div>`;
};
const cargando = cont => { cont.innerHTML = '<div class="cargando"><div class="spin"></div>Consultando el nodo…</div>'; };

/* ---------- selector de producto con búsqueda ---------- */
function selectorProducto(cont, productos, { alElegir, detalle }) {
  cont.classList.add('picker');
  cont.innerHTML = `<input type="text" placeholder="Buscar producto por código o nombre…" autocomplete="off"><div class="picker-lista hidden"></div>`;
  const inp = $('input', cont), lista = $('.picker-lista', cont);
  let sel = 0, vis = [];
  const pintar = () => {
    const q = inp.value.trim().toLowerCase();
    vis = productos.filter(p => !q || p.codigo.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q)).slice(0, 30);
    lista.classList.toggle('hidden', !vis.length);
    lista.innerHTML = vis.map((p, i) => `<div class="picker-item ${i === sel ? 'sel' : ''}" data-i="${i}"><span><b class="mono">${esc(p.codigo)}</b> ${esc(p.nombre)}</span><small>${esc(detalle(p))}</small></div>`).join('');
  };
  const elegir = i => { if (vis[i]) { alElegir(vis[i]); inp.value = ''; lista.classList.add('hidden'); } };
  inp.addEventListener('focus', () => { sel = 0; pintar(); });
  inp.addEventListener('input', () => { sel = 0; pintar(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, vis.length - 1); pintar(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); pintar(); e.preventDefault(); }
    else if (e.key === 'Enter') { elegir(sel); e.preventDefault(); }
    else if (e.key === 'Escape') lista.classList.add('hidden');
  });
  lista.addEventListener('mousedown', e => { const it = e.target.closest('.picker-item'); if (it) { e.preventDefault(); elegir(+it.dataset.i); } });
  inp.addEventListener('blur', () => setTimeout(() => lista.classList.add('hidden'), 120));
}

/* ---------- estado y navegación ---------- */
let perfil = null;
const NAV = [
  { id: 'mapa', t: 'Mapa de la empresa', i: 'map' },
  { id: 'inicio', t: 'Inicio', i: 'home' },
  { id: 'ventas', t: 'Ventas y facturación', i: 'receipt' },
  { id: 'cxc', t: 'Cuentas por cobrar', i: 'wallet' },
  { id: 'inventario', t: 'Inventario', i: 'boxes' },
  { id: 'transferencias', t: 'Transferencias', i: 'truck' },
  { id: 'reportes', t: 'Reportes consolidados', i: 'chart' },
  { id: 'catalogo', t: 'Catálogo y precios', i: 'tag' },
  { id: 'auditoria', t: 'Auditoría', i: 'shield' },
];
const SUBTITULOS = {
  mapa: 'Dónde vive cada dato y quién puede tocarlo',
  inicio: 'Resumen de tu unidad', ventas: 'Facturas de contado y de crédito', cxc: 'Saldos, vencimientos y abonos',
  inventario: 'Existencias y mínimos', transferencias: 'Despachos del almacén y recepciones en sucursal',
  reportes: 'Vistas de consolidación del corporativo', catalogo: 'Productos, unidades y listas de precios',
  auditoria: 'Operaciones críticas registradas por triggers',
};
const VISTAS = {};

function mostrarLogin(mensaje) {
  perfil = null;
  $('#shell').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#l-pass').value = '';
  const e = $('#l-error');
  e.classList.toggle('hidden', !mensaje);
  e.textContent = mensaje || '';
}
function cerrarLocal(mensaje) { if (perfil) mostrarLogin(mensaje || 'La sesión terminó.'); }

function entrar(p) {
  perfil = p;
  $('#login').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  $('#u-avatar').textContent = p.usuario.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
  $('#u-nombre').textContent = p.usuario;
  $('#u-rol').textContent = p.rol_principal;
  $('#t-nodo').textContent = `${p.nodo} · ${p.nodo_nombre}`;
  $('#p-servidor').textContent = p.servidor;
  $('#p-base').textContent = p.base;
  $('#p-version').textContent = 'SQL Server ' + p.version;
  const items = NAV.filter(n => n.id === 'mapa' || p.modulos.includes(n.id));
  $('#nav').innerHTML = items.map(n => `<a href="#/${n.id}" data-id="${n.id}">${ico(n.i)}<span>${esc(n.id === 'transferencias' ? (p.tipo === 'ALMACEN' ? 'Despachos' : 'Recepciones') : n.id === 'inventario' && p.tipo === 'ALMACEN' ? 'Existencias del almacén' : n.t)}</span></a>`).join('');
  if (!location.hash || location.hash === '#/') location.hash = '#/mapa';
  ruta();
}

async function ruta() {
  if (!perfil) return;
  const id = (location.hash.replace('#/', '') || 'mapa').split('/')[0];
  const v = VISTAS[id] || VISTAS.mapa;
  const nav = NAV.find(n => n.id === id) || NAV[0];
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('activo', a.dataset.id === id);
  $('#t-titulo').textContent = id === 'transferencias' ? (perfil.tipo === 'ALMACEN' ? 'Despachos a sucursales' : 'Recepción de transferencias') : nav.t;
  $('#t-sub').textContent = SUBTITULOS[id] || '';
  $('#side').classList.remove('abierto');
  // Cada navegación pinta en su propio contenedor: una respuesta lenta de otra vista no pisa a la actual.
  const cont = document.createElement("div");
  $("#vista").replaceChildren(cont);
  cargando(cont);
  try { await v(cont); } catch (e) { bloqueo(cont, e); }
}
window.addEventListener('hashchange', ruta);

/* ---------- vistas ---------- */
const ICO_KPI = { money: 'dinero', int: 'boxes', num: 'boxes' };
const COLOR_KPI = { ventas: '', acumulado: 'verde', cobrar: 'acero', saldos: 'acero', bajo: 'rojo', transito: 'morado', despachos: 'morado', productos: 'acero', unidades: '', auditoria: 'morado' };

VISTAS.inicio = async cont => {
  const d = await api('/inicio');
  const max = Math.max(...d.serie.puntos.map(p => p.valor), 1);
  const f = d.serie.formato === 'money' ? fmt.money : fmt.num;
  cont.innerHTML = `
    <div class="grid-kpi">${d.tarjetas.map(t => `
      <div class="kpi ${COLOR_KPI[t.id] || ''} ${t.error ? 'sin' : ''}" ${t.error ? `title="${esc(t.error)}"` : ''}>
        <div class="kpi-cab"><span>${esc(t.titulo)}</span><span class="kpi-ico">${ico(t.id === 'bajo' ? 'alerta' : t.id === 'auditoria' ? 'shield' : t.id.startsWith('transi') || t.id === 'despachos' ? 'truck' : ICO_KPI[t.formato])}</span></div>
        <div class="kpi-val">${t.error ? 'Sin permiso' : (fmt[t.formato] || fmt.num)(t.valor)}</div>
        <div class="kpi-det">${t.error ? 'SQL Server no permite leer este dato a tu perfil' : esc(t.detalle ?? '')}</div>
      </div>`).join('')}</div>
    <div class="dos">
      <div class="panel"><div class="panel-cab"><h3>${esc(d.serie.titulo)}</h3></div><div class="panel-cuerpo">
        ${d.serie.puntos.length ? `<div class="barras">${d.serie.puntos.map(p => `
          <div class="barra"><span class="et" title="${esc(p.etiqueta)}">${esc(p.etiqueta)}</span>
          <div class="pista"><div class="relleno" style="width:${Math.max(2, p.valor / max * 100)}%"></div></div><span class="val">${f(p.valor)}</span></div>`).join('')}</div>`
          : `<div class="vacio">${ico('inbox')}<b>Sin datos</b>Tu perfil no puede leer esta serie o aún no hay registros.</div>`}
      </div></div>
      <div class="panel"><div class="panel-cab"><h3>Tu sesión</h3></div><div class="panel-cuerpo">
        <table><tbody>
          <tr><td class="dim">Usuario SQL</td><td class="mono">${esc(perfil.usuario)}</td></tr>
          <tr><td class="dim">Rol detectado</td><td><b>${esc(perfil.rol_principal)}</b></td></tr>
          <tr><td class="dim">Pertenece a</td><td>${perfil.roles.length ? perfil.roles.map(r => `<code>${esc(r)}</code>`).join(' ') : '<span class="dim">ningún rol del proyecto</span>'}</td></tr>
          <tr><td class="dim">Nodo</td><td>${esc(perfil.nodo)} · ${esc(perfil.nodo_nombre)}</td></tr>
          <tr><td class="dim">Instancia</td><td class="mono">${esc(perfil.servidor)}</td></tr>
          <tr><td class="dim">Base de datos</td><td class="mono">${esc(perfil.base)}</td></tr>
        </tbody></table>
      </div></div>
    </div>`;
};

/* --- Mapa de la empresa y plano de cada unidad --- */
const UNIDADES = {
  CORP: { n: 'Dirección Corporativa', c: 'Managua', host: 'fcn-corp', p: 1437, base: 'BD_FCN_Corporativa', tipo: 'CORPORATIVO', ico: 'building', x: 15, y: 50 },
  ALM: { n: 'Almacén Central', c: 'Managua · Carretera Norte', host: 'fcn-cen', p: 1433, base: 'BD_FCN_Almacen', tipo: 'ALMACEN', ico: 'truck', x: 42, y: 38 },
  CEN: { n: 'Sucursal Central', c: 'Managua', host: 'fcn-cen', p: 1433, base: 'BD_FCN_Central', tipo: 'SUCURSAL', ico: 'home', x: 34, y: 70 },
  NOR: { n: 'Sucursal Norte', c: 'Estelí · ~150 km', host: 'fcn-nor', p: 1434, base: 'BD_FCN_Norte', tipo: 'SUCURSAL', ico: 'home', x: 30, y: 12 },
  SUR: { n: 'Sucursal Sur', c: 'Rivas · ~110 km', host: 'fcn-sur', p: 1435, base: 'BD_FCN_Sur', tipo: 'SUCURSAL', ico: 'home', x: 62, y: 88 },
  EST: { n: 'Sucursal Este', c: 'Juigalpa · ~140 km', host: 'fcn-est', p: 1436, base: 'BD_FCN_Este', tipo: 'SUCURSAL', ico: 'home', x: 79, y: 46 },
};
const CLASE_DATO = {
  local: ['Local', 'Nace y vive en este nodo'],
  copia: ['Copia', 'Copia de solo lectura del catálogo maestro'],
  central: ['Maestro', 'Fuente única: solo se modifica en el corporativo'],
  consol: ['Consolidado', 'Llega de los nodos por los Jobs de consolidación'],
};
const SERVIDOR = u => ({
  t: 'Cuarto de servidor', i: 'server', mod: null, roles: ['DBA del nodo'],
  d: `Instancia <code>${esc(u.host)}</code>, puerto ${u.p}, base <code>${esc(u.base)}</code>. ${u.tipo === 'CORPORATIVO'
    ? 'Aquí corren los Jobs que reciben lo que envían los nodos.'
    : 'Sus Jobs envían al corporativo cada 15 minutos; <code>ControlEnvio</code> evita mandar dos veces lo mismo.'} También tiene su propio respaldo.${u.host === 'fcn-cen' ? ' Central y Almacén comparten esta instancia, pero cada una tiene su base.' : ''}`,
  tablas: u.tipo === 'CORPORATIVO' ? [['ControlConsolidacion', 'local']] : [['ControlEnvio', 'local']],
});
const PLANOS = {
  SUCURSAL: {
    areas: '"anden bodega bodega gerencia" "anden bodega bodega servidor" "sala sala caja credito" "sala sala caja credito"',
    entrada: 'Entrada de clientes',
    salas: {
      anden: { t: 'Recepción de mercadería', i: 'dock', mod: 'transferencias', roles: ['rol_gerente_sucursal'], d: 'Aquí llega el camión del almacén. El gerente confirma lo que de verdad llegó y la existencia sube <b>solo en esta sucursal</b>. Las transferencias en tránsito se leen del corporativo por <code>LS_CORP</code>.', tablas: [['RecepcionTransferencia', 'local'], ['Transferencias en tránsito', 'consol']] },
      bodega: { t: 'Bodega', i: 'boxes', mod: 'inventario', roles: ['rol_vendedor', 'rol_gerente_sucursal'], d: 'El stock propio de la sucursal. Una venta aquí descuenta solo de esta base: las demás sucursales tienen su propia <code>InventarioSucursal</code> en otra instancia, así que no se enteran ni se afectan.', tablas: [['InventarioSucursal', 'local'], ['MovimientoInventario', 'local'], ['Producto', 'copia']] },
      gerencia: { t: 'Gerencia', i: 'shield', mod: 'auditoria', roles: ['rol_gerente_sucursal', 'rol_auditor'], d: 'Anula ventas, confirma recepciones y revisa la bitácora que llenan los triggers del nodo.', tablas: [['BitacoraAuditoria', 'local'], ['Devolucion', 'local']] },
      sala: { t: 'Sala de ventas', i: 'users', mod: 'ventas', roles: ['rol_vendedor'], d: 'El vendedor arma la factura con el catálogo y la lista de precios del cliente, que son copias de solo lectura. La venta queda registrada en la base de esta sucursal, que es donde se origina.', tablas: [['Venta', 'local'], ['DetalleVenta', 'local'], ['Pedido', 'local'], ['Cliente', 'copia'], ['ListaPrecio', 'copia']] },
      caja: { t: 'Caja', i: 'dinero', mod: 'ventas', roles: ['rol_cajero'], d: 'El cajero cobra las ventas de contado que dejó pendientes el vendedor.', tablas: [['Venta', 'local']] },
      credito: { t: 'Crédito y cobranza', i: 'wallet', mod: 'cxc', roles: ['rol_cxc'], d: 'Cuentas por cobrar de los clientes mayoristas de la sucursal y sus abonos.', tablas: [['CuentaPorCobrar', 'local'], ['Pago', 'local']] },
    },
  },
  ALMACEN: {
    areas: '"proveedores estantes estantes oficina" "proveedores estantes estantes servidor" "despacho despacho despacho servidor"',
    entrada: 'Portón de camiones',
    salas: {
      proveedores: { t: 'Andén de proveedores', i: 'dock', mod: null, roles: ['rol_almacen'], d: 'Los proveedores entregan solo aquí, nunca en las sucursales. Se registra la recepción y las diferencias. (Este paso se demuestra desde SSMS; la app no tiene pantalla para él.)', tablas: [['RecepcionProveedor', 'local'], ['DetalleRecepcion', 'local'], ['Proveedor', 'copia']] },
      estantes: { t: 'Estantería central', i: 'boxes', mod: 'inventario', roles: ['rol_almacen'], d: 'Existencias del almacén: un inventario distinto al de cualquier sucursal.', tablas: [['ExistenciaAlmacen', 'local'], ['MovimientoAlmacen', 'local'], ['Producto', 'copia']] },
      oficina: { t: 'Oficina del encargado', i: 'tag', mod: 'catalogo', roles: ['rol_almacen'], d: 'Consulta el catálogo para saber qué recibe y de quién.', tablas: [['Producto', 'copia'], ['UnidadMedida', 'copia']] },
      despacho: { t: 'Zona de despacho', i: 'truck', mod: 'transferencias', roles: ['rol_almacen'], d: 'Se arma la transferencia hacia una sucursal: baja la existencia del almacén y queda <b>en tránsito</b> hasta que la sucursal confirma la recepción.', tablas: [['Transferencia', 'local'], ['DetalleTransferencia', 'local']] },
    },
  },
  CORPORATIVO: {
    areas: '"direccion direccion catalogos" "consolidacion auditoria servidor"',
    entrada: 'Recepción',
    salas: {
      direccion: { t: 'Sala de dirección', i: 'chart', mod: 'reportes', roles: ['rol_gerente_general', 'rol_gerente_sucursal'], d: 'Ve las ventas, existencias y saldos de todas las unidades juntas, con el código de sucursal en cada fila.', tablas: [['Vistas de reportes', 'consol']] },
      catalogos: { t: 'Catálogos maestros', i: 'tag', mod: 'catalogo', roles: ['todos (lectura)'], d: 'La única fuente de productos, clientes, proveedores y precios. Se modifican solo aquí; los nodos tienen copias de solo lectura para poder vender aunque se caiga la conexión.', tablas: [['Producto', 'central'], ['Cliente', 'central'], ['Proveedor', 'central'], ['ListaPrecio', 'central'], ['Sucursal', 'central']] },
      consolidacion: { t: 'Consolidación', i: 'inbox', mod: 'reportes', roles: ['Jobs del Agente SQL'], d: 'Recibe cada 15 minutos lo que envían las sucursales y el almacén. <code>ControlConsolidacion</code> evita duplicados si un envío se repite.', tablas: [['Ventas de todos', 'consol'], ['CxC y pagos', 'consol'], ['Movimientos', 'consol'], ['Transferencias', 'consol']] },
      auditoria: { t: 'Auditoría', i: 'shield', mod: 'auditoria', roles: ['rol_auditor'], d: 'Bitácora de operaciones críticas y cambios de privilegios de todos los nodos.', tablas: [['BitacoraAuditoria', 'consol']] },
    },
  },
};
const chipDato = ([t, c]) => `<span class="dato d-${c}" title="${esc(CLASE_DATO[c][1])}">${esc(t)}</span>`;

VISTAS.mapa = async cont => {
  const cod = (location.hash.split('/')[2] || '').toUpperCase();
  if (UNIDADES[cod]) return planoUnidad(cont, cod);
  const linea = (a, b, cls) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${cls}" vector-effect="non-scaling-stroke"/>`;
  const U = UNIDADES;
  cont.innerHTML = `
    <div class="panel"><div class="panel-cab"><h3>Ferrecentro Nica · 6 unidades, 5 instancias de SQL Server</h3><span class="grow"></span>
      <span class="ley"><i class="l-desp"></i>Despacho de mercadería</span><span class="ley"><i class="l-cons"></i>Consolidación (Job cada 15 min)</span></div>
      <div class="mapa">
        <div class="zona-mga"><span>Managua</span></div>
        <svg class="mapa-lineas" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${['CEN', 'NOR', 'SUR', 'EST'].map(k => linea(U.ALM, U[k], 'desp')).join('')}
          ${['ALM', 'CEN', 'NOR', 'SUR', 'EST'].map(k => linea(U[k], U.CORP, 'cons')).join('')}
        </svg>
        ${Object.entries(U).map(([k, u]) => `
          <a class="unidad t-${u.tipo.toLowerCase()} ${perfil.nodo === k ? 'aqui' : ''}" href="#/mapa/${k}" style="left:${u.x}%;top:${u.y}%">
            ${perfil.nodo === k ? '<em>Tu sesión</em>' : ''}
            <span class="u-ico">${ico(u.ico)}</span>
            <span class="u-txt"><b>${esc(u.n)}</b><small>${esc(u.c)}</small><code>${esc(u.host)}:${u.p}</code></span>
          </a>`).join('')}
      </div>
      <div class="mapa-pie">Haz clic en una unidad para entrar a su plano.</div>
    </div>
    <div class="panel"><div class="panel-cab"><h3>Qué datos están centralizados y cuáles no</h3></div>
      <div class="reparto">
        <div><span class="dato d-central">Centralizado</span><b>Catálogos maestros</b><p>Productos, categorías, unidades, proveedores, clientes, listas de precios y sucursales. Una sola fuente en <code>BD_FCN_Corporativa</code>; cada nodo guarda una copia de solo lectura para seguir vendiendo si se cae la conexión.</p></div>
        <div><span class="dato d-local">Local</span><b>Operación de cada unidad</b><p>Ventas, pedidos, inventario, recepciones, devoluciones, CxC y pagos se registran en la base de la sucursal que los origina. Recepción de proveedores, existencias centrales y despachos, en <code>BD_FCN_Almacen</code>.</p></div>
        <div><span class="dato d-consol">Consolidado</span><b>Visión de la dirección</b><p>Los Jobs copian cada 15 minutos la operación local al corporativo con su <code>CodigoSucursal</code>. Ahí solo se lee para reportes y auditoría; nunca se vende desde el corporativo.</p></div>
      </div>
    </div>`;
};

function planoUnidad(cont, cod) {
  const u = UNIDADES[cod], P = PLANOS[u.tipo];
  const salas = { ...P.salas, servidor: SERVIDOR(u) };
  const propia = perfil.nodo === cod;
  const estado = s => !s.mod ? 'info' : !propia ? 'ajena' : perfil.modulos.includes(s.mod) ? 'mia' : 'bloq';
  cont.innerHTML = `
    <div class="plano-cab">
      <a class="btn btn-fantasma btn-sm" href="#/mapa">${ico('back')} Mapa de la empresa</a>
      <h2>${esc(u.n)} <small>${esc(u.c)}</small></h2>
      <span class="grow"></span>
      <code>${esc(u.host)}:${u.p}</code><code>${esc(u.base)}</code>
      ${propia ? '<span class="badge b-green">Tu sesión está aquí</span>' : '<span class="badge b-gray">Otra instancia</span>'}
    </div>
    ${propia ? '' : `<div class="alerta info">Tu sesión está abierta en <b>${esc(perfil.nodo_nombre)}</b>. ${esc(u.n)} es otra base${u.host === UNIDADES[perfil.nodo]?.host ? ' (en la misma instancia)' : ' en otra instancia de SQL Server'}: lo que hagas en tu unidad no toca sus datos, y para operar aquí hay que entrar con un login de este nodo.</div>`}
    <div class="plano-wrap">
      <div>
        <div class="plano p-${u.tipo.toLowerCase()}" style='grid-template-areas:${P.areas}'>
          ${Object.entries(salas).map(([k, s]) => `
            <button class="sala s-${estado(s)}" data-k="${k}" style="grid-area:${k}">
              <span class="sala-cab"><span class="sala-ico">${ico(s.i)}</span><b>${esc(s.t)}</b>${estado(s) === 'bloq' || estado(s) === 'ajena' ? ico('lock', 'candado') : ''}</span>
              <span class="sala-datos">${s.tablas.slice(0, 3).map(chipDato).join('')}${s.tablas.length > 3 ? `<span class="dato">+${s.tablas.length - 3}</span>` : ''}</span>
            </button>`).join('')}
        </div>
        <div class="entrada">${esc(P.entrada)}</div>
        <div class="leyenda">${Object.entries(CLASE_DATO).map(([c, [t, d]]) => `<span><span class="dato d-${c}">${t}</span>${esc(d)}</span>`).join('')}</div>
      </div>
      <aside class="sala-detalle" id="detalle"><div class="vacio">${ico('map')}<b>Elige un área</b>Haz clic en un cuarto del plano para ver qué datos viven ahí y quién puede usarlos.</div></aside>
    </div>`;

  const det = $('#detalle', cont);
  const mostrar = k => {
    const s = salas[k], e = estado(s);
    for (const b of cont.querySelectorAll('.sala')) b.classList.toggle('sel', b.dataset.k === k);
    const nombreMod = s.mod && (NAV.find(n => n.id === s.mod) || {}).t;
    const accion = {
      mia: `<a class="btn btn-primario btn-bloque" href="#/${s.mod}">Entrar a ${esc(nombreMod)}</a>`,
      bloq: `<div class="alerta">Tu login (<code>${esc(perfil.usuario)}</code>) no tiene un rol para esta área. La app la oculta, pero quien decide es SQL Server.</div>
        <a class="btn btn-peligro btn-bloque" href="#/${s.mod}">${ico('lock')} Intentar entrar de todas formas</a>`,
      ajena: `<div class="alerta info">Esta área es de ${esc(u.n)}. Desde tu sesión en ${esc(perfil.nodo_nombre)} no se puede tocar.</div>
        <button class="btn btn-bloque" id="cambiar">Cerrar sesión y entrar a ${esc(u.n)}</button>`,
      info: '',
    }[e];
    det.innerHTML = `
      <div class="det-cab"><span class="sala-ico">${ico(s.i)}</span><div><h3>${esc(s.t)}</h3><small>${esc(u.n)}</small></div></div>
      <p>${s.d}</p>
      <h4>Quién trabaja aquí</h4><div class="det-roles">${s.roles.map(r => `<code class="${perfil.roles.includes(r) ? 'tengo' : ''}">${esc(r)}</code>`).join('')}</div>
      <h4>Datos de esta área</h4>
      <ul class="det-datos">${s.tablas.map(([t, c]) => `<li><span class="mono">${esc(t)}</span><span class="dato d-${c}">${CLASE_DATO[c][0]}</span></li>`).join('')}</ul>
      ${accion}`;
    const b = $('#cambiar', det);
    if (b) b.onclick = async () => { await api('/logout', { method: 'POST', body: {} }).catch(() => {}); location.hash = ''; mostrarLogin(); $('#l-nodo').value = cod; $('#l-user').focus(); };
  };
  $('.plano', cont).addEventListener('click', e => { const b = e.target.closest('.sala'); if (b) mostrar(b.dataset.k); });
  const inicial = Object.keys(salas).find(k => estado(salas[k]) === 'mia');
  if (inicial) mostrar(inicial);
}

/* --- Ventas --- */
VISTAS.ventas = async cont => {
  const filas = await api('/ventas');
  const A = perfil.acciones;
  const pintar = fs => tabla(cont, [
    { k: 'numero', l: 'Número', t: 'mono' }, { k: 'fecha', l: 'Fecha', t: 'dim' }, { k: 'cliente', l: 'Cliente' },
    { k: 'tipo', l: 'Tipo', t: 'badge' }, { k: 'total', l: 'Total', t: 'money' }, { k: 'estado', l: 'Estado', t: 'badge' }, { k: 'usuario', l: 'Registró', t: 'dim' },
  ], fs, {
    titulo: 'Ventas recientes', vacio: 'Aún no hay ventas en esta sucursal.',
    extraCab: A.includes('crear_venta') ? '<button class="btn btn-primario" id="nv">' + ico('plus') + ' Nueva venta</button>' : '',
    alClic: f => detalleVenta(f, recargar),
    acciones: f => [
      ...(f.estado === 'PENDIENTE' && A.includes('cobrar') ? [{ txt: 'Cobrar', cls: 'btn-ok', fn: () => cobrar(f, recargar) }] : []),
      ...(['PENDIENTE', 'A_CREDITO'].includes(f.estado) && A.includes('anular') ? [{ txt: 'Anular', cls: 'btn-peligro', fn: () => anular(f, recargar) }] : []),
    ],
  });
  const recargar = () => VISTAS.ventas(cont).catch(e => bloqueo(cont, e));
  pintar(filas);
  const b = $('#nv', cont); if (b) b.onclick = () => nuevaVenta(recargar);
};

async function cobrar(f, recargar) {
  if (!await confirmar('Cobrar venta', `¿Cobrar la venta <b>${esc(f.numero)}</b> por <b>${fmt.money(f.total)}</b>?`, 'Cobrar', 'btn-ok')) return;
  try { const r = await api(`/ventas/${f.id}/cobrar`, { method: 'POST', body: {} }); toast('ok', 'Venta cobrada', r.mensaje); recargar(); }
  catch (e) { toast('mal', e.estado === 403 ? 'SQL Server rechazó la operación' : 'No se pudo cobrar', e.message); }
}
async function anular(f, recargar) {
  if (!await confirmar('Anular venta', `¿Anular la venta <b>${esc(f.numero)}</b>? Se devuelve el inventario y queda registrada en la auditoría.`, 'Anular', 'btn-peligro')) return;
  try { const r = await api(`/ventas/${f.id}/anular`, { method: 'POST', body: {} }); toast('ok', 'Venta anulada', r.mensaje); recargar(); }
  catch (e) { toast('mal', e.estado === 403 ? 'SQL Server rechazó la operación' : 'No se pudo anular', e.message); }
}

async function detalleVenta(f, recargar) {
  const m = modal({ titulo: `Venta ${f.numero}`, clase: 'ancho', cuerpo: '<div class="cargando"><div class="spin"></div></div>' });
  try {
    const l = await api(`/ventas/${f.id}/detalle`);
    $('.modal-cuerpo', m.el).innerHTML = `
      <div class="info-cliente"><span class="pildora">Cliente <b>${esc(f.cliente)}</b></span><span class="pildora">Fecha <b>${esc(f.fecha)}</b></span>
        <span class="pildora">${badge(f.tipo)}</span><span class="pildora">${badge(f.estado)}</span></div>
      <div class="lineas"><table><thead><tr><th>#</th><th>Código</th><th>Producto</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Desc.</th><th class="r">Importe</th></tr></thead><tbody>
      ${l.map(x => `<tr><td class="dim">${x.linea}</td><td class="mono">${esc(x.codigo)}</td><td>${esc(x.producto)}</td><td class="r">${fmt.num(x.cantidad)}</td><td class="r">${fmt.money(x.precio)}</td><td class="r">${fmt.money(x.descuento)}</td><td class="r">${fmt.money(x.importe)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="totales"><div><span>Subtotal</span><span>${fmt.money(f.subtotal)}</span></div><div><span>IVA 15 %</span><span>${fmt.money(f.impuesto)}</span></div><div class="gran"><span>Total</span><span>${fmt.money(f.total)}</span></div></div>`;
  } catch (e) { $('.modal-cuerpo', m.el).innerHTML = `<div class="alerta">${esc(e.message)}</div>`; }
}

async function nuevaVenta(recargar) {
  const m = modal({ titulo: 'Nueva venta', clase: 'ancho', cuerpo: '<div class="cargando"><div class="spin"></div></div>' });
  let clientes, productos;
  try { [clientes, productos] = await Promise.all([api('/clientes'), api('/productos')]); }
  catch (e) { $('.modal-cuerpo', m.el).innerHTML = `<div class="alerta">${esc(e.message)}</div>`; return; }
  const lineas = [];
  $('.modal-cuerpo', m.el).innerHTML = `
    <div class="fila2">
      <label class="campo"><span>Cliente</span><select id="v-cli">${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)} · ${esc(c.tipo)}</option>`).join('')}</select></label>
      <label class="campo"><span>Condición de pago</span><select id="v-cond"><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></select></label>
    </div>
    <div class="info-cliente" id="v-info"></div>
    <label class="campo" style="margin-bottom:6px"><span>Agregar producto</span><div id="v-pick"></div></label>
    <div class="lineas"><table><thead><tr><th>Producto</th><th class="r" style="width:110px">Cantidad</th><th class="r">Precio</th><th class="r" style="width:110px">Descuento</th><th class="r">Importe</th><th></th></tr></thead><tbody id="v-lineas"></tbody></table></div>
    <div class="totales" id="v-tot"></div>`;
  $('.modal', m.el).insertAdjacentHTML('beforeend', `<div class="modal-pie"><span class="dim grow" style="font-size:12px">El precio sale de la lista del cliente y el motor valida existencias y crédito.</span><button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primario" id="v-ok">Registrar venta</button></div>`);
  const cli = () => clientes.find(c => c.id === +$('#v-cli', m.el).value);
  const precio = p => (cli().tipo === 'MAYORISTA' ? p.mayorista : p.minorista);
  const refrescar = () => {
    const c = cli();
    const credito = c.tipo === 'MAYORISTA' && c.dias > 0;
    const sel = $('#v-cond', m.el);
    sel.querySelector('[value=CREDITO]').disabled = !credito;
    if (!credito && sel.value === 'CREDITO') sel.value = 'CONTADO';
    $('#v-info', m.el).innerHTML = `<span class="pildora">Lista <b>${esc(c.tipo)}</b></span><span class="pildora">Límite de crédito <b>${fmt.money(c.limite)}</b></span><span class="pildora">Plazo <b>${c.dias} días</b></span>`;
    let sub = 0;
    $('#v-lineas', m.el).innerHTML = lineas.length ? lineas.map((l, i) => {
      const pr = precio(l.p), imp = l.cantidad * (pr ?? 0) - l.descuento; sub += imp;
      const falta = l.p.existencia != null && l.cantidad > l.p.existencia;
      return `<tr><td><span class="mono">${esc(l.p.codigo)}</span> ${esc(l.p.nombre)}<small class="dim"> · ${esc(l.p.unidad)}</small></td>
        <td><input type="number" min="0" step="${l.p.decimales ? '0.001' : '1'}" value="${l.cantidad}" data-c="${i}">${falta ? `<span class="aviso-stock">Existencia: ${fmt.num(l.p.existencia)}</span>` : ''}</td>
        <td class="r">${pr == null ? '<span class="neg">sin precio</span>' : fmt.money(pr)}</td>
        <td><input type="number" min="0" step="0.01" value="${l.descuento}" data-d="${i}"></td><td class="r">${fmt.money(imp)}</td>
        <td><button class="quitar" data-q="${i}" aria-label="Quitar">${ico('x')}</button></td></tr>`;
    }).join('') : `<tr><td colspan="6" class="vacio" style="padding:22px">Busca un producto para agregarlo a la factura.</td></tr>`;
    const iva = Math.round(sub * 15) / 100;
    $('#v-tot', m.el).innerHTML = `<div><span>Subtotal</span><span>${fmt.money(sub)}</span></div><div><span>IVA 15 %</span><span>${fmt.money(iva)}</span></div><div class="gran"><span>Total</span><span>${fmt.money(sub + iva)}</span></div>`;
  };
  selectorProducto($('#v-pick', m.el), productos, {
    detalle: p => `${precio(p) != null ? fmt.money(precio(p)) : 'sin precio'}${p.existencia != null ? ' · exist. ' + fmt.num(p.existencia) : ''}`,
    alElegir: p => { const l = lineas.find(x => x.p.id === p.id); if (l) l.cantidad += 1; else lineas.push({ p, cantidad: 1, descuento: 0 }); refrescar(); },
  });
  $('#v-cli', m.el).onchange = refrescar;
  const tb = $('#v-lineas', m.el);
  tb.addEventListener('change', e => {
    const i = e.target.dataset.c ?? e.target.dataset.d; if (i === undefined) return;
    const v = parseFloat(e.target.value) || 0;
    if (e.target.dataset.c !== undefined) lineas[i].cantidad = v; else lineas[i].descuento = v;
    refrescar();
  });
  tb.addEventListener('click', e => { const q = e.target.closest('[data-q]'); if (q) { lineas.splice(+q.dataset.q, 1); refrescar(); } });
  refrescar();
  $('#v-ok', m.el).onclick = async ev => {
    if (!lineas.length) return m.error('Agrega al menos un producto.');
    ev.target.disabled = true; m.error('');
    try {
      const r = await api('/ventas', { method: 'POST', body: {
        cliente_id: cli().id, condicion: $('#v-cond', m.el).value,
        lineas: lineas.map(l => ({ producto_id: l.p.id, cantidad: l.cantidad, descuento: l.descuento })) } });
      m.cerrar(); toast('ok', 'Venta registrada', r.mensaje); recargar();
    } catch (e) { ev.target.disabled = false; m.error((e.estado === 403 ? 'SQL Server rechazó la operación: ' : '') + e.message); }
  };
}

/* --- Cuentas por cobrar --- */
VISTAS.cxc = async cont => {
  const [cuentas, pagos] = await Promise.all([api('/cxc'), api('/cxc/pagos').catch(() => [])]);
  const A = perfil.acciones;
  const recargar = () => VISTAS.cxc(cont).catch(e => bloqueo(cont, e));
  const abiertas = cuentas.filter(c => c.saldo > 0);
  const total = abiertas.reduce((a, c) => a + c.saldo, 0);
  const vencido = abiertas.filter(c => c.dias_atraso > 0).reduce((a, c) => a + c.saldo, 0);
  cont.innerHTML = `<div class="grid-kpi">
      <div class="kpi acero"><div class="kpi-cab"><span>Saldo pendiente</span><span class="kpi-ico">${ico('dinero')}</span></div><div class="kpi-val">${fmt.money(total)}</div><div class="kpi-det">${abiertas.length} cuentas abiertas</div></div>
      <div class="kpi rojo"><div class="kpi-cab"><span>Vencido</span><span class="kpi-ico">${ico('alerta')}</span></div><div class="kpi-val">${fmt.money(vencido)}</div><div class="kpi-det">${abiertas.filter(c => c.dias_atraso > 0).length} cuentas con atraso</div></div>
      <div class="kpi verde"><div class="kpi-cab"><span>Abonos registrados</span><span class="kpi-ico">${ico('ok')}</span></div><div class="kpi-val">${fmt.money(pagos.reduce((a, p) => a + p.monto, 0))}</div><div class="kpi-det">${pagos.length} pagos recientes</div></div></div>
    <div id="cx-c"></div><div id="cx-p"></div>`;
  tabla($('#cx-c', cont), [
    { k: 'numero', l: 'Cuenta', t: 'mono' }, { k: 'venta', l: 'Venta', t: 'mono' }, { k: 'cliente', l: 'Cliente' }, { k: 'vence', l: 'Vence', t: 'dim' },
    { k: 'monto', l: 'Monto', t: 'money' }, { k: 'saldo', l: 'Saldo', t: 'money' }, { k: 'limite', l: 'Límite', t: 'money' }, { k: 'dias_atraso', l: 'Atraso', t: 'dias' }, { k: 'estado', l: 'Estado', t: 'badge' },
  ], cuentas, {
    titulo: 'Cuentas por cobrar', vacio: 'No hay cuentas por cobrar.',
    acciones: f => f.saldo > 0 && A.includes('pago') ? [{ txt: 'Abonar', cls: 'btn-ok', fn: () => abonar(f, recargar) }] : [],
  });
  tabla($('#cx-p', cont), [
    { k: 'cuenta', l: 'Cuenta', t: 'mono' }, { k: 'fecha', l: 'Fecha', t: 'dim' }, { k: 'monto', l: 'Monto', t: 'money' },
    { k: 'forma', l: 'Forma', t: 'badge' }, { k: 'referencia', l: 'Referencia', t: 'dim' }, { k: 'usuario', l: 'Registró', t: 'dim' },
  ], pagos, { titulo: 'Abonos recientes', vacio: 'Aún no hay abonos.' });
};

function abonar(f, recargar) {
  const m = modal({
    titulo: `Registrar abono · cuenta ${f.numero}`, clase: 'chico',
    cuerpo: `<div class="info-cliente"><span class="pildora">Cliente <b>${esc(f.cliente)}</b></span><span class="pildora">Saldo <b>${fmt.money(f.saldo)}</b></span></div>
      <label class="campo"><span>Monto del abono (C$)</span><input id="a-monto" type="number" min="0.01" max="${f.saldo}" step="0.01" value="${f.saldo}"></label>
      <label class="campo"><span>Forma de pago</span><select id="a-forma"><option>EFECTIVO</option><option>TRANSFERENCIA</option><option>CHEQUE</option><option>TARJETA</option></select></label>
      <label class="campo" style="margin:0"><span>Referencia (opcional)</span><input id="a-ref" maxlength="40" placeholder="N.º de transferencia, cheque o voucher"></label>`,
    pie: '<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-ok" id="a-ok">Registrar abono</button>',
  });
  m.$('#a-ok').onclick = async ev => {
    ev.target.disabled = true; m.error('');
    try {
      const r = await api('/cxc/pagos', { method: 'POST', body: { cuenta_id: f.id, monto: parseFloat(m.$('#a-monto').value), forma: m.$('#a-forma').value, referencia: m.$('#a-ref').value } });
      m.cerrar(); toast('ok', 'Abono registrado', r.mensaje); recargar();
    } catch (e) { ev.target.disabled = false; m.error((e.estado === 403 ? 'SQL Server rechazó la operación: ' : '') + e.message); }
  };
}

/* --- Inventario --- */
VISTAS.inventario = async cont => {
  const filas = await api('/inventario');
  const bajos = filas.filter(f => f.existencia <= f.minimo).length;
  const alm = perfil.tipo === 'ALMACEN';
  tabla(cont, [
    { k: 'codigo', l: 'Código', t: 'mono' }, { k: 'producto', l: 'Producto' }, { k: 'categoria', l: 'Categoría', t: 'dim' }, { k: 'unidad', l: 'Unidad', t: 'dim' },
    { k: 'existencia', l: 'Existencia', t: 'stock' }, { k: 'minimo', l: 'Mínimo', t: 'num' },
    ...(alm ? [{ k: 'ubicacion', l: 'Ubicación', t: 'dim' }] : []), { k: 'actualizado', l: 'Actualizado', t: 'dim' },
  ], filas.map(f => ({ ...f, estado: f.existencia <= f.minimo ? 'BAJO' : 'OK' })), {
    titulo: alm ? 'Existencias del almacén central' : 'Existencias de la sucursal',
    extraCab: bajos ? `<span class="badge b-red">${bajos} bajo mínimo</span>` : '<span class="badge b-green">Todo sobre el mínimo</span>',
  });
};

/* --- Transferencias --- */
VISTAS.transferencias = async cont => {
  const filas = await api('/transferencias');
  const A = perfil.acciones, alm = perfil.tipo === 'ALMACEN';
  const recargar = () => VISTAS.transferencias(cont).catch(e => bloqueo(cont, e));
  tabla(cont, [
    { k: 'numero', l: 'Transferencia', t: 'mono' }, ...(alm ? [{ k: 'destino', l: 'Destino', t: 'mono' }] : []),
    { k: 'despacho', l: 'Despachada', t: 'dim' }, { k: 'recepcion', l: 'Recibida', t: 'dim' },
    { k: 'lineas', l: 'Líneas', t: 'int' }, { k: 'unidades', l: 'Unidades', t: 'num' }, { k: 'estado', l: 'Estado', t: 'badge' }, { k: 'observacion', l: 'Observación', t: 'corto' },
  ], filas, {
    titulo: alm ? 'Transferencias despachadas' : 'Transferencias del almacén hacia esta sucursal',
    vacio: alm ? 'Todavía no se ha despachado ninguna transferencia.' : 'Aún no ha llegado ninguna transferencia (la sincronización corre cada 15 minutos).',
    extraCab: A.includes('despachar') ? `<button class="btn btn-primario" id="nt">${ico('plus')} Nuevo despacho</button>` : '',
    alClic: f => detalleTransferencia(f),
    acciones: f => f.estado === 'EN_TRANSITO' && A.includes('recibir') ? [{ txt: 'Confirmar recepción', cls: 'btn-ok', fn: () => recibir(f, recargar) }] : [],
  });
  const b = $('#nt', cont); if (b) b.onclick = () => despachar(recargar);
};

async function detalleTransferencia(f) {
  const m = modal({ titulo: `Transferencia ${f.numero}`, clase: 'ancho', cuerpo: '<div class="cargando"><div class="spin"></div></div>' });
  try {
    const l = await api(`/transferencias/${f.id}/detalle`);
    $('.modal-cuerpo', m.el).innerHTML = `<div class="info-cliente"><span class="pildora">${badge(f.estado)}</span><span class="pildora">Despachada <b>${esc(f.despacho)}</b></span><span class="pildora">Destino <b>${esc(f.destino)}</b></span></div>
      <div class="lineas"><table><thead><tr><th>#</th><th>Código</th><th>Producto</th><th>Unidad</th><th class="r">Enviada</th><th class="r">Recibida</th></tr></thead><tbody>
      ${l.map(x => `<tr><td class="dim">${x.linea}</td><td class="mono">${esc(x.codigo)}</td><td>${esc(x.producto)}</td><td class="dim">${esc(x.unidad)}</td><td class="r">${fmt.num(x.enviada)}</td><td class="r ${x.recibida != null && x.recibida < x.enviada ? 'neg' : ''}">${x.recibida == null ? '—' : fmt.num(x.recibida)}</td></tr>`).join('')}</tbody></table></div>
      ${f.observacion ? `<p class="dim" style="margin:0">Observación: ${esc(f.observacion)}</p>` : ''}`;
  } catch (e) { $('.modal-cuerpo', m.el).innerHTML = `<div class="alerta">${esc(e.message)}</div>`; }
}

async function recibir(f, recargar) {
  const m = modal({ titulo: `Confirmar recepción ${f.numero}`, clase: 'ancho', cuerpo: '<div class="cargando"><div class="spin"></div></div>' });
  let l;
  try { l = await api(`/transferencias/${f.id}/detalle`); } catch (e) { $('.modal-cuerpo', m.el).innerHTML = `<div class="alerta">${esc(e.message)}</div>`; return; }
  $('.modal-cuerpo', m.el).innerHTML = `<p class="dim" style="margin-top:0">Indica la cantidad que de verdad llegó. Si todo llegó completo, confirma sin cambiar nada.</p>
    <div class="lineas"><table><thead><tr><th>Producto</th><th class="r">Enviada</th><th class="r" style="width:140px">Recibida</th></tr></thead><tbody>
    ${l.map(x => `<tr><td><span class="mono">${esc(x.codigo)}</span> ${esc(x.producto)}</td><td class="r">${fmt.num(x.enviada)} <small class="dim">${esc(x.unidad)}</small></td>
      <td><input type="number" min="0" max="${x.enviada}" step="0.001" value="${x.enviada}" data-l="${x.linea}" data-e="${x.enviada}"></td></tr>`).join('')}</tbody></table></div>`;
  $('.modal', m.el).insertAdjacentHTML('beforeend', '<div class="modal-pie"><button class="btn" data-cerrar>Cancelar</button><button class="btn btn-ok" id="r-ok">Confirmar recepción</button></div>');
  $('#r-ok', m.el).onclick = async ev => {
    const dif = [...m.el.querySelectorAll('input[data-l]')].filter(i => parseFloat(i.value) !== parseFloat(i.dataset.e)).map(i => ({ linea: +i.dataset.l, cantidad: parseFloat(i.value) || 0 }));
    ev.target.disabled = true; m.error('');
    try { const r = await api(`/transferencias/${f.id}/recibir`, { method: 'POST', body: { lineas: dif } }); m.cerrar(); toast('ok', 'Recepción confirmada', r.mensaje); recargar(); }
    catch (e) { ev.target.disabled = false; m.error((e.estado === 403 ? 'SQL Server rechazó la operación: ' : '') + e.message); }
  };
}

async function despachar(recargar) {
  const m = modal({ titulo: 'Nuevo despacho a sucursal', clase: 'ancho', cuerpo: '<div class="cargando"><div class="spin"></div></div>' });
  let productos;
  try { productos = (await api('/productos')).filter(p => p.existencia > 0); } catch (e) { $('.modal-cuerpo', m.el).innerHTML = `<div class="alerta">${esc(e.message)}</div>`; return; }
  const lineas = [];
  $('.modal-cuerpo', m.el).innerHTML = `<div class="fila2">
      <label class="campo"><span>Sucursal destino</span><select id="d-dest"><option value="CEN">Central · CEN</option><option value="NOR">Norte · NOR</option><option value="SUR">Sur · SUR</option><option value="EST">Este · EST</option></select></label>
      <label class="campo"><span>Observación</span><input id="d-obs" maxlength="400" placeholder="p. ej. Reposición semanal"></label></div>
    <label class="campo" style="margin-bottom:6px"><span>Agregar producto</span><div id="d-pick"></div></label>
    <div class="lineas"><table><thead><tr><th>Producto</th><th class="r">Existencia</th><th class="r" style="width:130px">Cantidad</th><th></th></tr></thead><tbody id="d-lineas"></tbody></table></div>`;
  $('.modal', m.el).insertAdjacentHTML('beforeend', '<div class="modal-pie"><button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primario" id="d-ok">Despachar</button></div>');
  const refrescar = () => {
    $('#d-lineas', m.el).innerHTML = lineas.length ? lineas.map((l, i) => `<tr><td><span class="mono">${esc(l.p.codigo)}</span> ${esc(l.p.nombre)}<small class="dim"> · ${esc(l.p.unidad)}</small></td>
      <td class="r ${l.p.existencia != null && l.cantidad > l.p.existencia ? 'neg' : ''}">${fmt.num(l.p.existencia)}</td>
      <td><input type="number" min="0" step="${l.p.decimales ? '0.001' : '1'}" value="${l.cantidad}" data-c="${i}"></td>
      <td><button class="quitar" data-q="${i}" aria-label="Quitar">${ico('x')}</button></td></tr>`).join('')
      : '<tr><td colspan="4" class="vacio" style="padding:22px">Busca un producto para agregarlo al despacho.</td></tr>';
  };
  selectorProducto($('#d-pick', m.el), productos, {
    detalle: p => 'exist. ' + fmt.num(p.existencia),
    alElegir: p => { const l = lineas.find(x => x.p.id === p.id); if (l) l.cantidad += 1; else lineas.push({ p, cantidad: 1 }); refrescar(); },
  });
  const tb = $('#d-lineas', m.el);
  tb.addEventListener('change', e => { if (e.target.dataset.c !== undefined) { lineas[e.target.dataset.c].cantidad = parseFloat(e.target.value) || 0; refrescar(); } });
  tb.addEventListener('click', e => { const q = e.target.closest('[data-q]'); if (q) { lineas.splice(+q.dataset.q, 1); refrescar(); } });
  refrescar();
  $('#d-ok', m.el).onclick = async ev => {
    if (!lineas.length) return m.error('Agrega al menos un producto.');
    ev.target.disabled = true; m.error('');
    try {
      const r = await api('/transferencias', { method: 'POST', body: { destino: $('#d-dest', m.el).value, observacion: $('#d-obs', m.el).value, lineas: lineas.map(l => ({ producto_id: l.p.id, cantidad: l.cantidad })) } });
      m.cerrar(); toast('ok', 'Transferencia despachada', r.mensaje); recargar();
    } catch (e) { ev.target.disabled = false; m.error((e.estado === 403 ? 'SQL Server rechazó la operación: ' : '') + e.message); }
  };
}

/* --- Reportes consolidados (corporativo) --- */
const REPORTES = {
  ventas: { t: 'Ventas por sucursal', cols: [{ k: 'nodo', l: 'Nodo', t: 'mono' }, { k: 'sucursal', l: 'Sucursal' }, { k: 'fecha', l: 'Fecha', t: 'dim' }, { k: 'ventas', l: 'Ventas', t: 'int' }, { k: 'contado', l: 'Contado', t: 'money' }, { k: 'credito', l: 'Crédito', t: 'money' }, { k: 'subtotal', l: 'Subtotal', t: 'money' }, { k: 'impuesto', l: 'IVA', t: 'money' }, { k: 'total', l: 'Total', t: 'money' }] },
  existencias: { t: 'Existencias totales', cols: [{ k: 'codigo', l: 'Código', t: 'mono' }, { k: 'producto', l: 'Producto' }, { k: 'unidad', l: 'Unidad', t: 'dim' }, { k: 'central', l: 'Central', t: 'num' }, { k: 'norte', l: 'Norte', t: 'num' }, { k: 'sur', l: 'Sur', t: 'num' }, { k: 'este', l: 'Este', t: 'num' }, { k: 'almacen', l: 'Almacén', t: 'num' }, { k: 'transito', l: 'En tránsito', t: 'num' }, { k: 'total', l: 'Total', t: 'num' }] },
  saldos: { t: 'Saldos por cobrar', cols: [{ k: 'nodo', l: 'Nodo', t: 'mono' }, { k: 'cuenta', l: 'Cuenta', t: 'mono' }, { k: 'cliente', l: 'Cliente' }, { k: 'venta', l: 'Venta', t: 'mono' }, { k: 'vence', l: 'Vence', t: 'dim' }, { k: 'monto', l: 'Monto', t: 'money' }, { k: 'saldo', l: 'Saldo', t: 'money' }, { k: 'dias_atraso', l: 'Atraso', t: 'dias' }, { k: 'estado', l: 'Estado', t: 'badge' }] },
  transito: { t: 'Transferencias en tránsito', cols: [{ k: 'id', l: 'Transferencia', t: 'mono' }, { k: 'destino', l: 'Destino' }, { k: 'despacho', l: 'Despachada', t: 'dim' }, { k: 'estado', l: 'Estado', t: 'badge' }, { k: 'recepcion', l: 'En la sucursal', t: 'badge' }, { k: 'lineas', l: 'Líneas', t: 'int' }, { k: 'unidades', l: 'Unidades', t: 'num' }, { k: 'horas', l: 'Horas', t: 'int' }] },
};
VISTAS.reportes = async cont => {
  const actual = sessionStorage.getItem('rep') || 'ventas';
  cont.innerHTML = `<div class="tabs">${Object.entries(REPORTES).map(([k, r]) => `<button class="tab ${k === actual ? 'on' : ''}" data-r="${k}">${esc(r.t)}</button>`).join('')}</div><div id="rep"></div>`;
  $('.tabs', cont).onclick = e => { const b = e.target.closest('[data-r]'); if (b) { sessionStorage.setItem('rep', b.dataset.r); VISTAS.reportes(cont).catch(x => bloqueo(cont, x)); } };
  const rep = $('#rep', cont); cargando(rep);
  try {
    const datos = await api('/reportes/' + actual);
    const R = REPORTES[actual];
    const suma = k => datos.reduce((a, f) => a + (+f[k] || 0), 0);
    const pie = actual === 'ventas' ? `<tr class="tr-total"><td colspan="3">Total</td><td class="r">${fmt.int(suma('ventas'))}</td><td class="r">${fmt.money(suma('contado'))}</td><td class="r">${fmt.money(suma('credito'))}</td><td class="r">${fmt.money(suma('subtotal'))}</td><td class="r">${fmt.money(suma('impuesto'))}</td><td class="r">${fmt.money(suma('total'))}</td></tr>`
      : actual === 'saldos' ? `<tr class="tr-total"><td colspan="5">Total por cobrar</td><td class="r">${fmt.money(suma('monto'))}</td><td class="r">${fmt.money(suma('saldo'))}</td><td colspan="2"></td></tr>` : '';
    tabla(rep, R.cols, datos, { titulo: R.t, pie, vacio: 'El corporativo aún no tiene filas de este reporte (los Jobs consolidan cada 15 minutos).' });
  } catch (e) { bloqueo(rep, e); }
};

/* --- Catálogo --- */
VISTAS.catalogo = async cont => {
  const p = await api('/productos');
  const hayPrecio = p.some(x => x.minorista != null), hayStock = p.some(x => x.existencia != null);
  tabla(cont, [
    { k: 'codigo', l: 'Código', t: 'mono' }, { k: 'nombre', l: 'Producto' }, { k: 'categoria', l: 'Categoría', t: 'dim' }, { k: 'unidad', l: 'Unidad', t: 'dim' },
    ...(hayPrecio ? [{ k: 'minorista', l: 'Minorista', t: 'money' }, { k: 'mayorista', l: 'Mayorista', t: 'money' }] : []),
    ...(hayStock ? [{ k: 'existencia', l: perfil.tipo === 'ALMACEN' ? 'Existencia (almacén)' : 'Existencia', t: 'stock' }] : []),
  ], p, { titulo: 'Catálogo de productos' });
};

/* --- Auditoría --- */
VISTAS.auditoria = async cont => {
  const filas = await api('/auditoria');
  tabla(cont, [
    { k: 'id', l: '#', t: 'dim' }, { k: 'nodo', l: 'Nodo', t: 'mono' }, { k: 'fecha', l: 'Fecha', t: 'dim' }, { k: 'usuario', l: 'Usuario' },
    { k: 'objeto', l: 'Objeto', t: 'mono' }, { k: 'operacion', l: 'Operación', t: 'badge' }, { k: 'llave', l: 'Llave', t: 'dim' }, { k: 'anterior', l: 'Antes', t: 'corto' }, { k: 'nuevo', l: 'Después', t: 'corto' },
  ], filas, { titulo: perfil.tipo === 'CORPORATIVO' ? 'Bitácora consolidada de auditoría' : 'Bitácora de auditoría del nodo', vacio: 'La bitácora está vacía.' });
};

/* ---------- arranque ---------- */
$('#l-ver').onclick = e => { const i = $('#l-pass'); const v = i.type === 'password'; i.type = v ? 'text' : 'password'; e.target.textContent = v ? 'Ocultar' : 'Ver'; };
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('#l-enviar'), err = $('#l-error');
  b.disabled = true; b.textContent = 'Conectando…'; err.classList.add('hidden');
  try {
    const p = await api('/login', { method: 'POST', body: { nodo: $('#l-nodo').value, usuario: $('#l-user').value, clave: $('#l-pass').value } });
    $('#l-pass').value = ''; location.hash = '#/mapa'; entrar(p);
  } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
  finally { b.disabled = false; b.textContent = 'Ingresar'; }
});
$('#salir').onclick = async () => { await api('/logout', { method: 'POST', body: {} }).catch(() => {}); location.hash = ''; mostrarLogin(); };
$('#menu-btn').onclick = () => $('#side').classList.toggle('abierto');
(async () => { try { entrar(await api('/perfil')); } catch { mostrarLogin(); } })();
