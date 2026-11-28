// ============================================================================
// MANAJEMEN KELAS & WALAS (SMP, SMA, IIS) - CLOUD FIRESTORE
// ============================================================================

(function () {
    const kwState = {
        walasList: [],
        kelasList: [],
        unitFilter: "ALL", // ALL | SMP | SMA | IIS
        activeTab: "kelas", // kelas | walas
        searchQuery: "",
        loaded: false,
        stagingContacts: []
    };

    // ------------------------------------------------------------------------
    // 0. KONEKSI DATABASE PUSAT (SIAN) UNTUK MASTER_WALAS & MASTER_KELAS
    // ------------------------------------------------------------------------
    let _masterDb = null;
    async function getMasterDb() {
        if (_masterDb) return _masterDb;
        if (!window.ACTIVE_CONFIG || window.ACTIVE_CONFIG.kode !== "SIAP") {
            _masterDb = window.FB?.db || null;
            return _masterDb;
        }
        try {
            const [{ initializeApp, getApps }, { getFirestore }, { FIREBASE_SIAN }] = await Promise.all([
                import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"),
                import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"),
                import("./config.js")
            ]);
            const existing = getApps().find((a) => a.name === "SIAN_MASTER");
            const masterApp = existing || initializeApp(FIREBASE_SIAN, "SIAN_MASTER");
            _masterDb = getFirestore(masterApp);
            return _masterDb;
        } catch (err) {
            console.warn("Fallback ke DB aktif untuk master_walas/master_kelas:", err);
            _masterDb = window.FB?.db || null;
            return _masterDb;
        }
    }

    // ------------------------------------------------------------------------
    // 1. UTILITAS NORMALISASI WA & HELPER
    // ------------------------------------------------------------------------
    function normalizeWa(raw) {
        let digits = String(raw || "").replace(/\D/g, "");
        if (!digits) return "";
        if (digits.startsWith("0")) digits = "62" + digits.slice(1);
        else if (digits.startsWith("8")) digits = "62" + digits;
        return digits;
    }

    function isWaValid(wa) {
        if (!wa) return true; // boleh kosong
        return wa.length >= 10 && wa.length <= 15;
    }

    function makeKelasDocId(unit, namaKelas) {
        const clean = String(namaKelas || "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return `${unit}_${clean || Date.now()}`;
    }

    function unitBadge(unit) {
        const colors = {
            SMP: "bg-sky-500/15 text-sky-300 border-sky-500/30",
            SMA: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
            IIS: "bg-amber-500/15 text-amber-300 border-amber-500/30"
        };
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${colors[unit] || "bg-slate-500/15 text-slate-300 border-slate-500/30"}">${unit}</span>`;
    }

    async function commitBatchedOps(ops, targetDb = null) {
        const db = targetDb || window.FB?.db;
        if (!window.FB || !window.FB.ready || !db || !ops.length) return;
        const CHUNK = 400;
        for (let i = 0; i < ops.length; i += CHUNK) {
            const batch = window.FB.writeBatch(db);
            ops.slice(i, i + CHUNK).forEach((op) => {
                if (op.type === "set") batch.set(op.ref, op.data, op.options || {});
                else if (op.type === "update") batch.update(op.ref, op.data);
                else if (op.type === "delete") batch.delete(op.ref);
            });
            await batch.commit();
        }
    }

    // ------------------------------------------------------------------------
    // 2. LOAD DATA DARI FIRESTORE
    // ------------------------------------------------------------------------
    async function loadKelasWalasData() {
        if (!window.FB || !window.FB.ready) return;
        try {
            const masterDb = await getMasterDb();
            const [wSnap, kSnap] = await Promise.all([
                window.FB.getDocs(window.FB.collection(masterDb, "master_walas")),
                window.FB.getDocs(window.FB.collection(masterDb, "master_kelas"))
            ]);
            kwState.walasList = wSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            kwState.kelasList = kSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            kwState.loaded = true;
        } catch (err) {
            console.error("Gagal memuat master_walas/master_kelas:", err);
            if (window.showToast) window.showToast("Gagal memuat data Kelas & Walas: " + err.message, "error");
        }
    }

    // ------------------------------------------------------------------------
    // 3. RENDER HALAMAN UTAMA
    // ------------------------------------------------------------------------
    window.renderKelasWalasPage = async function () {
        const container = document.getElementById("app-content");
        if (!container) return;

        if (!kwState.loaded) {
            container.innerHTML = `<div class="p-8 text-center text-xs text-slate-400">Memuat data Kelas & Walas...</div>`;
            await loadKelasWalasData();
        }

        const isAdmin = window.isRecordAdmin && window.isRecordAdmin(window.currentUser);
        const santriList = window.getSantriList ? window.getSantriList() : [];

        const countUnit = (u) => {
            const k = u === "ALL" ? kwState.kelasList.length : kwState.kelasList.filter((x) => x.unit === u).length;
            const w = u === "ALL" ? kwState.walasList.length : kwState.walasList.filter((x) => x.unit === u).length;
            return `${k} Kls • ${w} Wls`;
        };

        container.innerHTML = `
            <div class="space-y-5 pb-12">
                <!-- Header -->
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 class="text-xl font-extrabold text-white flex items-center gap-2">
                            <i class="ph-bold ph-chalkboard-teacher text-emerald-400"></i>
                            Manajemen Kelas & Walas
                        </h2>
                        <p class="text-xs text-slate-400 mt-0.5">Direktori Wali Kelas & Kelas Sekolah terpisah (SMP, SMA, IIS).</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button onclick="KelasWalas.exportVcfModal()" class="px-3 py-2 rounded-xl bg-asrama-card hover:bg-asrama-cardHover border border-asrama-border text-sky-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                            <i class="ph-bold ph-address-book"></i> Export Kontak (.vcf)
                        </button>
                        <button onclick="KelasWalas.exportExcel()" class="px-3 py-2 rounded-xl bg-asrama-card hover:bg-asrama-cardHover border border-asrama-border text-emerald-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                            <i class="ph-bold ph-file-xls"></i> Export Excel
                        </button>
                        ${isAdmin ? `
                            <button onclick="KelasWalas.downloadTemplate()" class="px-3 py-2 rounded-xl bg-asrama-card hover:bg-asrama-cardHover border border-asrama-border text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                                <i class="ph-bold ph-download-simple"></i> Template
                            </button>
                            <label class="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                                <i class="ph-bold ph-upload-simple"></i> Import Excel
                                <input type="file" accept=".xlsx,.xls" onchange="KelasWalas.handleExcelImport(event)" class="hidden">
                            </label>
                            <button onclick="KelasWalas.backupJson()" class="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                                <i class="ph-bold ph-database"></i> Backup (.json)
                            </button>
                        ` : ""}
                    </div>
                </div>

                <!-- Filter Unit Pills & Search -->
                <div class="bg-asrama-card border border-asrama-border rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                    <div class="flex flex-wrap gap-1.5">
                        ${["ALL", "SMP", "SMA", "IIS"].map((u) => `
                            <button onclick="KelasWalas.setUnit('${u}')" class="px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${kwState.unitFilter === u ? "bg-sky-500 text-slate-950" : "bg-asrama-bg text-slate-300 hover:text-white border border-asrama-border"}">
                                ${u === "ALL" ? "Semua" : u} <span class="opacity-75 font-normal">(${countUnit(u)})</span>
                            </button>
                        `).join("")}
                    </div>
                    <input id="kw-search-input" type="text" value="${kwState.searchQuery}" placeholder="Cari nama kelas, walas, atau no WA..." class="md:w-72 px-3.5 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-white focus:outline-none focus:border-sky-400">
                </div>

                <!-- Tabs -->
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="flex gap-1.5 bg-asrama-card p-1 rounded-xl border border-asrama-border">
                        <button onclick="KelasWalas.setTab('kelas')" class="px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${kwState.activeTab === "kelas" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:text-white"}">
                            1. Daftar Kelas (${kwState.kelasList.length})
                        </button>
                        <button onclick="KelasWalas.setTab('walas')" class="px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${kwState.activeTab === "walas" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:text-white"}">
                            2. Direktori Walas (${kwState.walasList.length})
                        </button>
                    </div>
                    ${isAdmin ? renderAdminActionButtons() : ""}
                </div>

                <!-- Content Table -->
                <div id="kw-table-container" class="bg-asrama-card border border-asrama-border rounded-2xl overflow-x-auto">
                    ${kwState.activeTab === "kelas" ? renderKelasTable(isAdmin, santriList) : renderWalasTable(isAdmin)}
                </div>
            </div>
        `;

        document.getElementById("kw-search-input").addEventListener("input", (e) => {
            kwState.searchQuery = e.target.value;
            document.getElementById("kw-table-container").innerHTML =
                kwState.activeTab === "kelas" ? renderKelasTable(isAdmin, santriList) : renderWalasTable(isAdmin);
        });
    };

    function renderAdminActionButtons() {
        if (kwState.activeTab === "kelas") {
            return `
                <button onclick="KelasWalas.openTambahKelasModal()" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                    <i class="ph-bold ph-plus"></i> Tambah Kelas
                </button>
            `;
        }
        return `
            <div class="flex flex-wrap gap-2">
                <button onclick="KelasWalas.pickFromPhoneContacts()" class="px-3 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                    <i class="ph-bold ph-device-mobile"></i> Ambil dari Kontak HP
                </button>
                <label class="px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                    <i class="ph-bold ph-file-arrow-up"></i> Upload Kontak (.vcf)
                    <input type="file" accept=".vcf" onchange="KelasWalas.handleVcfUpload(event)" class="hidden">
                </label>
                <button onclick="KelasWalas.openSmartPasteModal()" class="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                    <i class="ph-bold ph-clipboard-text"></i> Smart Paste WA / Excel
                </button>
                <button onclick="KelasWalas.openWalasFormModal()" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                    <i class="ph-bold ph-plus"></i> Tambah Walas
                </button>
            </div>
        `;
    }

    function renderKelasTable(isAdmin, santriList) {
        const q = kwState.searchQuery.toLowerCase();
        const rows = kwState.kelasList
            .filter((k) => kwState.unitFilter === "ALL" || k.unit === kwState.unitFilter)
            .filter((k) => {
                if (!q) return true;
                const w = kwState.walasList.find((x) => x.id === k.walas_id);
                return `${k.nama_kelas} ${k.unit} ${w?.nama || ""} ${w?.no_wa || ""}`.toLowerCase().includes(q);
            })
            .sort((a, b) => a.unit.localeCompare(b.unit) || a.nama_kelas.localeCompare(b.nama_kelas));

        if (!rows.length) {
            return `<div class="p-8 text-center text-xs text-slate-400">Belum ada data kelas.</div>`;
        }

        return `
            <table class="w-full text-left border-collapse text-xs">
                <thead class="bg-asrama-sidebar text-[11px] uppercase text-slate-400 border-b border-asrama-border">
                    <tr>
                        <th class="px-4 py-3">Unit</th>
                        <th class="px-4 py-3">Nama Kelas</th>
                        <th class="px-4 py-3">Wali Kelas & No. WA</th>
                        <th class="px-4 py-3">Santri Asrama</th>
                        <th class="px-4 py-3">Aksi</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-asrama-border">
                    ${rows.map((k) => {
                        const w = kwState.walasList.find((x) => x.id === k.walas_id);
                        const santriCount = santriList.filter((s) => String(s.kelas || "").trim().toLowerCase() === String(k.nama_kelas || "").trim().toLowerCase()).length;
                        return `
                            <tr class="hover:bg-asrama-cardHover/40">
                                <td class="px-4 py-3">${unitBadge(k.unit)}</td>
                                <td class="px-4 py-3 font-bold text-white">${k.nama_kelas}</td>
                                <td class="px-4 py-3">
                                    ${w ? `
                                        <div class="font-semibold text-slate-200">${w.nama}</div>
                                        ${w.no_wa ? `<a href="https://wa.me/${w.no_wa}" target="_blank" class="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline mt-0.5"><i class="ph-bold ph-whatsapp-logo"></i> ${w.no_wa}</a>` : `<span class="text-[11px] text-slate-500">Belum ada No. WA</span>`}
                                    ` : `<span class="text-slate-500 italic">Belum Ada Walas</span>`}
                                </td>
                                <td class="px-4 py-3 font-semibold text-sky-300">${santriCount} santri</td>
                                <td class="px-4 py-3">
                                    <div class="flex flex-wrap gap-1.5">
                                        ${w?.no_wa ? `<a href="https://wa.me/${w.no_wa}" target="_blank" class="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">Chat WA</a>` : ""}
                                        ${isAdmin ? `
                                            <button onclick="KelasWalas.openGantiWalasModal('${k.id}')" class="px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[11px] font-semibold cursor-pointer">Ganti Walas</button>
                                            <button onclick="KelasWalas.openRenameKelasModal('${k.id}')" class="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold cursor-pointer">Ubah</button>
                                            <button onclick="KelasWalas.deleteKelas('${k.id}', ${santriCount})" class="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-semibold cursor-pointer">Hapus</button>
                                        ` : ""}
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        `;
    }

    function renderWalasTable(isAdmin) {
        const q = kwState.searchQuery.toLowerCase();
        const rows = kwState.walasList
            .filter((w) => kwState.unitFilter === "ALL" || w.unit === kwState.unitFilter)
            .filter((w) => !q || `${w.nama} ${w.no_wa} ${w.unit}`.toLowerCase().includes(q))
            .sort((a, b) => a.unit.localeCompare(b.unit) || a.nama.localeCompare(b.nama));

        if (!rows.length) {
            return `<div class="p-8 text-center text-xs text-slate-400">Belum ada data Wali Kelas.</div>`;
        }

        return `
            <table class="w-full text-left border-collapse text-xs">
                <thead class="bg-asrama-sidebar text-[11px] uppercase text-slate-400 border-b border-asrama-border">
                    <tr>
                        <th class="px-4 py-3">Unit</th>
                        <th class="px-4 py-3">Nama Wali Kelas</th>
                        <th class="px-4 py-3">No. WA</th>
                        <th class="px-4 py-3">Kelas Diampu</th>
                        <th class="px-4 py-3">Aksi</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-asrama-border">
                    ${rows.map((w) => {
                        const kelasDiampu = kwState.kelasList.filter((k) => k.walas_id === w.id);
                        const warn = w.no_wa && !isWaValid(w.no_wa);
                        return `
                            <tr class="hover:bg-asrama-cardHover/40">
                                <td class="px-4 py-3">${unitBadge(w.unit)}</td>
                                <td class="px-4 py-3 font-bold text-white">${w.nama}</td>
                                <td class="px-4 py-3">
                                    ${w.no_wa ? `<a href="https://wa.me/${w.no_wa}" target="_blank" class="text-emerald-400 hover:underline font-semibold">${w.no_wa}</a> ${warn ? '<span class="text-rose-400 text-[10px]">(Cek digit)</span>' : ""}` : `<span class="text-slate-500">-</span>`}
                                </td>
                                <td class="px-4 py-3">
                                    <div class="flex flex-wrap gap-1">
                                        ${kelasDiampu.map((k) => `<span class="px-2 py-0.5 rounded bg-asrama-bg border border-asrama-border text-[10px] text-slate-200">${k.nama_kelas}</span>`).join("") || `<span class="text-slate-500">-</span>`}
                                    </div>
                                </td>
                                <td class="px-4 py-3">
                                    <div class="flex gap-1.5">
                                        ${w.no_wa ? `<a href="https://wa.me/${w.no_wa}" target="_blank" class="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">Chat</a>` : ""}
                                        ${isAdmin ? `
                                            <button onclick="KelasWalas.openWalasFormModal('${w.id}')" class="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold cursor-pointer">Edit</button>
                                            <button onclick="KelasWalas.deleteWalas('${w.id}')" class="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-semibold cursor-pointer">Hapus</button>
                                        ` : ""}
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        `;
    }

    // ------------------------------------------------------------------------
    // 4. PUBLIC API (window.KelasWalas)
    // ------------------------------------------------------------------------
    window.KelasWalas = {
        setUnit(u) {
            kwState.unitFilter = u;
            window.renderKelasWalasPage();
        },
        setTab(t) {
            kwState.activeTab = t;
            window.renderKelasWalasPage();
        },
        getWalasForKelas(namaKelas) {
            if (!namaKelas) return null;
            const k = kwState.kelasList.find((x) => String(x.nama_kelas || "").trim().toLowerCase() === String(namaKelas).trim().toLowerCase());
            if (!k || !k.walas_id) return null;
            return kwState.walasList.find((w) => w.id === k.walas_id) || null;
        },

        // --- CRUD KELAS ---
        openTambahKelasModal() {
            const walasOpts = kwState.walasList.map((w) => `<option value="${w.id}">[${w.unit}] ${w.nama}</option>`).join("");
            window.openModal("Tambah Kelas Baru", `
                <div class="space-y-3 text-xs">
                    <div>
                        <label class="block text-slate-300 font-semibold mb-1">Unit Sekolah</label>
                        <select id="kw-k-unit" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">
                            <option value="SMP">SMP</option>
                            <option value="SMA">SMA</option>
                            <option value="IIS">IIS</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-slate-300 font-semibold mb-1">Nama Kelas</label>
                        <input id="kw-k-nama" type="text" placeholder="Contoh: XII A1 atau VII A" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">
                    </div>
                    <div>
                        <label class="block text-slate-300 font-semibold mb-1">Wali Kelas (Opsional)</label>
                        <select id="kw-k-walas" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">
                            <option value="">-- Belum Ada Walas --</option>
                            ${walasOpts}
                        </select>
                    </div>
                </div>
            `, `
                <button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-slate-300">Batal</button>
                <button onclick="KelasWalas.saveNewKelas()" class="px-4 py-2 rounded-xl bg-emerald-600 text-xs text-white font-bold">Simpan Kelas</button>
            `);
        },

        async saveNewKelas() {
            const unit = document.getElementById("kw-k-unit").value;
            const nama = document.getElementById("kw-k-nama").value.trim();
            const walasId = document.getElementById("kw-k-walas").value || null;
            if (!nama) return alert("Nama kelas wajib diisi.");
            if (kwState.kelasList.some((k) => k.unit === unit && k.nama_kelas.toLowerCase() === nama.toLowerCase())) {
                return alert(`Kelas ${nama} sudah ada di unit ${unit}.`);
            }
            const id = makeKelasDocId(unit, nama);
            await window.FB.setDoc(window.FB.doc(window.FB.db, "master_kelas", id), {
                nama_kelas: nama,
                unit,
                walas_id: walasId,
                updatedAt: new Date().toISOString()
            });
            window.closeModal();
            await loadKelasWalasData();
            window.renderKelasWalasPage();
            window.showToast("Kelas berhasil ditambahkan.", "success");
        },

        openGantiWalasModal(kelasId) {
            const k = kwState.kelasList.find((x) => x.id === kelasId);
            if (!k) return;
            const walasOpts = kwState.walasList.map((w) => `<option value="${w.id}" ${w.id === k.walas_id ? "selected" : ""}>[${w.unit}] ${w.nama}</option>`).join("");
            window.openModal(`Ganti Walas: ${k.unit} ${k.nama_kelas}`, `
                <select id="kw-gw-select" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-white">
                    <option value="">-- Belum Ada Walas --</option>
                    ${walasOpts}
                </select>
            `, `
                <button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-slate-300">Batal</button>
                <button onclick="KelasWalas.saveGantiWalas('${kelasId}')" class="px-4 py-2 rounded-xl bg-sky-500 text-xs text-slate-950 font-bold">Simpan</button>
            `);
        },

        async saveGantiWalas(kelasId) {
            const walasId = document.getElementById("kw-gw-select").value || null;
            await window.FB.updateDoc(window.FB.doc(window.FB.db, "master_kelas", kelasId), {
                walas_id: walasId,
                updatedAt: new Date().toISOString()
            });
            window.closeModal();
            await loadKelasWalasData();
            window.renderKelasWalasPage();
            window.showToast("Wali kelas diperbarui.", "success");
        },

        openRenameKelasModal(kelasId) {
            const k = kwState.kelasList.find((x) => x.id === kelasId);
            if (!k) return;
            window.openModal(`Ubah Kelas: ${k.nama_kelas}`, `
                <div class="space-y-3 text-xs">
                    <p class="text-amber-300">Jika nama kelas diubah, seluruh santri di kelas ini otomatis ikut diperbarui.</p>
                    <select id="kw-rk-unit" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">
                        ${["SMP", "SMA", "IIS"].map((u) => `<option value="${u}" ${u === k.unit ? "selected" : ""}>${u}</option>`).join("")}
                    </select>
                    <input id="kw-rk-nama" type="text" value="${k.nama_kelas}" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">
                </div>
            `, `
                <button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-slate-300">Batal</button>
                <button onclick="KelasWalas.saveRenameKelas('${kelasId}')" class="px-4 py-2 rounded-xl bg-amber-500 text-xs text-slate-950 font-bold">Simpan & Sinkronkan</button>
            `);
        },

        async saveRenameKelas(kelasId) {
            const k = kwState.kelasList.find((x) => x.id === kelasId);
            if (!k) return;
            const newUnit = document.getElementById("kw-rk-unit").value;
            const newNama = document.getElementById("kw-rk-nama").value.trim();
            if (!newNama) return;

            const santriList = window.getSantriList ? window.getSantriList() : [];
            const affected = santriList.filter((s) => String(s.kelas || "").trim().toLowerCase() === k.nama_kelas.toLowerCase());
            const ops = [{
                type: "update",
                ref: window.FB.doc(window.FB.db, "master_kelas", kelasId),
                data: { nama_kelas: newNama, unit: newUnit, updatedAt: new Date().toISOString() }
            }];
            affected.forEach((s) => {
                ops.push({
                    type: "update",
                    ref: window.FB.doc(window.FB.db, "santri", s.id),
                    data: { kelas: newNama, unit_sekolah: newUnit }
                });
            });
            await commitBatchedOps(ops);
            window.closeModal();
            await loadKelasWalasData();
            window.renderKelasWalasPage();
            window.showToast(`Kelas diubah. ${affected.length} santri ikut tersinkron!`, "success");
        },

        async deleteKelas(kelasId, santriCount) {
            const k = kwState.kelasList.find((x) => x.id === kelasId);
            if (!k) return;
            if (santriCount === 0) {
                if (!confirm(`Hapus kelas "${k.unit} ${k.nama_kelas}"?`)) return;
                await window.FB.deleteDoc(window.FB.doc(window.FB.db, "master_kelas", kelasId));
                await loadKelasWalasData();
                window.renderKelasWalasPage();
                return;
            }
            const otherOpts = kwState.kelasList.filter((x) => x.id !== kelasId).map((x) => `<option value="${x.nama_kelas}">[${x.unit}] ${x.nama_kelas}</option>`).join("");
            window.openModal(`Hapus Kelas (${santriCount} Santri)`, `
                <div class="space-y-3 text-xs">
                    <p class="text-rose-300">Terdapat <b>${santriCount} santri</b> di kelas <b>${k.nama_kelas}</b>. Pilih tindakan aman:</p>
                    <label class="flex items-center gap-2"><input type="radio" name="kw-del-opt" value="move" checked> Pindahkan semua santri ke kelas lain:</label>
                    <select id="kw-del-target" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">${otherOpts}</select>
                    <label class="flex items-center gap-2"><input type="radio" name="kw-del-opt" value="clear"> Kosongkan status kelas santri-santri tersebut</label>
                </div>
            `, `
                <button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-slate-300">Batal</button>
                <button onclick="KelasWalas.confirmDeleteKelas('${kelasId}')" class="px-4 py-2 rounded-xl bg-rose-600 text-xs text-white font-bold">Eksekusi Hapus</button>
            `);
        },

        async confirmDeleteKelas(kelasId) {
            const k = kwState.kelasList.find((x) => x.id === kelasId);
            if (!k) return;
            const opt = document.querySelector('input[name="kw-del-opt"]:checked')?.value || "clear";
            const targetKelas = opt === "move" ? (document.getElementById("kw-del-target")?.value || "") : "";
            const santriList = window.getSantriList ? window.getSantriList() : [];
            const affected = santriList.filter((s) => String(s.kelas || "").trim().toLowerCase() === k.nama_kelas.toLowerCase());

            const ops = [{ type: "delete", ref: window.FB.doc(window.FB.db, "master_kelas", kelasId) }];
            affected.forEach((s) => {
                ops.push({ type: "update", ref: window.FB.doc(window.FB.db, "santri", s.id), data: { kelas: targetKelas } });
            });
            await commitBatchedOps(ops);
            window.closeModal();
            await loadKelasWalasData();
            window.renderKelasWalasPage();
            window.showToast(`Kelas dihapus & ${affected.length} santri diperbarui.`, "success");
        },

        // --- CRUD WALAS ---
        openWalasFormModal(walasId = "") {
            const w = walasId ? kwState.walasList.find((x) => x.id === walasId) : null;
            const hasPicker = "contacts" in navigator && "ContactsManager" in window;
            window.openModal(w ? "Edit Wali Kelas" : "Tambah Wali Kelas", `
                <div class="space-y-3 text-xs">
                    ${hasPicker ? `<button type="button" onclick="KelasWalas.pickSingleContactToForm()" class="w-full py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 font-bold">Ambil 1 Kontak dari HP</button>` : ""}
                    <div>
                        <label class="block text-slate-300 font-semibold mb-1">Unit</label>
                        <select id="kw-w-unit" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">
                            ${["SMP", "SMA", "IIS"].map((u) => `<option value="${u}" ${w?.unit === u ? "selected" : ""}>${u}</option>`).join("")}
                        </select>
                    </div>
                    <div>
                        <label class="block text-slate-300 font-semibold mb-1">Nama Lengkap</label>
                        <input id="kw-w-nama" type="text" value="${w?.nama || ""}" class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">
                    </div>
                    <div>
                        <label class="block text-slate-300 font-semibold mb-1">No. WA (Otomatis dinormalisasi ke 62...)</label>
                        <input id="kw-w-wa" type="text" value="${w?.no_wa || ""}" placeholder="0812..." class="w-full px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-white">
                    </div>
                </div>
            `, `
                <button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-slate-300">Batal</button>
                <button onclick="KelasWalas.saveWalasForm('${walasId}')" class="px-4 py-2 rounded-xl bg-emerald-600 text-xs text-white font-bold">Simpan</button>
            `);
        },

        async pickSingleContactToForm() {
            try {
                const contacts = await navigator.contacts.select(["name", "tel"], { multiple: false });
                if (contacts && contacts[0]) {
                    if (contacts[0].name?.[0]) document.getElementById("kw-w-nama").value = contacts[0].name[0];
                    if (contacts[0].tel?.[0]) document.getElementById("kw-w-wa").value = normalizeWa(contacts[0].tel[0]);
                }
            } catch (_) {}
        },

        async saveWalasForm(walasId) {
            const unit = document.getElementById("kw-w-unit").value;
            const nama = document.getElementById("kw-w-nama").value.trim();
            const no_wa = normalizeWa(document.getElementById("kw-w-wa").value);
            if (!nama) return alert("Nama walas wajib diisi.");
            const data = { nama, no_wa, unit, updatedAt: new Date().toISOString() };
            if (walasId) {
                await window.FB.updateDoc(window.FB.doc(window.FB.db, "master_walas", walasId), data);
            } else {
                await window.FB.addDoc(window.FB.collection(window.FB.db, "master_walas"), data);
            }
            window.closeModal();
            await loadKelasWalasData();
            window.renderKelasWalasPage();
            window.showToast("Data Wali Kelas disimpan.", "success");
        },

        async deleteWalas(walasId) {
            if (!confirm("Hapus Wali Kelas ini? Kelas yang diampu akan menjadi 'Belum Ada Walas'.")) return;
            const ops = [{ type: "delete", ref: window.FB.doc(window.FB.db, "master_walas", walasId) }];
            kwState.kelasList.filter((k) => k.walas_id === walasId).forEach((k) => {
                ops.push({ type: "update", ref: window.FB.doc(window.FB.db, "master_kelas", k.id), data: { walas_id: null } });
            });
            await commitBatchedOps(ops);
            await loadKelasWalasData();
            window.renderKelasWalasPage();
            window.showToast("Wali kelas dihapus.", "info");
        },

        // --- 4 JALUR INPUT KONTAK ---
        async pickFromPhoneContacts() {
            if (!("contacts" in navigator && "ContactsManager" in window)) {
                alert("Browser ini belum mendukung Contact Picker API (hanya didukung Chrome/Edge Android). Silakan gunakan tombol 'Upload Kontak (.vcf)' atau 'Smart Paste WA / Excel'.");
                return;
            }
            try {
                const contacts = await navigator.contacts.select(["name", "tel"], { multiple: true });
                if (!contacts || !contacts.length) return;
                kwState.stagingContacts = contacts.map((c, idx) => ({
                    idx,
                    checked: true,
                    nama: c.name?.[0] || "Tanpa Nama",
                    no_wa: normalizeWa(c.tel?.[0] || ""),
                    unit: kwState.unitFilter !== "ALL" ? kwState.unitFilter : "SMA",
                    kelas: ""
                }));
                this.openStagingModal("Hasil Ambil Kontak HP");
            } catch (err) {
                window.showToast("Gagal mengambil kontak: " + err.message, "error");
            }
        },

        handleVcfUpload(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target.result || "";
                const cards = text.split(/BEGIN:VCARD/i).slice(1);
                kwState.stagingContacts = cards.map((block, idx) => {
                    const fnMatch = block.match(/FN[^:]*:(.*)/i);
                    const telMatch = block.match(/TEL[^:]*:(.*)/i);
                    return {
                        idx,
                        checked: true,
                        nama: (fnMatch ? fnMatch[1] : "Tanpa Nama").trim(),
                        no_wa: normalizeWa(telMatch ? telMatch[1] : ""),
                        unit: kwState.unitFilter !== "ALL" ? kwState.unitFilter : "SMA",
                        kelas: ""
                    };
                }).filter((c) => c.no_wa || c.nama !== "Tanpa Nama");
                this.openStagingModal(`Staging File VCF (${kwState.stagingContacts.length} Kontak)`);
            };
            reader.readAsText(file);
        },

        openSmartPasteModal() {
            window.openModal("Smart Paste dari Chat WA / Excel", `
                <div class="space-y-3 text-xs">
                    <div class="flex items-center gap-2">
                        <span class="text-slate-300 font-semibold">Default Unit:</span>
                        <select id="kw-sp-unit" class="px-3 py-1.5 rounded-lg bg-asrama-bg border border-asrama-border text-white">
                            <option value="SMP">SMP</option>
                            <option value="SMA" selected>SMA</option>
                            <option value="IIS">IIS</option>
                        </select>
                    </div>
                    <textarea id="kw-sp-text" rows="7" placeholder="Tempel daftar dari Excel (Tab) atau WhatsApp, contoh:&#10;1. XII A1 - Bu Ayu Puji Lestari 0857-3140-8052&#10;7A IIS : Mr. Andi (08123456789)" class="w-full p-3 rounded-xl bg-asrama-bg border border-asrama-border text-white font-mono text-[11px]"></textarea>
                </div>
            `, `
                <button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-slate-300">Batal</button>
                <button onclick="KelasWalas.parseSmartPaste()" class="px-4 py-2 rounded-xl bg-amber-500 text-xs text-slate-950 font-bold">Parse ke Preview</button>
            `);
        },

        parseSmartPaste() {
            const raw = document.getElementById("kw-sp-text").value || "";
            const defaultUnit = document.getElementById("kw-sp-unit").value;
            const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            kwState.stagingContacts = lines.map((line, idx) => {
                const phoneMatch = line.match(/(\+?62|08)[0-9\s\-().]{7,16}/);
                const no_wa = phoneMatch ? normalizeWa(phoneMatch[0]) : "";
                let clean = phoneMatch ? line.replace(phoneMatch[0], "") : line;
                clean = clean.replace(/^\d+[.)]\s*/, "").replace(/[()]/g, "").trim();
                let kelas = "";
                let nama = clean;
                if (clean.includes("\t")) {
                    const parts = clean.split("\t").map((p) => p.trim()).filter(Boolean);
                    if (parts.length >= 2) { kelas = parts[0]; nama = parts[1]; }
                } else if (clean.includes(" - ") || clean.includes(" : ")) {
                    const parts = clean.split(/\s[-:]\s/);
                    if (parts.length >= 2) { kelas = parts[0].trim(); nama = parts.slice(1).join(" ").trim(); }
                }
                return { idx, checked: true, nama, no_wa, unit: defaultUnit, kelas };
            });
            window.closeModal();
            this.openStagingModal(`Preview Smart Paste (${kwState.stagingContacts.length} Baris)`);
        },

        openStagingModal(title) {
            window.openModal(title, `
                <div class="space-y-3 text-xs">
                    <div class="max-h-72 overflow-y-auto space-y-2">
                        ${kwState.stagingContacts.map((c, i) => `
                            <div class="flex flex-wrap items-center gap-2 bg-asrama-bg p-2 rounded-xl border border-asrama-border">
                                <input type="checkbox" ${c.checked ? "checked" : ""} onchange="KelasWalas.updateStaging(${i}, 'checked', this.checked)">
                                <input type="text" value="${c.nama}" onchange="KelasWalas.updateStaging(${i}, 'nama', this.value)" class="flex-1 min-w-[120px] px-2 py-1 rounded bg-asrama-card border border-asrama-border text-white">
                                <input type="text" value="${c.no_wa}" onchange="KelasWalas.updateStaging(${i}, 'no_wa', this.value)" class="w-32 px-2 py-1 rounded bg-asrama-card border border-asrama-border text-emerald-300">
                                <select onchange="KelasWalas.updateStaging(${i}, 'unit', this.value)" class="px-2 py-1 rounded bg-asrama-card border border-asrama-border text-white">
                                    ${["SMP", "SMA", "IIS"].map((u) => `<option value="${u}" ${c.unit === u ? "selected" : ""}>${u}</option>`).join("")}
                                </select>
                            </div>
                        `).join("")}
                    </div>
                </div>
            `, `
                <button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-slate-300">Batal</button>
                <button onclick="KelasWalas.saveStagingContacts()" class="px-4 py-2 rounded-xl bg-emerald-600 text-xs text-white font-bold">Simpan Semua</button>
            `);
        },

        updateStaging(idx, field, val) {
            if (kwState.stagingContacts[idx]) {
                kwState.stagingContacts[idx][field] = field === "no_wa" ? normalizeWa(val) : val;
            }
        },

        async saveStagingContacts() {
            const selected = kwState.stagingContacts.filter((c) => c.checked && c.nama);
            if (!selected.length) return;
            const ops = selected.map((c) => ({
                type: "set",
                ref: window.FB.doc(window.FB.collection(window.FB.db, "master_walas")),
                data: { nama: c.nama, no_wa: c.no_wa, unit: c.unit, updatedAt: new Date().toISOString() }
            }));
            await commitBatchedOps(ops);
            window.closeModal();
            await loadKelasWalasData();
            window.renderKelasWalasPage();
            window.showToast(`${selected.length} Wali Kelas berhasil disimpan!`, "success");
        },

        // --- EXCEL & VCF ---
        downloadTemplate() {
            if (typeof window.XLSX === "undefined") return;
            const wb = window.XLSX.utils.book_new();
            const makeSheet = (rows) => window.XLSX.utils.json_to_sheet(rows);
            window.XLSX.utils.book_append_sheet(wb, makeSheet([
                { "Nama Kelas": "VII A", "Nama Wali Kelas": "Ust. Ahmad", "No WA Walas": "081234567890" },
                { "Nama Kelas": "VIII B", "Nama Wali Kelas": "Bu Siti", "No WA Walas": "085712345678" }
            ]), "SMP");
            window.XLSX.utils.book_append_sheet(wb, makeSheet([
                { "Nama Kelas": "X ICP 1", "Nama Wali Kelas": "Bu Ayu", "No WA Walas": "085731408052" },
                { "Nama Kelas": "XII A1", "Nama Wali Kelas": "Ust. Budi", "No WA Walas": "081398765432" }
            ]), "SMA");
            window.XLSX.utils.book_append_sheet(wb, makeSheet([
                { "Nama Kelas": "7A", "Nama Wali Kelas": "Mr. Andi", "No WA Walas": "081222333444" },
                { "Nama Kelas": "8B", "Nama Wali Kelas": "Ms. Dina", "No WA Walas": "081555666777" }
            ]), "IIS");
            window.XLSX.utils.book_append_sheet(wb, makeSheet([
                { Panduan: "Jangan ubah nama tab SMP, SMA, IIS. Format No WA bebas, otomatis dirapikan ke 628..." }
            ]), "Panduan");
            window.XLSX.writeFile(wb, "Template_Kelas_Walas_SIAN.xlsx");
        },

        handleExcelImport(e) {
            const file = e.target.files[0];
            if (!file || typeof window.XLSX === "undefined") return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
                const ops = [];
                let count = 0;
                ["SMP", "SMA", "IIS"].forEach((unit) => {
                    const sheetName = wb.SheetNames.find((n) => n.trim().toUpperCase() === unit);
                    if (!sheetName) return;
                    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
                    rows.forEach((r) => {
                        const namaKelas = String(r["Nama Kelas"] || "").trim();
                        const namaWalas = String(r["Nama Wali Kelas"] || "").trim();
                        const noWa = normalizeWa(r["No WA Walas"] || "");
                        if (!namaKelas) return;
                        count++;
                        let walasId = null;
                        if (namaWalas) {
                            const existingW = kwState.walasList.find((w) => (noWa && w.no_wa === noWa) || (w.unit === unit && w.nama.toLowerCase() === namaWalas.toLowerCase()));
                            if (existingW) {
                                walasId = existingW.id;
                            } else {
                                const wRef = window.FB.doc(window.FB.collection(window.FB.db, "master_walas"));
                                walasId = wRef.id;
                                ops.push({ type: "set", ref: wRef, data: { nama: namaWalas, no_wa: noWa, unit, updatedAt: new Date().toISOString() } });
                            }
                        }
                        const kId = makeKelasDocId(unit, namaKelas);
                        ops.push({ type: "set", ref: window.FB.doc(window.FB.db, "master_kelas", kId), data: { nama_kelas: namaKelas, unit, walas_id: walasId, updatedAt: new Date().toISOString() }, options: { merge: true } });
                    });
                });
                if (!confirm(`Ditemukan ${count} baris kelas dari tab SMP/SMA/IIS. Simpan ke Firestore?`)) return;
                await commitBatchedOps(ops);
                await loadKelasWalasData();
                window.renderKelasWalasPage();
                window.showToast(`Import selesai (${count} kelas diproses)!`, "success");
            };
            reader.readAsArrayBuffer(file);
        },

        exportExcel() {
            if (typeof window.XLSX === "undefined") return;
            const santriList = window.getSantriList ? window.getSantriList() : [];
            const wb = window.XLSX.utils.book_new();
            ["SMP", "SMA", "IIS"].forEach((unit) => {
                const rows = kwState.kelasList.filter((k) => k.unit === unit).map((k, idx) => {
                    const w = kwState.walasList.find((x) => x.id === k.walas_id);
                    const cnt = santriList.filter((s) => String(s.kelas || "").trim().toLowerCase() === k.nama_kelas.toLowerCase()).length;
                    return {
                        No: idx + 1,
                        "Nama Kelas": k.nama_kelas,
                        "Nama Wali Kelas": w?.nama || "-",
                        "No WA Walas": w?.no_wa || "-",
                        "Jumlah Santri Asrama": cnt
                    };
                });
                window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(rows), unit);
            });
            window.XLSX.writeFile(wb, `Data_Kelas_Walas_SIAN_${new Date().toISOString().slice(0, 10)}.xlsx`);
        },

        exportVcfModal() {
            const unit = kwState.unitFilter === "ALL" ? "ALL" : kwState.unitFilter;
            const cards = kwState.kelasList
                .filter((k) => unit === "ALL" || k.unit === unit)
                .map((k) => {
                    const w = kwState.walasList.find((x) => x.id === k.walas_id);
                    if (!w || !w.no_wa) return "";
                    return `BEGIN:VCARD\nVERSION:3.0\nFN:Walas ${k.unit} ${k.nama_kelas} - ${w.nama}\nTEL;TYPE=CELL:+${w.no_wa}\nEND:VCARD`;
                })
                .filter(Boolean)
                .join("\n");
            if (!cards) return window.showToast("Tidak ada kontak walas dengan No. WA.", "error");
            const blob = new Blob([cards], { type: "text/vcard" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Kontak_Walas_${unit}.vcf`;
            a.click();
            URL.revokeObjectURL(url);
        },

        backupJson() {
            const payload = {
                exportedAt: new Date().toISOString(),
                santri: window.getSantriList ? window.getSantriList() : [],
                master_kelas: kwState.kelasList,
                master_walas: kwState.walasList
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Backup_SIAN_KelasWalas_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };
})();
