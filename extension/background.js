// Clicking the toolbar icon opens the app in a tab of the current profile.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});
