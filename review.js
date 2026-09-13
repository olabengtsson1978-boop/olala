let queue = [];
let index = 0;
let showingSource = false;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderDone() {
  document.getElementById("progress").textContent = "";
  document.getElementById("card-content").innerHTML =
    '<span class="muted">Inga fler kort att repetera just nu. Bra jobbat! 🎉</span>';
  document.getElementById("actions").innerHTML = "";
}

function renderCard() {
  const card = queue[index];
  document.getElementById("progress").textContent = `Kort ${index + 1} av ${queue.length}`;

  const content = document.getElementById("card-content");
  const actions = document.getElementById("actions");

  if (!showingSource) {
    content.innerHTML = `<div>${escapeHtml(card.text)}</div>`;
    actions.innerHTML = `<button class="primary" id="show-source">Visa källa</button>`;
    document.getElementById("show-source").addEventListener("click", () => {
      showingSource = true;
      renderCard();
    });
  } else {
    content.innerHTML = `
      <div>
        <div>${escapeHtml(card.text)}</div>
        ${
          card.sourceTitle || card.sourceUrl
            ? `<div style="font-size:13px;color:#888;margin-top:14px;">${escapeHtml(
                card.sourceTitle || card.sourceUrl
              )}</div>`
            : ""
        }
      </div>`;
    actions.innerHTML = `
      <button class="danger" id="forgot">Glömde</button>
      <button class="primary" id="remembered">Kom ihåg</button>`;

    document.getElementById("forgot").addEventListener("click", () => advance(false));
    document.getElementById("remembered").addEventListener("click", () => advance(true));
  }
}

async function advance(remembered) {
  const card = queue[index];
  await reviewCard(card.id, remembered);
  index += 1;
  showingSource = false;
  if (index >= queue.length) {
    renderDone();
  } else {
    renderCard();
  }
}

(async () => {
  queue = await getDueCards();
  if (queue.length === 0) {
    renderDone();
  } else {
    renderCard();
  }
})();
