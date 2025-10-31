////////////////////////////////////////////////////////////////
// DASHBOARD.JS  (controller)
////////////////////////////////////////////////////////////////

// ---- token + helpers ----
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const getToken = () => localStorage.getItem('token') || localStorage.getItem('jwtToken') || '';
const authHeaders = () => (getToken() ? { Authorization: 'Bearer ' + getToken() } : {});

async function fetchJSON(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.warn(url, 'failed:', r.status, t);
    throw new Error(`Request failed ${r.status}`);
  }
  return r.json();
}

// safely coerce values like 120, "120", "120.00", "$120.00" → 120
const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// --- small date helpers ---
const pad2 = (n) => String(n).padStart(2, '0');
// "YYYY-MM" -> "Oct '25"
function formatMonthLabel(yyyyMm) {
  const d = new Date(`${yyyyMm}-01T00:00:00`);
  if (isNaN(d)) return yyyyMm;
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const yy  = String(d.getFullYear()).slice(-2);
  return `${mon} '${yy}`;
}

// --- KPIs (try reports + client sums, then pick best) ---
async function loadKPIs() {
  const incomeEl = document.getElementById('kpiIncome');
  const expEl    = document.getElementById('kpiExpenses');
  const budEl    = document.getElementById('kpiBudget');

  if (incomeEl) incomeEl.textContent = 'No data';
  if (expEl)    expEl.textContent    = 'No data';
  if (budEl)    budEl.textContent    = 'No data';

  const token = getToken();
  if (!token) {
    console.warn('[KPIs] No token; staying "No data".');
    return;
  }

  let reportsTotals = null;
  let clientTotals  = null;

  // 1) preferred: server /api/reports
  const pReports = (async () => {
    try {
      const data = await fetchJSON('/api/reports'); // { totals:{income,expenses,net} }
      reportsTotals = {
        income:   toNum(data?.totals?.income),
        expenses: toNum(data?.totals?.expenses),
      };
      console.log('[KPIs] /api/reports totals:', reportsTotals);
    } catch (e) {
      console.warn('[KPIs] /api/reports failed -> will rely on client sums too:', e?.message || e);
    }
  })();

  // 2) fallback: compute from endpoints
  const pClient = (async () => {
    try {
      const [incRes, expRes] = await Promise.allSettled([
        fetchJSON('/api/income'),   // { items: [...] }
        fetchJSON('/api/expenses')  // { items: [...] }
      ]);
      const incomeItems  = incRes.status === 'fulfilled' ? (incRes.value.items  || []) : [];
      const expenseItems = expRes.status === 'fulfilled' ? (expRes.value.items || []) : [];

      const incomeSum  = incomeItems.reduce((s, r)  => s + toNum(r.amount), 0);
      const expenseSum = expenseItems.reduce((s, r) => s + toNum(r.amount), 0);

      clientTotals = { income: incomeSum, expenses: expenseSum };
      console.log('[KPIs] client totals:', clientTotals);
    } catch (e) {
      console.warn('[KPIs] client totals failed:', e?.message || e);
    }
  })();

  await Promise.all([pReports, pClient]);

  // choose values
  const pick = (a, b) => {
    const aNum = toNum(a), bNum = toNum(b);
    if (aNum > 0 && bNum > 0) return Math.max(aNum, bNum);
    return (aNum > 0) ? aNum : (bNum > 0 ? bNum : 0);
  };

  const incomeVal   = pick(reportsTotals?.income,   clientTotals?.income);
  const expensesVal = pick(reportsTotals?.expenses, clientTotals?.expenses);

  if (incomeEl) incomeEl.textContent = incomeVal   > 0 ? money.format(incomeVal)   : 'No data';
  if (expEl)    expEl.textContent    = expensesVal > 0 ? money.format(expensesVal) : 'No data';

  const budget = toNum(localStorage.getItem('monthlyBudget'));
  if (budEl) budEl.textContent = budget > 0 ? money.format(budget) : 'No data';
}

// --- Income chart (real data from /api/income) ---
// let incomeChart;
// async function loadIncomeChart() {
//   const canvas = document.getElementById('incomeChart');
//   if (!canvas) return;

//   try {
//     const data = await fetchJSON('/api/income'); // { items: [...] }
//     const rows = Array.isArray(data?.items) ? data.items : [];

//     // group by YYYY-MM
//     const byMonth = {};
//     for (const r of rows) {
//       const key = String(r.date || '').slice(0, 7); // YYYY-MM
//       if (!key) continue;
//       byMonth[key] = (byMonth[key] || 0) + toNum(r.amount);
//     }
//     const labels = Object.keys(byMonth).sort();
//     const values = labels.map(k => byMonth[k]);

//     // draw
//     if (incomeChart) incomeChart.destroy();
//     incomeChart = new Chart(canvas, {
//       type: 'line',
//       data: {
//         labels: labels.map(formatMonthLabel),
//         datasets: [{ label: 'Monthly Income ($)', data: values, fill: true, tension: 0.35 }]
//       },
//       options: {
//         responsive: true,
//         plugins: { legend: { position: 'top' } },
//         scales: {
//           y: {
//             beginAtZero: true,
//             ticks: { callback: (v) => money.format(v) }
//           }
//         }
//       }
//     });
//   } catch (e) {
//     console.error('[Chart] failed to load income chart:', e?.message || e);
//   }
// }
// --- Income chart (real data from /api/income) ---
let incomeChart;
async function loadIncomeChart() {
  const canvas = document.getElementById('incomeChart');
  if (!canvas) return;

  try {
    const data = await fetchJSON('/api/income'); // { items: [...] }
    const rows = Array.isArray(data?.items) ? data.items : [];

    // group by YYYY-MM
    const byMonth = {};
    for (const r of rows) {
      const key = String(r.date || '').slice(0, 7); // YYYY-MM
      if (!key) continue;
      byMonth[key] = (byMonth[key] || 0) + toNum(r.amount);
    }
    const labels = Object.keys(byMonth).sort();
    const values = labels.map(k => byMonth[k]);

    if (incomeChart) incomeChart.destroy();
    incomeChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels.map(formatMonthLabel),
        datasets: [{
          label: 'Monthly Income ($)',
          data: values,
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,     // smaller color box
              boxHeight: 10,
              padding: 6,       // tighter spacing
              font: { size: 12 } // smaller font
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => money.format(v) }
          }
        },
        elements: {
          point: { radius: 2 },  // optional: smaller points to match the compact legend
          line:  { borderWidth: 2 }
        }
      }
    });
  } catch (e) {
    console.error('[Chart] failed to load income chart:', e?.message || e);
  }
}


// ===== Expenses by Category (doughnut) =====
let categoryChart; // doughnut for expenses by category

async function fetchReports(rangeParams = '') {
  const r = await fetch('/api/reports' + rangeParams, { headers: authHeaders() }); // <-- fixed
  if (!r.ok) throw new Error('Failed to load reports');
  return r.json(); // { totals: {income, expenses, net}, expensesByCategory: [{category,total}, ...] }
}

function renderCategoryChart(expensesByCategory = []) {
  const canvas = document.getElementById('categoryChart');
  const emptyMsg = document.getElementById('categoryChartEmpty');
  if (!canvas) return;

  // Show/Hide empty message
  const hasData = Array.isArray(expensesByCategory) && expensesByCategory.length > 0;
  canvas.style.display = hasData ? 'block' : 'none';
  if (emptyMsg) emptyMsg.style.display = hasData ? 'none' : 'block';
  if (!hasData) {
    if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
    return;
  }

  const labels = expensesByCategory.map(x => x.category ?? 'Unknown');
  const values = expensesByCategory.map(x => Number(x.total || 0));

  // Nice, soft palette
  const palette = [
    '#4F46E5','#10B981','#F59E0B','#EF4444','#06B6D4',
    '#8B5CF6','#84CC16','#F97316','#14B8A6','#EC4899'
  ];

  if (categoryChart) categoryChart.destroy();
  const ctx = canvas.getContext('2d');
  const total = values.reduce((a,b) => a + b, 0);

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 14 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed ?? 0;
              const pct = total ? (v / total) * 100 : 0;
              return `${ctx.label}: ${money.format(v)} (${pct.toFixed(1)}%)`;
            }
          }
        }
      },
      cutout: '55%' // ring
    }
  });
}

async function loadExpenseCategoryChart() {
  try {
    const reports = await fetchReports(); // add ?from=&to= if you wire range chips later
    renderCategoryChart(reports.expensesByCategory || []);
  } catch (e) {
    console.error('[CategoryChart] failed:', e?.message || e);
  }
}

// --- Optional: show user email in header (from JWT) ---
function renderUserNameFromJWT() {
  const el = document.getElementById('userName');
  if (!el) return;
  const tok = getToken();
  try {
    const payload = JSON.parse(atob((tok || '').split('.')[1] || ''));
    el.textContent = payload?.email || 'User';
  } catch {
    el.textContent = 'User';
  }
}

// ---- init ----
document.addEventListener('DOMContentLoaded', () => {
  const logoutButton  = document.getElementById('logoutButton');
  const refreshButton = document.getElementById('refreshButton');

  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('jwtToken');
      window.location.href = '/';
    });
  }

  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      loadKPIs();
      loadIncomeChart();
      loadExpenseCategoryChart(); // refresh the doughnut too
    });
  }

  // Auth guard + initial load
  const token = getToken();
  if (!token) {
    window.location.href = '/';
    return;
  }

  renderUserNameFromJWT();
  loadKPIs();
  loadIncomeChart();
  loadExpenseCategoryChart();

  // Refresh once if income/expense page set the flag
  if (localStorage.getItem('refreshDashboard') === 'true') {
    loadKPIs();
    loadIncomeChart();
    loadExpenseCategoryChart();
    localStorage.removeItem('refreshDashboard');
  }
}); // end DOMContentLoaded
