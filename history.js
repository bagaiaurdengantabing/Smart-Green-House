requireLogin();

const READINGS_TABLE = "sensor_readings";
let supabaseClient = null;
let latestRows = [];
let currentPage = 1;
const maxPage = 5;
const pageSize = 200;

function el(id) {
  return document.getElementById(id);
}

function showError(message) {
  el("errorBox").textContent = message;
  el("errorBox").classList.add("show");
  el("messageBox").classList.remove("show");
}

function showMessage(message) {
  el("messageBox").textContent = message;
  el("messageBox").classList.add("show");
  el("errorBox").classList.remove("show");
}

function fmt(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return Number(value).toFixed(decimals);
}

function fullTime(value) {
  if (!value) return "--";

  return new Date(value).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function duration(sec) {
  sec = Number(sec || 0);

  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function getConfig() {
  return {
    url:
      (typeof SGHS_SUPABASE_URL !== "undefined" ? SGHS_SUPABASE_URL : "") ||
      localStorage.getItem("SUPABASE_URL") ||
      "",

    key:
      (typeof SGHS_SUPABASE_ANON_KEY !== "undefined" ? SGHS_SUPABASE_ANON_KEY : "") ||
      localStorage.getItem("SUPABASE_KEY") ||
      ""
  };
}

function openSettings() {
  const label = el("themeModeText");

  if (label && typeof getThemeMode === "function") {
    label.textContent =
      getThemeMode() === "light"
        ? "Current mode: Light Mode"
        : "Current mode: Dark Mode";
  }

  el("settingsModal").classList.add("show");
}

function closeSettings() {
  el("settingsModal").classList.remove("show");
}

function saveConfig() {
  closeSettings();
}

function initSupabase() {
  const config = getConfig();

  if (!config.url || !config.key) {
    showError("Supabase URL/key missing. Please edit supabase_config.js in the code.");
    return false;
  }

  if (!window.supabase) {
    showError("Supabase library did not load.");
    return false;
  }

  supabaseClient = supabase.createClient(config.url, config.key);
  return true;
}

async function loadPage(page) {
  if (page < 1 || page > maxPage) return;

  currentPage = page;

  if (!supabaseClient && !initSupabase()) return;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error } = await supabaseClient
    .from(READINGS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    showError("History load error: " + error.message);
    return;
  }

  latestRows = data || [];

  updateTable(latestRows, from);
  updatePagination();

  showMessage(`Page ${page} loaded. Maximum 200 rows per page.`);
}

function updatePagination() {
  for (let i = 1; i <= maxPage; i++) {
    const btn = el("page" + i);

    if (btn) {
      btn.classList.toggle("active-auto", i === currentPage);
    }
  }
}

function updateTable(rows, offset) {
  if (!rows.length) {
    el("historyBody").innerHTML =
      '<tr><td colspan="17">No data found.</td></tr>';
    return;
  }

  el("historyBody").innerHTML = rows
    .map((r, i) => {
      const moisture1 = r.moisture_1_percent ?? r.moisture_percent;
      const moisture2 = r.moisture_2_percent ?? r.moisture_percent;
      const overallMoisture = r.moisture_percent;

      return `
        <tr>
          <td>${offset + i + 1}</td>
          <td>${fullTime(r.created_at)}</td>
          <td>${fmt(r.temperature, 1)} °C</td>
          <td>${fmt(r.humidity, 1)} %</td>
          <td>${fmt(r.lux, 1)} lx</td>

          <td>${fmt(moisture1, 0)} %</td>
          <td>${fmt(moisture2, 0)} %</td>
          <td>${fmt(overallMoisture, 0)} %</td>

          <td>${fmt(r.water_level_percent, 0)} %</td>

          <td class="${r.light_relay ? "on" : "off"}">
            ${r.light_relay ? "ON" : "OFF"}
          </td>

          <td class="${r.pump_relay ? "on" : "off"}">
            ${r.pump_relay ? "ON" : "OFF"}
          </td>

          <td class="${r.tray_pump_relay ? "on" : "off"}">
            ${r.tray_pump_relay ? "ON" : "OFF"}
          </td>

          <td class="${r.fertilizer_relay ? "on" : "off"}">
            ${r.fertilizer_relay ? "ON" : "OFF"}
          </td>

          <td>${duration(r.light_on_seconds)}</td>
          <td>${duration(r.pump_on_seconds)}</td>
          <td>${duration(r.tray_pump_on_seconds)}</td>
          <td>${duration(r.fertilizer_on_seconds)}</td>
        </tr>
      `;
    })
    .join("");
}

function exportCSV() {
  if (!latestRows.length) {
    showError("No data to export.");
    return;
  }

  const headers = [
    "time",
    "temperature",
    "humidity",
    "lux",
    "moisture_sensor_1",
    "moisture_sensor_2",
    "overall_soil_moisture",
    "tray_water_level",
    "light_bulb",
    "irrigation_pump",
    "tray_return_pump",
    "fertilizer_pump",
    "light_on_seconds",
    "pump_on_seconds",
    "tray_pump_on_seconds",
    "fertilizer_on_seconds"
  ];

  const lines = [headers.join(",")];

  latestRows.forEach((r) => {
    lines.push(
      [
        r.created_at,
        r.temperature,
        r.humidity,
        r.lux,

        r.moisture_1_percent ?? r.moisture_percent,
        r.moisture_2_percent ?? r.moisture_percent,
        r.moisture_percent,

        r.water_level_percent,

        r.light_relay ? "ON" : "OFF",
        r.pump_relay ? "ON" : "OFF",
        r.tray_pump_relay ? "ON" : "OFF",
        r.fertilizer_relay ? "ON" : "OFF",

        r.light_on_seconds,
        r.pump_on_seconds,
        r.tray_pump_on_seconds,
        r.fertilizer_on_seconds
      ].join(",")
    );
  });

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `smart_green_house_history_page_${currentPage}.csv`;
  a.click();

  URL.revokeObjectURL(url);
}

window.addEventListener("load", () => {
  if (typeof applyThemeMode === "function") {
    applyThemeMode();
  }

  initSupabase();
  loadPage(1);
});