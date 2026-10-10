// Botón "Abrir en YT Flotante": pausa el video de la pestaña, toma el minuto actual
// y se lo pasa a la app con un link ytpip://open?url=...
// La primera vez Chrome pregunta si permite abrir YT Flotante (marca "Permitir siempre").

function sendFromPage(linkUrl) {
  let target;
  if (linkUrl) {
    target = linkUrl;
  } else {
    const v = document.querySelector('video');
    const u = new URL(location.href);
    if (v) {
      u.searchParams.set('t', Math.floor(v.currentTime) + 's');
      v.pause();
    }
    target = u.toString();
  }
  location.href = 'ytpip://open?url=' + encodeURIComponent(target);
}

const isYouTube = (url) => /^https?:\/\/([a-z]+\.)?(youtube\.com|youtu\.be)\//i.test(url || '');

chrome.action.onClicked.addListener((tab) => {
  if (!isYouTube(tab.url)) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, func: sendFromPage, args: [null] });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ytf-link',
    title: 'Abrir en YT Flotante',
    contexts: ['link'],
    targetUrlPatterns: ['*://*.youtube.com/*', '*://youtu.be/*'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'ytf-link' || !tab || !isYouTube(tab.url)) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, func: sendFromPage, args: [info.linkUrl] });
});
