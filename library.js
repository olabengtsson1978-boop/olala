let allCards = [];
let activeTag = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function allTags(cards) {
  const set = new Set();
  cards.forEach((c) => c.tags.forEach((t) => set.add(t)));
  return [...set].sort();
}

function matches(card, query) {
  if (!query) return true;
  const haystack = `${card.text} ${card.tags.join(" ")}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function render() {
  const query = document.getElementById("search").value.trim();

  const tagFilters = document.getElementById("tag-filters");
  tagFilters.innerHTML = allTags(allCards)
    .map(
      (t) =>
        `<span class="tag" data-tag="${escapeHtml(t)}" style="cursor:pointer;${
          t === activeTag ? "background:#2b6cb0;color:#fff;" : ""
        }">${escapeHtml(t)}</span>`
    )
    .join("");
  tagFilters.querySelectorAll("[data-tag]").forEach((el) => {
    el.addEventListener("click", () => {
      const tag = el.dataset.tag;
      activeTag = activeTag === tag ? null : tag;
      render();
    });
  });

  const filtered = allCards.filter(
    (c) => matches(c, query) && (!activeTag || c.tags.includes(activeTag))
  );

  const list = document.getElementById("list");
  if (filtered.length === 0) {
    list.innerHTML = '<p class="muted">Inga kort matchar.</p>';
    return;
  }

  list.innerHTML = filtered
    .map(
      (c) => `
      <div class="card" data-id="${c.id}">
        <p class="card-text">${escapeHtml(c.text)}</p>
        ${
          c.sourceUrl
            ? `<a class="card-source" href="${escapeHtml(c.sourceUrl)}" target="_blank">${escapeHtml(
                c.sourceTitle || c.sourceUrl
              )}</a>`
            : ""
        }
        <div class="tags">
          ${c.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
        </div>
        <div class="row" style="margin-top:10px;">
          <input type="text" class="edit-tags" placeholder="Redigera taggar, kommaseparerat" value="${escapeHtml(
            c.tags.join(", ")
          )}">
          <button class="save-tags">Spara taggar</button>
          <button class="danger delete-card">Ta bort</button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll(".delete-card").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".card").dataset.id;
      await deleteCard(id);
      allCards = await getAllCards();
      render();
    })
  );

  list.querySelectorAll(".save-tags").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const cardEl = e.target.closest(".card");
      const id = cardEl.dataset.id;
      const tags = cardEl.querySelector(".edit-tags").value.split(",");
      await updateCardTags(id, tags);
      allCards = await getAllCards();
      render();
    })
  );
}

document.getElementById("search").addEventListener("input", render);

(async () => {
  allCards = await getAllCards();
  render();
})();
