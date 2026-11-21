// Service Worker SIAN · Sistem Informasi Asrama Nusantara
const CACHE_NAME = 'sian-pwa-v3';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Menangani push notification dari server (FCM HTTP v1 & Web Push)
self.addEventListener('push', (event) => {
    let title = 'SIAN · Pemberitahuan Baru';
    let body = 'Ada pembaruan data perizinan atau kamar di SIAN.';
    let targetUrl = '/';
    try {
        if (event.data) {
            const raw = event.data.json();
            title = raw?.notification?.title || raw?.data?.title || raw?.title || title;
            body = raw?.notification?.body || raw?.data?.body || raw?.body || body;
            targetUrl = raw?.data?.url || raw?.fcmOptions?.link || '/';
        }
    } catch (_) {
        if (event.data) body = event.data.text();
    }
    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            vibrate: [300, 120, 300, 120, 300],
            requireInteraction: true,
            tag: 'sian-push-' + Date.now(),
            data: { url: targetUrl }
        })
    );
});

// Membuka / memfokuskan aplikasi SIAN saat notifikasi di panel atas HP diketuk
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});