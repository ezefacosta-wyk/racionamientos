import { firebaseConfig, ADMIN_PASSCODE } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot, query, where,
  setDoc, addDoc, deleteDoc, getDocs, serverTimestamp, deleteField
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

// Opciones de marca de presencialidad. EZE y BOU cuentan para el total;
// C, F y V se registran pero no suman dias ni monto.
const TIPOS_PRESENCIAL = [
  { code: 'EZE', label: 'Ezeiza', cuenta: true },
  { code: 'BOU', label: 'Bouchard', cuenta: true },
  { code: 'C', label: 'Comisión', cuenta: false },
  { code: 'F', label: 'Falta', cuenta: false },
  { code: 'V', label: 'Vacaciones', cuenta: false }
];
const TIPO_DEFAULT = 'EZE';
function cuentaParaTotal(code) {
  const t = TIPOS_PRESENCIAL.find(t => t.code === code);
  return t ? t.cuenta : false;
}

function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

function initials(nombre) {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------
// Estado
// ---------------------------------------------------------------
const today = new Date();
let state = {
  anio: today.getFullYear(),
  mes: today.getMonth() + 1,
  personas: [],             // [{id, nombre, orden}]
  marcasPresencial: {},     // { personaId: { dias: {"5":"EZE",...}, notas: {"5":"texto",...} } }
  marcasRemoto: {},         // { personaId: [dias...] }
  feriados: {},             // { "mes-dia": {id, nombre} } para el anio actual
  valores: { racionamiento: 0, movilidad: 0 },
  isAdmin: sessionStorage.getItem('isAdmin') === 'true',
  vista: localStorage.getItem('vistaPreferida') || 'calendario',
  selectMode: { presencial: false, remoto: false },
  selection: { presencial: new Set(), remoto: new Set() } // "personaId|dia"
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
// Toggle de vista (Calendario / Horizontal)
// ---------------------------------------------------------------
function applyViewState() {
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.vista));
  const esCal = state.vista === 'calendario';
  document.getElementById('calendarViewPresencial').hidden = !esCal;
  document.getElementById('horizontalViewPresencial').hidden = esCal;
  document.getElementById('calendarViewRemoto').hidden = !esCal;
  document.getElementById('horizontalViewRemoto').hidden = esCal;
  document.getElementById('summaryWrapPresencial').hidden = !esCal;
  document.getElementById('summaryWrapRemoto').hidden = !esCal;
}
document.getElementById('viewToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.view-btn');
  if (!btn) return;
  state.vista = btn.dataset.view;
  localStorage.setItem('vistaPreferida', state.vista);
  applyViewState();
  renderAll();
});
applyViewState();

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
    snap.forEach(d => {
      const data = d.data();
      state.marcasPresencial[data.personaId] = { dias: data.dias || {}, notas: data.notas || {} };
    });
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
    list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
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
  if (state.vista === 'calendario') {
    renderCalendar('presencial');
    renderCalendar('remoto');
  } else {
    renderHorizontal('presencial');
    renderHorizontal('remoto');
  }
  renderSummary('presencial');
  renderSummary('remoto');
}

// ---------------------------------------------------------------
// Helpers de conteo
// ---------------------------------------------------------------
function diasQueCuentanPresencial(mapaDias) {
  return Object.values(mapaDias || {}).filter(code => cuentaParaTotal(code)).length;
}

function getRegistroPresencial(personaId) {
  return state.marcasPresencial[personaId] || { dias: {}, notas: {} };
}

// ---------------------------------------------------------------
// Vista Calendario (semanas x 7 dias) con chips por persona
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
    const weekdayIdx = (new Date(state.anio, state.mes - 1, dayNum).getDay() + 6) % 7; // 0=Lun ... 6=Dom
    const esFinde = weekdayIdx === 5 || weekdayIdx === 6;
    tile.className = 'day-tile' + (esFinde ? ' weekend' : '') + (feriado ? ' holiday' : '');

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
      const chip = document.createElement('div');
      let marked, code;
      if (tipo === 'presencial') {
        const registro = getRegistroPresencial(p.id);
        code = registro.dias[dayNum];
        const nota = registro.notas[dayNum];
        marked = !!code;
        chip.className = 'chip' + (marked ? ' chip-on mark-' + code : '') + (nota ? ' has-note' : '') + (feriado ? ' chip-disabled' : '');
        chip.textContent = initials(p.nombre);
        chip.title = p.nombre + (marked ? ' — ' + code : '') + (nota ? ' — Nota: ' + nota : '') + (feriado ? ' — no disponible en feriado' : '');
      } else {
        const diasMarcados = state.marcasRemoto[p.id] || [];
        marked = diasMarcados.includes(dayNum);
        chip.className = 'chip tipo-remoto' + (marked ? ' chip-on' : '') + (feriado ? ' chip-disabled' : '');
        chip.textContent = initials(p.nombre);
        chip.title = p.nombre + (feriado ? ' — no disponible en feriado' : '');
      }
      if (!feriado) {
        chip.addEventListener('click', () => handleMarkClick(tipo, p, dayNum));
      }
      chipRow.appendChild(chip);
    });
    tile.appendChild(chipRow);

    daysEl.appendChild(tile);
  }

  wrap.appendChild(daysEl);
}

// ---------------------------------------------------------------
// Vista Horizontal (tabla: persona x dias 1..N)
// ---------------------------------------------------------------
function renderHorizontal(tipo) {
  const head = document.getElementById(tipo === 'presencial' ? 'headPresencial' : 'headRemoto');
  const body = document.getElementById(tipo === 'presencial' ? 'bodyPresencial' : 'bodyRemoto');
  const emptyState = document.getElementById(tipo === 'presencial' ? 'emptyPresencial' : 'emptyRemoto');
  const view = document.getElementById(tipo === 'presencial' ? 'horizontalViewPresencial' : 'horizontalViewRemoto');

  if (!state.personas.length) {
    view.style.display = 'none';
    emptyState.hidden = false;
    return;
  }
  view.style.display = '';
  emptyState.hidden = true;
  renderSelectionToolbar(tipo);

  const nDias = diasEnMes(state.anio, state.mes);

  head.innerHTML = '';
  const thName = document.createElement('th');
  thName.className = 'col-name';
  thName.textContent = 'Persona';
  head.appendChild(thName);
  for (let d = 1; d <= nDias; d++) {
    const th = document.createElement('th');
    const weekdayIdx = (new Date(state.anio, state.mes - 1, d).getDay() + 6) % 7;
    const weekday = DIAS_SEMANA[weekdayIdx];
    if (weekdayIdx === 5 || weekdayIdx === 6) th.classList.add('weekend');
    th.innerHTML = `<span class="weekday">${weekday}</span>${d}`;
    head.appendChild(th);
  }
  const thDias = document.createElement('th');
  thDias.textContent = 'Días';
  head.appendChild(thDias);
  if (tipo === 'presencial') {
    const thTotal = document.createElement('th');
    thTotal.textContent = 'Total $';
    head.appendChild(thTotal);
  }

  body.innerHTML = '';
  state.personas.forEach(p => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'col-name';
    tdName.textContent = p.nombre;
    tr.appendChild(tdName);

    const registroPresencial = tipo === 'presencial' ? getRegistroPresencial(p.id) : null;
    const mapaDias = tipo === 'presencial' ? registroPresencial.dias : null;
    const mapaNotas = tipo === 'presencial' ? registroPresencial.notas : null;
    const diasMarcadosRemoto = tipo === 'remoto' ? (state.marcasRemoto[p.id] || []) : null;

    for (let d = 1; d <= nDias; d++) {
      const td = document.createElement('td');
      td.className = 'day-cell';
      const weekdayIdx = (new Date(state.anio, state.mes - 1, d).getDay() + 6) % 7;
      if (weekdayIdx === 5 || weekdayIdx === 6) td.classList.add('weekend');
      const feriado = state.feriados[`${state.mes}-${d}`];
      if (feriado) {
        td.classList.add('holiday-cell');
        td.title = 'Feriado' + (feriado.nombre ? ' — ' + feriado.nombre : '');
      } else if (tipo === 'presencial') {
        const code = mapaDias[d];
        const nota = mapaNotas[d];
        if (code) { td.classList.add('mark-' + code); td.textContent = code; }
        if (nota) { td.classList.add('has-note'); td.title = 'Nota: ' + nota; }
        if (state.selection.presencial.has(p.id + '|' + d)) td.classList.add('cell-selected');
        td.addEventListener('click', () => {
          if (state.selectMode.presencial) toggleCellSelection('presencial', p.id, d, td);
          else handleMarkClick(tipo, p, d);
        });
      } else {
        const marked = diasMarcadosRemoto.includes(d);
        if (marked) { td.classList.add('mark-remoto'); td.textContent = 'X'; }
        if (state.selection.remoto.has(p.id + '|' + d)) td.classList.add('cell-selected');
        td.addEventListener('click', () => {
          if (state.selectMode.remoto) toggleCellSelection('remoto', p.id, d, td);
          else handleMarkClick(tipo, p, d);
        });
      }
      tr.appendChild(td);
    }

    const cantidad = tipo === 'presencial' ? diasQueCuentanPresencial(mapaDias) : diasMarcadosRemoto.length;
    const tdDias = document.createElement('td');
    tdDias.className = 'col-total';
    tdDias.textContent = cantidad;
    tr.appendChild(tdDias);

    if (tipo === 'presencial') {
      const total = (Number(state.valores.racionamiento || 0) + Number(state.valores.movilidad || 0)) * cantidad;
      const tdTotal = document.createElement('td');
      tdTotal.className = 'col-total';
      tdTotal.textContent = formatMoney(total);
      tr.appendChild(tdTotal);
    }

    body.appendChild(tr);
  });
}

// ---------------------------------------------------------------
// Selección múltiple (solo vista horizontal)
// ---------------------------------------------------------------
function renderSelectionToolbar(tipo) {
  const bar = document.getElementById(tipo === 'presencial' ? 'selectionToolbarPresencial' : 'selectionToolbarRemoto');
  if (!bar) return;
  bar.innerHTML = '';

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'btn-select-mode' + (state.selectMode[tipo] ? ' active' : '');
  modeBtn.textContent = state.selectMode[tipo] ? 'Cancelar selección' : 'Seleccionar varios días';
  modeBtn.addEventListener('click', () => {
    if (state.selectMode[tipo]) exitSelectMode(tipo);
    else {
      state.selectMode[tipo] = true;
      state.selection[tipo].clear();
      renderSelectionToolbar(tipo);
      renderHorizontal(tipo);
    }
  });
  bar.appendChild(modeBtn);

  if (!state.selectMode[tipo]) return;

  const count = state.selection[tipo].size;
  const countEl = document.createElement('span');
  countEl.className = 'selection-count';
  countEl.textContent = count ? `${count} día${count === 1 ? '' : 's'} seleccionado${count === 1 ? '' : 's'}` : 'Tocá los días a marcar';
  bar.appendChild(countEl);

  if (!count) return;

  if (tipo === 'presencial') {
    const typesWrap = document.createElement('div');
    typesWrap.className = 'selection-types';
    TIPOS_PRESENCIAL.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bulk-type-btn opt-' + t.code;
      btn.textContent = t.code;
      btn.title = t.label;
      btn.addEventListener('click', () => applySelectionPresencial(t.code));
      typesWrap.appendChild(btn);
    });
    bar.appendChild(typesWrap);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove-mark';
    removeBtn.textContent = 'Quitar marca';
    removeBtn.addEventListener('click', () => applySelectionPresencial(null));
    bar.appendChild(removeBtn);
  } else {
    const markBtn = document.createElement('button');
    markBtn.type = 'button';
    markBtn.className = 'bulk-type-btn opt-remoto';
    markBtn.textContent = 'Marcar remoto';
    markBtn.addEventListener('click', () => applySelectionRemoto('mark'));
    bar.appendChild(markBtn);

    const unmarkBtn = document.createElement('button');
    unmarkBtn.type = 'button';
    unmarkBtn.className = 'btn-remove-mark';
    unmarkBtn.textContent = 'Quitar remoto';
    unmarkBtn.addEventListener('click', () => applySelectionRemoto('unmark'));
    bar.appendChild(unmarkBtn);
  }
}

function toggleCellSelection(tipo, personaId, dia, td) {
  const key = personaId + '|' + dia;
  if (state.selection[tipo].has(key)) {
    state.selection[tipo].delete(key);
    td.classList.remove('cell-selected');
  } else {
    state.selection[tipo].add(key);
    td.classList.add('cell-selected');
  }
  renderSelectionToolbar(tipo);
}

function exitSelectMode(tipo) {
  state.selectMode[tipo] = false;
  state.selection[tipo].clear();
  renderSelectionToolbar(tipo);
  renderHorizontal(tipo);
}

async function applySelectionPresencial(code) {
  const grouped = {}; // personaId -> { dia: code | deleteField() }
  const groupedNotas = {}; // personaId -> { dia: deleteField() } (solo al quitar)
  state.selection.presencial.forEach(key => {
    const [personaId, diaStr] = key.split('|');
    grouped[personaId] = grouped[personaId] || {};
    grouped[personaId][diaStr] = code === null ? deleteField() : code;
    if (code === null) {
      groupedNotas[personaId] = groupedNotas[personaId] || {};
      groupedNotas[personaId][diaStr] = deleteField();
    }
  });
  const cantidad = state.selection.presencial.size;
  const writes = Object.entries(grouped).map(([personaId, diasPatch]) => {
    const payload = { personaId, anio: state.anio, mes: state.mes, tipo: 'presencial', dias: diasPatch };
    if (groupedNotas[personaId]) payload.notas = groupedNotas[personaId];
    return setDoc(doc(db, 'marcas', `${personaId}_${state.anio}_${mesId()}_presencial`), payload, { merge: true });
  });
  try {
    await Promise.all(writes);
    showToast(code === null ? `Marca quitada en ${cantidad} días` : `${code} aplicado en ${cantidad} días`);
  } catch (err) {
    showToast('No se pudo guardar: ' + err.message);
  }
  exitSelectMode('presencial');
}

async function applySelectionRemoto(action) {
  const grouped = {}; // personaId -> [dias]
  state.selection.remoto.forEach(key => {
    const [personaId, diaStr] = key.split('|');
    grouped[personaId] = grouped[personaId] || [];
    grouped[personaId].push(Number(diaStr));
  });
  const cantidad = state.selection.remoto.size;
  const writes = Object.entries(grouped).map(([personaId, dias]) => {
    const actuales = state.marcasRemoto[personaId] || [];
    const nuevo = action === 'mark'
      ? Array.from(new Set([...actuales, ...dias])).sort((a, b) => a - b)
      : actuales.filter(d => !dias.includes(d));
    return setDoc(doc(db, 'marcas', `${personaId}_${state.anio}_${mesId()}_remoto`), {
      personaId, anio: state.anio, mes: state.mes, tipo: 'remoto', dias: nuevo
    });
  });
  try {
    await Promise.all(writes);
    showToast(action === 'mark' ? `Remoto marcado en ${cantidad} días` : `Remoto quitado en ${cantidad} días`);
  } catch (err) {
    showToast('No se pudo guardar: ' + err.message);
  }
  exitSelectMode('remoto');
}

// ---------------------------------------------------------------
// Click en una celda/chip: remoto alterna directo; presencial
// marca EZE por defecto, o abre el selector si ya estaba marcado.
// ---------------------------------------------------------------
function handleMarkClick(tipo, persona, dia) {
  if (tipo === 'remoto') {
    const diasActuales = state.marcasRemoto[persona.id] || [];
    toggleRemoto(persona.id, dia, diasActuales);
    return;
  }
  const registro = getRegistroPresencial(persona.id);
  const codeActual = registro.dias[dia];
  if (!codeActual) {
    setMarcaPresencial(persona.id, dia, TIPO_DEFAULT, '');
  } else {
    openMarkerModal(persona, dia, codeActual, registro.notas[dia] || '');
  }
}

async function toggleRemoto(personaId, dia, diasActuales) {
  const nuevo = diasActuales.includes(dia)
    ? diasActuales.filter(d => d !== dia)
    : [...diasActuales, dia].sort((a, b) => a - b);
  const ref = doc(db, 'marcas', `${personaId}_${state.anio}_${mesId()}_remoto`);
  try {
    await setDoc(ref, { personaId, anio: state.anio, mes: state.mes, tipo: 'remoto', dias: nuevo });
  } catch (err) {
    showToast('No se pudo guardar: ' + err.message);
  }
}

async function setMarcaPresencial(personaId, dia, code, nota) {
  const ref = doc(db, 'marcas', `${personaId}_${state.anio}_${mesId()}_presencial`);
  try {
    await setDoc(ref, {
      personaId, anio: state.anio, mes: state.mes, tipo: 'presencial',
      dias: { [dia]: code },
      notas: { [dia]: nota ? nota : deleteField() }
    }, { merge: true });
  } catch (err) {
    showToast('No se pudo guardar: ' + err.message);
  }
}

async function quitarMarcaPresencial(personaId, dia) {
  const ref = doc(db, 'marcas', `${personaId}_${state.anio}_${mesId()}_presencial`);
  try {
    await setDoc(ref, { dias: { [dia]: deleteField() }, notas: { [dia]: deleteField() } }, { merge: true });
  } catch (err) {
    showToast('No se pudo guardar: ' + err.message);
  }
}

// ---------------------------------------------------------------
// Modal selector de tipo de marca (presencial)
// ---------------------------------------------------------------
const markerModal = document.getElementById('markerModal');
let markerCtx = null; // { personaId, dia }

function openMarkerModal(persona, dia, codeActual, notaActual) {
  markerCtx = { personaId: persona.id, dia };
  document.getElementById('markerModalTitle').textContent = `${persona.nombre} — día ${dia}`;
  document.getElementById('markerNota').value = notaActual || '';
  const opts = document.getElementById('markerOptions');
  opts.innerHTML = '';
  TIPOS_PRESENCIAL.forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'marker-option opt-' + t.code + (t.code === codeActual ? ' selected' : '');
    btn.innerHTML = `<span class="code">${t.code}</span><span class="label">${t.label}</span>`;
    btn.addEventListener('click', async () => {
      const nota = document.getElementById('markerNota').value.trim();
      await setMarcaPresencial(markerCtx.personaId, markerCtx.dia, t.code, nota);
      closeMarkerModal();
    });
    opts.appendChild(btn);
  });
  markerModal.hidden = false;
}
function closeMarkerModal() {
  markerModal.hidden = true;
  markerCtx = null;
}
document.getElementById('markerCancelBtn').addEventListener('click', closeMarkerModal);
document.getElementById('markerRemoveBtn').addEventListener('click', async () => {
  if (!markerCtx) return;
  await quitarMarcaPresencial(markerCtx.personaId, markerCtx.dia);
  closeMarkerModal();
});
markerModal.addEventListener('click', (e) => {
  if (e.target === markerModal) closeMarkerModal();
});

// ---------------------------------------------------------------
// Tabla resumen del mes (sin fila de total general)
// ---------------------------------------------------------------
function renderSummary(tipo) {
  const table = document.getElementById(tipo === 'presencial' ? 'summaryPresencial' : 'summaryRemoto');
  if (!state.personas.length) { table.innerHTML = ''; return; }

  let html = '<thead><tr><th>Persona</th><th>Días</th>' +
    (tipo === 'presencial' ? '<th>Total $</th>' : '') + '</tr></thead><tbody>';

  state.personas.forEach(p => {
    let cantidad;
    if (tipo === 'presencial') {
      cantidad = diasQueCuentanPresencial(getRegistroPresencial(p.id).dias);
    } else {
      cantidad = (state.marcasRemoto[p.id] || []).length;
    }
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
// Resumen anual: solo días remotos por mes
// ---------------------------------------------------------------
async function loadResumen() {
  document.getElementById('resumenYear2').textContent = state.anio;

  const marcasSnap = await getDocs(query(
    collection(db, 'marcas'), where('anio', '==', state.anio), where('tipo', '==', 'remoto')
  ));

  const diasPorPersonaMes = {}; // personaId -> { mes: count }
  marcasSnap.forEach(d => {
    const data = d.data();
    diasPorPersonaMes[data.personaId] = diasPorPersonaMes[data.personaId] || {};
    diasPorPersonaMes[data.personaId][data.mes] = (data.dias || []).length;
  });

  const table = document.getElementById('resumenRemoto');
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
      const valor = (diasPorPersonaMes[p.id] || {})[m] || 0;
      totalPersona += valor;
      const td = document.createElement('td');
      td.className = 'days';
      td.textContent = valor;
      tr.appendChild(td);
    }
    const tdTotal = document.createElement('td');
    tdTotal.className = 'days';
    tdTotal.textContent = totalPersona;
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
