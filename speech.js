// Enkel "speaker"-funktion: läser upp kortets text med webbläsarens
// inbyggda talsyntes (Web Speech API). Allt sker lokalt i webbläsaren
// – ingen text skickas till någon server.

let currentSpeakBtn = null;

function speak(text, btn) {
  if (!("speechSynthesis" in window) || !text) return;

  // Klick på samma knapp som redan läser upp -> stoppa.
  if (speechSynthesis.speaking && currentSpeakBtn === btn) {
    speechSynthesis.cancel();
    return;
  }

  speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "sv-SE";
  const svVoice = speechSynthesis.getVoices().find((v) => (v.lang || "").toLowerCase().startsWith("sv"));
  if (svVoice) utter.voice = svVoice;

  utter.onstart = () => {
    currentSpeakBtn = btn;
    if (btn) btn.classList.add("speaking");
  };
  utter.onend = utter.onerror = () => {
    if (btn) btn.classList.remove("speaking");
    if (currentSpeakBtn === btn) currentSpeakBtn = null;
  };

  speechSynthesis.speak(utter);
}

// Delegerad klickhanterare: funkar även för kort som ritas om dynamiskt,
// så varje sida behöver bara ha knappar med data-speak="...text...".
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-speak]");
  if (!btn) return;
  speak(btn.dataset.speak, btn);
});
