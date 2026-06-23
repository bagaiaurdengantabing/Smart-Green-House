requireLogin();

const READINGS_TABLE = "sensor_readings";
const CONTROL_TABLE = "device_controls";
const ALERTS_TABLE = "system_alerts";
const SETTINGS_TABLE = "system_settings";
const AUTO_REFRESH_MS = 60000; // 1 minute refresh

let thresholdSettings = {
  light_lux: 150,
  moisture_percent: 70,
  tray_water_percent: 0
};

let supabaseClient = null;
let latestControls = [];
let latestReading = null;
let allRows = [];
let graphRows = [];
let activeRange = "1h";
let refreshTimer = null;
let countdownTimer = null;
let nextRefreshAt = Date.now() + AUTO_REFRESH_MS;

let liveSeconds = {
  light_bulb: 0,
  water_pump: 0,
  tray_pump: 0,
  fertilizer_pump: 0
};

let liveStates = {
  light_bulb: false,
  water_pump: false,
  tray_pump: false,
  fertilizer_pump: false
};

let liveStartMs = {
  light_bulb: null,
  water_pump: null,
  tray_pump: null,
  fertilizer_pump: null
};

function el(id) { return document.getElementById(id); }

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getLocalThresholds() {
  try {
    return {
      light_lux: clampNumber(localStorage.getItem("THRESHOLD_LIGHT_LUX"), 0, 100000, 150),
      moisture_percent: clampNumber(localStorage.getItem("THRESHOLD_MOISTURE_PERCENT"), 0, 100, 70),
      tray_water_percent: clampNumber(localStorage.getItem("THRESHOLD_TRAY_WATER_PERCENT"), 0, 100, 0)
    };
  } catch (error) {
    return { light_lux: 150, moisture_percent: 70, tray_water_percent: 0 };
  }
}

function saveThresholdsToLocal(values) {
  localStorage.setItem("THRESHOLD_LIGHT_LUX", String(values.light_lux));
  localStorage.setItem("THRESHOLD_MOISTURE_PERCENT", String(values.moisture_percent));
  localStorage.setItem("THRESHOLD_TRAY_WATER_PERCENT", String(values.tray_water_percent));
}

function updateThresholdDisplay() {
  if (el("lightThresholdShow")) el("lightThresholdShow").textContent = thresholdSettings.light_lux;
  if (el("moistureThresholdShow")) el("moistureThresholdShow").textContent = thresholdSettings.moisture_percent;
  if (el("trayThresholdShow")) el("trayThresholdShow").textContent = thresholdSettings.tray_water_percent;
}

function fmt(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(decimals);
}

function fmtTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function showMessage(message) {
  el("messageBox").textContent = message;
  el("messageBox").classList.add("show");
  el("errorBox").classList.remove("show");
  setTimeout(() => el("messageBox").classList.remove("show"), 3500);
}

function showError(message) {
  el("errorBox").textContent = message;
  el("errorBox").classList.add("show");
  el("messageBox").classList.remove("show");
}

function showAlert(message) {
  const node = el("alertModalText");
  if (node) node.innerHTML = message;
  const modal = el("alertModal");
  if (modal) modal.classList.add("show");
}

function closeAlertModal() {
  const modal = el("alertModal");
  if (modal) modal.classList.remove("show");
}

function clearBoxes() {
  ["messageBox", "errorBox"].forEach((id) => {
    if (el(id)) {
      el(id).textContent = "";
      el(id).classList.remove("show");
    }
  });
}

function openSettings() {
  const label = el("themeModeText");
  if (label && typeof getThemeMode === "function") {
    label.textContent = getThemeMode() === "light" ? "Current mode: Light Mode" : "Current mode: Dark Mode";
  }
  el("settingsModal").classList.add("show");
}

function closeSettings() {
  el("settingsModal").classList.remove("show");
}

function openThresholdModal() {
  thresholdSettings = getLocalThresholds();
  updateThresholdDisplay();

  if (el("thresholdLightOnly")) el("thresholdLightOnly").value = thresholdSettings.light_lux;
  if (el("thresholdMoistureOnly")) el("thresholdMoistureOnly").value = thresholdSettings.moisture_percent;
  if (el("thresholdTrayOnly")) el("thresholdTrayOnly").value = thresholdSettings.tray_water_percent;

  const modal = el("thresholdModal");
  if (modal) modal.classList.add("show");
}

function closeThresholdModal() {
  const modal = el("thresholdModal");
  if (modal) modal.classList.remove("show");
}

async function saveThresholdOnly() {
  thresholdSettings = {
    light_lux: clampNumber(el("thresholdLightOnly") ? el("thresholdLightOnly").value : 150, 0, 100000, 150),
    moisture_percent: clampNumber(el("thresholdMoistureOnly") ? el("thresholdMoistureOnly").value : 70, 0, 100, 70),
    tray_water_percent: clampNumber(el("thresholdTrayOnly") ? el("thresholdTrayOnly").value : 0, 0, 100, 0)
  };

  saveThresholdsToLocal(thresholdSettings);
  updateThresholdDisplay();

  if (!supabaseClient) {
    initSupabase();
  }

  await saveThresholdSettings();
  closeThresholdModal();
  updateControlTexts(latestControls);
  updateButtonStyles(latestControls);
  updateCards(latestReading || {});
  showMessage("Threshold values saved.");
}

function getConfig() {
  return {
    url: (typeof SGHS_SUPABASE_URL !== "undefined" ? SGHS_SUPABASE_URL : "") || localStorage.getItem("SUPABASE_URL") || "",
    key: (typeof SGHS_SUPABASE_ANON_KEY !== "undefined" ? SGHS_SUPABASE_ANON_KEY : "") || localStorage.getItem("SUPABASE_KEY") || ""
  };
}

async function saveConfig() {
  closeSettings();
}

function initSupabase() {
  const config = getConfig();

  if (!config.url || !config.key) {
    setStatus(false, "No Supabase config");
    showError("Supabase URL/key missing. Please edit supabase_config.js in the code.");
    return false;
  }

  if (!window.supabase) {
    setStatus(false, "Library error");
    showError("Supabase library did not load. Check internet connection.");
    return false;
  }

  supabaseClient = supabase.createClient(config.url, config.key);
  setStatus(true, "Ready");
  return true;
}

function setStatus(ok, text) {
  el("connectionStatus").textContent = text;
  el("statusDot").className = ok ? "dot ok" : "dot bad";
  el("statusBig").textContent = ok ? "Connected" : "Not connected";
  el("statusBig").style.color = ok ? "var(--green)" : "var(--red)";
}

function resetClock() {
  nextRefreshAt = Date.now() + AUTO_REFRESH_MS;
  updateCountdown();
}

function updateCountdown() {
  const remaining = Math.max(0, nextRefreshAt - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  el("countdownText").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startTimers() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (countdownTimer) clearInterval(countdownTimer);

  refreshTimer = setInterval(() => loadData(false), AUTO_REFRESH_MS);
  countdownTimer = setInterval(() => {
    updateCountdown();
    tickLiveTimers();
  }, 1000);

  resetClock();
}

function tickLiveTimers() {
  const now = Date.now();

  ["light_bulb", "water_pump", "tray_pump", "fertilizer_pump"].forEach((device) => {
    if (liveStates[device]) {
      if (!liveStartMs[device]) liveStartMs[device] = now - liveSeconds[device] * 1000;
      liveSeconds[device] = Math.max(0, Math.floor((now - liveStartMs[device]) / 1000));
    } else {
      liveSeconds[device] = 0;
      liveStartMs[device] = null;
    }
  });

  updateTimerText();
}

function updateTimerText() {
  el("lightOnTimeText").textContent = "ON time: " + fmtDuration(liveSeconds.light_bulb);
  el("pumpOnTimeText").textContent = "ON time: " + fmtDuration(liveSeconds.water_pump);
  if (el("trayPumpOnTimeText")) el("trayPumpOnTimeText").textContent = "ON time: " + fmtDuration(liveSeconds.tray_pump);
  el("fertilizerOnTimeText").textContent = "ON time: " + fmtDuration(liveSeconds.fertilizer_pump);
}

function rangeStartMs() {
  const now = Date.now();
  if (activeRange === "1h") return now - 3600000;
  if (activeRange === "5h") return now - 5 * 3600000;
  if (activeRange === "1d") return now - 24 * 3600000;
  return 0;
}

function setRange(range) {
  activeRange = range;

  ["range1h", "range5h", "range1d", "rangeAll"].forEach((id) => {
    el(id).classList.remove("active-auto");
  });

  const activeId = range === "all" ? "rangeAll" : "range" + range;
  el(activeId).classList.add("active-auto");

  updateGraphFromCachedData();
}

function updateGraphFromCachedData() {
  const startMs = rangeStartMs();

  graphRows = allRows
    .filter((row) => {
      if (activeRange === "all") return true;
      return new Date(row.created_at).getTime() >= startMs;
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  drawChart(graphRows);
}

async function loadThresholdSettings() {
  thresholdSettings = getLocalThresholds();

  if (!supabaseClient) {
    updateThresholdDisplay();
    return;
  }

  const { data, error } = await supabaseClient
    .from(SETTINGS_TABLE)
    .select("*")
    .eq("setting_key", "thresholds")
    .maybeSingle();

  if (!error && data && data.setting_value) {
    const value = data.setting_value;
    thresholdSettings = {
      light_lux: clampNumber(value.light_lux ?? 150, 0, 100000, 150),
      moisture_percent: clampNumber(value.moisture_percent ?? 70, 0, 100, 70),
      tray_water_percent: clampNumber(value.tray_water_percent ?? 0, 0, 100, 0)
    };

    saveThresholdsToLocal(thresholdSettings);
  }

  updateThresholdDisplay();
}

async function saveThresholdSettings() {
  if (!supabaseClient) return;

  const payload = {
    setting_key: "thresholds",
    setting_value: thresholdSettings,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseClient
    .from(SETTINGS_TABLE)
    .upsert(payload, { onConflict: "setting_key" });

  if (error) {
    showError("Threshold save error: " + error.message + ". Please run the updated SQL schema.");
  }
}

async function loadData(showSuccess) {
  clearBoxes();

  if (!supabaseClient && !initSupabase()) return;

  setStatus(true, "Loading...");

  const readingsRes = await supabaseClient
    .from(READINGS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (readingsRes.error) {
    setStatus(false, "Read error");
    showError("Reading table error: " + readingsRes.error.message);
    return;
  }

  const controlsRes = await supabaseClient.from(CONTROL_TABLE).select("*");

  if (controlsRes.error) {
    setStatus(false, "Control error");
    showError("Control table error: " + controlsRes.error.message + ". Please run the updated SQL schema.");
    return;
  }

  latestControls = controlsRes.data || [];
  allRows = readingsRes.data || [];
  await loadThresholdSettings();
  setStatus(true, "Connected");

  if (allRows.length > 0) {
    latestReading = allRows[0];
    updateCards(latestReading);
  } else {
    latestReading = null;
  }

  updateControlTexts(latestControls);
  updateButtonStyles(latestControls);
  updateGraphFromCachedData();
  await loadAlerts();
  resetClock();

  if (showSuccess) showMessage("Latest data refreshed.");
}

async function loadAlerts() {
  const alerts = [];

  if (latestReading && Number(latestReading.water_level_percent) > thresholdSettings.tray_water_percent) {
    alerts.push("Water detected in the bottom tray. The return pump can recycle it back to the water tank.");
  }

  const { data, error } = await supabaseClient
    .from(ALERTS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(3);

  if (!error && data) data.forEach((a) => {
    const msg = String(a.message || "");
    if (!/fertilizer.*(tank|level|low)/i.test(msg)) alerts.push(msg);
  });

  const uniqueAlerts = [...new Set(alerts)];
  if (uniqueAlerts.length) showAlert("⚠️ " + uniqueAlerts.join("<br><br>⚠️ "));
}

function updateCards(row) {
  if (!row) row = {};

  const m1 = clampNumber(row.moisture_1_percent ?? row.moisture_percent ?? 0, 0, 100, 0);
  const m2 = clampNumber(row.moisture_2_percent ?? row.moisture_percent ?? 0, 0, 100, 0);
  const overall = clampNumber(row.moisture_percent ?? ((m1 + m2) / 2), 0, 100, 0);

  el("temperatureValue").textContent = fmt(row.temperature, 1) + " °C";
  el("humidityValue").textContent = fmt(row.humidity, 1) + " %";
  el("luxValue").textContent = fmt(row.lux, 1) + " lx";

  if (el("moisture1Value")) el("moisture1Value").textContent = fmt(m1, 0) + " %";
  if (el("moisture2Value")) el("moisture2Value").textContent = fmt(m2, 0) + " %";
  el("moistureValue").textContent = fmt(overall, 0) + " %";

  el("waterLevelValue").textContent = fmt(row.water_level_percent, 0) + " %";
  el("waterLevelNote").textContent = Number(row.water_level_percent) > thresholdSettings.tray_water_percent ? "Water detected in tray." : "Tray is dry.";
}

function setDeviceVisual(deviceName, isOn) {
  const map = {
    light_bulb: "lightRelayValue",
    water_pump: "pumpRelayValue",
    tray_pump: "trayPumpRelayValue",
    fertilizer_pump: "fertilizerRelayValue"
  };

  const id = map[deviceName];
  if (!id) return;

  el(id).textContent = isOn ? "ON" : "OFF";
  el(id).className = isOn ? "value relay-on" : "value relay-off";

  const wasOn = !!liveStates[deviceName];
  liveStates[deviceName] = !!isOn;

  if (isOn && !wasOn) {
    liveStartMs[deviceName] = Date.now() - (Number(liveSeconds[deviceName] || 0) * 1000);
  }

  if (!isOn) {
    liveSeconds[deviceName] = 0;
    liveStartMs[deviceName] = null;
  }
}

function fmtDuration(sec) {
  sec = Number(sec || 0);
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
}

function updateControlTexts(rows) {
  const light = rows.find((r) => r.device_name === "light_bulb");
  const pump = rows.find((r) => r.device_name === "water_pump");
  const tray = rows.find((r) => r.device_name === "tray_pump");
  const fertilizer = rows.find((r) => r.device_name === "fertilizer_pump");

  if (latestReading) {
    const readingMs = new Date(latestReading.created_at).getTime();
    const ageSeconds = Number.isFinite(readingMs) ? Math.max(0, Math.floor((Date.now() - readingMs) / 1000)) : 0;

    liveSeconds.light_bulb = Number(latestReading.light_on_seconds || 0);
    liveSeconds.water_pump = Number(latestReading.pump_on_seconds || 0);
    liveSeconds.tray_pump = Number(latestReading.tray_pump_on_seconds || 0);
    liveSeconds.fertilizer_pump = Number(latestReading.fertilizer_on_seconds || 0);

    liveStartMs.light_bulb = liveSeconds.light_bulb > 0 ? Date.now() - (liveSeconds.light_bulb + ageSeconds) * 1000 : null;
    liveStartMs.water_pump = liveSeconds.water_pump > 0 ? Date.now() - (liveSeconds.water_pump + ageSeconds) * 1000 : null;
    liveStartMs.tray_pump = liveSeconds.tray_pump > 0 ? Date.now() - (liveSeconds.tray_pump + ageSeconds) * 1000 : null;
    liveStartMs.fertilizer_pump = liveSeconds.fertilizer_pump > 0 ? Date.now() - (liveSeconds.fertilizer_pump + ageSeconds) * 1000 : null;
  }

  if (light) {
    if (light.mode === "manual") {
      el("lightModeText").textContent = "Mode: Manual " + (light.target_state ? "ON" : "OFF");

      if (light.target_state && light.updated_at) {
        liveStartMs.light_bulb = new Date(light.updated_at).getTime();
        liveSeconds.light_bulb = Math.max(0, Math.floor((Date.now() - liveStartMs.light_bulb) / 1000));
      }

      setDeviceVisual("light_bulb", !!light.target_state);

    } else {
      el("lightModeText").textContent = "Mode: AUTO";

      if (latestReading) {
        setDeviceVisual("light_bulb", Number(latestReading.lux) >= 0 && Number(latestReading.lux) < thresholdSettings.light_lux);
      }
    }
  }

  if (pump) {
    if (pump.mode === "manual") {
      el("pumpModeText").textContent = "Mode: Manual " + (pump.target_state ? "ON" : "OFF");

      if (pump.target_state && pump.updated_at) {
        liveStartMs.water_pump = new Date(pump.updated_at).getTime();
        liveSeconds.water_pump = Math.max(0, Math.floor((Date.now() - liveStartMs.water_pump) / 1000));
      }

      setDeviceVisual("water_pump", !!pump.target_state);

    } else {
      el("pumpModeText").textContent = "Mode: AUTO";

      if (latestReading) {
        const m1 = Number(latestReading.moisture_1_percent ?? latestReading.moisture_percent ?? 0);
        const m2 = Number(latestReading.moisture_2_percent ?? latestReading.moisture_percent ?? 0);
        const overallMoisture = Number(latestReading.moisture_percent ?? ((m1 + m2) / 2));

        setDeviceVisual("water_pump", overallMoisture <= thresholdSettings.moisture_percent);
      }
    }
  }

  if (tray) {
    if (tray.mode === "manual") {
      el("trayPumpModeText").textContent = "Mode: Manual " + (tray.target_state ? "ON" : "OFF");

      if (tray.target_state && tray.updated_at) {
        liveStartMs.tray_pump = new Date(tray.updated_at).getTime();
        liveSeconds.tray_pump = Math.max(0, Math.floor((Date.now() - liveStartMs.tray_pump) / 1000));
      }

      setDeviceVisual("tray_pump", !!tray.target_state);

    } else {
      el("trayPumpModeText").textContent = "Mode: AUTO";

      if (latestReading) {
        setDeviceVisual("tray_pump", Number(latestReading.water_level_percent) > thresholdSettings.tray_water_percent);
      }
    }

  } else if (el("trayPumpModeText")) {
    el("trayPumpModeText").textContent = "Mode: AUTO";

    if (latestReading) {
      setDeviceVisual("tray_pump", Number(latestReading.water_level_percent) > thresholdSettings.tray_water_percent);
    }
  }

  if (fertilizer) {
    el("fertilizerModeText").textContent = "Mode: Manual " + (fertilizer.target_state ? "ON" : "OFF");

    if (fertilizer.target_state && fertilizer.updated_at) {
      liveStartMs.fertilizer_pump = new Date(fertilizer.updated_at).getTime();
      liveSeconds.fertilizer_pump = Math.max(0, Math.floor((Date.now() - liveStartMs.fertilizer_pump) / 1000));
    }

    setDeviceVisual("fertilizer_pump", !!fertilizer.target_state);
  }

  updateTimerText();
}

function updateButtonStyles(rows) {
  ["lightOnBtn", "lightOffBtn", "lightAutoBtn", "pumpOnBtn", "pumpOffBtn", "pumpAutoBtn", "trayPumpOnBtn", "trayPumpOffBtn", "trayPumpAutoBtn", "fertilizerOnBtn", "fertilizerOffBtn"].forEach((id) => {
    if (el(id)) el(id).classList.remove("active-on", "active-off", "active-auto");
  });

  const light = rows.find((r) => r.device_name === "light_bulb");
  const pump = rows.find((r) => r.device_name === "water_pump");
  const tray = rows.find((r) => r.device_name === "tray_pump");
  const fertilizer = rows.find((r) => r.device_name === "fertilizer_pump");

  if (light) {
    if (light.mode === "auto") el("lightAutoBtn").classList.add("active-auto");
    else if (light.target_state) el("lightOnBtn").classList.add("active-on");
    else el("lightOffBtn").classList.add("active-off");
  }

  if (pump) {
    if (pump.mode === "auto") el("pumpAutoBtn").classList.add("active-auto");
    else if (pump.target_state) el("pumpOnBtn").classList.add("active-on");
    else el("pumpOffBtn").classList.add("active-off");
  }

  if (tray) {
    if (tray.mode === "auto") el("trayPumpAutoBtn").classList.add("active-auto");
    else if (tray.target_state) el("trayPumpOnBtn").classList.add("active-on");
    else el("trayPumpOffBtn").classList.add("active-off");
  } else if (el("trayPumpAutoBtn")) {
    el("trayPumpAutoBtn").classList.add("active-auto");
  }

  if (fertilizer) {
    if (fertilizer.target_state) el("fertilizerOnBtn").classList.add("active-on");
    else el("fertilizerOffBtn").classList.add("active-off");
  }
}

async function sendDeviceCommand(deviceName, mode, targetState) {
  clearBoxes();

  if (!supabaseClient && !initSupabase()) return;

  const payload = {
    device_name: deviceName,
    mode: mode,
    target_state: targetState,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseClient
    .from(CONTROL_TABLE)
    .upsert(payload, { onConflict: "device_name" });

  if (error) {
    showError("Control command error: " + error.message);
    return;
  }

  const index = latestControls.findIndex((r) => r.device_name === deviceName);
  if (index >= 0) latestControls[index] = payload;
  else latestControls.push(payload);

  if (mode === "manual") {
    if (targetState) {
      liveStartMs[deviceName] = Date.now();
      liveSeconds[deviceName] = 0;
    } else {
      liveStartMs[deviceName] = null;
      liveSeconds[deviceName] = 0;
    }

    setDeviceVisual(deviceName, targetState);
    updateTimerText();
  }

  updateControlTexts(latestControls);
  updateButtonStyles(latestControls);

  const labels = {
    light_bulb: "Light bulb",
    water_pump: "Irrigation pump",
    tray_pump: "Tray return pump",
    fertilizer_pump: "Fertilizer pump"
  };

  const modeLabel = mode === "auto" ? "AUTO" : (targetState ? "ON" : "OFF");
  showMessage((labels[deviceName] || "Device") + " command sent: " + modeLabel);
}

async function insertTestRow() {
  clearBoxes();

  if (!supabaseClient && !initSupabase()) return;

  const lux = 50 + Math.random() * 300;
  const moisture1 = Math.floor(30 + Math.random() * 70);
  const moisture2 = Math.floor(30 + Math.random() * 70);
  const moisture = Math.round((moisture1 + moisture2) / 2);
  const water = Math.floor(10 + Math.random() * 90);

  const light = latestControls.find((r) => r.device_name === "light_bulb");
  const pump = latestControls.find((r) => r.device_name === "water_pump");
  const tray = latestControls.find((r) => r.device_name === "tray_pump");
  const fertilizer = latestControls.find((r) => r.device_name === "fertilizer_pump");

  const row = {
    temperature: Number((28 + Math.random() * 6).toFixed(2)),
    humidity: Number((60 + Math.random() * 25).toFixed(2)),
    lux: Number(lux.toFixed(2)),

    moisture_raw: Math.floor(1500 + Math.random() * 2500),
    moisture_1_raw: Math.floor(1500 + Math.random() * 2500),
    moisture_1_percent: moisture1,
    moisture_2_raw: Math.floor(1500 + Math.random() * 2500),
    moisture_2_percent: moisture2,
    moisture_percent: moisture,

    water_level_raw: Math.floor(800 + Math.random() * 3000),
    water_level_percent: water,

    light_relay: light && light.mode === "manual" ? !!light.target_state : lux < thresholdSettings.light_lux,
    pump_relay: pump && pump.mode === "manual" ? !!pump.target_state : moisture <= thresholdSettings.moisture_percent,
    tray_pump_relay: tray && tray.mode === "manual" ? !!tray.target_state : water > thresholdSettings.tray_water_percent,
    fertilizer_relay: fertilizer ? !!fertilizer.target_state : false,

    light_on_seconds: liveSeconds.light_bulb,
    pump_on_seconds: liveSeconds.water_pump,
    tray_pump_on_seconds: liveSeconds.tray_pump,
    fertilizer_on_seconds: liveSeconds.fertilizer_pump
  };

  const { error } = await supabaseClient.from(READINGS_TABLE).insert(row);

  if (error) {
    showError("Insert error: " + error.message);
  } else {
    await loadData(false);
    showMessage("Test row inserted.");
  }
}

function drawChart(rows) {
  const canvas = el("trendChart");
  const parentWidth = canvas.parentElement.clientWidth - 24;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(720, parentWidth * dpr);
  canvas.height = 380 * dpr;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);

  const left = 58, right = 24, top = 26, bottom = 48;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  ctx.fillStyle = "rgba(255,255,255,.016)";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(111,189,255,.14)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#92aabe";
  ctx.font = "12px Segoe UI,Arial";

  for (let i = 0; i <= 5; i++) {
    const val = i * 20;
    const y = top + plotH - (val / 100) * plotH;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
    ctx.fillText(String(val), 18, y + 4);
  }

  ctx.strokeStyle = "rgba(111,189,255,.28)";
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, top + plotH);
  ctx.lineTo(w - right, top + plotH);
  ctx.stroke();

  if (!rows || rows.length < 2) {
    ctx.fillStyle = "#92aabe";
    ctx.font = "15px Segoe UI,Arial";

    const text = rows && rows.length === 1
      ? "Only 1 record in this time range. Need at least 2 records to draw graph."
      : "No records in this time range. Click Refresh when new data is uploaded.";

    ctx.fillText(text, left + 16, h / 2);
    return;
  }

  const maxIndex = rows.length - 1;
  const x = (i) => left + (plotW / maxIndex) * i;
  const y = (v) => top + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;

  rows.forEach((r, i) => {
    if (i % Math.max(1, Math.ceil(rows.length / 6)) === 0 || i === rows.length - 1) {
      ctx.fillStyle = "#92aabe";
      ctx.font = "11px Segoe UI,Arial";
      ctx.fillText(fmtTime(r.created_at), x(i) - 18, h - 18);
    }
  });

  function series(values, color) {
    ctx.beginPath();

    values.forEach((v, i) => {
      const px = x(i);
      const py = y(v);

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    values.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  series(rows.map((r) => Number(r.moisture_percent || 0)), "#46ffb1");
  series(rows.map((r) => Math.min(Number(r.lux || 0), 1000) / 10), "#46d9ff");
  series(rows.map((r) => Number(r.temperature || 0)), "#ffd166");
  series(rows.map((r) => Number(r.humidity || 0)), "#b0a2ff");
  series(rows.map((r) => Number(r.water_level_percent || 0)), "#ff6380");

  ctx.fillStyle = "#92aabe";
  ctx.font = "12px Segoe UI,Arial";
  ctx.fillText(`Scale: 0 to 100 | Records: ${rows.length}`, left, 18);
}

window.addEventListener("resize", () => updateGraphFromCachedData());

window.addEventListener("load", () => {
  initSupabase();
  setRange("1h");
  loadData(false);
  startTimers();
});

window.addEventListener("load", () => {
  thresholdSettings = getLocalThresholds();
  updateThresholdDisplay();
});

if (typeof applyThemeMode === "function") applyThemeMode();
