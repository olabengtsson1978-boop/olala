function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function renderRecent() {
  const cards = await getAllCards();
  const list = document.getElementById("recent-list");
  const recent = cards.slice(0, 5);

  if (recent.length === 0) {
    list.innerHTML = '<p class="muted">Inga kort ännu.</p>';
    return;
  }

  list.innerHTML = recent
    .map(
      (c) => `
      <div class="card">
        <p class="card-text">${escapeHtml(c.text)}</p>
        ${c.sourceTitle ? `<span class="card-source">${escapeHtml(c.sourceTitle)}</span>` : ""}
      </div>`
    )
    .join("");
}

async function renderDueCount() {
  const due = await getDueCards();
  document.getElementById("due-count").textContent = due.length;
}

async function renderStashOptions() {
  const stashes = await getAllStashes();
  const select = document.getElementById("new-stash");
  select.innerHTML =
    '<option value="">Inkorgen</option>' +
    stashes.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
}

document.getElementById("save-btn").addEventListener("click", async () => {
  const textEl = document.getElementById("new-text");
  const tagsEl = document.getElementById("new-tags");
  const stashEl = document.getElementById("new-stash");
  const text = textEl.value.trim();
  if (!text) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  await addCard({
    text,
    sourceTitle: tab?.title || "",
    sourceUrl: tab?.url || "",
    tags: tagsEl.value.split(","),
    stashId: stashEl.value || null,
  });

  textEl.value = "";
  tagsEl.value = "";
  await renderRecent();
  await renderDueCount();
});

document.getElementById("open-library").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
});

document.getElementById("open-review").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
});

renderRecent();
renderDueCount();
renderStashOptions();
