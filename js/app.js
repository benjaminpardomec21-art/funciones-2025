// ---- CONFIGURACIÓN ----
// IVA Chile aprox. 19%
const IVA_RATE = 0.19;

// ---- MODELO DE DATOS EN LOCALSTORAGE ----
const STORAGE_KEY = "stockAppData_v1";

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      users: [],
      currentUser: null,
      items: [] 
      // item: {id, name, desc, min, max, stock, code,
      //        priceNet, priceIVA, priceTotal, priceMode,
      //        transactions:[{date, type, qty}]}
    };
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error al parsear datos:", e);
    return { users: [], currentUser: null, items: [] };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let appData = loadData();
let currentChart = null;
let html5QrCodeInstance = null;
let scannerRunning = false;

// ---- UTILIDADES ----
function genId() {
  return Math.random().toString(36).substring(2, 10);
}

function ensureItemCodes() {
  let updated = false;
  appData.items.forEach(item => {
    if (!item.code) {
      item.code = "IT-" + genId().toUpperCase();
      updated = true;
    }
  });
  if (updated) saveData(appData);
}

ensureItemCodes();

function showMessage(el, text, type = "ok") {
  el.textContent = text;
  el.classList.remove("msg-ok", "msg-error");
  if (type === "ok" && text) el.classList.add("msg-ok");
  if (type === "error" && text) el.classList.add("msg-error");
  if (!text) {
    el.classList.remove("msg-ok", "msg-error");
  }
}

function getItemById(id) {
  return appData.items.find(i => i.id === id);
}

function formatCLP(value) {
  return value.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  });
}

function updateCurrentUserUI() {
  const label = document.getElementById("currentUserLabel");
  const logoutBtn = document.getElementById("logoutBtn");
  const mainNav = document.getElementById("mainNav");

  if (appData.currentUser) {
    label.textContent = "Usuario: " + appData.currentUser;
    logoutBtn.style.display = "inline-block";
    mainNav.style.display = "flex";
    switchView("view-movimientos");
  } else {
    label.textContent = "No autenticado";
    logoutBtn.style.display = "none";
    mainNav.style.display = "none";
    switchView("view-auth");
  }
}

function switchView(viewId) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const view = document.getElementById(viewId);
  if (view) view.classList.add("active");

  document.querySelectorAll("nav button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

  if (viewId === "view-stock") {
    renderStockTable();
  }
  if (viewId === "view-movimientos") {
    populateMovementItems();
  }
}

// ---- AUTENTICACIÓN ----
const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const registerMsg = document.getElementById("registerMsg");
const loginMsg = document.getElementById("loginMsg");
const logoutBtn = document.getElementById("logoutBtn");

registerForm.addEventListener("submit", e => {
  e.preventDefault();
  const user = document.getElementById("regUsername").value.trim();
  const pass = document.getElementById("regPassword").value;

  if (!user || !pass) {
    showMessage(registerMsg, "Completa todos los campos.", "error");
    return;
  }

  const exists = appData.users.some(u => u.username === user);
  if (exists) {
    showMessage(registerMsg, "Ese usuario ya existe.", "error");
    return;
  }

  appData.users.push({ username: user, password: pass });
  appData.currentUser = user;
  saveData(appData);

  showMessage(loginMsg, "", "ok");
  updateCurrentUserUI();
  showMessage(registerMsg, "Usuario creado e iniciado sesión.", "ok");
  registerForm.reset();
});

loginForm.addEventListener("submit", e => {
  e.preventDefault();
  const user = document.getElementById("loginUsername").value.trim();
  const pass = document.getElementById("loginPassword").value;
  const found = appData.users.find(u => u.username === user && u.password === pass);

  if (!found) {
    showMessage(loginMsg, "Usuario o contraseña incorrectos.", "error");
    return;
  }

  appData.currentUser = user;
  saveData(appData);
  showMessage(loginMsg, "", "ok");
  updateCurrentUserUI();
});

logoutBtn.addEventListener("click", () => {
  appData.currentUser = null;
  saveData(appData);
  updateCurrentUserUI();
});

// ---- ITEMS: CREAR / EDITAR ----
const itemForm = document.getElementById("itemForm");
const itemMsg = document.getElementById("itemMsg");
const clearItemFormBtn = document.getElementById("clearItemForm");
const itemPriceInput = document.getElementById("itemPrice");
const itemPriceModeSelect = document.getElementById("itemPriceMode");
const itemPriceInfo = document.getElementById("itemPriceInfo");

let editingItemId = null;

function updatePricePreview() {
  const raw = parseFloat(itemPriceInput.value || "0");
  const mode = itemPriceModeSelect.value;
  if (!raw || raw <= 0) {
    itemPriceInfo.textContent = "";
    return;
  }

  let net, iva, total;
  if (mode === "with") {
    total = raw;
    net = total / (1 + IVA_RATE);
    iva = total - net;
    itemPriceInfo.textContent =
      `De ${formatCLP(total)} aprox. ${formatCLP(net)} son neto y ${formatCLP(iva)} corresponden al IVA (por 1 unidad).`;
  } else {
    net = raw;
    iva = net * IVA_RATE;
    total = net + iva;
    itemPriceInfo.textContent =
      `Precio neto: ${formatCLP(net)} | IVA aprox: ${formatCLP(iva)} | Total con IVA: ${formatCLP(total)} (por 1 unidad).`;
  }
}

itemPriceInput.addEventListener("input", updatePricePreview);
itemPriceModeSelect.addEventListener("change", updatePricePreview);

itemForm.addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("itemName").value.trim();
  const desc = document.getElementById("itemDesc").value.trim();
  const min = Number(document.getElementById("itemMin").value || 0);
  const max = Number(document.getElementById("itemMax").value || 0);
  const initStock = Number(document.getElementById("itemInitStock").value || 0);

  const priceRaw = parseFloat(itemPriceInput.value || "0");
  const priceMode = itemPriceModeSelect.value;

  if (!name) {
    showMessage(itemMsg, "El nombre es obligatorio.", "error");
    return;
  }
  if (max > 0 && min > max) {
    showMessage(itemMsg, "El mínimo no puede ser mayor que el máximo.", "error");
    return;
  }

  let priceNet = null, priceIVA = null, priceTotal = null, storedMode = null;
  if (priceRaw && priceRaw > 0) {
    storedMode = priceMode;
    if (priceMode === "with") {
      priceTotal = priceRaw;
      priceNet = priceTotal / (1 + IVA_RATE);
      priceIVA = priceTotal - priceNet;
    } else {
      priceNet = priceRaw;
      priceIVA = priceNet * IVA_RATE;
      priceTotal = priceNet + priceIVA;
    }
  }

  if (editingItemId) {
    const item = getItemById(editingItemId);
    if (item) {
      item.name = name;
      item.desc = desc;
      item.min = min;
      item.max = max;
      item.stock = initStock;
      item.priceNet = priceNet;
      item.priceIVA = priceIVA;
      item.priceTotal = priceTotal;
      item.priceMode = storedMode;
    }
    showMessage(itemMsg, "Ítem actualizado.", "ok");
  } else {
    const newItem = {
      id: genId(),
      name,
      desc,
      min,
      max,
      stock: initStock,
      code: "IT-" + genId().toUpperCase(),
      priceNet,
      priceIVA,
      priceTotal,
      priceMode: storedMode,
      transactions: []
    };
    appData.items.push(newItem);
    showMessage(itemMsg, "Ítem creado.", "ok");
  }

  saveData(appData);
  populateMovementItems();
  renderStockTable();
  itemForm.reset();
  itemPriceInfo.textContent = "";
  editingItemId = null;
});

clearItemFormBtn.addEventListener("click", () => {
  editingItemId = null;
  itemForm.reset();
  itemPriceInfo.textContent = "";
  showMessage(itemMsg, "", "ok");
});

// ---- MOVIMIENTOS ----
const movementItemSelect = document.getElementById("movementItem");
const movementForm = document.getElementById("movementForm");
const movementMsg = document.getElementById("movementMsg");
const openScannerBtn = document.getElementById("openScannerBtn");
const closeScannerBtn = document.getElementById("closeScannerBtn");

function populateMovementItems() {
  movementItemSelect.innerHTML = "";
  if (appData.items.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No hay ítems. Crea uno primero.";
    movementItemSelect.appendChild(opt);
    movementItemSelect.disabled = true;
  } else {
    movementItemSelect.disabled = false;
    appData.items.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.name;
      movementItemSelect.appendChild(opt);
    });
  }
}

function checkAlarms(item) {
  let msg = "";
  if (item.stock <= item.min) {
    msg += `⚠ Stock en o bajo el mínimo (${item.min}). `;
  }
  if (item.max > 0 && item.stock >= item.max) {
    msg += `⚠ Stock en o sobre el máximo (${item.max}). `;
  }
  if (msg) {
    alert("ALERTA para " + item.name + ":\n\n" + msg);
  }
}

movementForm.addEventListener("submit", e => {
  e.preventDefault();
  const itemId = movementItemSelect.value;
  const type = document.getElementById("movementType").value;
  const qty = Number(document.getElementById("movementQty").value || 0);

  if (!itemId) {
    showMessage(movementMsg, "Selecciona un ítem.", "error");
    return;
  }
  if (qty <= 0) {
    showMessage(movementMsg, "La cantidad debe ser mayor a 0.", "error");
    return;
  }

  const item = getItemById(itemId);
  if (!item) {
    showMessage(movementMsg, "Ítem no encontrado.", "error");
    return;
  }

  if (type === "out" && item.stock < qty) {
    showMessage(movementMsg, "No hay stock suficiente para realizar el retiro.", "error");
    return;
  }

  const movement = {
    date: new Date().toISOString(),
    type,
    qty
  };
  item.transactions.push(movement);

  if (type === "in") {
    item.stock += qty;
  } else {
    item.stock -= qty;
  }

  saveData(appData);
  showMessage(movementMsg, "Movimiento registrado correctamente.", "ok");
  movementForm.reset();
  renderStockTable();
  checkAlarms(item);
});

// ---- ESCÁNER DE CÓDIGO (QR) ----
async function startScanner() {
  if (scannerRunning) return;
  const scannerCard = document.getElementById("scannerCard");
  const scanStatus = document.getElementById("scanStatus");
  scannerCard.style.display = "block";
  scanStatus.textContent = "Iniciando cámara...";

  if (!window.Html5Qrcode) {
    scanStatus.textContent = "No se pudo cargar el lector de códigos.";
    return;
  }

  const config = { fps: 10, qrbox: 250 };
  html5QrCodeInstance = new Html5Qrcode("reader");
  scannerRunning = true;

  const onScanSuccess = (decodedText) => {
    const item = appData.items.find(i => i.code === decodedText);
    if (item) {
      movementItemSelect.value = item.id;
      scanStatus.textContent = "Ítem detectado: " + item.name;
      stopScanner();
    } else {
      scanStatus.textContent = "Código leído, pero no corresponde a ningún ítem.";
    }
  };

  const onScanFailure = (error) => {
    // silencioso
  };

  try {
    await html5QrCodeInstance.start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      onScanFailure
    );
    scanStatus.textContent = "Escaneando... apunta la cámara al código.";
  } catch (err) {
    scanStatus.textContent = "No se pudo iniciar la cámara: " + err;
    scannerRunning = false;
  }
}

async function stopScanner() {
  const scannerCard = document.getElementById("scannerCard");
  const scanStatus = document.getElementById("scanStatus");
  if (html5QrCodeInstance && scannerRunning) {
    try {
      await html5QrCodeInstance.stop();
      await html5QrCodeInstance.clear();
    } catch (e) {
      console.error(e);
    }
  }
  scannerRunning = false;
  scanStatus.textContent = "";
  scannerCard.style.display = "none";
}

openScannerBtn.addEventListener("click", () => {
  startScanner();
});

closeScannerBtn.addEventListener("click", () => {
  stopScanner();
});

window.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopScanner();
  }
});

// ---- LISTADO DE STOCK + SUGERENCIAS ----
const stockTableBody = document.querySelector("#stockTable tbody");
const suggestionsList = document.getElementById("suggestionsList");

function getItemStatus(item) {
  if (item.stock <= item.min) return "low";
  if (item.max > 0 && item.stock >= item.max) return "high";
  return "ok";
}

function computeWeeklySuggestions() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const suggestions = [];

  appData.items.forEach(item => {
    if (!item.transactions || item.transactions.length === 0) return;

    const weeklyTx = item.transactions.filter(t => {
      const d = new Date(t.date);
      return d >= sevenDaysAgo && d <= now;
    });

    if (weeklyTx.length === 0) return;

    let inQty = 0;
    let outQty = 0;
    weeklyTx.forEach(t => {
      if (t.type === "in") inQty += t.qty;
      else if (t.type === "out") outQty += t.qty;
    });

    const max = item.max || 0;
    const min = item.min || 0;

    if (max > 0) {
      if (outQty > max * 0.7) {
        suggestions.push(
          `🔼 Considera <strong>aumentar la cantidad máxima</strong> de <strong>${item.name}</strong>. ` +
          `Retiros últimos 7 días: ${outQty}, máximo actual: ${max}.`
        );
      } else if (outQty < max * 0.2 && item.stock < max * 0.3) {
        suggestions.push(
          `🔽 Podrías <strong>disminuir la cantidad máxima</strong> de <strong>${item.name}</strong>. ` +
          `Retiros últimos 7 días: ${outQty}, máximo actual: ${max}.`
        );
      }
    } else {
      if (outQty > 0 && item.stock <= min) {
        suggestions.push(
          `⚠ <strong>${item.name}</strong> se ha movido bastante (retiros: ${outQty}) y está cerca del mínimo (${min}). ` +
          `Evalúa aumentar stock máximo o frecuencia de reposición.`
        );
      }
    }
  });

  suggestionsList.innerHTML = "";
  if (suggestions.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = "Por ahora no hay suficientes movimientos en los últimos 7 días para generar sugerencias.";
    suggestionsList.appendChild(li);
  } else {
    suggestions.forEach(text => {
      const li = document.createElement("li");
      li.innerHTML = text;
      suggestionsList.appendChild(li);
    });
  }
}

function renderStockTable() {
  stockTableBody.innerHTML = "";
  if (appData.items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No hay ítems registrados.";
    tr.appendChild(td);
    stockTableBody.appendChild(tr);

    suggestionsList.innerHTML = "";
    const li = document.createElement("li");
    li.innerHTML = "Crea algunos ítems y registra movimientos para ver sugerencias.";
    suggestionsList.appendChild(li);
    return;
  }

  appData.items.forEach(item => {
    const tr = document.createElement("tr");
    tr.dataset.id = item.id;

    const tdName = document.createElement("td");
    tdName.textContent = item.name;
    if (item.desc) {
      const span = document.createElement("span");
      span.className = "badge";
      span.textContent = item.desc;
      tdName.appendChild(span);
    }

    const tdStock = document.createElement("td");
    tdStock.textContent = item.stock;

    const tdMinMax = document.createElement("td");
    tdMinMax.textContent = `${item.min} / ${item.max || "-"}`;

    const tdPriceUnit = document.createElement("td");
    if (item.priceTotal && item.priceTotal > 0) {
      tdPriceUnit.textContent = formatCLP(item.priceTotal);
    } else {
      tdPriceUnit.textContent = "-";
    }

    const tdTotalValue = document.createElement("td");
    if (item.priceTotal && item.priceTotal > 0 && item.stock > 0) {
      const totalValue = item.priceTotal * item.stock;
      tdTotalValue.textContent = formatCLP(totalValue);
    } else {
      tdTotalValue.textContent = "-";
    }

    const tdStatus = document.createElement("td");
    const status = getItemStatus(item);
    const span = document.createElement("span");
    span.classList.add("status-pill");
    if (status === "ok") {
      span.classList.add("status-ok");
      span.textContent = "OK";
    } else if (status === "low") {
      span.classList.add("status-low");
      span.textContent = "Bajo";
    } else if (status === "high") {
      span.classList.add("status-high");
      span.textContent = "Alto";
    }
    tdStatus.appendChild(span);

    tr.appendChild(tdName);
    tr.appendChild(tdStock);
    tr.appendChild(tdMinMax);
    tr.appendChild(tdPriceUnit);
    tr.appendChild(tdTotalValue);
    tr.appendChild(tdStatus);

    tr.addEventListener("click", () => openItemChart(item.id));

    stockTableBody.appendChild(tr);
  });

  computeWeeklySuggestions();
}

// ---- GRÁFICO POR ÍTEM + QR + PRECIOS ----
const chartModalOverlay = document.getElementById("chartModalOverlay");
const closeChartModalBtn = document.getElementById("closeChartModal");
const chartTitle = document.getElementById("chartTitle");
const chartSubtitle = document.getElementById("chartSubtitle");
const chartCanvas = document.getElementById("itemChart");
const qrCodeContainer = document.getElementById("qrCodeContainer");
const qrText = document.getElementById("qrText");
const priceInfo = document.getElementById("priceInfo");

function openItemChart(itemId) {
  const item = getItemById(itemId);
  if (!item) return;

  const totalIn = item.transactions
    .filter(t => t.type === "in")
    .reduce((sum, t) => sum + t.qty, 0);
  const totalOut = item.transactions
    .filter(t => t.type === "out")
    .reduce((sum, t) => sum + t.qty, 0);

  chartTitle.textContent = "Detalle de: " + item.name;
  chartSubtitle.textContent = `Stock actual: ${item.stock} | Ingresos totales: ${totalIn} | Retiros totales: ${totalOut}`;

  if (currentChart) {
    currentChart.destroy();
  }

  currentChart = new Chart(chartCanvas, {
    type: "bar",
    data: {
      labels: ["Ingresos", "Retiros"],
      datasets: [
        {
          label: "Cantidad",
          data: [totalIn, totalOut]
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });

  // QR
  qrCodeContainer.innerHTML = "";
  qrText.textContent = "Valor del código: " + item.code;
  if (window.QRCode) {
    new QRCode(qrCodeContainer, {
      text: item.code,
      width: 128,
      height: 128
    });
  }

  // Info de precios (si existe)
  if (item.priceTotal && item.priceTotal > 0 && item.priceNet != null && item.priceIVA != null) {
    const totalStockValue = item.priceTotal * item.stock;
    priceInfo.textContent =
      `Precio unitario aprox: Neto ${formatCLP(item.priceNet)} | IVA ${formatCLP(item.priceIVA)} | Total ${formatCLP(item.priceTotal)}. ` +
      `Valor total del stock (c/IVA): ${formatCLP(totalStockValue)}.`;
  } else {
    priceInfo.textContent = "No se ha definido un precio para este ítem.";
  }

  chartModalOverlay.style.display = "flex";
}

closeChartModalBtn.addEventListener("click", () => {
  chartModalOverlay.style.display = "none";
});
chartModalOverlay.addEventListener("click", e => {
  if (e.target === chartModalOverlay) {
    chartModalOverlay.style.display = "none";
  }
});

// ---- NAV ----
document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    const viewId = btn.dataset.view;
    switchView(viewId);
  });
});

// ---- INICIALIZACIÓN ----
updateCurrentUserUI();
populateMovementItems();
renderStockTable();
