// Barn-versionen av Upptäck. Egna kort, stashes och historik (separata
// localStorage-nycklar, se storage.js) – delar bara Worker-URL:en med
// vuxenversionen i index.html (en vuxen ställer in den där om
// standard-Workern inte ska användas; den här sidan bara läser den).
// Dessutom ett eget strikt AI-granskningsspår (kidMode: true i
// discover.js → worker/worker.js).

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
    '<option value="">Mitt förråd</option>' +
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

function sourceColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hash}, 70%, 50%)`;
}

async function saveSuggestion(items, idx) {
  const it = items[idx];
  const idea = it.idea || it.title;
  await addCard({
    text: idea,
    sourceTitle: `${it.title} (${it.source})`,
    sourceUrl: it.link,
    body: it.body,
    sources: it.sources,
    tags: [],
  });
  await markSeen({ link: it.link, title: it.title }, "saved");
  await removePendingSuggestion(it.link);
  await renderDueCount();
}

async function skipSuggestion(items, idx) {
  const it = items[idx];
  await markSeen({ link: it.link, title: it.title }, "skipped");
  await removePendingSuggestion(it.link);
}

// Utfällbar artikeltext med källförteckning.
function articleHtml(body, sources) {
  if (!body) return "";
  const sourceList = (sources || [])
    .map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a></li>`)
    .join("");
  return `
    <details class="article">
      <summary>Läs hela! 📖</summary>
      <div class="article-body">${escapeHtml(body)}</div>
      ${sourceList ? `<p class="article-sources-label">Var vi hittade det</p><ol class="article-sources">${sourceList}</ol>` : ""}
    </details>`;
}

function renderSuggestions(items) {
  const list = document.getElementById("suggestions-list");
  if (items.length === 0) {
    list.innerHTML = '<p class="muted">Inga fler kul fakta just nu – kolla igen senare! 🙂</p>';
    return;
  }

  list.innerHTML = items
    .map((it, i) => {
      const color = sourceColor(it.source || "");
      const idea = it.idea || it.title;
      const sourceCount = (it.sources || []).length;

      return `
      <div class="card suggestion-card" data-index="${i}">
        <span class="tag source-badge" style="background:${color};">${escapeHtml(it.source)}</span>
        <blockquote class="idea-text">${escapeHtml(idea)}</blockquote>
        <p class="idea-byline">${escapeHtml(it.title)}${sourceCount > 1 ? ` · ${sourceCount} källor` : ""}</p>
        ${articleHtml(it.body, it.sources)}
        <div class="row" style="margin-top:10px;align-items:center;">
          <button class="speaker-btn" data-speak="${escapeHtml(it.body ? `${it.title}. ${it.body}` : idea)}" title="Läs upp">🔊</button>
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="primary save-suggestion">Spara! ⭐</button>
          <button class="skip-suggestion">Nästa ➡️</button>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll(".suggestion-card").forEach((cardEl) => {
    const idx = Number(cardEl.dataset.index);

    cardEl.querySelector(".save-suggestion").addEventListener("click", async () => {
      await saveSuggestion(items, idx);
      cardEl.remove();
    });

    cardEl.querySelector(".skip-suggestion").addEventListener("click", async () => {
      await skipSuggestion(items, idx);
      cardEl.remove();
    });

    enableSwipe(cardEl, {
      labelRight: "Spara",
      labelLeft: "Nästa",
      onRight: async () => {
        await saveSuggestion(items, idx);
        cardEl.remove();
      },
      onLeft: async () => {
        await skipSuggestion(items, idx);
        cardEl.remove();
      },
    });
  });
}

// Visar sparade förslag direkt; söker bara efter nya när inga finns kvar
// eller när du uttryckligen ber om det (varje sökning tar tid/kostar).
async function showPendingOrLoad() {
  const pending = await getPendingSuggestions();
  if (pending.length > 0) {
    renderSuggestions(pending);
    document.getElementById("suggestions-status").textContent = "";
  } else {
    await loadSuggestions();
  }
}

async function loadSuggestions() {
  const status = document.getElementById("suggestions-status");
  const refreshBtn = document.getElementById("refresh-btn");
  status.textContent = "Letar efter kul fakta på nätet… (kan ta en liten stund) 🔎";
  document.getElementById("suggestions-list").innerHTML = "";
  refreshBtn.disabled = true;

  const { items, failures, needsSetup, provider } = await fetchKidSuggestions();
  refreshBtn.disabled = false;
  await savePendingSuggestions(items);
  renderSuggestions(items);

  if (needsSetup) {
    status.innerHTML = "Be en vuxen ställa in detta på \"Upptäck\"-sidan (för vuxna) först! 🙋";
  } else if (failures.length > 0) {
    status.innerHTML = failures.map((f) => escapeHtml(f.message)).join("<br>");
  } else if (items.length === 0) {
    status.textContent = "Inga nya fakta just nu – prova igen om ett tag! 🙂";
  } else if (provider && provider !== "claude") {
    status.innerHTML = `<span style="color:#888;">ℹ️ Hämtat via reservläget just nu, men lika noga granskat! 🙂</span>`;
  } else {
    status.textContent = "";
  }
}

document.getElementById("refresh-btn").addEventListener("click", loadSuggestions);

renderDueCount();
renderStashOptions();
showPendingOrLoad();
