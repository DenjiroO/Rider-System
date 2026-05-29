// ==========================================
// 1. CLOUD DATABASE INITIALIZATION
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAlltxTLkvE44wbrkVQHOH0xeJKb_tbfUk",
  authDomain: "rider-financial-monitor.firebaseapp.com",
  databaseURL: "https://rider-financial-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "rider-financial-monitor",
  storageBucket: "rider-financial-monitor.firebasestorage.app",
  messagingSenderId: "743077826140",
  appId: "1:743077826140:web:c64ec08887f60f2fd82099"
};

// Fire up safe instances of Firebase App and Database SDK
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

let editId         = null;
let financialChart = null;
let activePeriod   = 'daily'; 
let globalDataStore = []; // Unified real-time runtime state cache

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
  el.style.border = type === 'error' ? '1px solid #ef4444' : '1px solid #22c55e';
  el.style.color = type === 'error' ? '#f87171' : '#4ade80';
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ══════════════════════════════════════════════════════════
// 3. FOODPANDA FORMULA — CALCULATION CORE
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
  const remitted  = wallet - income;      // Wallet − Total Income (Your exact rule)

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
// 4. PERIOD FILTER AGGREGATIONS
// ══════════════════════════════════════════════════════════
function setPeriod(el, period) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activePeriod = period;
  processAndRender(globalDataStore);
}

function periodKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');

  function isoWeek(dt) {
    const tmp = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  }

  switch (activePeriod) {
    case 'daily':   return dateStr;
    case 'weekly':  return `${y}-W${String(isoWeek(d)).padStart(2,'0')}`;
    case 'monthly': return `${y}-${m}`;
    case 'yearly':  return `${y}`;
    default:        return dateStr;
  }
}

function periodLabel(key) {
  switch (activePeriod) {
    case 'daily': {
      const d = new Date(key + 'T00:00:00');
      return d.toLocaleDateString('en-PH', { month:'short', day:'numeric' });
    }
    case 'weekly':  return key;
    case 'monthly': {
      const [yr, mo] = key.split('-');
      const d = new Date(parseInt(yr), parseInt(mo) - 1, 1);
      return d.toLocaleDateString('en-PH', { month:'short', year:'2-digit' });
    }
    case 'yearly':  return key;
    default:        return key;
  }
}

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
// 5. CLOUD DATABASE CRUD OPERATION HANDLERS
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

  // FIXED: Check values safely and default to empty strings to avoid parsing NaN values directly
  const faresVal  = document.getElementById('fFares').value.trim();
  const walletVal = document.getElementById('fWallet').value.trim();
  const gasVal    = document.getElementById('fGas').value.trim();
  const foodVal   = document.getElementById('fFood').value.trim();
  const dataVal   = document.getElementById('fData').value.trim();
  const maintVal  = document.getElementById('fMaint').value.trim();
  const otherVal  = document.getElementById('fOther').value.trim();

  const fares  = faresVal === "" ? 0 : parseFloat(faresVal);
  const wallet = walletVal === "" ? 0 : parseFloat(walletVal);
  const gas    = gasVal === "" ? 0 : parseFloat(gasVal);
  const food   = foodVal === "" ? 0 : parseFloat(foodVal);
  const data   = dataVal === "" ? 0 : parseFloat(dataVal);
  const maint  = maintVal === "" ? 0 : parseFloat(maintVal);
  const other  = otherVal === "" ? 0 : parseFloat(otherVal);

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

  const targetId = editId ? String(editId) : String(Date.now());
  
  const record = {
    id: targetId,
    date,
    fares,
    wallet,
    gas,
    food,
    data,
    maint,
    other
  };

  database.ref('ledger/' + targetId).set(record, (error) => {
    if (error) {
      showToast('Cloud connection error. Sync failed.', 'error');
    } else {
      showToast(editId ? 'Entry updated across all devices.' : 'Entry added to Cloud.');
      cancelForm();
    }
  });
}

function editRecord(id) {
  const record = globalDataStore.find(item => String(item.id) === String(id));
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

  document.querySelector('.form-card').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// FIXED: Kept table configurations clean by matching exact parameter paths
function deleteRecord(id) {
  if (!confirm('Are you sure you want to delete this ledger entry from all devices?')) return;
  
  database.ref('ledger/' + id).remove((error) => {
    if (error) {
      showToast('Delete synchronization failed.', 'error');
    } else {
      showToast('Entry deleted globally.');
      if (String(editId) === String(id)) cancelForm();
    }
  });
}

function cancelForm() {
  editId = null;
  // FIXED: Explicitly removed missing fields from array parsing loops to avoid crashing on null pointers
  ['fFares','fWallet','fGas','fFood','fData','fMaint','fOther'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  const today = new Date();
  const dateEl = document.getElementById('fDate');
  if (dateEl) {
    dateEl.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }
  const btn = document.getElementById('saveBtn');
  if (btn) btn.textContent = 'Save Entry';
}

// ══════════════════════════════════════════════════════════
// 6. FORMAT MODULES
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
// 7. DASHBOARD DATA AGGREGATION VIEW CONTROLLERS
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
      <td style="text-align:left">${fmtDate(r.date)}</td>
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

  const totFares  = rows.reduce((s,r) => s + r.fares,    0);
  const totIncome = rows.reduce((s,r) => s + r.income,   0);
  const totCosts  = rows.reduce((s,r) => s + r.costs,    0);
  const totNet    = rows.reduce((s,r) => s + r.takeHome, 0);
  const totWallet = rows.reduce((s,r) => s + r.wallet,   0);
  const totRemit  = rows.reduce((s,r) => s + r.remitted, 0);

  if (tfoot) {
    tfoot.innerHTML = `
      <td style="text-align:left">Totals</td>
      <td>${php(totFares)}</td>
      <td class="val-income">${php(totIncome)}</td>
      <td>${php(totCosts)}</td>
      <td class="${totNet >= 0 ? 'val-take' : 'val-neg'}">${php(totNet)}</td>
      <td>${php(totWallet)}</td>
      <td class="val-remit">${php(totRemit)}</td>
      <td></td>`;
  }
}

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
        legend: { labels: { color: '#8a8f9d', font: { size: 12 } } },
        tooltip: { callbacks: { label: ctx => ' ₱' + ctx.parsed.y.toFixed(2) } }
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

function exportCSV() {
  if (!globalDataStore.length) { showToast('No data to export.', 'error'); return; }

  const headers = ['Date','Total Fares','FP Income','Fuel','Food','Mobile Data',
                   'Maintenance','Other','Total Costs','Take-Home','Wallet',
                   'Remittance Due'];
  const lines = [headers.join(',')];

  globalDataStore.map(calculateRecord)
                 .sort((a,b) => a.date.localeCompare(b.date))
                 .forEach(r => {
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
// 8. MASTER PIPELINE DATA RENDERER
// ══════════════════════════════════════════════════════════
function processAndRender(rawList) {
  const processedRows = rawList
    .map(calculateRecord)
    .sort((a, b) => a.date.localeCompare(b.date));

  updateKPIs(processedRows);
  renderLedger(processedRows);
  updateTrendChart(processedRows);
}

// ══════════════════════════════════════════════════════════
// 9. OVER-THE-AIR LIVE SYNCHRONIZATION EVENT STREAM
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const dateEl = document.getElementById('fDate');
  if (dateEl) dateEl.value = `${y}-${m}-${d}`;

  // Attaching active real-time data streaming pipe from Firebase Cloud node root path
  database.ref('ledger').on('value', (snapshot) => {
    const rawData = snapshot.val();
    const parsedList = [];
    
    if (rawData) {
      Object.keys(rawData).forEach(key => {
        parsedList.push(rawData[key]);
      });
    }
    
    globalDataStore = parsedList; // Update local data cache
    processAndRender(parsedList); // Refresh interface components instantly
  });
});
