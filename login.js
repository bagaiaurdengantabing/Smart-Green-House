let loginMode = "login";

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

function switchMode(nextMode) {
  loginMode = nextMode;

  el("formTitle").textContent = loginMode === "login" ? "Login" : "Sign Up";
  el("formSubtitle").textContent = loginMode === "login"
    ? "Login to view the data. Session expires every 6 hours."
    : "Create an account for this dashboard demo.";

  el("submitBtn").textContent = loginMode === "login" ? "Login" : "Create Account";
  el("switchLoginBtn").style.display = loginMode === "login" ? "none" : "inline-flex";
  el("switchSignupBtn").style.display = loginMode === "login" ? "inline-flex" : "none";

  el("errorBox").classList.remove("show");
  el("messageBox").classList.remove("show");
}

async function submitForm() {
  const username = el("username").value.trim();
  const password = el("password").value.trim();

  if (!username || !password) {
    showError("Please enter username and password.");
    return;
  }

  const users = getUsers();

  if (loginMode === "signup") {
    if (password.length < 6) {
      showError("Password must be at least 6 characters.");
      return;
    }

    const databaseUser = await getDatabaseUser(username);

    if (databaseUser || users[username]) {
      showError("This username already exists.");
      return;
    }

    users[username] = {
      password,
      createdAt: new Date().toISOString()
    };

    saveUsers(users);

    const saveResult = await createDatabaseUser(username, password);

    if (saveResult.saved) {
      showMessage("Account created and saved to database. Please login now.");
    } else {
      showMessage("Account created locally. Database not saved: " + saveResult.message);
    }

    switchMode("login");
    el("password").value = "";
    return;
  }

  const databaseUser = await getDatabaseUser(username);

  if (databaseUser) {
    if (databaseUser.password !== password) {
      showError("Wrong username or password.");
      return;
    }

    await updateDatabaseLogin(username, databaseUser.login_count);
    setLoggedIn(username);
    window.location.href = "dashboard.html";
    return;
  }

  if (!users[username] || users[username].password !== password) {
    showError("Wrong username or password.");
    return;
  }

  setLoggedIn(username);

  // Sync local user to database if Supabase is configured.
  await createDatabaseUser(username, password);

  window.location.href = "dashboard.html";
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitForm();
});

window.addEventListener("load", async () => {
  getUsers();
  switchMode("login");

  // Put default admin into database if Supabase config is ready.
  await syncLocalAdminToDatabase();

  if (isLoggedIn()) {
    window.location.href = "dashboard.html";
  }
});
