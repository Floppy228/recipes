const form = document.getElementById("recipeForm");
const ingredientsDiv = document.getElementById("ingredients");
const stepsDiv = document.getElementById("steps");
const msg = document.getElementById("msg");
const category = document.getElementById("category");

const recipeId = new URLSearchParams(location.search).get("id");
let existingStepImages = [];

function ingredientRow(value = "") {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<input placeholder="Например: 200 г муки" value="${value.replace(/"/g, "&quot;")}" />`;
  ingredientsDiv.appendChild(row);
}

function stepRow(text = "", hasImage = false) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <textarea rows="2" placeholder="Описание шага">${text}</textarea>
    <input type="file" accept="image/*" />
    ${hasImage ? "<p>Текущая картинка шага сохранена</p>" : ""}
  `;
  stepsDiv.appendChild(row);
}

document.getElementById("addIngredient").onclick = () => ingredientRow();
document.getElementById("addStep").onclick = () => stepRow();

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

async function init() {
  try {
    const session = await fetchJson("/api/session");
    if (!session.user) {
      location.href = "/pages/login.html";
      return;
    }

    const categoriesResp = await fetchJson("/api/categories");
    category.innerHTML = categoriesResp.categories.map((item) => `<option>${item}</option>`).join("");

    if (recipeId) {
      document.getElementById("title").textContent = "Редактирование рецепта";

      const { recipe } = await fetchJson(`/api/recipes/${recipeId}`);
      form.title.value = recipe.title;
      form.description.value = recipe.description || "";
      form.category.value = recipe.category;

      recipe.ingredients.forEach((item) => ingredientRow(item));
      recipe.steps.forEach((step) => {
        existingStepImages.push(step.image || "");
        stepRow(step.text, Boolean(step.image));
      });
    } else {
      ingredientRow();
      stepRow();
    }
  } catch (error) {
    msg.textContent = error.message;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const data = new FormData();
    data.append("title", form.title.value.trim());
    data.append("description", form.description.value.trim());
    data.append("category", form.category.value);

    if (form.coverImage.files[0]) {
      data.append("coverImage", form.coverImage.files[0]);
    }

    const ingredients = [...ingredientsDiv.querySelectorAll("input")]
      .map((input) => input.value.trim())
      .filter(Boolean);

    data.append("ingredients", JSON.stringify(ingredients));

    const rows = [...stepsDiv.querySelectorAll(".row")];
    const steps = [];
    const keepImages = [];

    rows.forEach((row, index) => {
      const text = row.querySelector("textarea").value.trim();
      const file = row.querySelector('input[type="file"]').files[0];

      if (!text) {
        return;
      }

      steps.push({ text });
      keepImages.push(existingStepImages[index] || "");

      if (file) {
        data.append("stepImages", file);
      }
    });

    data.append("steps", JSON.stringify(steps));
    data.append("existingStepImages", JSON.stringify(keepImages));

    const url = recipeId ? `/api/recipes/${recipeId}` : "/api/recipes";
    const method = recipeId ? "PUT" : "POST";

    const response = await fetch(url, { method, body: data });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Ошибка сохранения рецепта");
    }

    location.href = "/pages/dashboard.html";
  } catch (error) {
    msg.textContent = error.message;
  }
});

init();
