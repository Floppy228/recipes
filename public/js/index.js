async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

const recipesList = document.getElementById("recipesList");
const categorySelect = document.getElementById("categorySelect");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const authActions = document.getElementById("authActions");
const toast = document.getElementById("toast");
const pageParams = new URLSearchParams(location.search);
const searchFromLink = (pageParams.get("search") || pageParams.get("author") || "").trim();
const likedOnly = pageParams.get("liked") === "1";

let currentUser = null;
let toastTimer = null;

async function loadSession() {
  const { user } = await api("/api/session");
  currentUser = user;

  if (user) {
    authActions.innerHTML = `
      <a class="btn secondary" href="/pages/dashboard.html">Мои рецепты</a>
      <button id="logoutBtn">Выйти (${user.login})</button>
    `;

    document.getElementById("logoutBtn").onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      location.reload();
    };
  } else {
    authActions.innerHTML = `
      <a class="btn" href="/pages/login.html">Войти</a>
      <a class="btn secondary" href="/pages/register.html">Регистрация</a>
    `;
  }
}

function showToast(message) {
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.classList.add("visible");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 5000);
}

function recipeCard(recipe) {
  const authorUrl = `/pages/index.html?search=${encodeURIComponent(recipe.authorLogin)}`;
  const likesCount = Number(recipe.likesCount || 0);
  const views = Number(recipe.views || 0);
  const commentsCount = Number(recipe.commentsCount || 0);

  return `
    <article class="recipe-card" data-recipe-url="/pages/recipe.html?id=${recipe.id}">
      ${recipe.coverImage ? `<img src="${recipe.coverImage}" alt="${recipe.title}" />` : ""}
      <p class="meta">
        ${recipe.category} • Автор:
        <a class="author-link" href="${authorUrl}">${recipe.authorLogin}</a>
      </p>
      <p class="meta">Лайки: ${likesCount} • Просмотры: ${views} • Комментарии: ${commentsCount}</p>
      <h3>${recipe.title}</h3>
      <p>${recipe.description || ""}</p>
      <a class="btn" href="/pages/recipe.html?id=${recipe.id}">Открыть рецепт</a>
    </article>
  `;
}

async function loadCategories() {
  const { categories } = await api("/api/categories");
  categorySelect.innerHTML = ["Все", ...categories]
    .map((category) => `<option>${category}</option>`)
    .join("");
}

async function loadRecipes() {
  const category = categorySelect.value || "Все";
  const search = searchInput.value.trim();
  const sort = sortSelect.value || "recent";
  const query = new URLSearchParams();

  if (category !== "Все") {
    query.set("category", category);
  }
  if (search) {
    query.set("search", search);
  }
  if (likedOnly) {
    query.set("liked", "1");
  }
  if (sort !== "recent") {
    query.set("sort", sort);
  }

  const { recipes } = await api(`/api/recipes?${query.toString()}`);

  if (!recipes.length) {
    recipesList.innerHTML = likedOnly
      ? "<p>У вас пока нет избранных рецептов.</p>"
      : "<p>Пока нет рецептов по вашему запросу.</p>";
    return;
  }

  recipesList.innerHTML = recipes.map(recipeCard).join("");

  document.querySelectorAll(".recipe-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) {
        return;
      }

      location.href = card.dataset.recipeUrl;
    });
  });
}

categorySelect.addEventListener("change", loadRecipes);
sortSelect.addEventListener("change", loadRecipes);
searchInput.addEventListener("input", () => {
  const url = new URL(location.href);

  if (searchInput.value.trim()) {
    url.searchParams.set("search", searchInput.value.trim());
  } else {
    url.searchParams.delete("search");
  }

  url.searchParams.delete("author");
  window.history.replaceState({}, "", url);

  clearTimeout(window.__searchTimer);
  window.__searchTimer = setTimeout(loadRecipes, 250);
});

(async function init() {
  try {
    if (searchFromLink) {
      searchInput.value = searchFromLink;
    }

    await Promise.all([loadSession(), loadCategories()]);

    if (likedOnly && !currentUser) {
      showToast("У гостя не может быть избранных рецептов. Сначала войдите в аккаунт.");
    }

    const favoritesButton = document.querySelector('a[href="/pages/index.html?liked=1"]');
    if (favoritesButton) {
      favoritesButton.addEventListener("click", (event) => {
        if (currentUser) {
          return;
        }

        event.preventDefault();
        showToast("Войдите в аккаунт, чтобы добавлять рецепты в избранное.");
      });
    }

    await loadRecipes();
  } catch (error) {
    recipesList.innerHTML = `<p>${error.message}</p>`;
  }
})();
