const form = document.getElementById("forgotForm");
const sendCodeBtn = document.getElementById("sendCode");
const toast = document.getElementById("toast");

const emailInput = form ? form.querySelector('input[name="email"]') : null;
const codeInput = form ? form.querySelector('input[name="code"]') : null;
const passwordInput = form ? form.querySelector('input[name="newPassword"]') : null;

let toastTimer = null;
const REQUEST_TIMEOUT_MS = 12000;

function showToast(message, type = "error") {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove("toast-error", "toast-success");
  toast.classList.add(type === "success" ? "toast-success" : "toast-error", "visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 2600);
}

async function postJson(url, payload, fallbackError, timeoutMs = 0) {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || fallbackError);
    }

    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendResetCode() {
  if (!sendCodeBtn) return;

  const email = emailInput ? emailInput.value.trim() : "";
  if (!email) {
    showToast("Введите email", "error");
    return;
  }

  sendCodeBtn.disabled = true;
  const originalBtnText = sendCodeBtn.textContent;
  sendCodeBtn.textContent = "Отправка...";

  try {
    const data = await postJson("/api/auth/forgot-password", { email }, "Ошибка отправки кода", REQUEST_TIMEOUT_MS);
    showToast(data.message || "Код отправлен", "success");
  } catch (error) {
    const isTimeout = error && error.name === "AbortError";
    showToast(isTimeout ? "Таймаут сети при отправке кода. Попробуйте еще раз." : error.message, "error");
  } finally {
    sendCodeBtn.disabled = false;
    sendCodeBtn.textContent = originalBtnText;
  }
}

if (sendCodeBtn) {
  sendCodeBtn.addEventListener("click", sendResetCode);
}

if (emailInput && sendCodeBtn) {
  emailInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendResetCode();
    }
  });
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      email: emailInput ? emailInput.value.trim() : "",
      code: codeInput ? codeInput.value.trim() : "",
      newPassword: passwordInput ? passwordInput.value : ""
    };

    try {
      const data = await postJson("/api/auth/reset-password", payload, "Ошибка сброса пароля");
      showToast(data.message, "success");
      setTimeout(() => {
        location.href = "/pages/login.html";
      }, 1200);
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}
