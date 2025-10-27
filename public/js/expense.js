// ======================= expense.js =======================
'use strict';

// ---- token helpers (accept either key) ----
const getToken = () => localStorage.getItem('token') || localStorage.getItem('jwtToken') || '';
const auth = () => (getToken() ? { Authorization: 'Bearer ' + getToken() } : {});
const $ = (s) => document.querySelector(s);

let chart; // Chart.js instance

// ---- Currency helpers ----
const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Turn "$1,234.56" or "1234.56" into 1234.56 (Number)
const unformatCurrency = (s) => {
  const n = Number(String(s || '').replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Formats as $0.00 while typing.
 * Typing digits acts like cents-entry: 1 -> $0.01, 12 -> $0.12, 1234 -> $12.34
 */
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

// ---- API calls ----
async function listExpense() {
  const r = await fetch('/api/expense', { headers: { ...auth() } });
  if (r.status === 401) return logout();
  if (!r.ok) {
    console.error('GET /api/expense failed:', r.status, await r.text().catch(() => ''));
    throw new Error('load failed');
  }
  const { items } = await r.json();
  return items || [];
}

async function createExpense(body) {
  const r = await fetch('/api/expense', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify(body),
  });
  if (r.status === 401) return logout();
  if (!r.ok) {
    console.error('POST /api/expense failed:', r.status, await r.text().catch(() => ''));
    throw new Error('create failed');
  }
}

async function updateExpense(id, body) {
  const r = await fetch('/api/expense/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify(body),
  });
  if (r.status === 401) return logout();
  if (!r.ok) {
    console.error('PATCH /api/expense/:id failed:', r.status, await r.text().catch(() => ''));
    throw new Error('update failed');
  }
}

async function deleteExpense(id) {
  const r = await fetch('/api/expense/' + id, { method: 'DELETE', headers: { ...auth() } });
  if (r.status === 401) return logout();
  if (!r.ok) {
    console.error('DELETE /api/expense/:id failed:', r.status, await r.text().catch(() => ''));
    throw new Error('delete failed');
  }
}

// ---- session ----
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('jwtToken');
  window.location.href = '/';
}

// ---- renderers ----
function renderTable(rows) {
  const wrap = $('#expenseTableWrap');
  if (!wrap) return;

  if (!rows.length) {
    wrap.innerHTML = '<p>No expenses yet.</p>';
    return;
  }

  const head = `
    <thead><tr>
      <th style="text-align:left">Date</th>
      <th style="text-align:left">Category</th>
      <th>Cadence</th>
      <th style="text-align:right">Amount</th>
      <th style="width:120px">Actions</th>
    </tr></thead>`;

  const body = rows.map(r => `
    <tr data-id="${r.id}">
      <td>${r.date}</td>
      <td>${r.category}</td>
      <td style="text-transform:capitalize">${r.cadence || ''}</td>
      <td style="text-align:right">${currencyFmt.format(Number(r.amount) || 0)}</td>
      <td>
        <button class="editBtn">Edit</button>
        <button class="delBtn">Delete</button>
      </td>
    </tr>`).join('');

  wrap.innerHTML = `<table class="data-table">${head}<tbody>${body}</tbody></table>`;

  // Edit handlers
  wrap.querySelectorAll('.editBtn').forEach(b => b.onclick = (e) => {
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    const row = rows.find(x => String(x.id) === id);
    if (!row) return;

    $('#expenseId').value = row.id;
    $('#expenseDate').value = row.date;

    // Set radio by value, default to Other
    const radios = document.querySelectorAll('input[name="category"]');
    let matched = false;
    radios.forEach(radio => {
      if (radio.value.toLowerCase() === String(row.category || '').toLowerCase()) {
        radio.checked = true; matched = true;
      }
    });
    if (!matched) {
      const other = document.querySelector('input[name="category"][value="Other"]');
      if (other) other.checked = true;
    }

    $('#expenseAmount').value = currencyFmt.format(Number(row.amount) || 0);
    $('#expenseCadence').value = row.cadence || 'monthly';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Delete handlers
  wrap.querySelectorAll('.delBtn').forEach(b => b.onclick = async (e) => {
    const id = e.target.closest('tr').dataset.id;
    if (confirm('Delete this expense?')) {
      try {
        await deleteExpense(id);
        localStorage.setItem('refreshDashboard', 'true');
        await load();
      } catch (err) {
        console.error(err);
        alert('Failed to delete expense');
      }
    }
  });
}

function renderChart(rows) {
  const byMonth = {};
  rows.forEach(r => {
    const key = (r.date || '').slice(0, 7); // YYYY-MM
    if (!key) return;
    byMonth[key] = (byMonth[key] || 0) + Number(r.amount || 0);
  });
  const labels = Object.keys(byMonth).sort();
  const data = labels.map(k => byMonth[k]);

  const el = document.getElementById('expenseTrend');
  if (!el) return;

  if (chart) chart.destroy();
  const ctx = el.getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Expenses', data, fill: false, tension: 0.25 }] },
    options: {
      plugins: { legend: { display: false } },
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

// ---- load all ----
async function load() {
  try {
    const rows = await listExpense();
    renderTable(rows);
    renderChart(rows);
  } catch (e) {
    console.error(e);
    alert('Failed to load expenses');
  }
}

// ---- init ----
window.addEventListener('DOMContentLoaded', () => {
  $('#logoutButton')?.addEventListener('click', logout);
  $('#logoutLink')?.addEventListener('click', logout);
  $('#refreshButton')?.addEventListener('click', load);

  // Submit handler: stay on Expense page, mark dashboard to refresh next visit
  $('#expenseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const categoryEl = document.querySelector('input[name="category"]:checked');

    // --- read + sanitize fields ---
    const dateVal = $('#expenseDate')?.value || '';
    const amountVal = unformatCurrency($('#expenseAmount')?.value);
    const cadenceVal = $('#expenseCadence')?.value || 'monthly';
    const categoryVal = categoryEl ? categoryEl.value : 'Other';

    const amount = Number.isFinite(amountVal) ? amountVal : 0;

    const body = {
      date: dateVal || new Date().toISOString().slice(0, 10),
      category: categoryVal,
      amount,
      cadence: cadenceVal
    };

    const id = $('#expenseId')?.value;

    try {
      if (id) await updateExpense(id, body);
      else await createExpense(body);

      localStorage.setItem('refreshDashboard', 'true');
      await load();

      $('#expenseForm').reset();
      $('#expenseId').value = '';
      $('#expenseAmount').value = currencyFmt.format(0);
    } catch (err) {
      console.error(err);
      alert('Failed to save expense');
    }
  });

  // Clear button for the form
  $('#resetBtn')?.addEventListener('click', () => {
    $('#expenseForm').reset();
    $('#expenseId').value = '';
    $('#expenseAmount').value = currencyFmt.format(0);
  });

  // Clear chart and table
  document.getElementById('clearTrendBtn')?.addEventListener('click', () => {
    if (chart) { chart.destroy(); chart = null; }
    const ctx = document.getElementById('expenseTrend')?.getContext('2d');
    if (ctx?.canvas) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  });
  document.getElementById('clearTableBtn')?.addEventListener('click', () => {
    const wrap = document.getElementById('expenseTableWrap');
    if (wrap) wrap.innerHTML = '<p>No expenses yet.</p>';
  });

  // Attach currency formatter
  attachCurrencyFormatter(document.getElementById('expenseAmount'));

  // Initial load
  load();
});

// ===================== end expense.js =====================
