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

    // Inject marked for Markdown rendering
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/marked.min.js']
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'mdcp-capture-visible') {
    try {
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ dataUrl });
      });
    } catch (error) {
      sendResponse({ error: error.message });
    }
    return true;
  }

  if (message && message.type === 'mdcp-fetch-image' && message.url) {
    (async () => {
      try {
        const res = await fetch(message.url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ dataUrl: reader.result });
        };
        reader.onerror = () => {
          sendResponse({ error: 'Failed to read image data' });
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }
});
