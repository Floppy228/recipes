const registerForm = document.getElementById("registerForm");
const toast = document.getElementById("toast");
let toastTimer = null;

function showToast(message, type = "error") {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("toast-error", "toast-success");
  toast.classList.add(type === "success" ? "toast-success" : "toast-error", "visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

async function postJson(url, payload, fallbackError) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || fallbackError);
  }
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(registerForm);
  const payload = {
    login: formData.get("login"),
    email: formData.get("email"),
    password: formData.get("password")
  };

  try {
    await postJson("/api/auth/register", payload, "Ошибка регистрации");
    showToast("Аккаунт создан", "success");
    setTimeout(() => {
      location.href = "/pages/dashboard.html";
    }, 350);
  } catch (error) {
    showToast(error.message, "error");
  }
});
