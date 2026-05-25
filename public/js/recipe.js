const content = document.getElementById("content");
const toast = document.getElementById("toast");

let currentRecipeId = "";
let currentUser = null;
let toastTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("visible");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 5000);
}

function formatDate(value) {
  return new Date(value).toLocaleString("ru-RU");
}

function renderComments(recipe) {
  const comments = Array.isArray(recipe.comments) ? recipe.comments : [];

  if (!comments.length) {
    return '<p class="empty-note">Пока нет комментариев.</p>';
  }

  return `
    <div class="comments-list">
      ${comments
        .map(
          (comment) => `
            <article class="comment-card">
              <p class="comment-head">${comment.userLogin} • ${formatDate(comment.createdAt)}</p>
              <p class="comment-text">${comment.text}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRecipe(recipe, user) {
  const authorUrl = `/pages/index.html?search=${encodeURIComponent(recipe.authorLogin)}`;
  const likesCount = Number(recipe.likesCount || 0);
  const views = Number(recipe.views || 0);
  const commentsCount = Number(recipe.commentsCount || 0);
  const userLiked = Boolean(recipe.userLiked);
  const authNote = user
    ? ""
    : '<p class="auth-note">Лайкать и комментировать могут только зарегистрированные пользователи.</p>';

  content.innerHTML = `
    <h2>${recipe.title}</h2>
    <p>${recipe.category} • Автор: <a href="${authorUrl}">${recipe.authorLogin}</a></p>

    <section class="stats-panel">
      <div class="stat-pill">Просмотры: <strong>${views}</strong></div>
      <div class="stat-pill">Лайки: <strong id="likesCount">${likesCount}</strong></div>
      <div class="stat-pill">Комментарии: <strong id="commentsCount">${commentsCount}</strong></div>
    </section>

    <div class="social-actions">
      <button class="btn ${userLiked ? "secondary" : ""}" id="likeBtn">
        ${userLiked ? "Убрать лайк" : "Лайкнуть"}
      </button>
    </div>

    ${authNote}
    ${recipe.coverImage ? `<img src="${recipe.coverImage}" alt="${recipe.title}" />` : ""}
    <p>${recipe.description || ""}</p>

    <h3>Ингредиенты</h3>
    <ul>
      ${recipe.ingredients.map((item) => `<li>${item}</li>`).join("")}
    </ul>

    <h3>Шаги</h3>
    <ol>
      ${recipe.steps
        .map(
          (step) => `
            <li>
              ${step.text}
              ${step.image ? `<div class="step-img"><img src="${step.image}" alt="Шаг" /></div>` : ""}
            </li>
          `
        )
        .join("")}
    </ol>

    <section class="comments-section">
      <h3>Комментарии</h3>
      ${
        user
          ? `
            <form id="commentForm" class="comment-form">
              <textarea id="commentText" rows="3" placeholder="Напишите комментарий"></textarea>
              <button type="submit" class="btn">Отправить комментарий</button>
            </form>
          `
          : ""
      }
      <div id="commentsWrap">
        ${renderComments(recipe)}
      </div>
    </section>
  `;
}

async function init() {
  try {
    currentRecipeId = new URLSearchParams(location.search).get("id");
    if (!currentRecipeId) {
      throw new Error("Не указан рецепт");
    }

    try {
      await api(`/api/recipes/${currentRecipeId}/view`, { method: "POST" });
    } catch (_) {
      // keep page usable
    }

    await loadRecipe();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadRecipe() {
  const [{ recipe }, { user }] = await Promise.all([
    api(`/api/recipes/${currentRecipeId}`),
    api("/api/session")
  ]);

  currentUser = user;
  renderRecipe(recipe, user);

  const likeBtn = document.getElementById("likeBtn");

  likeBtn.addEventListener("click", async () => {
    if (!currentUser) {
      showToast("Войдите в аккаунт, чтобы добавлять рецепты в избранное.");
      return;
    }

    const result = await api(`/api/recipes/${currentRecipeId}/like`, { method: "POST" });
    likeBtn.textContent = result.userLiked ? "Убрать лайк" : "Лайкнуть";
    likeBtn.classList.toggle("secondary", result.userLiked);
    document.getElementById("likesCount").textContent = result.likesCount;
  });

  if (!user) {
    return;
  }

  const commentForm = document.getElementById("commentForm");

  commentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const commentText = document.getElementById("commentText");
    const text = commentText.value.trim();

    if (!text) return;

    await api(`/api/recipes/${currentRecipeId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text })
    });

    await loadRecipe();
  });
}

init();
