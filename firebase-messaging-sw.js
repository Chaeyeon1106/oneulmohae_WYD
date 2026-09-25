// 앱이 닫혀 있을 때 가족 알림을 받아 보여주는 서비스워커.
// 서비스워커는 firebase-config.js를 불러올 수 없어서 공개용 설정값을 여기 옮겨 적었어요.
importScripts('https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js');

firebase.initializeApp({
  "projectId": "oneulmohae-family",
  "appId": "1:636635859622:web:6178bc7531e99afb418267",
  "storageBucket": "oneulmohae-family.firebasestorage.app",
  "apiKey": "AIzaSyACs9r0FCXtaMPK6LtdxxavnAJoNhrSx0s",
  "authDomain": "oneulmohae-family.firebaseapp.com",
  "messagingSenderId": "636635859622"
});
const messaging = firebase.messaging();

// 서버는 data만 보내고, 표시는 여기서만 해요 (알림이 두 번 뜨는 것 방지)
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  self.registration.showNotification(d.title || '오늘모해?', {
    body: d.body || '',
    icon: '/images/icon-b-192.png',
    badge: '/images/icon-b-192.png',
    tag: d.tag || undefined,
    data: d,
  });
});

// 알림을 누르면 알림 종류에 맞는 화면으로 (일정 → 그 일정, 메모/제안 → 냉장고, 칭찬 → 칭찬 목록)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const go = { type: d.type || '', id: d.id || '', date: d.date || '' };
  const q = new URLSearchParams();
  if (go.type) q.set('go', go.type);
  if (go.id) q.set('id', go.id);
  if (go.date) q.set('date', go.date);
  const url = '/' + (q.toString() ? '?' + q.toString() : '');
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.postMessage({ go }); return; }
    }
    return clients.openWindow(url);
  })());
});
