/* ============================================================
   RIDER MONITOR — script.js
   Original logic preserved:
     - wallet field, other expenses field
     - remittance = wallet - income  (your formula)
     - string ID matching
     - validateNumber() guards
     - wallet >= income validation
   Added:
     - KPI overview cards
     - Daily / Weekly / Monthly / Yearly period filter
     - Totals footer row
     - CSV export
     - Refined toast (CSS-transition based)
============================================================ */

const STORAGE_KEY = 'rider_monitor_fixed';

let editId        = null;
let financialChart = null;
let activePeriod  = 'daily';   // 'daily' | 'weekly' | 'monthly' | 'yearly'

// ══════════════════════════════════════════════════════════
// 1. DATA STORAGE UTILITIES
// ══════════════════════════════════════════════════════════
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    showToast('Error loading data from storage.', 'error');
    return [];
  }
}

function saveDataToStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    showToast('Error saving data to storage.', 'error');
  }
}

// ══════════════════════════════════════════════════════════
// 2. VALIDATION & TOAST
// ══════════════════════════════════════════════════════════
function validateNumber(value, fieldName) {
  const num = parseFloat(value);
  if (isNaN(num) || !isFinite(num)) {
    showToast(`${fieldName} must be a valid number.`, 'error');
    return false;
  }
  if (num < 0) {
    showToast(`${fieldName} cannot be negative.`, 'error');
    return false;
  }
  return true;
}

let _toastTimer = null;
function showToast(message, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.style.border = type === 'error'
    ? '1px solid #ef4444'
    : '1px solid #22c55e';
  el.style.color = type === 'error' ? '#f87171' : '#4ade80';
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ══════════════════════════════════════════════════════════
// 3. FOODPANDA FORMULA — YOUR ORIGINAL LOGIC
// ══════════════════════════════════════════════════════════
function calculateRecord(record) {
  const kita         = parseFloat(record.fares)  || 0;
  const wallet       = parseFloat(record.wallet) || 0;
  const gas          = parseFloat(record.gas)    || 0;
  const food         = parseFloat(record.food)   || 0;
  const dataExpense  = parseFloat(record.data)   || 0;
  const maint        = parseFloat(record.maint)  || 0;
  const other        = parseFloat(record.other)  || 0;

  const costs     = gas + food + dataExpense + maint + other;
  const income    = kita * 0.98;          // Payments/Kita − 2%
  const takeHome  = income - costs;
  const remitted  = wallet - income;      // Wallet − Total Income  (your formula)

  return {
    ...record,
    fares: kita,
    wallet,
    gas,
    food,
    data: dataExpense,
    maint,
    other,
    costs,
    income,
    takeHome,
    remitted
  };
}

// ══════════════════════════════════════════════════════════
// 4. PERIOD FILTER
// ══════════════════════════════════════════════════════════
function setPeriod(el, period) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activePeriod = period;
  render();
}

/**
 * Returns a label that groups a date string into the active period.
 * Used to bucket rows for chart aggregation.
 */
function periodKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');

  // ISO week number helper
  function isoWeek(dt) {
    const tmp = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  }

  switch (activePeriod) {
    case 'daily':   return dateStr;                                           // 2026-05-28
    case 'weekly':  return `${y}-W${String(isoWeek(d)).padStart(2,'0')}`;    // 2026-W22
    case 'monthly': return `${y}-${m}`;                                       // 2026-05
    case 'yearly':  return `${y}`;                                            // 2026
    default:        return dateStr;
  }
}

/** Human-readable label shown on the chart x-axis */
function periodLabel(key) {
  switch (activePeriod) {
    case 'daily': {
      const d = new Date(key + 'T00:00:00');
      return d.toLocaleDateString('en-PH', { month:'short', day:'numeric' });
    }
    case 'weekly':  return key;       // e.g. 2026-W22
    case 'monthly': {
      const [yr, mo] = key.split('-');
      const d = new Date(parseInt(yr), parseInt(mo) - 1, 1);
      return d.toLocaleDateString('en-PH', { month:'short', year:'2-digit' });
    }
    case 'yearly':  return key;
    default:        return key;
  }
}

/**
 * Aggregate rows by the active period.
 * Returns array of { key, label, fares, income, costs, takeHome, remitted, wallet, count }
 */
function aggregateByPeriod(rows) {
  const map = new Map();
  rows.forEach(r => {
    const k = periodKey(r.date);
    if (!map.has(k)) {
      map.set(k, { key:k, label:periodLabel(k), fares:0, income:0, costs:0,
                   takeHome:0, remitted:0, wallet:0, count:0 });
    }
    const bucket = map.get(k);
    bucket.fares    += r.fares;
    bucket.income   += r.income;
    bucket.costs    += r.costs;
    bucket.takeHome += r.takeHome;
    bucket.remitted += r.remitted;
    bucket.wallet   += r.wallet;
    bucket.count    += 1;
  });
  return [...map.values()].sort((a,b) => a.key.localeCompare(b.key));
}

// ══════════════════════════════════════════════════════════
// 5. CRUD HANDLERS  (your original logic, unchanged)
// ══════════════════════════════════════════════════════════
function saveEntry() {
  const dateEl = document.getElementById('fDate');
  let date = dateEl ? dateEl.value.trim() : '';

  if (!date) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2,'0');
    const d = String(today.getDate()).padStart(2,'0');
    date = `${y}-${m}-${d}`;
  }

  const fares  = parseFloat(document.getElementById('fFares').value)  || 0;
  const wallet = parseFloat(document.getElementById('fWallet').value) || 0;
  const gas    = parseFloat(document.getElementById('fGas').value)    || 0;
  const food   = parseFloat(document.getElementById('fFood').value)   || 0;
  const data   = parseFloat(document.getElementById('fData').value)   || 0;
  const maint  = parseFloat(document.getElementById('fMaint').value)  || 0;
  const other  = parseFloat(document.getElementById('fOther').value)  || 0;

  if (!validateNumber(fares,  'Payments/Kita'))  return;
  if (!validateNumber(wallet, 'Wallet balance')) return;
  if (!validateNumber(gas,    'Fuel cost'))      return;
  if (!validateNumber(food,   'Food cost'))      return;
  if (!validateNumber(data,   'Mobile data'))    return;
  if (!validateNumber(maint,  'Maintenance'))    return;
  if (!validateNumber(other,  'Other expenses')) return;

  if (fares <= 0) {
    showToast('Payments/Kita must be greater than 0.', 'error');
    return;
  }

  const calculatedIncome = fares * 0.98;
  if (wallet < calculatedIncome) {
    showToast('Wallet balance cannot be less than Total Income.', 'error');
    return;
  }

  const dataStore = loadData();
  const record = {
    id: editId ? String(editId) : String(Date.now()),
    date,
    fares,
    wallet,
    gas,
    food,
    data,
    maint,
    other,
    remitted: 0
  };

  if (editId) {
    const idx = dataStore.findIndex(item => String(item.id) === String(editId));
    if (idx !== -1) {
      dataStore[idx] = record;
      showToast('Entry updated successfully.');
    }
  } else {
    dataStore.push(record);
    showToast('Entry added successfully.');
  }

  saveDataToStorage(dataStore);
  render();
  cancelForm();
}

function editRecord(id) {
  const dataStore = loadData();
  const record = dataStore.find(item => String(item.id) === String(id));
  if (!record) { showToast('Record not found.', 'error'); return; }

  editId = String(id);
  document.getElementById('fDate').value   = record.date;
  document.getElementById('fFares').value  = record.fares;
  document.getElementById('fWallet').value = record.wallet;
  document.getElementById('fGas').value    = record.gas;
  document.getElementById('fFood').value   = record.food;
  document.getElementById('fData').value   = record.data;
  document.getElementById('fMaint').value  = record.maint;
  document.getElementById('fOther').value  = record.other;

  const btn = document.getElementById('saveBtn');
  if (btn) btn.textContent = 'Update Entry';

  document.querySelector('.form-card')
          .scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function deleteRecord(id) {
  if (!confirm('Are you sure you want to delete this ledger entry?')) return;
  let dataStore = loadData().filter(item => String(item.id) !== String(id));
  saveDataToStorage(dataStore);
  render();
  showToast('Entry deleted successfully.');
  if (String(editId) === String(id)) cancelForm();
}

function cancelForm() {
  editId = null;
  ['fFares','fWallet','fGas','fFood','fData','fMaint','fOther'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const dateEl = document.getElementById('fDate');
  if (dateEl) dateEl.value = '';
  const btn = document.getElementById('saveBtn');
  if (btn) btn.textContent = 'Save Entry';
}

// ══════════════════════════════════════════════════════════
// 6. FORMAT HELPERS
// ══════════════════════════════════════════════════════════
function php(n) {
  return '₱' + (n || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtDate(str) {
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'2-digit' });
}

// ══════════════════════════════════════════════════════════
// 7. KPI CARDS
// ══════════════════════════════════════════════════════════
function updateKPIs(rows) {
  const totFares  = rows.reduce((s,r) => s + r.fares,    0);
  const totIncome = rows.reduce((s,r) => s + r.income,   0);
  const totCosts  = rows.reduce((s,r) => s + r.costs,    0);
  const totNet    = rows.reduce((s,r) => s + r.takeHome, 0);
  const totRemit  = rows.reduce((s,r) => s + r.remitted, 0);
  const ratio     = totIncome > 0 ? (totCosts / totIncome) : 0;

  document.getElementById('kFares').textContent  = php(totFares);
  document.getElementById('kDays').textContent   = rows.length + ' active day' + (rows.length !== 1 ? 's' : '');
  document.getElementById('kIncome').textContent = php(totIncome);
  document.getElementById('kCosts').textContent  = php(totCosts);
  document.getElementById('kRatio').textContent  = 'cost ratio: ' + (ratio * 100).toFixed(1) + '%';
  document.getElementById('kNet').textContent    = php(totNet);
  document.getElementById('kRemit').textContent  = php(totRemit) + ' remittance due';
}

// ══════════════════════════════════════════════════════════
// 8. LEDGER TABLE
// ══════════════════════════════════════════════════════════
function renderLedger(rows) {
  const tbody = document.getElementById('ledgerBody');
  const tfoot = document.getElementById('ledgerFoot');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="big">📋</div>
          No entries yet. Fill in the form above to log your first day.
        </div>
      </td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${php(r.fares)}</td>
      <td class="val-income">${php(r.income)}</td>
      <td>${php(r.costs)}</td>
      <td class="${r.takeHome >= 0 ? 'val-take' : 'val-neg'}">${php(r.takeHome)}</td>
      <td>${php(r.wallet)}</td>
      <td class="val-remit">${php(r.remitted)}</td>
      <td>
        <div class="row-actions">
          <button class="action-btn"     onclick="editRecord('${r.id}')">edit</button>
          <button class="action-btn del" onclick="deleteRecord('${r.id}')">del</button>
        </div>
      </td>
    </tr>`).join('');

  // Totals footer
  const totFares  = rows.reduce((s,r) => s + r.fares,    0);
  const totIncome = rows.reduce((s,r) => s + r.income,   0);
  const totCosts  = rows.reduce((s,r) => s + r.costs,    0);
  const totNet    = rows.reduce((s,r) => s + r.takeHome, 0);
  const totWallet = rows.reduce((s,r) => s + r.wallet,   0);
  const totRemit  = rows.reduce((s,r) => s + r.remitted, 0);

  if (tfoot) {
    tfoot.innerHTML = `
      <td>Totals</td>
      <td>${php(totFares)}</td>
      <td class="val-income">${php(totIncome)}</td>
      <td>${php(totCosts)}</td>
      <td class="${totNet >= 0 ? 'val-take' : 'val-neg'}">${php(totNet)}</td>
      <td>${php(totWallet)}</td>
      <td class="val-remit">${php(totRemit)}</td>
      <td></td>`;
  }
}

// ══════════════════════════════════════════════════════════
// 9. CHART  (aggregated by active period)
// ══════════════════════════════════════════════════════════
function updateTrendChart(rows) {
  const ctx = document.getElementById('trendChart');
  if (!ctx || typeof Chart === 'undefined') return;

  const buckets = aggregateByPeriod(rows);
  const labels  = buckets.map(b => b.label);
  const income  = buckets.map(b => parseFloat(b.income.toFixed(2)));
  const costs   = buckets.map(b => parseFloat(b.costs.toFixed(2)));

  if (financialChart) {
    financialChart.data.labels           = labels;
    financialChart.data.datasets[0].data = income;
    financialChart.data.datasets[1].data = costs;
    financialChart.update();
    return;
  }

  financialChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Net Income',
          data: income,
          borderColor: '#ff9f1c',
          backgroundColor: 'rgba(255,159,28,0.07)',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#ff9f1c'
        },
        {
          label: 'Operational Costs',
          data: costs,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.06)',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#ef4444',
          borderDash: [5, 4]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#8a8f9d', font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => ' ₱' + ctx.parsed.y.toFixed(2)
          }
        }
      },
      scales: {
        x: {
          grid:  { color: '#20242e' },
          ticks: { color: '#5c5964', font: { size: 11 }, autoSkip: false, maxRotation: 0 }
        },
        y: {
          grid:       { color: '#20242e' },
          ticks:      { color: '#5c5964', font: { size: 11 }, callback: v => '₱' + v },
          beginAtZero: true
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════
// 10. CSV EXPORT
// ══════════════════════════════════════════════════════════
function exportCSV() {
  const rows = loadData().map(calculateRecord)
                         .sort((a,b) => a.date.localeCompare(b.date));
  if (!rows.length) { showToast('No data to export.', 'error'); return; }

  const headers = ['Date','Total Fares','FP Income','Fuel','Food','Mobile Data',
                   'Maintenance','Other','Total Costs','Take-Home','Wallet',
                   'Remittance Due'];
  const lines = [headers.join(',')];

  rows.forEach(r => {
    lines.push([
      r.date,
      r.fares.toFixed(2),
      r.income.toFixed(2),
      r.gas.toFixed(2),
      r.food.toFixed(2),
      r.data.toFixed(2),
      r.maint.toFixed(2),
      r.other.toFixed(2),
      r.costs.toFixed(2),
      r.takeHome.toFixed(2),
      r.wallet.toFixed(2),
      r.remitted.toFixed(2)
    ].join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'rider_monitor_export.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported successfully.');
}

// ══════════════════════════════════════════════════════════
// 11. MASTER RENDER
// ══════════════════════════════════════════════════════════
function render() {
  const rows = loadData()
    .map(calculateRecord)
    .sort((a, b) => a.date.localeCompare(b.date));

  updateKPIs(rows);
  renderLedger(rows);
  updateTrendChart(rows);
}

// ══════════════════════════════════════════════════════════
// 12. INIT
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Set today's date in the form by default
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const dateEl = document.getElementById('fDate');
  if (dateEl) dateEl.value = `${y}-${m}-${d}`;

  render();
});