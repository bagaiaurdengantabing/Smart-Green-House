
const AUTH_UNTIL_KEY = "GREENHOUSE_AUTH_UNTIL";
const CURRENT_USER_KEY = "GREENHOUSE_CURRENT_USER";
const USERS_KEY = "GREENHOUSE_USERS";
const SESSION_MS = 6 * 60 * 60 * 1000;

function getUsers() {
  let users = {};
  try {
    users = JSON.parse(localStorage.getItem(USERS_KEY) || "{}");
  } catch (error) {
    users = {};
  }

  if (!users.admin) {
    users.admin = {
      password: "12345678",
      createdAt: new Date().toISOString()
    };
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  return users;
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function isLoggedIn() {
  return Number(localStorage.getItem(AUTH_UNTIL_KEY) || 0) > Date.now();
}

function requireLogin() {
  if (!isLoggedIn()) {
    window.location.href = "login.html";
  }
}

function setLoggedIn(username) {
  localStorage.setItem(CURRENT_USER_KEY, username);
  localStorage.setItem(AUTH_UNTIL_KEY, String(Date.now() + SESSION_MS));
}

function logout() {
  localStorage.removeItem(AUTH_UNTIL_KEY);
  localStorage.removeItem(CURRENT_USER_KEY);
  window.location.href = "login.html";
}


// ================= DATABASE USER SUPPORT =================
// Demo/class project only: stores username and password in Supabase app_users.
// Do not use real passwords for production.

const APP_USERS_TABLE = "app_users";

function getDatabaseConfig() {
  const url =
    (typeof SGHS_SUPABASE_URL !== "undefined" ? SGHS_SUPABASE_URL : "") ||
    localStorage.getItem("SUPABASE_URL") ||
    "";

  const key =
    (typeof SGHS_SUPABASE_ANON_KEY !== "undefined" ? SGHS_SUPABASE_ANON_KEY : "") ||
    localStorage.getItem("SUPABASE_KEY") ||
    "";

  return { url, key };
}

function isValidDatabaseKey(key) {
  return key && key !== "PASTE_YOUR_LONG_ANON_KEY_HERE";
}

function getDatabaseClient() {
  const config = getDatabaseConfig();

  if (!config.url || !isValidDatabaseKey(config.key)) {
    console.warn("Supabase URL/key not configured for login database.");
    return null;
  }

  if (!window.supabase) {
    console.warn("Supabase library is not loaded.");
    return null;
  }

  localStorage.setItem("SUPABASE_URL", config.url);
  localStorage.setItem("SUPABASE_KEY", config.key);

  return window.supabase.createClient(config.url, config.key);
}

async function getDatabaseUser(username) {
  const client = getDatabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from(APP_USERS_TABLE)
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error("Database user read error:", error.message);
    return null;
  }

  return data;
}

async function createDatabaseUser(username, password) {
  const client = getDatabaseClient();
  if (!client) return { saved: false, message: "Database not configured." };

  const { error } = await client.from(APP_USERS_TABLE).insert({
    username: username,
    password: password,
    created_at: new Date().toISOString(),
    last_login_at: null,
    login_count: 0
  });

  if (error) {
    console.error("Database user insert error:", error.message);
    return { saved: false, message: error.message };
  }

  return { saved: true, message: "Saved to database." };
}

async function updateDatabaseLogin(username, currentLoginCount) {
  const client = getDatabaseClient();
  if (!client) return;

  await client
    .from(APP_USERS_TABLE)
    .update({
      last_login_at: new Date().toISOString(),
      login_count: Number(currentLoginCount || 0) + 1
    })
    .eq("username", username);
}

async function syncLocalAdminToDatabase() {
  const client = getDatabaseClient();
  if (!client) return;

  const existing = await getDatabaseUser("admin");
  if (existing) return;

  await createDatabaseUser("admin", "12345678");
}


// ================= THEME SUPPORT =================
const THEME_MODE_KEY = "GREENHOUSE_THEME_MODE";

function getThemeMode() {
  return localStorage.getItem(THEME_MODE_KEY) || "dark";
}

function applyThemeMode() {
  const mode = getThemeMode();
  document.documentElement.setAttribute("data-theme", mode);
}

function setThemeMode(mode) {
  const selected = mode === "light" ? "light" : "dark";
  localStorage.setItem(THEME_MODE_KEY, selected);
  applyThemeMode();

  const label = document.getElementById("themeModeText");
  if (label) {
    label.textContent = selected === "light" ? "Current mode: Light Mode" : "Current mode: Dark Mode";
  }
}

window.addEventListener("DOMContentLoaded", applyThemeMode);
