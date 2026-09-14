function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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

  await addCard({
    text,
    tags: tagsEl.value.split(","),
    stashId: stashEl.value || null,
  });

  textEl.value = "";
  tagsEl.value = "";
  await renderDueCount();
});

async function renderFeedList() {
  const feeds = await getFeeds();
  const el = document.getElementById("feed-list");
  if (feeds.length === 0) {
    el.innerHTML = '<p class="muted">Inga flöden ännu.</p>';
    return;
  }
  el.innerHTML = feeds
    .map(
      (f) => `
      <div class="stash-row" style="margin-bottom:6px;">
        <span>${escapeHtml(f.name)}</span>
        <span class="card-source" style="flex:1;">${escapeHtml(f.url)}</span>
        <button class="remove-stash" data-remove-feed="${escapeHtml(f.url)}" title="Ta bort flöde">×</button>
      </div>`
    )
    .join("");
  el.querySelectorAll("[data-remove-feed]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await removeFeed(btn.dataset.removeFeed);
      await renderFeedList();
    })
  );
}

document.getElementById("add-feed-btn").addEventListener("click", async () => {
  const urlEl = document.getElementById("new-feed-url");
  const nameEl = document.getElementById("new-feed-name");
  const url = urlEl.value.trim();
  if (!url) return;
  await addFeed(url, nameEl.value.trim());
  urlEl.value = "";
  nameEl.value = "";
  await renderFeedList();
});

// Ger varje källa en stabil färg, så samma tidning/flöde alltid får
// samma badge-färg (rent kosmetiskt, ingen faktisk kategorisering).
function sourceColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hash}, 55%, 42%)`;
}

function renderSuggestions(items) {
  const list = document.getElementById("suggestions-list");
  if (items.length === 0) {
    list.innerHTML = '<p class="muted">Inga nya förslag just nu.</p>';
    return;
  }

  list.innerHTML = items
    .map((it, i) => {
      const color = sourceColor(it.source || "");
      const imageHtml = it.image
        ? `<img class="suggestion-image" src="${escapeHtml(it.image)}" alt="" loading="lazy" onerror="this.remove()">`
        : `<div class="suggestion-image suggestion-image-fallback" style="background:${color};">${escapeHtml(
            (it.source || "?").slice(0, 1)
          )}</div>`;

      return `
      <div class="card suggestion-card" data-index="${i}">
        ${imageHtml}
        <span class="tag source-badge" style="background:${color};">${escapeHtml(it.source)}</span>
        <p class="card-text" style="margin-top:8px;">${escapeHtml(it.title)}</p>
        ${it.summary ? `<p style="font-size:13px;color:#666;margin:0 0 8px;">${escapeHtml(it.summary)}</p>` : ""}
        <a class="card-source" href="${escapeHtml(it.link)}" target="_blank">Läs artikeln ↗</a>
        <div class="row" style="margin-top:10px;">
          <button class="primary save-suggestion">Spara</button>
          <button class="skip-suggestion">Hoppa över</button>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll(".save-suggestion").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.closest(".card").dataset.index);
      const it = items[idx];
      await addCard({
        text: it.title,
        sourceTitle: it.source,
        sourceUrl: it.link,
        tags: [],
      });
      await markSeen(it.link);
      e.target.closest(".card").remove();
      await renderDueCount();
    })
  );

  list.querySelectorAll(".skip-suggestion").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.closest(".card").dataset.index);
      await markSeen(items[idx].link);
      e.target.closest(".card").remove();
    })
  );
}

async function loadSuggestions() {
  const status = document.getElementById("suggestions-status");
  status.textContent = "Laddar förslag…";
  document.getElementById("suggestions-list").innerHTML = "";

  const { items, failures } = await fetchSuggestions();
  renderSuggestions(items);

  if (failures.length > 0) {
    status.textContent = `Kunde inte hämta: ${failures.map((f) => f.feed.name).join(", ")}. Övriga flöden visas nedan.`;
  } else if (items.length === 0) {
    status.textContent = "Inga nya förslag just nu.";
  } else {
    status.textContent = "";
  }
}

document.getElementById("refresh-btn").addEventListener("click", loadSuggestions);

renderDueCount();
renderStashOptions();
renderFeedList();
loadSuggestions();
