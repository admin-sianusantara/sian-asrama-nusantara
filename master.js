import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { FIREBASE_SIAN, FIREBASE_SIAP } from "./config.js";

// Inisialisasi 2 koneksi Firebase sekaligus
const appSIAN = initializeApp(FIREBASE_SIAN, "SIAN");
const authSIAN = getAuth(appSIAN);
const dbSIAN = getFirestore(appSIAN);

const isSiapConfigured = FIREBASE_SIAP.apiKey && !FIREBASE_SIAP.apiKey.includes("MASUKKAN_");
const appSIAP = isSiapConfigured ? initializeApp(FIREBASE_SIAP, "SIAP") : null;
const authSIAP = appSIAP ? getAuth(appSIAP) : null;
const dbSIAP = appSIAP ? getFirestore(appSIAP) : null;

const state = {
    santri: [],
    absensi: [],
    izin: [],
    pelanggaran: [],
    activeTab: "santri",
    filterAsrama: "ALL",
    searchQuery: ""
};

// DOM Elements
const loginView = document.getElementById("master-login-view");
const dashboardView = document.getElementById("master-dashboard-view");
const loginForm = document.getElementById("master-login-form");
const loginError = document.getElementById("master-login-error");
const loginBtn = document.getElementById("master-login-btn");
const connStatus = document.getElementById("master-connection-status");

function showError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove("hidden");
}

// Login 1 Pintu (Promise.all ke kedua Firebase)
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.add("hidden");
    const email = document.getElementById("master-email").value.trim();
    const password = document.getElementById("master-password").value;

    loginBtn.disabled = true;
    loginBtn.textContent = "Menghubungkan ke SIAN & SIAP...";

    try {
        const authPromises = [signInWithEmailAndPassword(authSIAN, email, password)];
        if (authSIAP) {
            authPromises.push(signInWithEmailAndPassword(authSIAP, email, password));
        }

        await Promise.all(authPromises);

        document.getElementById("master-user-info").textContent = `Login sebagai: ${email}`;
        loginView.classList.add("hidden");
        dashboardView.classList.remove("hidden");

        await fetchAllMasterData();
    } catch (err) {
        console.error("Login SIMA gagal:", err);
        showError(`Login gagal: ${err.message}`);
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = "Masuk ke Dashboard Gabungan";
    }
});

// Opsi 2: Login dengan Google (ke SIAN & SIAP, aman dari popup blocker)
const googleLoginBtn = document.getElementById("btn-master-google-login");
let googleStep = 1;
let lastGoogleEmail = "";

if (googleLoginBtn) {
    googleLoginBtn.addEventListener("click", async () => {
        loginError.classList.add("hidden");
        googleLoginBtn.disabled = true;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        try {
            if (googleStep === 1) {
                googleLoginBtn.textContent = "Menghubungkan Google (SIAN)...";
                const resSIAN = await signInWithPopup(authSIAN, provider);
                lastGoogleEmail = resSIAN.user?.email || "Akun Google";

                if (authSIAP) {
                    try {
                        googleLoginBtn.textContent = "Menghubungkan Google (SIAP)...";
                        await signInWithPopup(authSIAP, provider);
                    } catch (errSIAP) {
                        if (errSIAP.code === "auth/popup-blocked") {
                            googleStep = 2;
                            showError("SIAN berhasil! Klik tombol di bawah sekali lagi untuk menyelesaikan login Google SIAP.");
                            googleLoginBtn.disabled = false;
                            googleLoginBtn.innerHTML = `<i class="ph-bold ph-google-logo text-amber-300 text-base"></i> Lanjutkan Login Google (SIAP)`;
                            return;
                        }
                        throw errSIAP;
                    }
                }
            } else {
                googleLoginBtn.textContent = "Menghubungkan Google (SIAP)...";
                await signInWithPopup(authSIAP, provider);
                googleStep = 1;
            }

            document.getElementById("master-user-info").textContent = `Login sebagai: ${lastGoogleEmail}`;
            loginView.classList.add("hidden");
            dashboardView.classList.remove("hidden");

            await fetchAllMasterData();
        } catch (err) {
            console.error("Login Google SIMA gagal:", err);
            showError(`Login Google gagal: ${err.message}`);
            googleStep = 1;
        } finally {
            googleLoginBtn.disabled = false;
            if (googleStep === 1) {
                googleLoginBtn.innerHTML = `<i class="ph-bold ph-google-logo text-amber-300 text-base"></i> Masuk dengan Google`;
            }
        }
    });
}

// Tarik koleksi dari 1 database & sisipkan asalAsrama
async function fetchCollectionWithOrigin(db, colName, asalAsrama) {
    if (!db) return [];
    try {
        const snap = await getDocs(collection(db, colName));
        return snap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            asalAsrama
        }));
    } catch (err) {
        console.warn(`Gagal mengambil ${colName} dari ${asalAsrama}:`, err.message);
        return [];
    }
}

// Penarik data paralel dari SIAN & SIAP
async function fetchAllMasterData() {
    connStatus.textContent = "Menarik data paralel dari Asrama Nusantara (SIAN) & Asrama Putra (SIAP)...";

    const [
        santriSIAN, santriSIAP,
        absensiSIAN, absensiSIAP,
        izinSIAN, izinSIAP,
        pelanggaranSIAN, pelanggaranSIAP
    ] = await Promise.all([
        fetchCollectionWithOrigin(dbSIAN, "santri", "Asrama Nusantara"),
        fetchCollectionWithOrigin(dbSIAP, "santri", "Asrama Putra"),
        fetchCollectionWithOrigin(dbSIAN, "absensi", "Asrama Nusantara"),
        fetchCollectionWithOrigin(dbSIAP, "absensi", "Asrama Putra"),
        fetchCollectionWithOrigin(dbSIAN, "izin", "Asrama Nusantara"),
        fetchCollectionWithOrigin(dbSIAP, "izin", "Asrama Putra"),
        fetchCollectionWithOrigin(dbSIAN, "pelanggaran", "Asrama Nusantara"),
        fetchCollectionWithOrigin(dbSIAP, "pelanggaran", "Asrama Putra")
    ]);

    state.santri = [...santriSIAN, ...santriSIAP];
    state.absensi = [...absensiSIAN, ...absensiSIAP];
    state.izin = [...izinSIAN, ...izinSIAP];
    state.pelanggaran = [...pelanggaranSIAN, ...pelanggaranSIAP];

    connStatus.innerHTML = isSiapConfigured
        ? `<span class="text-emerald-400 font-semibold">Terhubung ke SIAN & SIAP</span> • Terakhir diperbarui: ${new Date().toLocaleTimeString("id-ID")}`
        : `<span class="text-amber-300 font-semibold">SIAN Terhubung • SIAP masih menggunakan placeholder config</span>`;

    updateSummaryCards();
    renderTable();
}

function updateSummaryCards() {
    const countBy = (arr, origin) => arr.filter((x) => x.asalAsrama === origin).length;

    document.getElementById("stat-total-santri").textContent = state.santri.length;
    document.getElementById("stat-santri-breakdown").textContent =
        `SIAN: ${countBy(state.santri, "Asrama Nusantara")} • SIAP: ${countBy(state.santri, "Asrama Putra")}`;

    document.getElementById("stat-total-absensi").textContent = state.absensi.length;
    document.getElementById("stat-absensi-breakdown").textContent =
        `SIAN: ${countBy(state.absensi, "Asrama Nusantara")} • SIAP: ${countBy(state.absensi, "Asrama Putra")}`;

    document.getElementById("stat-total-izin").textContent = state.izin.length;
    document.getElementById("stat-izin-breakdown").textContent =
        `SIAN: ${countBy(state.izin, "Asrama Nusantara")} • SIAP: ${countBy(state.izin, "Asrama Putra")}`;

    document.getElementById("stat-total-pelanggaran").textContent = state.pelanggaran.length;
    document.getElementById("stat-pelanggaran-breakdown").textContent =
        `SIAN: ${countBy(state.pelanggaran, "Asrama Nusantara")} • SIAP: ${countBy(state.pelanggaran, "Asrama Putra")}`;
}

function getFilteredData() {
    const list = state[state.activeTab] || [];
    const q = state.searchQuery.toLowerCase();

    return list.filter((item) => {
        if (state.filterAsrama !== "ALL" && item.asalAsrama !== state.filterAsrama) {
            return false;
        }
        if (!q) return true;
        const searchable = [
            item.nama,
            item.namaSantri,
            item.kamar,
            item.sektor,
            item.asalAsrama,
            item.kegiatan,
            item.keterangan,
            item.alasan
        ].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(q);
    });
}

function renderTable() {
    const thead = document.getElementById("master-table-head");
    const tbody = document.getElementById("master-table-body");
    const rows = getFilteredData();

    const headers = {
        santri: ["Asal Asrama", "Nama Santri", "Sektor", "Kamar", "Status"],
        absensi: ["Asal Asrama", "Nama Santri", "Kegiatan", "Tanggal", "Status"],
        izin: ["Asal Asrama", "Nama Santri", "Alasan / Tujuan", "Tanggal", "Status"],
        pelanggaran: ["Asal Asrama", "Nama Santri", "Pelanggaran", "Tanggal", "Poin / Tindakan"]
    }[state.activeTab];

    thead.innerHTML = `<tr>${headers.map((h) => `<th class="px-4 py-3 font-bold">${h}</th>`).join("")}</tr>`;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${headers.length}" class="px-4 py-8 text-center text-slate-400">Tidak ada data yang cocok.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.slice(0, 200).map((item) => {
        const badgeClass = item.asalAsrama === "Asrama Putra"
            ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
            : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
        const badge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}">${item.asalAsrama}</span>`;
        const nama = item.nama || item.namaSantri || "-";

        if (state.activeTab === "santri") {
            return `<tr class="hover:bg-[#1c2b3c]/60">
                <td class="px-4 py-3">${badge}</td>
                <td class="px-4 py-3 font-semibold text-white">${nama}</td>
                <td class="px-4 py-3">${item.sektor || "-"}</td>
                <td class="px-4 py-3">${item.kamar || "-"}</td>
                <td class="px-4 py-3">${item.status || "Aktif"}</td>
            </tr>`;
        }
        if (state.activeTab === "absensi") {
            return `<tr class="hover:bg-[#1c2b3c]/60">
                <td class="px-4 py-3">${badge}</td>
                <td class="px-4 py-3 font-semibold text-white">${nama}</td>
                <td class="px-4 py-3">${item.kegiatan || "-"}</td>
                <td class="px-4 py-3">${item.tanggal || "-"}</td>
                <td class="px-4 py-3">${item.status || "-"}</td>
            </tr>`;
        }
        if (state.activeTab === "izin") {
            return `<tr class="hover:bg-[#1c2b3c]/60">
                <td class="px-4 py-3">${badge}</td>
                <td class="px-4 py-3 font-semibold text-white">${nama}</td>
                <td class="px-4 py-3">${item.alasan || item.keterangan || "-"}</td>
                <td class="px-4 py-3">${item.tanggal || item.tanggalKeluar || "-"}</td>
                <td class="px-4 py-3">${item.status || "-"}</td>
            </tr>`;
        }
        return `<tr class="hover:bg-[#1c2b3c]/60">
            <td class="px-4 py-3">${badge}</td>
            <td class="px-4 py-3 font-semibold text-white">${nama}</td>
            <td class="px-4 py-3">${item.jenis || item.keterangan || "-"}</td>
            <td class="px-4 py-3">${item.tanggal || "-"}</td>
            <td class="px-4 py-3">${item.poin || item.tindakan || "-"}</td>
        </tr>`;
    }).join("");
}

// Event Listeners UI
document.getElementById("filter-asrama").addEventListener("change", (e) => {
    state.filterAsrama = e.target.value;
    renderTable();
});

document.getElementById("search-santri").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderTable();
});

document.querySelectorAll(".master-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".master-tab").forEach((b) => {
            b.className = "master-tab px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white cursor-pointer";
        });
        btn.className = "master-tab px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-500 text-slate-950 cursor-pointer";
        state.activeTab = btn.dataset.tab;
        renderTable();
    });
});

document.getElementById("btn-refresh-master").addEventListener("click", fetchAllMasterData);

document.getElementById("btn-export-excel").addEventListener("click", () => {
    if (typeof XLSX === "undefined") {
        alert("Library Excel belum selesai dimuat. Coba sesaat lagi.");
        return;
    }
    const wb = XLSX.utils.book_new();
    const filterFn = (arr) => state.filterAsrama === "ALL" ? arr : arr.filter((x) => x.asalAsrama === state.filterAsrama);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filterFn(state.santri)), "Santri");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filterFn(state.absensi)), "Absensi");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filterFn(state.izin)), "Izin");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filterFn(state.pelanggaran)), "Pelanggaran");

    const tgl = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `SIMA-Laporan-Gabungan-${tgl}.xlsx`);
});

document.getElementById("btn-master-logout").addEventListener("click", async () => {
    await Promise.all([
        signOut(authSIAN),
        authSIAP ? signOut(authSIAP) : Promise.resolve()
    ]);
    dashboardView.classList.add("hidden");
    loginView.classList.remove("hidden");
});
