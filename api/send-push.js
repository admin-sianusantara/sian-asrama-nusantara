// Vercel Serverless Function: Pengirim Notifikasi Push Firebase Cloud Messaging (FCM HTTP v1)
// Menggunakan Node.js built-in (crypto & fetch) tanpa perlu package.json atau npm install.
const crypto = require('crypto');

function base64UrlEncode(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
    return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken(serviceAccount) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };

    const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claimSet))}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedToken);
    const privateKey = String(serviceAccount.private_key || '').replace(/\\n/g, '\n');
    const signature = signer.sign(privateKey);
    const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || 'Gagal mendapatkan Google Access Token');
    }
    return data.access_token;
}

function norm(str) {
    return String(str || '').trim().toLowerCase();
}

function normSektor(str) {
    return norm(str)
        .replace(/^asrama\s+nusantara\s+/i, '')
        .replace(/^ns\s+/i, '')
        .replace(/\blantai\s*/gi, 'lt. ')
        .replace(/\blt\.?\s*/gi, 'lt. ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractFirestoreString(field) {
    return field && typeof field.stringValue === 'string' ? field.stringValue : '';
}

function extractFirestoreBool(field) {
    return Boolean(field && field.booleanValue === true);
}

function extractFirestoreTokens(field) {
    if (!field || !field.arrayValue || !Array.isArray(field.arrayValue.values)) return [];
    return field.arrayValue.values
        .map(v => v && v.stringValue)
        .filter(Boolean);
}

function isRecipientEligible(userFields, eventPayload) {
    const status = norm(extractFirestoreString(userFields.status));
    if (status === 'pending' || status === 'menunggu' || status === 'rejected' || status === 'ditolak') return false;

    const email = norm(extractFirestoreString(userFields.email));
    const isAdmin = email === 'admin.sianusantara@gmail.com'
        || extractFirestoreBool(userFields.isAdmin)
        || norm(extractFirestoreString(userFields.role)) === 'admin';
    const isKetuaAsrama = !isAdmin && (
        extractFirestoreBool(userFields.isKetuaAsrama)
        || norm(extractFirestoreString(userFields.role)) === 'ketua_asrama'
    );
    const isKetuaLantai = !isAdmin && !isKetuaAsrama && (
        extractFirestoreBool(userFields.isKetuaLantai)
        || norm(extractFirestoreString(userFields.role)) === 'ketua_sektor'
    );
    const userSektor = normSektor(extractFirestoreString(userFields.sektor));
    const userKamar = norm(extractFirestoreString(userFields.kamar));
    const userDivisi = norm(extractFirestoreString(userFields.divisi));
    const ketuaUtamaDiv = norm(extractFirestoreString(userFields.ketuaUtamaDivisi));

    const eventType = eventPayload.eventType;

    // 0. Tes Notifikasi Personal ke User yang login
    if (eventType === 'test_notif') {
        const targetEmail = norm(eventPayload.targetEmail);
        return email === targetEmail;
    }

    if (eventType === 'pendaftaran_baru') {
        return isAdmin;
    }

    if (eventType === 'izin_baru') {
        if (isAdmin) return true;
        const targetSektor = normSektor(eventPayload.sektor);
        const jenis = norm(eventPayload.jenis);
        const kategoriPulang = norm(eventPayload.kategoriPulang);
        const tujuan = norm(eventPayload.divisiTujuan);

        // 1. Izin Sakit -> Divisi Kesehatan
        if (jenis === 'sakit' || tujuan === 'kesehatan') {
            return ketuaUtamaDiv === 'kesehatan' || userDivisi.includes('kesehatan');
        }

        // 2. Izin Pulang Acara Keluarga -> Ketua Sektor terkait & Ketua Asrama
        if (kategoriPulang === 'pulang_keluarga' || tujuan === 'pimpinan') {
            if (isKetuaAsrama) return true;
            if (isKetuaLantai && userSektor === targetSektor) return true;
            return false;
        }

        // 3. Izin Pulang karena Sakit -> Divisi Keamanan
        return ketuaUtamaDiv === 'keamanan' || userDivisi.includes('keamanan');
    }

    // 2. Update Status Perizinan (ACC / Tolak) -> Murobbi Kamar Santri
    if (eventType === 'izin_status_update') {
        const targetSektor = normSektor(eventPayload.sektor);
        const targetKamar = norm(eventPayload.kamar);
        // Notif ditujukan khusus kepada Murobbi kamar santri tersebut
        if (userSektor === targetSektor && userKamar === targetKamar) {
            return true;
        }
        return false;
    }

    if (eventType === 'izin_dihapus') {
        const targetSektor = normSektor(eventPayload.sektor);
        const targetKamar = norm(eventPayload.kamar);
        if (userSektor === targetSektor && userKamar === targetKamar) {
            return true;
        }
        return false;
    }

    // 3. Jadwal Roan Kebersihan -> Murobbi kamar-kamar yang bertugas roan
    if (eventType === 'roan_baru') {
        const targetSektor = normSektor(eventPayload.sektor);
        const targetKamarStr = norm(eventPayload.kamar); // bisa koma atau "&", misal: "demak & granada"
        if (targetKamarStr.includes(userKamar) || userKamar.includes(targetKamarStr)) {
            if (!eventPayload.sektor || userSektor === targetSektor || eventPayload.sektor === 'Semua Sektor') {
                return true;
            }
        }
        return false;
    }

    // 4. Tugas Penilaian Rubrik -> Murobbi yang ditunjuk sebagai penilai
    if (eventType === 'rubrik_baru') {
        if (isAdmin || isKetuaAsrama) return true;
        if (eventPayload.penugasanMode === 'khusus' && Array.isArray(eventPayload.penugasanList)) {
            return eventPayload.penugasanList.some(a => norm(a.pengujiEmail) === email);
        }
        if (eventPayload.cakupan === 'semua_asrama') return true;
        return userSektor === normSektor(eventPayload.targetSektor);
    }

    // 5. Takziran Fix / Pelanggaran Baru -> Murobbi Kamar Santri
    if (eventType === 'takziran_fix') {
        const targetSektor = normSektor(eventPayload.sektor);
        const targetKamar = norm(eventPayload.kamar);
        if (userSektor === targetSektor && userKamar === targetKamar) {
            return true;
        }
        return false;
    }

    if (eventType === 'pindah_kamar') {
        if (isAdmin || isKetuaAsrama) return true;
        const dariSektor = normSektor(eventPayload.dariSektor);
        const keSektor = normSektor(eventPayload.keSektor);
        const keKamar = norm(eventPayload.keKamar);
        if (isKetuaLantai && (userSektor === dariSektor || userSektor === keSektor)) return true;
        if (userSektor === keSektor && userKamar === keKamar) return true;
        return false;
    }

    return false;
}

async function sendSingleFcmMessage(projectId, accessToken, token, title, body, dedupId, targetUrl = '/') {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: {
                token,
                notification: {
                    title,
                    body
                },
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        icon: 'stock_ticker_update',
                        color: '#10b981'
                    }
                },
                webpush: {
                    headers: {
                        Urgency: 'high'
                    },
                    notification: {
                        title,
                        body,
                        icon: '/icon-192.png',
                        badge: '/icon-192.png',
                        requireInteraction: true
                    },
                    fcm_options: {
                        link: targetUrl
                    }
                },
                data: {
                    title,
                    body,
                    url: targetUrl,
                    dedupId: String(dedupId || '')
                }
            }
        })
    });
    return res.ok;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (!rawSa) {
            return res.status(500).json({
                error: 'Environment variable FIREBASE_SERVICE_ACCOUNT belum diisi di Vercel.'
            });
        }

        const serviceAccount = JSON.parse(rawSa);
        const projectId = serviceAccount.project_id;
        const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const title = payload.title || 'SIAN · Pemberitahuan Baru';
        const body = payload.body || 'Ada pembaruan data baru di SIAN.';
        const dedupId = payload.dedupId || '';
        const targetUrl = payload.targetUrl || '/';

        const accessToken = await getGoogleAccessToken(serviceAccount);

        if (payload.testToken) {
            const ok = await sendSingleFcmMessage(projectId, accessToken, payload.testToken, title, body, dedupId, targetUrl);
            return res.status(ok ? 200 : 500).json({
                sent: ok ? 1 : 0,
                error: ok ? null : 'Token ditolak oleh FCM.'
            });
        }

        const fsRes = await fetch(
            `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pengurus?pageSize=200`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const fsData = await fsRes.json();
        const docs = Array.isArray(fsData.documents) ? fsData.documents : [];

        const targetTokens = new Set();
        docs.forEach(docItem => {
            const fields = docItem.fields || {};
            if (isRecipientEligible(fields, payload)) {
                extractFirestoreTokens(fields.fcmTokens).forEach(t => targetTokens.add(t));
            }
        });

        let sentCount = 0;
        for (const token of targetTokens) {
            const ok = await sendSingleFcmMessage(projectId, accessToken, token, title, body, dedupId, targetUrl);
            if (ok) sentCount++;
        }

        return res.status(200).json({ ok: true, sent: sentCount });
    } catch (err) {
        console.error('Error send-push Vercel:', err);
        return res.status(500).json({ error: err.message });
    }
};
