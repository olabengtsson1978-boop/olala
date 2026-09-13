let allCards = [];
let allStashes = [];
let activeTag = null;
const INBOX = "__inbox__";
let activeStash = null; // null = alla, INBOX = inkorgen, annars stash-id

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

function matchesStash(card) {
  if (activeStash === null) return true;
  if (activeStash === INBOX) return !card.stashId;
  return card.stashId === activeStash;
}

function stashOptionsHtml(selectedId) {
  const inboxSelected = !selectedId ? "selected" : "";
  const options = allStashes
    .map(
      (s) =>
        `<option value="${escapeHtml(s.id)}" ${s.id === selectedId ? "selected" : ""}>${escapeHtml(s.name)}</option>`
    )
    .join("");
  return `<option value="" ${inboxSelected}>Inkorgen</option>${options}`;
}

function renderStashFilters() {
  const el = document.getElementById("stash-filters");
  const allChip = `<span class="tag" data-stash="__all__" style="cursor:pointer;${
    activeStash === null ? "background:#2b6cb0;color:#fff;" : ""
  }">Alla</span>`;
  const inboxChip = `<span class="tag stash-chip" data-stash="${INBOX}" style="cursor:pointer;${
    activeStash === INBOX ? "background:#2b6cb0;color:#fff;" : ""
  }">Inkorgen</span>`;
  const stashChips = allStashes
    .map(
      (s) => `
      <span class="stash-row">
        <span class="tag stash-chip" data-stash="${escapeHtml(s.id)}" style="cursor:pointer;${
        activeStash === s.id ? "background:#2b6cb0;color:#fff;" : ""
      }">${escapeHtml(s.name)}</span>
        <button class="remove-stash" data-remove-stash="${escapeHtml(s.id)}" title="Ta bort stash">×</button>
      </span>`
    )
    .join("");

  el.innerHTML = allChip + inboxChip + stashChips;

  el.querySelectorAll("[data-stash]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const val = chip.dataset.stash;
      activeStash = val === "__all__" ? null : activeStash === val ? null : val;
      render();
    });
  });

  el.querySelectorAll("[data-remove-stash]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.removeStash;
      if (!confirm("Ta bort den här stashen? Korten flyttas till Inkorgen.")) return;
      await deleteStash(id);
      allStashes = await getAllStashes();
      allCards = await getAllCards();
      if (activeStash === id) activeStash = null;
      render();
    });
  });
}

function render() {
  const query = document.getElementById("search").value.trim();

  renderStashFilters();

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
    (c) => matches(c, query) && (!activeTag || c.tags.includes(activeTag)) && matchesStash(c)
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
        </div>
        <div class="row">
          <select class="card-stash">${stashOptionsHtml(c.stashId)}</select>
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

  list.querySelectorAll(".card-stash").forEach((select) =>
    select.addEventListener("change", async (e) => {
      const cardEl = e.target.closest(".card");
      const id = cardEl.dataset.id;
      await updateCardStash(id, select.value || null);
      allCards = await getAllCards();
      render();
    })
  );
}

document.getElementById("search").addEventListener("input", render);

document.getElementById("add-stash-btn").addEventListener("click", async () => {
  const input = document.getElementById("new-stash-name");
  const name = input.value.trim();
  if (!name) return;
  await createStash(name);
  input.value = "";
  allStashes = await getAllStashes();
  render();
});

document.getElementById("export-btn").addEventListener("click", async (e) => {
  e.preventDefault();
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `stash-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-btn").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    alert("Filen kunde inte tolkas som JSON.");
    return;
  }
  if (!confirm("Detta ersätter allt nuvarande innehåll i Stash med filens innehåll. Fortsätta?")) return;
  try {
    await importBackup(data);
  } catch (err) {
    alert(err.message);
    return;
  }
  allCards = await getAllCards();
  allStashes = await getAllStashes();
  activeTag = null;
  activeStash = null;
  render();
  e.target.value = "";
});

(async () => {
  allCards = await getAllCards();
  allStashes = await getAllStashes();
  render();
})();
