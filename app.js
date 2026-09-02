import { firebaseConfig, ADMIN_PASSCODE } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot, query, where,
  setDoc, addDoc, deleteDoc, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const statusLine = document.getElementById('statusLine');
function setStatus(text, kind) {
  statusLine.textContent = text;
  statusLine.className = 'status-line' + (kind ? ' ' + kind : '');
}

// ---------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];
// Encabezado de dias, empezando el lunes (convencion local).
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

function initials(nombre) {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------
// Estado
// ---------------------------------------------------------------
const today = new Date();
let state = {
  anio: today.getFullYear(),
  mes: today.getMonth() + 1,
  personas: [],           // [{id, nombre, orden}]
  marcasPresencial: {},   // { personaId: [dias...] }
  marcasRemoto: {},       // { personaId: [dias...] }
  feriados: {},           // { "mes-dia": {nombre} } para el anio actual
  valores: { racionamiento: 0, movilidad: 0 },
  isAdmin: sessionStorage.getItem('isAdmin') === 'true'
};

let unsubPersonas = null;
let unsubPresencial = null;
let unsubRemoto = null;
let unsubValores = null;
let unsubFeriados = null;

// ---------------------------------------------------------------
// Selectores de periodo
// ---------------------------------------------------------------
const monthSelect = document.getElementById('monthSelect');
const yearSelect = document.getElementById('yearSelect');

MESES.forEach((nombre, i) => {
  const opt = document.createElement('option');
  opt.value = i + 1;
  opt.textContent = nombre;
  monthSelect.appendChild(opt);
});
monthSelect.value = state.mes;

const yearStart = today.getFullYear() - 1;
for (let y = yearStart; y <= yearStart + 4; y++) {
  const opt = document.createElement('option');
  opt.value = y;
  opt.textContent = y;
  yearSelect.appendChild(opt);
}
yearSelect.value = state.anio;

monthSelect.addEventListener('change', () => {
  state.mes = Number(monthSelect.value);
  subscribeToPeriod();
});
yearSelect.addEventListener('change', () => {
  state.anio = Number(yearSelect.value);
  subscribeToPeriod();
  subscribeFeriados();
  if (currentTab === 'resumen') loadResumen();
});

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
let currentTab = 'presencial';
document.getElementById('tabNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  currentTab = btn.dataset.tab;
  document.getElementById('panel-' + currentTab).classList.add('active');
  if (currentTab === 'resumen') loadResumen();
});

// ---------------------------------------------------------------
// Suscripciones a Firestore
// ---------------------------------------------------------------
function mesId() { return String(state.mes).padStart(2, '0'); }

function subscribeToPeriod() {
  if (unsubPresencial) unsubPresencial();
  if (unsubRemoto) unsubRemoto();
  if (unsubValores) unsubValores();

  const qPres = query(collection(db, 'marcas'),
    where('anio', '==', state.anio), where('mes', '==', state.mes), where('tipo', '==', 'presencial'));
  unsubPresencial = onSnapshot(qPres, (snap) => {
    state.marcasPresencial = {};
    snap.forEach(d => { state.marcasPresencial[d.data().personaId] = d.data().dias || []; });
    renderAll();
  }, (err) => setStatus('Error leyendo presencialidad: ' + err.message, 'error'));

  const qRem = query(collection(db, 'marcas'),
    where('anio', '==', state.anio), where('mes', '==', state.mes), where('tipo', '==', 'remoto'));
  unsubRemoto = onSnapshot(qRem, (snap) => {
    state.marcasRemoto = {};
    snap.forEach(d => { state.marcasRemoto[d.data().personaId] = d.data().dias || []; });
    renderAll();
  }, (err) => setStatus('Error leyendo remoto: ' + err.message, 'error'));

  const valoresRef = doc(db, 'valoresMensuales', `${state.anio}_${mesId()}`);
  unsubValores = onSnapshot(valoresRef, (snap) => {
    state.valores = snap.exists() ? snap.data() : { racionamiento: 0, movilidad: 0 };
    document.getElementById('racionamientoDisplay').textContent = formatMoney(state.valores.racionamiento || 0);
    document.getElementById('movilidadDisplay').textContent = formatMoney(state.valores.movilidad || 0);
    document.getElementById('racionamientoInput').value = state.valores.racionamiento || 0;
    document.getElementById('movilidadInput').value = state.valores.movilidad || 0;
    renderAll();
  }, (err) => setStatus('Error leyendo valores del mes: ' + err.message, 'error'));
}

function subscribeFeriados() {
  if (unsubFeriados) unsubFeriados();
  const q = query(collection(db, 'feriados'), where('anio', '==', state.anio));
  unsubFeriados = onSnapshot(q, (snap) => {
    const map = {};
    snap.forEach(d => {
      const data = d.data();
      map[`${data.mes}-${data.dia}`] = { id: d.id, nombre: data.nombre || '' };
    });
    state.feriados = map;
    document.getElementById('feriadosYearLabel').textContent = state.anio;
    renderAll();
    renderFeriadoAdminList();
  }, (err) => setStatus('Error leyendo feriados: ' + err.message, 'error'));
}

function subscribePersonas() {
  unsubPersonas = onSnapshot(collection(db, 'personas'), (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
    state.personas = list;
    renderAll();
    renderPersonAdminList();
    setStatus('Conectado', 'ok');
  }, (err) => setStatus('Error de conexión: ' + err.message, 'error'));
}

function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR');
}

function renderAll() {
  renderCalendar('presencial');
  renderCalendar('remoto');
  renderSummary('presencial');
  renderSummary('remoto');
}

// ---------------------------------------------------------------
// Calendario mensual (semanas x 7 dias) con chips por persona
// ---------------------------------------------------------------
function renderCalendar(tipo) {
  const wrap = document.getElementById(tipo === 'presencial' ? 'calendarPresencial' : 'calendarRemoto');
  const emptyState = document.getElementById(tipo === 'presencial' ? 'emptyPresencial' : 'emptyRemoto');

  if (!state.personas.length) {
    wrap.style.display = 'none';
    emptyState.hidden = false;
    return;
  }
  wrap.style.display = '';
  emptyState.hidden = true;

  const marcas = tipo === 'presencial' ? state.marcasPresencial : state.marcasRemoto;
  const nDias = diasEnMes(state.anio, state.mes);
  const firstOfMonth = new Date(state.anio, state.mes - 1, 1);
  const leadingBlank = (firstOfMonth.getDay() + 6) % 7; // 0 = lunes
  const totalCells = Math.ceil((leadingBlank + nDias) / 7) * 7;

  wrap.innerHTML = '';

  const weekdaysEl = document.createElement('div');
  weekdaysEl.className = 'calendar-weekdays';
  DIAS_SEMANA.forEach(d => {
    const div = document.createElement('div');
    div.textContent = d;
    weekdaysEl.appendChild(div);
  });
  wrap.appendChild(weekdaysEl);

  const daysEl = document.createElement('div');
  daysEl.className = 'calendar-days';

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - leadingBlank + 1;
    const tile = document.createElement('div');

    if (dayNum < 1 || dayNum > nDias) {
      tile.className = 'day-tile pad';
      daysEl.appendChild(tile);
      continue;
    }

    const feriado = state.feriados[`${state.mes}-${dayNum}`];
    tile.className = 'day-tile' + (feriado ? ' holiday' : '');

    const numEl = document.createElement('div');
    numEl.className = 'day-num';
    numEl.textContent = dayNum;
    tile.appendChild(numEl);

    if (feriado) {
      const tag = document.createElement('div');
      tag.className = 'holiday-tag';
      tag.textContent = feriado.nombre ? `Feriado · ${feriado.nombre}` : 'Feriado';
      tile.appendChild(tag);
    }

    const chipRow = document.createElement('div');
    chipRow.className = 'chip-row';
    state.personas.forEach(p => {
      const diasMarcados = marcas[p.id] || [];
      const marked = diasMarcados.includes(dayNum);
      const chip = document.createElement('div');
      chip.className = 'chip tipo-' + tipo + (marked ? ' chip-on' : '') + (feriado ? ' chip-disabled' : '');
      chip.textContent = initials(p.nombre);
      chip.title = p.nombre + (feriado ? ' — no disponible en feriado' : '');
      if (!feriado) {
        chip.addEventListener('click', () => toggleDia(tipo, p.id, dayNum, diasMarcados));
      }
      chipRow.appendChild(chip);
    });
    tile.appendChild(chipRow);

    daysEl.appendChild(tile);
  }

  wrap.appendChild(daysEl);
}

async function toggleDia(tipo, personaId, dia, diasActuales) {
  const nuevo = diasActuales.includes(dia)
    ? diasActuales.filter(d => d !== dia)
    : [...diasActuales, dia].sort((a, b) => a - b);
  const ref = doc(db, 'marcas', `${personaId}_${state.anio}_${mesId()}_${tipo}`);
  try {
    await setDoc(ref, {
      personaId, anio: state.anio, mes: state.mes, tipo, dias: nuevo
    });
  } catch (err) {
    showToast('No se pudo guardar: ' + err.message);
  }
}

// ---------------------------------------------------------------
// Tabla resumen del mes (sin fila de total general)
// ---------------------------------------------------------------
function renderSummary(tipo) {
  const table = document.getElementById(tipo === 'presencial' ? 'summaryPresencial' : 'summaryRemoto');
  if (!state.personas.length) { table.innerHTML = ''; return; }

  const marcas = tipo === 'presencial' ? state.marcasPresencial : state.marcasRemoto;
  let html = '<thead><tr><th>Persona</th><th>Días</th>' +
    (tipo === 'presencial' ? '<th>Total $</th>' : '') + '</tr></thead><tbody>';

  state.personas.forEach(p => {
    const cantidad = (marcas[p.id] || []).length;
    html += `<tr><td>${escapeHtml(p.nombre)}</td><td class="num">${cantidad}</td>`;
    if (tipo === 'presencial') {
      const total = (Number(state.valores.racionamiento || 0) + Number(state.valores.movilidad || 0)) * cantidad;
      html += `<td class="num">${formatMoney(total)}</td>`;
    }
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------
// Valores mensuales (racionamiento / movilidad) - solo admin
// ---------------------------------------------------------------
document.getElementById('saveValuesBtn').addEventListener('click', async () => {
  const rac = Number(document.getElementById('racionamientoInput').value) || 0;
  const mov = Number(document.getElementById('movilidadInput').value) || 0;
  try {
    await setDoc(doc(db, 'valoresMensuales', `${state.anio}_${mesId()}`), {
      racionamiento: rac, movilidad: mov, anio: state.anio, mes: state.mes
    });
    showToast('Valores guardados');
  } catch (err) {
    showToast('No se pudo guardar: ' + err.message);
  }
});

// ---------------------------------------------------------------
// Resumen anual
// ---------------------------------------------------------------
async function loadResumen() {
  document.getElementById('resumenYear1').textContent = state.anio;
  document.getElementById('resumenYear2').textContent = state.anio;

  const [marcasSnap, valoresSnap] = await Promise.all([
    getDocs(query(collection(db, 'marcas'), where('anio', '==', state.anio))),
    getDocs(query(collection(db, 'valoresMensuales'), where('anio', '==', state.anio)))
  ]);

  const valoresPorMes = {};
  valoresSnap.forEach(d => { valoresPorMes[d.data().mes] = d.data(); });

  const diasPorPersonaMes = {}; // personaId -> { presencial: {mes: count}, remoto: {mes: count} }
  marcasSnap.forEach(d => {
    const data = d.data();
    const pid = data.personaId;
    diasPorPersonaMes[pid] = diasPorPersonaMes[pid] || { presencial: {}, remoto: {} };
    diasPorPersonaMes[pid][data.tipo][data.mes] = (data.dias || []).length;
  });

  renderResumenTable('resumenMoney', true, valoresPorMes, diasPorPersonaMes);
  renderResumenTable('resumenRemoto', false, valoresPorMes, diasPorPersonaMes);
}

function renderResumenTable(tableId, esDinero, valoresPorMes, diasPorPersonaMes) {
  const table = document.getElementById(tableId);
  table.innerHTML = '';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.innerHTML = '<th class="col-name">Persona</th>' +
    MESES.map(m => `<th>${m.slice(0, 3)}</th>`).join('') +
    `<th>Total año</th>`;
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  state.personas.forEach(p => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'col-name';
    tdName.textContent = p.nombre;
    tr.appendChild(tdName);

    let totalPersona = 0;
    for (let m = 1; m <= 12; m++) {
      const registro = diasPorPersonaMes[p.id] || { presencial: {}, remoto: {} };
      let valor;
      if (esDinero) {
        const cant = registro.presencial[m] || 0;
        const vm = valoresPorMes[m] || { racionamiento: 0, movilidad: 0 };
        valor = (Number(vm.racionamiento || 0) + Number(vm.movilidad || 0)) * cant;
      } else {
        valor = registro.remoto[m] || 0;
      }
      totalPersona += valor;
      const td = document.createElement('td');
      td.className = esDinero ? 'amount' : 'days';
      td.textContent = esDinero ? formatMoney(valor) : valor;
      tr.appendChild(td);
    }
    const tdTotal = document.createElement('td');
    tdTotal.className = esDinero ? 'amount' : 'days';
    tdTotal.textContent = esDinero ? formatMoney(totalPersona) : totalPersona;
    tr.appendChild(tdTotal);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

// ---------------------------------------------------------------
// Admin: passcode, agregar/quitar personas, feriados
// ---------------------------------------------------------------
function applyAdminState() {
  document.body.classList.toggle('admin-mode', state.isAdmin);
  document.getElementById('adminLock').hidden = state.isAdmin;
  document.getElementById('adminPanel').hidden = !state.isAdmin;
}
applyAdminState();

document.getElementById('adminUnlockBtn').addEventListener('click', () => {
  const val = document.getElementById('adminPasscode').value;
  const errorEl = document.getElementById('adminError');
  if (val === ADMIN_PASSCODE) {
    state.isAdmin = true;
    sessionStorage.setItem('isAdmin', 'true');
    errorEl.hidden = true;
    document.getElementById('adminPasscode').value = '';
    applyAdminState();
    renderAll();
  } else {
    errorEl.hidden = false;
  }
});

document.getElementById('adminLockBtn').addEventListener('click', () => {
  state.isAdmin = false;
  sessionStorage.removeItem('isAdmin');
  applyAdminState();
  renderAll();
});

document.getElementById('addPersonForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('newPersonName');
  const nombre = input.value.trim();
  if (!nombre) return;
  try {
    await addDoc(collection(db, 'personas'), {
      nombre, orden: state.personas.length, creadoEn: serverTimestamp()
    });
    input.value = '';
    showToast('Persona agregada');
  } catch (err) {
    showToast('No se pudo agregar: ' + err.message);
  }
});

function renderPersonAdminList() {
  const ul = document.getElementById('personList');
  ul.innerHTML = '';
  state.personas.forEach(p => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = p.nombre;
    const btn = document.createElement('button');
    btn.textContent = 'Quitar';
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Quitar a ${p.nombre}? Sus marcas ya cargadas no se borran.`)) return;
      try {
        await deleteDoc(doc(db, 'personas', p.id));
        showToast('Persona quitada');
      } catch (err) {
        showToast('No se pudo quitar: ' + err.message);
      }
    });
    li.appendChild(span);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

document.getElementById('addFeriadoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dateInput = document.getElementById('newFeriadoDate');
  const nameInput = document.getElementById('newFeriadoName');
  if (!dateInput.value) return;
  const [anioStr, mesStr, diaStr] = dateInput.value.split('-');
  const anio = Number(anioStr), mes = Number(mesStr), dia = Number(diaStr);
  try {
    await setDoc(doc(db, 'feriados', `${anio}_${mesStr}_${diaStr}`), {
      anio, mes, dia, nombre: nameInput.value.trim(), creadoEn: serverTimestamp()
    });
    dateInput.value = '';
    nameInput.value = '';
    showToast('Feriado agregado');
    if (anio !== state.anio) {
      showToast(`Guardado. Cambiá el selector de Año a ${anio} para verlo.`);
    }
  } catch (err) {
    showToast('No se pudo agregar: ' + err.message);
  }
});

function renderFeriadoAdminList() {
  const ul = document.getElementById('feriadoList');
  ul.innerHTML = '';
  const entries = Object.entries(state.feriados)
    .map(([key, val]) => {
      const [mes, dia] = key.split('-').map(Number);
      return { mes, dia, ...val };
    })
    .sort((a, b) => a.mes - b.mes || a.dia - b.dia);

  if (!entries.length) {
    const li = document.createElement('li');
    li.textContent = `Todavía no hay feriados cargados para ${state.anio}.`;
    li.style.color = 'var(--ink-soft)';
    li.style.background = 'transparent';
    li.style.border = 'none';
    ul.appendChild(li);
    return;
  }

  entries.forEach(f => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    const fecha = `${String(f.dia).padStart(2, '0')}/${String(f.mes).padStart(2, '0')}`;
    span.innerHTML = `<span class="feriado-date">${fecha}</span>${escapeHtml(f.nombre || 'Feriado')}`;
    const btn = document.createElement('button');
    btn.textContent = 'Quitar';
    btn.addEventListener('click', async () => {
      try {
        await deleteDoc(doc(db, 'feriados', f.id));
        showToast('Feriado quitado');
      } catch (err) {
        showToast('No se pudo quitar: ' + err.message);
      }
    });
    li.appendChild(span);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// ---------------------------------------------------------------
// Toast
// ---------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------
setStatus('Conectando…');
subscribePersonas();
subscribeToPeriod();
subscribeFeriados();
