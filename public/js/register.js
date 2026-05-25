const msg = document.getElementById("msg");
const registerForm = document.getElementById("registerForm");

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  msg.textContent = "";

  const formData = new FormData(registerForm);
  const payload = {
    login: formData.get("login"),
    email: formData.get("email"),
    password: formData.get("password")
  };

  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка регистрации");
    }

    location.href = "/pages/dashboard.html";
  } catch (error) {
    msg.textContent = error.message;
  }
});
