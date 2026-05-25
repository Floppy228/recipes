const msg = document.getElementById("msg");
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

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 2600);
}

async function sendResetCode() {
  if (!sendCodeBtn) return;

    msg.textContent = "";

    const email = emailInput ? emailInput.value.trim() : "";
    if (!email) {
      msg.style.color = "#a32626";
      msg.textContent = "Введите email";
      showToast("Введите email", "error");
      return;
    }

    sendCodeBtn.disabled = true;
    const originalBtnText = sendCodeBtn.textContent;
    sendCodeBtn.textContent = "Отправка...";

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        signal: controller.signal
      });
      clearTimeout(timer);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Ошибка отправки кода");
      }

      msg.style.color = "green";
      msg.textContent = data.message || "Код отправлен";
      showToast(data.message || "Код отправлен", "success");
    } catch (error) {
      const timeoutError = error && error.name === "AbortError";
      const message = timeoutError
        ? "Таймаут сети при отправке кода. Попробуйте еще раз."
        : error.message;
      msg.style.color = "#a32626";
      msg.textContent = message;
      showToast(message, "error");
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
    msg.textContent = "";

    const payload = {
      email: emailInput ? emailInput.value.trim() : "",
      code: codeInput ? codeInput.value.trim() : "",
      newPassword: passwordInput ? passwordInput.value : ""
    };

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Ошибка сброса пароля");
      }

      msg.style.color = "green";
      msg.textContent = data.message;
      showToast(data.message, "success");

      setTimeout(() => {
        location.href = "/pages/login.html";
      }, 1200);
    } catch (error) {
      msg.style.color = "#a32626";
      msg.textContent = error.message;
      showToast(error.message, "error");
    }
  });
}
