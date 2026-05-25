const msg = document.getElementById("msg");
const loginForm = document.getElementById("loginForm");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  msg.textContent = "";

  const formData = new FormData(loginForm);
  const payload = {
    login: formData.get("login"),
    password: formData.get("password")
  };

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка авторизации");
    }

    location.href = "/pages/dashboard.html";
  } catch (error) {
    msg.textContent = error.message;
  }
});
