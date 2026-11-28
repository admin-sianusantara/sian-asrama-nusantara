import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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
    filterJenjang: "ALL",
    filterKelas: "ALL",
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

// Auto-login (Quick Login) jika sesi Firebase sudah aktif
let autoLoginTriggered = false;
onAuthStateChanged(authSIAN, async (userSIAN) => {
    if (userSIAN && !autoLoginTriggered) {
        if (!authSIAP || authSIAP.currentUser) {
            autoLoginTriggered = true;
            document.getElementById("master-user-info").textContent = `Login sebagai: ${userSIAN.email || "Pimpinan"}`;
            loginView.classList.add("hidden");
            dashboardView.classList.remove("hidden");
            await fetchAllMasterData();
        }
    }
});
if (authSIAP) {
    onAuthStateChanged(authSIAP, async (userSIAP) => {
        if (userSIAP && authSIAN.currentUser && !autoLoginTriggered) {
            autoLoginTriggered = true;
            document.getElementById("master-user-info").textContent = `Login sebagai: ${authSIAN.currentUser.email || "Pimpinan"}`;
            loginView.classList.add("hidden");
            dashboardView.classList.remove("hidden");
            await fetchAllMasterData();
        }
    });
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
    // Hanya tampilkan pelanggaran berat / keamanan (kecualikan telat & tidak ikut kegiatan)
    state.pelanggaran = [...pelanggaranSIAN, ...pelanggaranSIAP].filter((p) => {
        const jenis = String(p.jenis || p.kategori || p.keterangan || "").toLowerCase();
        if (jenis.includes("terlambat") || jenis.includes("tidak ikut kegiatan") || jenis === "telat" || jenis === "alpa") {
            return false;
        }
        return true;
    });

    connStatus.innerHTML = isSiapConfigured
        ? `<span class="text-emerald-400 font-semibold">Terhubung ke SIAN & SIAP</span> • Terakhir diperbarui: ${new Date().toLocaleTimeString("id-ID")}`
        : `<span class="text-amber-300 font-semibold">SIAN Terhubung • SIAP masih menggunakan placeholder config</span>`;

    updateSummaryCards();
    populateKelasDropdown();
    renderTable();
}

function resolveKelas(item) {
    if (item.kelas) return String(item.kelas).trim();
    const nama = String(item.nama || item.santriNama || item.namaSantri || "").trim().toLowerCase();
    const santriMatch = state.santri.find((s) =>
        (item.santriId && s.id === item.santriId) ||
        (nama && String(s.nama || "").trim().toLowerCase() === nama && s.asalAsrama === item.asalAsrama)
    );
    return String(santriMatch?.kelas || "").trim();
}

function resolveTingkatKelas(item) {
    const k = resolveKelas(item).toUpperCase();
    if (/^(XII|12)\b/.test(k)) return "XII";
    if (/^(XI|11)\b/.test(k)) return "XI";
    if (/^(X|10)\b/.test(k)) return "X";
    if (/^(IX|9)\b/.test(k)) return "IX";
    if (/^(VIII|8)\b/.test(k)) return "VIII";
    if (/^(VII|7)\b/.test(k)) return "VII";
    return "-";
}

function populateKelasDropdown() {
    const sel = document.getElementById("filter-kelas");
    if (!sel) return;
    const opts = state.filterJenjang === "SMP"
        ? ["VII", "VIII", "IX"]
        : state.filterJenjang === "SMA"
            ? ["X", "XI", "XII"]
            : ["VII", "VIII", "IX", "X", "XI", "XII"];
    const prev = state.filterKelas;
    sel.innerHTML = `<option value="ALL">Semua Kelas</option>` + opts.map((k) => `<option value="${k}" ${k === prev ? "selected" : ""}>Kelas ${k}</option>`).join("");
    if (prev !== "ALL" && !opts.includes(prev)) {
        state.filterKelas = "ALL";
        sel.value = "ALL";
    }
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

function resolveJenjang(item) {
    if (item.jenjang) return String(item.jenjang).toUpperCase();
    const nama = String(item.nama || item.santriNama || item.namaSantri || "").trim().toLowerCase();
    const santriMatch = state.santri.find((s) =>
        (item.santriId && s.id === item.santriId) ||
        (nama && String(s.nama || "").trim().toLowerCase() === nama && s.asalAsrama === item.asalAsrama)
    );
    const kelas = String(item.kelas || santriMatch?.kelas || "").trim().toUpperCase();
    if (santriMatch?.jenjang) return String(santriMatch.jenjang).toUpperCase();
    if (/^(VII|VIII|IX)\b/.test(kelas) || /^[789]\b/.test(kelas)) return "SMP";
    if (/^(X|XI|XII)\b/.test(kelas) || /^(10|11|12)\b/.test(kelas)) return "SMA";
    return "-";
}

function getFilteredData() {
    const list = state[state.activeTab] || [];
    const q = state.searchQuery.toLowerCase();

    return list.filter((item) => {
        if (state.filterAsrama !== "ALL" && item.asalAsrama !== state.filterAsrama) {
            return false;
        }
        if (state.filterJenjang !== "ALL" && resolveJenjang(item) !== state.filterJenjang) {
            return false;
        }
        if (state.filterKelas !== "ALL" && resolveTingkatKelas(item) !== state.filterKelas) {
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
        const nama = item.nama || item.santriNama || item.namaSantri || "-";

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
    populateKelasDropdown();
    renderTable();
});

document.getElementById("filter-jenjang").addEventListener("change", (e) => {
    state.filterJenjang = e.target.value;
    populateKelasDropdown();
    renderTable();
});

document.getElementById("filter-kelas").addEventListener("change", (e) => {
    state.filterKelas = e.target.value;
    renderTable();
});

document.getElementById("search-santri").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderTable();
});

document.querySelectorAll(".master-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".master-tab").forEach((b) => {
            b.classList.remove("border-2", "border-sky-500");
            b.classList.add("border", "border-[#273647]");
        });
        btn.classList.remove("border", "border-[#273647]");
        btn.classList.add("border-2", "border-sky-500");
        state.activeTab = btn.dataset.tab;
        const waBtn = document.getElementById("btn-export-wa");
        if (waBtn) {
            if (state.activeTab === "izin") waBtn.classList.remove("hidden");
            else waBtn.classList.add("hidden");
        }
        renderTable();
    });
});

document.getElementById("btn-refresh-master").addEventListener("click", fetchAllMasterData);

document.getElementById("btn-export-wa").addEventListener("click", () => {
    const rows = getFilteredData();
    if (!rows.length) {
        alert("Tidak ada data untuk dikirim ke WhatsApp.");
        return;
    }
    const header = `*LAPORAN SIMA (${state.activeTab.toUpperCase()})*\nAsrama: ${state.filterAsrama === "ALL" ? "Semua" : state.filterAsrama} | Jenjang: ${state.filterJenjang === "ALL" ? "Semua" : state.filterJenjang} | Kelas: ${state.filterKelas === "ALL" ? "Semua" : state.filterKelas}\nTotal: ${rows.length} data\n\n`;
    const lines = rows.slice(0, 40).map((item, i) => {
        const nama = item.nama || item.santriNama || item.namaSantri || "-";
        const kls = resolveKelas(item) || "-";
        const info = state.activeTab === "izin" ? (item.alasan || item.keterangan || item.status || "-")
            : state.activeTab === "absensi" ? (item.kegiatan || item.status || "-")
            : state.activeTab === "pelanggaran" ? (item.jenis || item.keterangan || "-")
            : `${item.sektor || "-"} • ${item.kamar || "-"}`;
        return `${i + 1}. *${nama}* (${kls}) - ${item.asalAsrama}\n   _${info}_`;
    }).join("\n");
    const footer = rows.length > 40 ? `\n\n...dan ${rows.length - 40} data lainnya.` : "";
    const url = `https://wa.me/?text=${encodeURIComponent(header + lines + footer)}`;
    window.open(url, "_blank");
});

document.getElementById("btn-export-excel").addEventListener("click", () => {
    if (typeof XLSX === "undefined") {
        alert("Library Excel belum selesai dimuat. Coba sesaat lagi.");
        return;
    }
    const wb = XLSX.utils.book_new();
    const filterFn = (arr) => arr.filter((x) => {
        if (state.filterAsrama !== "ALL" && x.asalAsrama !== state.filterAsrama) return false;
        if (state.filterJenjang !== "ALL" && resolveJenjang(x) !== state.filterJenjang) return false;
        if (state.filterKelas !== "ALL" && resolveKelas(x) !== state.filterKelas) return false;
        return true;
    });

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
