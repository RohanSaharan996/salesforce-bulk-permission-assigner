console.log('Content script loaded on:', window.location.href);

// Listen for messages from popup and forward to background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  // Forward all API-related requests to background script
  if (
    request.type === 'fetchUsers' ||
    request.type === 'assignPermissionSet' ||
    request.type === 'fetchPermissionSets'
  ) {
    console.log('Forwarding message to background script:', request.type);
    chrome.runtime.sendMessage(request, (response) => {
      console.log('Background script response:', response);
      sendResponse(response);
    });
    return true; // Keep message channel open for async response
  }
  
  console.log('Unknown message type:', request.type);
  sendResponse({ success: false, error: 'Unknown message type' });
});