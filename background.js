importScripts("storage.js");

const MENU_ID = "save-to-stash";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Spara "%s" till Stash',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  await addCard({
    text: info.selectionText,
    sourceTitle: tab?.title || "",
    sourceUrl: info.pageUrl || tab?.url || "",
    tags: [],
  });
  chrome.action.setBadgeText({ text: "✓" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
});
