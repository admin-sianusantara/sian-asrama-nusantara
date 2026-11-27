// ============================================================================
// KONFIGURASI MULTI-TENANT SIAN & SIAP
// ============================================================================

export const FIREBASE_SIAN = {
    apiKey: "AIzaSyC7spgWIt7iPsPpVOPTmk0e-XYO8TgZINI",
    authDomain: "sian-asrama-nusantara.firebaseapp.com",
    projectId: "sian-asrama-nusantara",
    storageBucket: "sian-asrama-nusantara.firebasestorage.app",
    messagingSenderId: "561976504931",
    appId: "1:561976504931:web:b0856e7d4d56c903677e56",
    measurementId: "G-Z20J923GWW"
};

// Placeholder sementara untuk Firebase SIAP (Asrama Putra) — silakan ganti dengan config asli
export const FIREBASE_SIAP = {
    apiKey: "AIzaSyC-0Iouc9PhVu0EGQtTAMASQh5pJKIsA1E",
    authDomain: "siap-asrama-putra.firebaseapp.com",
    projectId: "siap-asrama-putra",
    storageBucket: "siap-asrama-putra.firebasestorage.app",
    messagingSenderId: "903525384971",
    appId: "1:903525384971:web:ada49361e2c8ea12af980e",
    measurementId: "G-1KPZJDS0YM"
};

const TENANT_CONFIGS = {
    SIAN: {
        kode: "SIAN",
        nama: "Sistem Informasi Asrama Nusantara",
        logo: "/assets/logo-sian.png",
        manifest: "/manifest-sian.json",
        sektor: [
            "Asrama Nusantara Lt. 1 Utara",
            "Asrama Nusantara Lt. 1 Selatan",
            "Asrama Nusantara Lt. 2 Utara",
            "Asrama Nusantara Lt. 2 Selatan",
            "Asrama Nusantara Lt. 3 Utara",
            "Asrama Nusantara Lt. 3 Selatan"
        ],
        firebase: FIREBASE_SIAN
    },
    SIAP: {
        kode: "SIAP",
        nama: "Sistem Informasi Asrama Putra",
        logo: "/assets/logo-siap.jpg",
        manifest: "/manifest-siap.json",
        sektor: [
            "Putra Lt 2",
            "Putra Lt 3"
        ],
        firebase: FIREBASE_SIAP
    }
};

function detectActiveMode() {
    const hostname = window.location.hostname.toLowerCase();
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";

    if (isLocal) {
        const params = new URLSearchParams(window.location.search);
        const appParam = params.get("app");
        if (appParam === "siap" || appParam === "sian") {
            localStorage.setItem("sian_dev_tenant", appParam.toUpperCase());
        }
        const saved = localStorage.getItem("sian_dev_tenant");
        return saved === "SIAP" ? "SIAP" : "SIAN";
    }

    return hostname.includes("siap") ? "SIAP" : "SIAN";
}

const activeMode = detectActiveMode();
export const ACTIVE_CONFIG = TENANT_CONFIGS[activeMode];

// Expose ke window agar dapat diakses oleh script non-module
window.ACTIVE_CONFIG = ACTIVE_CONFIG;

// Tombol melayang khusus localhost / 127.0.0.1 untuk testing ganti mode SIAN <-> SIAP
(function renderDevSwitcher() {
    const hostname = window.location.hostname.toLowerCase();
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    if (!isLocal) return;

    const mountButton = () => {
        if (document.getElementById("dev-tenant-switcher")) return;
        const btn = document.createElement("button");
        btn.id = "dev-tenant-switcher";
        btn.type = "button";
        const nextMode = activeMode === "SIAN" ? "siap" : "sian";
        btn.textContent = `DEV: ${activeMode} (Klik → ${nextMode.toUpperCase()})`;
        btn.style.cssText = [
            "position:fixed",
            "bottom:16px",
            "right:16px",
            "z-index:99999",
            "padding:8px 12px",
            "border-radius:9999px",
            "font-size:11px",
            "font-weight:700",
            "font-family:sans-serif",
            "background:" + (activeMode === "SIAP" ? "#0284c7" : "#059669"),
            "color:#ffffff",
            "border:1px solid rgba(255,255,255,0.25)",
            "box-shadow:0 4px 14px rgba(0,0,0,0.4)",
            "cursor:pointer"
        ].join(";");
        btn.addEventListener("click", () => {
            localStorage.setItem("sian_dev_tenant", nextMode.toUpperCase());
            const url = new URL(window.location.href);
            url.searchParams.set("app", nextMode);
            window.location.href = url.toString();
        });
        document.body.appendChild(btn);
    };

    if (document.body) {
        mountButton();
    } else {
        window.addEventListener("DOMContentLoaded", mountButton);
    }
})();
