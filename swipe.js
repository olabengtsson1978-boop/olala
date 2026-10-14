// Delad svep-gest (som i DeepStash/Tinder): dra ett kort åt höger för
// att bekräfta (spara / kom ihåg), åt vänster för att avböja (hoppa
// över / glömde). Knapparna i kortet fungerar precis likadant – svepet
// är bara en snabbare genväg, inte det enda sättet.

function enableSwipe(cardEl, { onRight, onLeft, labelRight = "Spara", labelLeft = "Hoppa över" }) {
  const threshold = 90;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;

  const hintRight = document.createElement("div");
  hintRight.className = "swipe-hint swipe-hint-right";
  hintRight.textContent = `✓ ${labelRight}`;
  const hintLeft = document.createElement("div");
  hintLeft.className = "swipe-hint swipe-hint-left";
  hintLeft.textContent = `✕ ${labelLeft}`;
  cardEl.prepend(hintLeft);
  cardEl.prepend(hintRight);
  cardEl.classList.add("swipeable");

  function onPointerMove(e) {
    if (!dragging) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > Math.abs(dx) * 1.5) return;
    cardEl.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
    const progress = Math.min(Math.abs(dx) / threshold, 1);
    hintRight.style.opacity = dx > 0 ? progress : 0;
    hintLeft.style.opacity = dx < 0 ? progress : 0;
  }

  function reset() {
    cardEl.style.transition = "transform 0.2s ease";
    cardEl.style.transform = "";
    hintRight.style.opacity = 0;
    hintLeft.style.opacity = 0;
  }

  function endDrag() {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", endDrag);
    document.removeEventListener("pointercancel", endDrag);
    if (!dragging) return;
    dragging = false;
    cardEl.style.transition = "transform 0.25s ease, opacity 0.25s ease";

    if (dx > threshold) {
      cardEl.style.transform = `translateX(700px) rotate(18deg)`;
      cardEl.style.opacity = "0";
      setTimeout(onRight, 180);
    } else if (dx < -threshold) {
      cardEl.style.transform = `translateX(-700px) rotate(-18deg)`;
      cardEl.style.opacity = "0";
      setTimeout(onLeft, 180);
    } else {
      reset();
    }
    dx = 0;
  }

  cardEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a, select, input, textarea")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    cardEl.style.transition = "none";
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
  });
}
