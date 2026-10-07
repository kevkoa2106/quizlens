// Explicit action handling keeps the toolbar click tied to activeTab access.
const extensionApi = globalThis.browser ?? globalThis.chrome;
extensionApi.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
extensionApi.action.onClicked.addListener(tab => {
  const opening = extensionApi.sidePanel ? extensionApi.sidePanel.open({ windowId: tab.windowId }) : extensionApi.sidebarAction.open();
  opening.catch(console.error);
});
