const list = document.getElementById("list");
const msg = document.getElementById("msg");

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

function renderRecipes(recipes) {
  if (!recipes.length) {
    list.innerHTML = "<p>У вас пока нет рецептов.</p>";
    return;
  }

  list.innerHTML = recipes
    .map(
      (recipe) => `
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
    `
    )
    .join("");

  document.querySelectorAll(".del").forEach((button) => {
    button.onclick = async () => {
      if (!confirm("Удалить рецепт?")) {
        return;
      }

      await fetchJson(`/api/recipes/${button.dataset.id}`, { method: "DELETE" });
      await init();
    };
  });

  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) {
        return;
      }

      location.href = card.dataset.recipeUrl;
    });
  });
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

    const { recipes } = await fetchJson("/api/recipes?mine=1");
    renderRecipes(recipes);
  } catch (error) {
    msg.textContent = error.message;
  }
}

init();
