export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.log('Collectab extension installed');
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_SYNC_STATUS') {
      sendResponse({ connected: false });
    }

    return true;
  });
});
