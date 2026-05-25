const content = document.getElementById("content");
const msg = document.getElementById("msg");
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
    throw new Error(data.error || "РћС€РёР±РєР° Р·Р°РїСЂРѕСЃР°");
  }

  return data;
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

function formatDate(value) {
  return new Date(value).toLocaleString("ru-RU");
}

function renderComments(recipe) {
  const comments = Array.isArray(recipe.comments) ? recipe.comments : [];

  if (!comments.length) {
    return '<p class="empty-note">РџРѕРєР° РЅРµС‚ РєРѕРјРјРµРЅС‚Р°СЂРёРµРІ.</p>';
  }

  return `
    <div class="comments-list">
      ${comments
        .map(
          (comment) => `
            <article class="comment-card">
              <p class="comment-head">${comment.userLogin} вЂў ${formatDate(comment.createdAt)}</p>
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
    : '<p class="auth-note">Р›Р°Р№РєР°С‚СЊ Рё РєРѕРјРјРµРЅС‚РёСЂРѕРІР°С‚СЊ РјРѕРіСѓС‚ С‚РѕР»СЊРєРѕ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»Рё.</p>';

  content.innerHTML = `
    <h2>${recipe.title}</h2>
    <p>${recipe.category} вЂў РђРІС‚РѕСЂ: <a href="${authorUrl}">${recipe.authorLogin}</a></p>

    <section class="stats-panel">
      <div class="stat-pill">РџСЂРѕСЃРјРѕС‚СЂС‹: <strong>${views}</strong></div>
      <div class="stat-pill">Р›Р°Р№РєРё: <strong id="likesCount">${likesCount}</strong></div>
      <div class="stat-pill">РљРѕРјРјРµРЅС‚Р°СЂРёРё: <strong id="commentsCount">${commentsCount}</strong></div>
    </section>

    <div class="social-actions">
      <button class="btn ${userLiked ? "secondary" : ""}" id="likeBtn">
        ${userLiked ? "РЈР±СЂР°С‚СЊ Р»Р°Р№Рє" : "Р›Р°Р№РєРЅСѓС‚СЊ"}
      </button>
    </div>

    ${authNote}
    ${recipe.coverImage ? `<img src="${recipe.coverImage}" alt="${recipe.title}" />` : ""}
    <p>${recipe.description || ""}</p>

    <h3>РРЅРіСЂРµРґРёРµРЅС‚С‹</h3>
    <ul>
      ${recipe.ingredients.map((item) => `<li>${item}</li>`).join("")}
    </ul>

    <h3>РЁР°РіРё</h3>
    <ol>
      ${recipe.steps
        .map(
          (step) => `
            <li>
              ${step.text}
              ${step.image ? `<div class="step-img"><img src="${step.image}" alt="РЁР°Рі" /></div>` : ""}
            </li>
          `
        )
        .join("")}
    </ol>

    <section class="comments-section">
      <h3>РљРѕРјРјРµРЅС‚Р°СЂРёРё</h3>
      ${
        user
          ? `
            <form id="commentForm" class="comment-form">
              <textarea id="commentText" rows="3" placeholder="РќР°РїРёС€РёС‚Рµ РєРѕРјРјРµРЅС‚Р°СЂРёР№"></textarea>
              <button type="submit" class="btn">РћС‚РїСЂР°РІРёС‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёР№</button>
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
      throw new Error("РќРµ СѓРєР°Р·Р°РЅ СЂРµС†РµРїС‚");
    }

    try {
      await api(`/api/recipes/${currentRecipeId}/view`, { method: "POST" });
    } catch (_) {
      // Keep the page usable even if an older backend build is still running.
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
      showToast("Р’РѕР№РґРёС‚Рµ РІ Р°РєРєР°СѓРЅС‚, С‡С‚РѕР±С‹ РґРѕР±Р°РІР»СЏС‚СЊ СЂРµС†РµРїС‚С‹ РІ РёР·Р±СЂР°РЅРЅРѕРµ.");
      return;
    }

    const result = await api(`/api/recipes/${currentRecipeId}/like`, { method: "POST" });
    likeBtn.textContent = result.userLiked ? "РЈР±СЂР°С‚СЊ Р»Р°Р№Рє" : "Р›Р°Р№РєРЅСѓС‚СЊ";
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

    if (!text) {
      return;
    }

    await api(`/api/recipes/${currentRecipeId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text })
    });

    await loadRecipe();
  });
}

init();


