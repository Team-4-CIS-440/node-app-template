// ======================= income.js =======================
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

  // Initialize if empty
  if (!input.value) input.value = currencyFmt.format(0);

  input.addEventListener('input', () => {
    // Keep only digits, treat as cents
    const digits = input.value.replace(/\D/g, '');
    const cents = digits ? parseInt(digits, 10) : 0;
    input.value = currencyFmt.format(cents / 100);
  });

  input.addEventListener('blur', () => {
    // On blur, ensure it's a valid formatted number
    input.value = currencyFmt.format(unformatCurrency(input.value));
  });
}

// ---- API calls ----
async function listIncome() {
  const r = await fetch('/api/income', { headers: { ...auth() } });
  if (r.status === 401) return logout();
  if (!r.ok) {
    console.error('GET /api/income failed:', r.status, await r.text().catch(() => ''));
    throw new Error('load failed');
  }
  const { items } = await r.json();
  return items || [];
}

async function createIncome(body) {
  const r = await fetch('/api/income', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify(body),
  });
  if (r.status === 401) return logout();
  if (!r.ok) {
    console.error('POST /api/income failed:', r.status, await r.text().catch(() => ''));
    throw new Error('create failed');
  }
}

async function updateIncome(id, body) {
  const r = await fetch('/api/income/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify(body),
  });
  if (r.status === 401) return logout();
  if (!r.ok) {
    console.error('PATCH /api/income/:id failed:', r.status, await r.text().catch(() => ''));
    throw new Error('update failed');
  }
}

async function deleteIncome(id) {
  const r = await fetch('/api/income/' + id, { method: 'DELETE', headers: { ...auth() } });
  if (r.status === 401) return logout();
  if (!r.ok) {
    console.error('DELETE /api/income/:id failed:', r.status, await r.text().catch(() => ''));
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
  const wrap = $('#tableWrap');
  if (!wrap) return;

  if (!rows.length) {
    wrap.innerHTML = '<p>No income yet.</p>';
    return;
  }

  const head = `
    <thead><tr>
      <th style="text-align:left">Date</th>
      <th style="text-align:left">Source</th>
      <th>Cadence</th>
      <th style="text-align:right">Amount</th>
      <th style="width:120px">Actions</th>
    </tr></thead>`;

  const body = rows.map(r => `
    <tr data-id="${r.id}">
      <td>${r.date}</td>
      <td>${r.source}</td>
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

    $('#incomeId').value = row.id;
    $('#dateInput').value = row.date;

    // Set radio by value, default to Other
    const radios = document.querySelectorAll('input[name="source"]');
    let matched = false;
    radios.forEach(radio => {
      if (radio.value.toLowerCase() === String(row.source || '').toLowerCase()) {
        radio.checked = true; matched = true;
      }
    });
    if (!matched) {
      const other = document.querySelector('input[name="source"][value="Other"]');
      if (other) other.checked = true;
    }

    // amount + cadence
    $('#amountInput').value = currencyFmt.format(Number(row.amount) || 0);
    $('#cadenceInput').value = row.cadence || 'monthly';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Delete handlers
  wrap.querySelectorAll('.delBtn').forEach(b => b.onclick = async (e) => {
    const id = e.target.closest('tr').dataset.id;
    if (confirm('Delete this entry?')) {
      try {
        await deleteIncome(id);
        // Mark dashboard to refresh on next visit
        localStorage.setItem('refreshDashboard', 'true');
        await load();
      } catch (err) {
        console.error(err);
        alert('Failed to delete income');
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

  const el = document.getElementById('incomeTrend');
  if (!el) return;

  if (chart) chart.destroy();
  const ctx = el.getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Income', data, fill: false, tension: 0.25 }] },
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
    const rows = await listIncome();
    renderTable(rows);
    renderChart(rows);
  } catch (e) {
    console.error(e);
    alert('Failed to load income');
  }
}

// ---- init ----
window.addEventListener('DOMContentLoaded', () => {
  $('#logoutButton')?.addEventListener('click', logout);
  $('#logoutLink')?.addEventListener('click', logout);
  $('#refreshButton')?.addEventListener('click', load);

  // Submit handler: stay on Income page, mark dashboard to refresh next visit
  $('#incomeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const sourceEl = document.querySelector('input[name="source"]:checked');

    // --- read + sanitize fields ---
    const dateVal = $('#dateInput')?.value || '';
    const amountVal = unformatCurrency($('#amountInput')?.value);
    const cadenceVal = $('#cadenceInput')?.value || 'monthly';
    const sourceVal = sourceEl ? sourceEl.value : 'Other';

    // Guard: ensure amount is a finite number
    const amount = Number.isFinite(amountVal) ? amountVal : 0;

    const body = {
      date: dateVal || new Date().toISOString().slice(0, 10), // fallback: today (YYYY-MM-DD)
      source: sourceVal,
      amount,               // <<< numeric value saved to API
      cadence: cadenceVal
    };

    const id = $('#incomeId')?.value;

    try {
      if (id) await updateIncome(id, body);
      else await createIncome(body);

      // Mark dashboard to refresh on next open
      localStorage.setItem('refreshDashboard', 'true');

      // Refresh local table + chart so user sees it now
      await load();

      // Reset form to “add new”
      $('#incomeForm').reset();
      $('#incomeId').value = '';
      $('#amountInput').value = currencyFmt.format(0);
      // Optional: toast "Saved!"
    } catch (err) {
      console.error(err);
      alert('Failed to save income');
    }
  });

  // Clear button for the form
  $('#resetBtn')?.addEventListener('click', () => {
    $('#incomeForm').reset();
    $('#incomeId').value = '';
    $('#amountInput').value = currencyFmt.format(0);
  });

  // Optional panel clear buttons (only if present in the DOM)
  document.getElementById('clearTrendBtn')?.addEventListener('click', () => {
    if (chart) { chart.destroy(); chart = null; }
    const ctx = document.getElementById('incomeTrend')?.getContext('2d');
    if (ctx?.canvas) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  });
  document.getElementById('clearTableBtn')?.addEventListener('click', () => {
    const wrap = document.getElementById('tableWrap');
    if (wrap) wrap.innerHTML = '<p>No income yet.</p>';
  });

  // Attach currency formatter (keeps the $ while typing)
  attachCurrencyFormatter(document.getElementById('amountInput'));

  // Initial load
  load();
});

// ===================== end income.js =====================
