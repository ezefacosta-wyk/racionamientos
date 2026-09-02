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
const DIAS_SEMANA = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];

function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
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
  valores: { racionamiento: 0, movilidad: 0 },
  isAdmin: sessionStorage.getItem('isAdmin') === 'true'
};

let unsubPersonas = null;
let unsubPresencial = null;
let unsubRemoto = null;
let unsubValores = null;

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
    renderGrid('presencial');
  }, (err) => setStatus('Error leyendo presencialidad: ' + err.message, 'error'));

  const qRem = query(collection(db, 'marcas'),
    where('anio', '==', state.anio), where('mes', '==', state.mes), where('tipo', '==', 'remoto'));
  unsubRemoto = onSnapshot(qRem, (snap) => {
    state.marcasRemoto = {};
    snap.forEach(d => { state.marcasRemoto[d.data().personaId] = d.data().dias || []; });
    renderGrid('remoto');
  }, (err) => setStatus('Error leyendo remoto: ' + err.message, 'error'));

  const valoresRef = doc(db, 'valoresMensuales', `${state.anio}_${mesId()}`);
  unsubValores = onSnapshot(valoresRef, (snap) => {
    state.valores = snap.exists() ? snap.data() : { racionamiento: 0, movilidad: 0 };
    document.getElementById('racionamientoDisplay').textContent = formatMoney(state.valores.racionamiento || 0);
    document.getElementById('movilidadDisplay').textContent = formatMoney(state.valores.movilidad || 0);
    document.getElementById('racionamientoInput').value = state.valores.racionamiento || 0;
    document.getElementById('movilidadInput').value = state.valores.movilidad || 0;
    renderGrid('presencial');
  }, (err) => setStatus('Error leyendo valores del mes: ' + err.message, 'error'));
}

function subscribePersonas() {
  unsubPersonas = onSnapshot(collection(db, 'personas'), (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
    state.personas = list;
    renderGrid('presencial');
    renderGrid('remoto');
    renderPersonAdminList();
    setStatus('Conectado', 'ok');
  }, (err) => setStatus('Error de conexión: ' + err.message, 'error'));
}

function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR');
}

// ---------------------------------------------------------------
// Render de grillas (presencial / remoto)
// ---------------------------------------------------------------
function renderGrid(tipo) {
  const head = document.getElementById(tipo === 'presencial' ? 'headPresencial' : 'headRemoto');
  const body = document.getElementById(tipo === 'presencial' ? 'bodyPresencial' : 'bodyRemoto');
  const foot = document.getElementById(tipo === 'presencial' ? 'footPresencial' : 'footRemoto');
  const emptyState = document.getElementById(tipo === 'presencial' ? 'emptyPresencial' : 'emptyRemoto');
  const wrap = document.getElementById(tipo === 'presencial' ? 'gridPresencial' : 'gridRemoto');

  if (!state.personas.length) {
    wrap.style.display = 'none';
    emptyState.hidden = false;
    return;
  }
  wrap.style.display = '';
  emptyState.hidden = true;

  const nDias = diasEnMes(state.anio, state.mes);
  const marcas = tipo === 'presencial' ? state.marcasPresencial : state.marcasRemoto;

  // Header
  head.innerHTML = '';
  const thName = document.createElement('th');
  thName.className = 'col-name';
  thName.textContent = 'Persona';
  head.appendChild(thName);
  for (let d = 1; d <= nDias; d++) {
    const th = document.createElement('th');
    const weekday = DIAS_SEMANA[new Date(state.anio, state.mes - 1, d).getDay()];
    th.innerHTML = `<span class="weekday">${weekday}</span>${d}`;
    head.appendChild(th);
  }
  const thDias = document.createElement('th');
  thDias.textContent = tipo === 'presencial' ? 'Días' : 'Días';
  head.appendChild(thDias);
  if (tipo === 'presencial') {
    const thTotal = document.createElement('th');
    thTotal.textContent = 'Total $';
    head.appendChild(thTotal);
  }

  // Body
  body.innerHTML = '';
  let sumaDias = 0, sumaTotal = 0;
  state.personas.forEach(p => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'col-name';
    tdName.textContent = p.nombre;
    tr.appendChild(tdName);

    const diasMarcados = marcas[p.id] || [];
    for (let d = 1; d <= nDias; d++) {
      const td = document.createElement('td');
      td.className = 'day-cell';
      const marked = diasMarcados.includes(d);
      if (marked) td.classList.add(tipo === 'presencial' ? 'marked-presencial' : 'marked-remoto');
      td.textContent = marked ? 'X' : '';
      td.addEventListener('click', () => toggleDia(tipo, p.id, d, diasMarcados));
      tr.appendChild(td);
    }

    const cantidad = diasMarcados.length;
    sumaDias += cantidad;
    const tdDias = document.createElement('td');
    tdDias.className = 'col-total';
    tdDias.textContent = cantidad;
    tr.appendChild(tdDias);

    if (tipo === 'presencial') {
      const total = (Number(state.valores.racionamiento || 0) + Number(state.valores.movilidad || 0)) * cantidad;
      sumaTotal += total;
      const tdTotal = document.createElement('td');
      tdTotal.className = 'col-total';
      tdTotal.textContent = formatMoney(total);
      tr.appendChild(tdTotal);
    }

    body.appendChild(tr);
  });

  // Footer
  foot.innerHTML = '';
  const tdFootLabel = document.createElement('td');
  tdFootLabel.className = 'col-name';
  tdFootLabel.textContent = 'Total general';
  tdFootLabel.colSpan = 1;
  foot.appendChild(tdFootLabel);
  for (let d = 1; d <= nDias; d++) foot.appendChild(document.createElement('td'));
  const tdFootDias = document.createElement('td');
  tdFootDias.textContent = sumaDias;
  foot.appendChild(tdFootDias);
  if (tipo === 'presencial') {
    const tdFootTotal = document.createElement('td');
    tdFootTotal.textContent = formatMoney(sumaTotal);
    foot.appendChild(tdFootTotal);
  }
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
  const totalesPorMes = new Array(12).fill(0);
  let granTotal = 0;

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
      totalesPorMes[m - 1] += valor;
      const td = document.createElement('td');
      td.className = esDinero ? 'amount' : 'days';
      td.textContent = esDinero ? formatMoney(valor) : valor;
      tr.appendChild(td);
    }
    granTotal += totalPersona;
    const tdTotal = document.createElement('td');
    tdTotal.className = esDinero ? 'amount' : 'days';
    tdTotal.textContent = esDinero ? formatMoney(totalPersona) : totalPersona;
    tr.appendChild(tdTotal);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const trf = document.createElement('tr');
  trf.innerHTML = '<td class="col-name">Total general</td>' +
    totalesPorMes.map(v => `<td>${esDinero ? formatMoney(v) : v}</td>`).join('') +
    `<td>${esDinero ? formatMoney(granTotal) : granTotal}</td>`;
  tfoot.appendChild(trf);
  table.appendChild(tfoot);
}

// ---------------------------------------------------------------
// Admin: passcode, agregar/quitar personas
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
    renderGrid('presencial');
  } else {
    errorEl.hidden = false;
  }
});

document.getElementById('adminLockBtn').addEventListener('click', () => {
  state.isAdmin = false;
  sessionStorage.removeItem('isAdmin');
  applyAdminState();
  renderGrid('presencial');
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
