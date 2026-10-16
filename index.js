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

async function renderWorkerUrlField() {
  document.getElementById("worker-url").value = await getWorkerUrl();
}

document.getElementById("save-worker-url-btn").addEventListener("click", async () => {
  const input = document.getElementById("worker-url");
  await setWorkerUrl(input.value);
  await loadSuggestions();
});

async function renderPreferencesField() {
  document.getElementById("preferences-text").value = await getPreferences();
}

document.getElementById("save-preferences-btn").addEventListener("click", async () => {
  const input = document.getElementById("preferences-text");
  await setPreferences(input.value);
  await loadSuggestions();
});

// Ger varje källa en stabil färg, så samma tidning/flöde alltid får
// samma badge-färg (rent kosmetiskt, ingen faktisk kategorisering).
function sourceColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hash}, 55%, 42%)`;
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
      <summary>Läs artikeln</summary>
      <div class="article-body">${escapeHtml(body)}</div>
      ${sourceList ? `<p class="article-sources-label">Källor</p><ol class="article-sources">${sourceList}</ol>` : ""}
    </details>`;
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
      const idea = it.idea || it.title;
      const imageHtml = it.image
        ? `<img class="suggestion-image" src="${escapeHtml(it.image)}" alt="" loading="lazy" onerror="this.remove()">`
        : "";
      const sourceCount = (it.sources || []).length;

      return `
      <div class="card suggestion-card" data-index="${i}">
        ${imageHtml}
        <span class="tag source-badge" style="background:${color};">${escapeHtml(it.source)}</span>
        <blockquote class="idea-text">${escapeHtml(idea)}</blockquote>
        <p class="idea-byline">${escapeHtml(it.title)}${sourceCount > 1 ? ` · ${sourceCount} källor` : ""}</p>
        ${articleHtml(it.body, it.sources)}
        <div class="row" style="margin-top:10px;align-items:center;">
          <button class="speaker-btn" data-speak="${escapeHtml(it.body ? `${it.title}. ${it.body}` : idea)}" title="Läs upp">🔊</button>
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="primary save-suggestion">Spara</button>
          <button class="skip-suggestion">Hoppa över</button>
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
      labelLeft: "Hoppa över",
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
// eller när du uttryckligen ber om det (varje sökning kostar pengar).
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
  status.textContent = "Söker på nätet och skriver artiklar… (tar oftast 1–3 minuter)";
  document.getElementById("suggestions-list").innerHTML = "";
  refreshBtn.disabled = true;

  const { items, failures, needsSetup, provider } = await fetchSuggestions();
  refreshBtn.disabled = false;
  await savePendingSuggestions(items);
  renderSuggestions(items);

  if (needsSetup) {
    status.innerHTML = "Spara en Worker-URL under \"AI-kuratering\" nedan för att hämta förslag.";
  } else if (failures.length > 0) {
    status.innerHTML = failures
      .map((f) => `<strong>${escapeHtml(f.feed.name)}</strong>: ${escapeHtml(f.message)}`)
      .join("<br>");
  } else if (items.length === 0) {
    status.textContent = "Inga nya förslag just nu.";
  } else if (provider && provider !== "claude") {
    status.innerHTML = `<span style="color:#888;">ℹ️ Hämtat via gratisläget ${
      provider === "groq" ? "Groq" : "Mistral"
    } eftersom Claude inte kunde nås just nu.</span>`;
  } else {
    status.textContent = "";
  }
}

document.getElementById("refresh-btn").addEventListener("click", loadSuggestions);

renderDueCount();
renderStashOptions();
renderWorkerUrlField();
renderPreferencesField();
showPendingOrLoad();
