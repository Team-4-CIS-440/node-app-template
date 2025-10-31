// ======================= expense.js =======================
'use strict';

const getToken = () => localStorage.getItem('token') || localStorage.getItem('jwtToken') || '';
const auth = () => (getToken() ? { Authorization: 'Bearer ' + getToken() } : {});
const $ = (s) => document.querySelector(s);

let chart;
let expenseRowsCache = [];
let expenseRange = '6'; // default

// Currency helpers
const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const unformatCurrency = (s) => {
  const n = Number(String(s || '').replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : 0;
};
function attachCurrencyFormatter(input) {
  if (!input) return;
  if (!input.value) input.value = currencyFmt.format(0);
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    const cents = digits ? parseInt(digits, 10) : 0;
    input.value = currencyFmt.format(cents / 100);
  });
  input.addEventListener('blur', () => {
    input.value = currencyFmt.format(unformatCurrency(input.value));
  });
}

// Date helpers
const pad2 = (n) => String(n).padStart(2, '0');
function formatTableDate(s) {
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${pad2(d.getMonth()+1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}
function formatMonthLabel(yyyyMm) {
  const d = new Date(`${yyyyMm}-01T00:00:00`);
  if (isNaN(d)) return yyyyMm;
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const yy = String(d.getFullYear()).slice(-2);
  return `${mon} '${yy}`;
}

// API
async function listExpense() {
  const r = await fetch('/api/expense', { headers: { ...auth() } });
  if (r.status === 401) return logout();
  if (!r.ok) throw new Error('load failed');
  const { items } = await r.json();
  return items || [];
}
async function createExpense(body) {
  const r = await fetch('/api/expense', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body),
  });
  if (r.status === 401) return logout();
  if (!r.ok) throw new Error('create failed');
}
async function updateExpense(id, body) {
  const r = await fetch('/api/expense/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body),
  });
  if (r.status === 401) return logout();
  if (!r.ok) throw new Error('update failed');
}
async function deleteExpense(id) {
  const r = await fetch('/api/expense/' + id, { method: 'DELETE', headers: { ...auth() } });
  if (r.status === 401) return logout();
  if (!r.ok) throw new Error('delete failed');
}

// session
function logout() { localStorage.removeItem('token'); localStorage.removeItem('jwtToken'); window.location.href = '/'; }

// chart helpers
function aggregateByMonth(rows) {
  const map = {};
  let maxDate = null;
  rows.forEach(r => {
    const d = new Date(r.date);
    if (isNaN(d)) return;
    const ym = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
    map[ym] = (map[ym] || 0) + Number(r.amount || 0);
    if (!maxDate || d > maxDate) maxDate = d;
  });
  let labels = Object.keys(map).sort();
  if (expenseRange !== 'ALL' && labels.length) {
    const n = parseInt(expenseRange, 10);
    const cutoff = new Date(maxDate);
    cutoff.setMonth(cutoff.getMonth() - (n - 1));
    labels = labels.filter(ym => new Date(`${ym}-01`) >= cutoff);
  }
  const data = labels.map(ym => map[ym]);
  return { labels, data };
}
function setCanvasWidthForLabels(wrapperId, canvasId, labelCount) {
  const wrap = document.getElementById(wrapperId);
  const canvas = document.getElementById(canvasId);
  if (!wrap || !canvas) return;
  const minPerLabel = 80;
  const w = Math.max(labelCount * minPerLabel, wrap.clientWidth || 600);
  canvas.style.width = w + 'px';
}
function renderChart(rows) {
  const { labels, data } = aggregateByMonth(rows);
  const el = document.getElementById('expenseTrend');
  if (!el) return;

  setCanvasWidthForLabels('expenseTrendWrap', 'expenseTrend', labels.length);

  if (chart) chart.destroy();
  chart = new Chart(el.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels.map(formatMonthLabel),
      datasets: [{ label: 'Expenses', data, fill: false, tension: 0.25 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${currencyFmt.format(ctx.parsed.y || 0)}` }
        }
      },
      scales: {
        x: { ticks: { autoSkip: false } },
        y: { ticks: { callback: (v) => currencyFmt.format(v) }, beginAtZero: true }
      }
    }
  });
}

// table renderer
function renderTable(rows) {
  const wrap = $('#expenseTableWrap');
  if (!wrap) return;

  if (!rows.length) { wrap.innerHTML = '<p>No expenses yet.</p>'; return; }

  const head = `
    <thead>
      <tr>
        <th style="text-align:left">Date</th>
        <th style="text-align:left">Category</th>
        <th>Cadence</th>
        <th style="text-align:right">Amount</th>
        <th style="width:120px">Actions</th>
      </tr>
    </thead>`;

  const body = rows.map(r => `
    <tr data-id="${r.id}">
      <td>${formatTableDate(r.date)}</td>
      <td>${r.category}</td>
      <td style="text-transform:capitalize">${r.cadence || ''}</td>
      <td style="text-align:right">${currencyFmt.format(Number(r.amount) || 0)}</td>
      <td>
        <button class="editBtn">Edit</button>
        <button class="delBtn">Delete</button>
      </td>
    </tr>`).join('');

  wrap.innerHTML = `<div style="max-height:320px; overflow:auto; border:1px solid #e7ecf6; border-radius:12px;">
    <table class="data-table">${head}<tbody>${body}</tbody></table>
  </div>`;

  // Edit
  wrap.querySelectorAll('.editBtn').forEach(b => b.onclick = (e) => {
    const tr = e.target.closest('tr'); const id = tr.dataset.id;
    const row = expenseRowsCache.find(x => String(x.id) === id); if (!row) return;
    $('#expenseId').value = row.id;
    $('#expenseDate').value = row.date;
    const radios = document.querySelectorAll('input[name="category"]');
    let matched = false;
    radios.forEach(radio => {
      if (radio.value.toLowerCase() === String(row.category || '').toLowerCase()) { radio.checked = true; matched = true; }
    });
    if (!matched) document.querySelector('input[name="category"][value="Other"]')?.setAttribute('checked', true);
    $('#expenseAmount').value = currencyFmt.format(Number(row.amount) || 0);
    $('#expenseCadence').value = row.cadence || 'monthly';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Delete
  wrap.querySelectorAll('.delBtn').forEach(b => b.onclick = async (e) => {
    const id = e.target.closest('tr').dataset.id;
    if (confirm('Delete this expense?')) {
      await deleteExpense(id);
      localStorage.setItem('refreshDashboard','true');
      await load();
    }
  });
}

// load
async function load() {
  const rows = await listExpense();
  expenseRowsCache = rows;
  renderTable(rows);
  renderChart(rows);
}

// init
window.addEventListener('DOMContentLoaded', () => {
  $('#logoutButton')?.addEventListener('click', logout);
  $('#logoutLink')?.addEventListener('click', logout);
  $('#refreshButton')?.addEventListener('click', load);

  // Range chips
  const chipEls = document.querySelectorAll('[data-range-expense]');
  chipEls.forEach(btn => {
    btn.addEventListener('click', () => {
      chipEls.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      expenseRange = btn.dataset.rangeExpense;
      renderChart(expenseRowsCache);
    });
  });
  document.querySelector('[data-range-expense="6"]')?.classList.add('active');

  // Clear chart
  $('#clearTrendBtn')?.addEventListener('click', () => {
    if (chart) { chart.destroy(); chart = null; }
    const ctx = $('#expenseTrend')?.getContext('2d'); if (ctx?.canvas) ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  });

  // Form submit
  $('#expenseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const catEl = document.querySelector('input[name="category"]:checked');
    const body = {
      date: $('#expenseDate')?.value || new Date().toISOString().slice(0,10),
      category: catEl ? catEl.value : 'Other',
      amount: Number.isFinite(unformatCurrency($('#expenseAmount')?.value)) ? unformatCurrency($('#expenseAmount')?.value) : 0,
      cadence: $('#expenseCadence')?.value || 'monthly',
    };
    const id = $('#expenseId')?.value;
    if (id) await updateExpense(id, body); else await createExpense(body);
    localStorage.setItem('refreshDashboard','true');
    await load();
    $('#expenseForm').reset(); $('#expenseId').value = ''; $('#expenseAmount').value = currencyFmt.format(0);
  });

  $('#resetBtn')?.addEventListener('click', () => {
    $('#expenseForm').reset(); $('#expenseId').value = ''; $('#expenseAmount').value = currencyFmt.format(0);
  });

  attachCurrencyFormatter($('#expenseAmount'));
  load();
});
// ===================== end expense.js =======================
