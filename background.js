// Background script for Element to Markdown Copier
// Handles extension icon clicks and manages content script injection

chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Check if we can inject scripts into this tab
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      console.log('Cannot inject scripts into chrome:// or chrome-extension:// pages');
      return;
    }

    // Inject the Turndown library first
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/turndown.js']
    });

    // Inject the Turndown GFM plugin
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/turndown-plugin-gfm.js']
    });

    // Inject the CSS for highlighting
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles.css']
    });

    // Finally, inject the content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    console.log('Element to Markdown Copier activated');
  } catch (error) {
    console.error('Failed to inject scripts:', error);
  }
});
