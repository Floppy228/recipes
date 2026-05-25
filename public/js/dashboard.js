const list = document.getElementById("list");
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Ошибка запроса (${response.status})`);
  }

  return data;
}

function bindCardNavigation() {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      location.href = card.dataset.recipeUrl;
    });
  });
}

function bindDeleteButtons() {
  document.querySelectorAll(".del").forEach((button) => {
    button.onclick = async () => {
      if (!confirm("Удалить рецепт?")) return;
      await fetchJson(`/api/recipes/${button.dataset.id}`, { method: "DELETE" });
      showToast("Рецепт удален", "success");
      await init();
    };
  });
}

function renderRecipes(recipes) {
  if (!recipes.length) {
    list.innerHTML = "<p>У вас пока нет рецептов.</p>";
    return;
  }

  list.innerHTML = recipes.map((recipe) => `
    <article class="card" data-recipe-url="/pages/recipe.html?id=${recipe.id}">
      ${recipe.coverImage ? `<img src="${recipe.coverImage}" alt="${recipe.title}" />` : ""}
      <p class="muted">${recipe.category}</p>
      <h3>${recipe.title}</h3>
      <p>${recipe.description || ""}</p>
      <div class="actions">
        <a class="btn" href="/pages/recipe.html?id=${recipe.id}">Открыть</a>
        <a class="btn" href="/pages/recipe-form.html?id=${recipe.id}">Изменить</a>
        <button data-id="${recipe.id}" class="del">Удалить</button>
      </div>
    </article>
  `).join("");

  bindDeleteButtons();
  bindCardNavigation();
}

async function init() {
  try {
    const session = await fetchJson("/api/session");
    if (!session.user) {
      location.href = "/pages/login.html";
      return;
    }

    document.getElementById("logoutBtn").onclick = async () => {
      await fetchJson("/api/auth/logout", { method: "POST" });
      location.href = "/pages/index.html";
    };

    const deleteAccountBtn = document.getElementById("deleteAccountBtn");
    if (deleteAccountBtn) {
      deleteAccountBtn.onclick = async () => {
        try {
          if (!confirm("Удалить аккаунт? Это действие необратимо.")) return;
          await fetchJson("/api/auth/account", { method: "DELETE" });
          showToast("Аккаунт удален", "success");
          setTimeout(() => {
            location.href = "/pages/index.html";
          }, 350);
        } catch (error) {
          showToast(error.message || "Не удалось удалить аккаунт", "error");
        }
      };
    }

    const { recipes } = await fetchJson("/api/recipes?mine=1");
    renderRecipes(recipes);
  } catch (error) {
    showToast(error.message, "error");
  }
}

init();
