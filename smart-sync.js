// ============================================================================
// SMART SYNC KELAS, NIS & PEMBAKUAN NAMA (SIAN & SIAP)
// ============================================================================

(function () {
    const DRAFT_KEY = "sian_smart_sync_draft_v1";

    const syncState = {
        workbook: null,
        sheetNames: [],
        selectedSheets: new Set(),
        filterPutraOnly: true,
        schoolRows: [],
        selectedKamars: new Set(), // key: "sektor|||kamar"
        skipExistingNis: true,
        standardizeNames: true,
        results: [], // array of match items
        usedSchoolKeys: new Map(), // schoolKey -> santriId
        activeTab: "needs_fix",
        searchQuery: "",
        manualTargetId: null
    };

    // ------------------------------------------------------------------------
    // 1. UTILITAS NORMALISASI & PENCOCOKAN
    // ------------------------------------------------------------------------
    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        const v0 = Array.from({ length: b.length + 1 }, (_, i) => i);
        const v1 = new Array(b.length + 1);
        for (let i = 0; i < a.length; i++) {
            v1[0] = i + 1;
            for (let j = 0; j < b.length; j++) {
                const cost = a[i] === b[j] ? 0 : 1;
                v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
            }
            for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
        }
        return v0[b.length];
    }

    const ABBR_MAP = {
        m: "muhammad", moh: "muhammad", muh: "muhammad", moch: "muhammad",
        mohd: "muhammad", mhd: "muhammad", muhamad: "muhammad", mohamad: "muhammad",
        mohammad: "muhammad", mochammad: "muhammad", mochamad: "muhammad",
        a: "ahmad", ach: "ahmad", akh: "ahmad", achmad: "ahmad", akhmad: "ahmad",
        abd: "abdul", abdl: "abdul", noor: "nur"
    };

    const ARAB_PREFIXES = ["al", "an", "ar", "as", "at", "az", "el"];

    function phoneticClean(str) {
        return str
            .replace(/dj/g, "j")
            .replace(/oe/g, "u")
            .replace(/tj/g, "c")
            .replace(/kh|ch/g, "k")
            .replace(/sy|sh/g, "s")
            .replace(/y/g, "i")
            .replace(/q/g, "k")
            .replace(/v/g, "f")
            .replace(/(.)\1+/g, "$1");
    }

    function normalizeNameTokens(raw) {
        let s = String(raw || "")
            .toLowerCase()
            .replace(/['’`.,]/g, " ")
            .replace(/\s*-\s*/g, " ")
            .trim();

        let rawTokens = s.split(/\s+/).filter(Boolean);
        // Satukan awalan Arab: ["al", "hafidz"] -> ["alhafidz"]
        const merged = [];
        for (let i = 0; i < rawTokens.length; i++) {
            const t = rawTokens[i];
            if (ARAB_PREFIXES.includes(t) && i + 1 < rawTokens.length) {
                merged.push(t + rawTokens[i + 1]);
                i++;
            } else {
                merged.push(t);
            }
        }

        return merged.map((t) => {
            const mapped = ABBR_MAP[t] || t;
            return phoneticClean(mapped);
        });
    }

    function tokenScore(t1, t2) {
        if (t1 === t2) return 1.0;
        // Strip Arab prefix if one side omitted it
        for (const p of ARAB_PREFIXES) {
            if (t1 === p + t2 || t2 === p + t1) return 0.95;
        }
        if (t1.length >= 3 && t2.length >= 3 && (t1.startsWith(t2) || t2.startsWith(t1))) {
            return 0.90;
        }
        if ((t1.length === 1 && t2.startsWith(t1)) || (t2.length === 1 && t1.startsWith(t2))) {
            return 0.85;
        }
        const dist = levenshtein(t1, t2);
        if (dist === 1) return 0.85;
        if (dist === 2 && Math.max(t1.length, t2.length) >= 7) return 0.70;
        return 0;
    }

    function computeNameSimilarity(nameA, nameB) {
        const tokA = normalizeNameTokens(nameA);
        const tokB = normalizeNameTokens(nameB);
        if (!tokA.length || !tokB.length) return 0;

        const shorter = tokA.length <= tokB.length ? tokA : tokB;
        const longer = tokA.length <= tokB.length ? tokB : tokA;

        let total = 0;
        const usedIdx = new Set();
        for (const t of shorter) {
            let best = 0;
            let bestIdx = -1;
            for (let j = 0; j < longer.length; j++) {
                if (usedIdx.has(j)) continue;
                const sc = tokenScore(t, longer[j]);
                if (sc > best) {
                    best = sc;
                    bestIdx = j;
                }
            }
            if (bestIdx !== -1) usedIdx.add(bestIdx);
            total += best;
        }

        const baseScore = total / shorter.length;
        const lenPenalty = Math.abs(tokA.length - tokB.length) * 0.03;
        return Math.max(0, Math.min(1, baseScore - lenPenalty));
    }

    function normalizeRoom(raw) {
        let s = String(raw || "")
            .toLowerCase()
            .replace(/['’`.,-]/g, "")
            .replace(/\b(kamar|kmr|ruang)\b/g, "")
            .replace(/\s+/g, "")
            .replace(/o/g, "a")
            .replace(/th/g, "t")
            .replace(/kh/g, "k")
            .replace(/sy|sh/g, "s")
            .replace(/dz|zh/g, "z")
            .replace(/dh/g, "d")
            .replace(/y/g, "i")
            .replace(/q/g, "k")
            .replace(/h$/g, "")
            .replace(/(.)\1+/g, "$1");
        return s.trim();
    }

    function isSameRoom(roomA, roomB) {
        const a = normalizeRoom(roomA);
        const b = normalizeRoom(roomB);
        if (!a || !b) return false;
        if (a === b) return true;
        if (Math.min(a.length, b.length) >= 5 && levenshtein(a, b) <= 1) return true;
        return false;
    }

    function detectJenjang(kelas) {
        const k = String(kelas || "").trim().toUpperCase();
        if (/^(VII|VIII|IX)\b/.test(k) || /^[789]\b/.test(k)) return "SMP";
        if (/^(X|XI|XII)\b/.test(k) || /^(10|11|12)\b/.test(k)) return "SMA";
        return "";
    }

    // ------------------------------------------------------------------------
    // 2. PARSING EXCEL MULTI-SHEET
    // ------------------------------------------------------------------------
    function detectHeaders(headers) {
        const findCol = (patterns, excludePatterns = []) => {
            for (const h of headers) {
                const lower = String(h || "").toLowerCase().trim();
                if (excludePatterns.some((ex) => lower.includes(ex))) continue;
                if (patterns.some((p) => lower === p || lower.includes(p))) return h;
            }
            return null;
        };

        return {
            nama: findCol(["nama siswa", "nama lengkap", "nama"], ["wali", "kelas", "kamar", "asrama", "murobbi"]),
            nis: findCol(["nis", "nipd"]),
            kelas: findCol(["nama kelas", "kelas"], ["sore", "madin", "wali"]),
            gender: findCol(["jenis kelamin", "jk", "gender"]),
            kamar: findCol(["nama kamar", "kamar"]),
            asrama: findCol(["nama asrama", "asrama"]),
            madin: findCol(["kelas madin", "madin"])
        };
    }

    function parseSelectedSheets() {
        if (!syncState.workbook) return [];
        const rows = [];
        let idxCounter = 0;

        syncState.selectedSheets.forEach((sheetName) => {
            const ws = syncState.workbook.Sheets[sheetName];
            if (!ws) return;
            const json = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
            if (!json.length) return;

            const headers = Object.keys(json[0]);
            const cols = detectHeaders(headers);
            if (!cols.nama) return;

            json.forEach((r) => {
                const nama = String(r[cols.nama] || "").trim();
                if (!nama) return;

                if (syncState.filterPutraOnly && cols.gender) {
                    const g = String(r[cols.gender] || "").trim().toUpperCase();
                    if (g && !["L", "LAKI-LAKI", "LAKI LAKI", "PUTRA", "LK"].includes(g)) {
                        return;
                    }
                }

                const nis = cols.nis ? String(r[cols.nis] || "").trim() : "";
                const kelas = cols.kelas ? String(r[cols.kelas] || "").trim() : "";
                const kamar = cols.kamar ? String(r[cols.kamar] || "").trim() : "";
                const madin = cols.madin ? String(r[cols.madin] || "").trim() : "";
                const jenjang = detectJenjang(kelas) || detectJenjang(sheetName) || "";

                idxCounter++;
                rows.push({
                    schoolKey: nis ? `NIS:${nis}` : `ROW:${sheetName}:${idxCounter}`,
                    sheetName,
                    nama,
                    nis,
                    kelas,
                    jenjang,
                    kamar,
                    kelas_madin: madin
                });
            });
        });

        syncState.schoolRows = rows;
        return rows;
    }

    // ------------------------------------------------------------------------
    // 3. MESIN PENCOCOKAN BERTINGKAT (WATERFALL)
    // ------------------------------------------------------------------------
    function runMatchingEngine() {
        parseSelectedSheets();
        const santriList = window.getSantriList ? window.getSantriList() : [];
        const schoolRows = syncState.schoolRows;

        const targetSantri = santriList.filter((s) => {
            const key = `${window.toCanonicalSektor(s.sektor)}|||${s.kamar}`;
            if (syncState.selectedKamars.size > 0 && !syncState.selectedKamars.has(key)) return false;
            if (syncState.skipExistingNis && s.nis && String(s.nis).trim() !== "") return false;
            return true;
        });

        const draft = loadDraft();
        syncState.usedSchoolKeys.clear();

        const results = targetSantri.map((s) => {
            const sNis = String(s.nis || "").trim();
            const isOneWord = normalizeNameTokens(s.nama).length <= 1;

            // Prioritas 1: Cocok NIS Persis
            if (sNis) {
                const exactNis = schoolRows.find((r) => r.nis && r.nis === sNis);
                if (exactNis) {
                    const roomMatch = isSameRoom(s.kamar, exactNis.kamar);
                    return {
                        santri: s,
                        status: "HIJAU",
                        score: 1.0,
                        selectedSchool: exactNis,
                        candidates: [{ school: exactNis, score: 1.0, roomMatch }],
                        useOfficialName: syncState.standardizeNames,
                        pindahKamarInfo: (!roomMatch && exactNis.kamar) ? `Indikasi pindah kamar (Sekolah: ${exactNis.kamar})` : "",
                        note: "Cocok NIS Persis (100%)"
                    };
                }
            }

            // Prioritas 2: Normalisasi Nama + Penguat Kamar
            const scored = schoolRows.map((r) => {
                const nameScore = computeNameSimilarity(s.nama, r.nama);
                const roomMatch = isSameRoom(s.kamar, r.kamar);
                let finalScore = nameScore;
                if (nameScore >= 0.50 && roomMatch) {
                    finalScore = Math.min(1.0, nameScore + 0.15);
                }
                return { school: r, nameScore, score: finalScore, roomMatch };
            })
            .filter((x) => x.score >= 0.45)
            .sort((a, b) => b.score - a.score);

            const top3 = scored.slice(0, 3);
            const best = top3[0];
            const second = top3[1];

            let status = "MERAH";
            let selectedSchool = null;
            let pindahKamarInfo = "";
            let note = "Tidak ditemukan kandidat yang cukup mirip";

            if (best) {
                const isUnique = !second || (best.score - second.score >= 0.08);
                if (isOneWord) {
                    if (best.roomMatch && isUnique && best.nameScore >= 0.85) {
                        status = "HIJAU";
                        selectedSchool = best.school;
                        note = "Nama 1 kata cocok & kamar sama";
                    } else {
                        status = "KUNING";
                        note = "Nama 1 kata: perlu verifikasi manual";
                    }
                } else if (best.score >= 0.90 && isUnique) {
                    status = "HIJAU";
                    selectedSchool = best.school;
                    note = `Cocok otomatis (${Math.round(best.score * 100)}%)`;
                    if (!best.roomMatch && best.school.kamar) {
                        pindahKamarInfo = `Indikasi pindah kamar (Sekolah: ${best.school.kamar})`;
                    }
                } else {
                    status = "KUNING";
                    note = isUnique ? "Kemiripan sedang, perlu konfirmasi" : "Ada beberapa kandidat mirip";
                }
            }

            // Terapkan draft manual jika ada
            const d = draft[s.id];
            if (d) {
                if (d.status === "LEWATI") {
                    status = "LEWATI";
                    selectedSchool = null;
                } else if (d.manualInput) {
                    status = "DIPERBAIKI";
                    selectedSchool = d.manualInput;
                } else if (d.schoolKey) {
                    const found = schoolRows.find((r) => r.schoolKey === d.schoolKey);
                    if (found) {
                        status = "DIPERBAIKI";
                        selectedSchool = found;
                    }
                }
            }

            return {
                santri: s,
                status,
                score: best ? best.score : 0,
                selectedSchool,
                candidates: top3,
                useOfficialName: d && typeof d.useOfficialName === "boolean" ? d.useOfficialName : syncState.standardizeNames,
                pindahKamarInfo,
                note
            };
        });

        // Proteksi Anti-Bentrok NIS untuk status HIJAU
        const nisCount = new Map();
        results.forEach((item) => {
            if (item.status === "HIJAU" && item.selectedSchool?.nis) {
                const nis = item.selectedSchool.nis;
                nisCount.set(nis, (nisCount.get(nis) || 0) + 1);
            }
        });
        results.forEach((item) => {
            if (item.status === "HIJAU" && item.selectedSchool?.nis && nisCount.get(item.selectedSchool.nis) > 1) {
                item.status = "KUNING";
                item.selectedSchool = null;
                item.note = "Bentrok: NIS sama dengan santri lain";
            }
            if ((item.status === "HIJAU" || item.status === "DIPERBAIKI") && item.selectedSchool?.schoolKey) {
                syncState.usedSchoolKeys.set(item.selectedSchool.schoolKey, item.santri.id);
            }
        });

        syncState.results = results;
        renderSyncResults();
    }

    // ------------------------------------------------------------------------
    // 4. DRAFT LOCALSTORAGE
    // ------------------------------------------------------------------------
    function loadDraft() {
        try {
            return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
        } catch (_) {
            return {};
        }
    }

    function saveDraftItem(santriId, payload) {
        const draft = loadDraft();
        draft[santriId] = payload;
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }

    // ------------------------------------------------------------------------
    // 5. RENDER UI HALAMAN SMART SYNC
    // ------------------------------------------------------------------------
    window.renderSmartSyncPage = function () {
        const container = document.getElementById("app-content");
        if (!container) return;

        const santriList = window.getSantriList ? window.getSantriList() : [];
        const sektors = window.SEKTOR_ASRAMA || [];
        const kamarMap = window.kamarBySektor || {};

        // Filter sektor jika Ketua Sektor
        const isAdmin = window.isRecordAdmin && window.isRecordAdmin(window.currentUser);
        const allowedSektors = isAdmin
            ? sektors
            : sektors.filter((sec) => window.isSameSektor && window.isSameSektor(sec, window.currentUser?.sektor));

        container.innerHTML = `
            <div class="space-y-6 pb-12">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 class="text-xl font-extrabold text-white flex items-center gap-2">
                            <i class="ph-bold ph-arrows-clockwise text-sky-400"></i>
                            Smart Sync Kelas, NIS & Pembakuan Nama
                        </h2>
                        <p class="text-xs text-slate-400 mt-0.5">Sinkronisasi data resmi sekolah tanpa menimpa kamar, sektor, absensi, atau izin santri.</p>
                    </div>
                    <button onclick="SmartSync.backupSantriJson()" class="px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                        <i class="ph-bold ph-download-simple"></i> Backup Data Santri (.json)
                    </button>
                </div>

                <!-- STEP 1 & 2 -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <!-- STEP 1: UPLOAD EXCEL -->
                    <div class="bg-asrama-card border border-asrama-border rounded-2xl p-5 space-y-4">
                        <div class="flex items-center justify-between">
                            <h3 class="text-sm font-bold text-white">1. Upload File Master Sekolah (.xlsx / .csv)</h3>
                            <span id="ss-file-badge" class="text-[11px] text-slate-400">Belum ada file</span>
                        </div>
                        <label class="flex flex-col items-center justify-center border-2 border-dashed border-asrama-border hover:border-sky-400 rounded-2xl p-5 cursor-pointer transition-colors bg-asrama-bg/50">
                            <i class="ph-bold ph-file-xls text-3xl text-emerald-400 mb-2"></i>
                            <span class="text-xs font-semibold text-slate-200">Klik untuk pilih file Excel Master Sekolah</span>
                            <span class="text-[11px] text-slate-400 mt-1">Mendukung multi-sheet (X, XI, XII, VII, VIII, IX)</span>
                            <input id="ss-excel-input" type="file" accept=".xlsx,.xls,.csv" class="hidden">
                        </label>
                        <div id="ss-sheets-container" class="hidden space-y-2">
                            <p class="text-xs font-semibold text-slate-300">Pilih Tab Sheet yang Diproses:</p>
                            <div id="ss-sheets-list" class="flex flex-wrap gap-2"></div>
                        </div>
                        <label class="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                            <input id="ss-filter-putra" type="checkbox" checked class="rounded border-asrama-border bg-asrama-bg text-sky-500">
                            <span>Hanya Putra (Filter Gender <b>L / Laki-Laki</b>)</span>
                        </label>
                    </div>

                    <!-- STEP 2: TARGET SEKTOR & KAMAR -->
                    <div class="bg-asrama-card border border-asrama-border rounded-2xl p-5 space-y-4">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h3 class="text-sm font-bold text-white">2. Filter Target Sektor & Kamar</h3>
                            <button onclick="SmartSync.autoCheckRoomsFromExcel()" class="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 text-[11px] font-bold cursor-pointer">
                                Auto-Centang Kamar Sesuai File
                            </button>
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="text-[11px] text-slate-400 mr-1">Pilih Cepat:</span>
                            <button type="button" onclick="SmartSync.quickSelectFloor('ALL')" class="px-2 py-0.5 rounded bg-asrama-bg hover:bg-asrama-cardHover border border-asrama-border text-[11px] text-slate-200 cursor-pointer">Semua</button>
                            <button type="button" onclick="SmartSync.quickSelectFloor('1')" class="px-2 py-0.5 rounded bg-asrama-bg hover:bg-asrama-cardHover border border-asrama-border text-[11px] text-emerald-300 cursor-pointer">Lt. 1</button>
                            <button type="button" onclick="SmartSync.quickSelectFloor('2')" class="px-2 py-0.5 rounded bg-asrama-bg hover:bg-asrama-cardHover border border-asrama-border text-[11px] text-emerald-300 cursor-pointer">Lt. 2</button>
                            <button type="button" onclick="SmartSync.quickSelectFloor('3')" class="px-2 py-0.5 rounded bg-asrama-bg hover:bg-asrama-cardHover border border-asrama-border text-[11px] text-emerald-300 cursor-pointer">Lt. 3</button>
                            <button type="button" onclick="SmartSync.quickSelectFloor('NONE')" class="px-2 py-0.5 rounded bg-asrama-bg hover:bg-asrama-cardHover border border-rose-500/30 text-[11px] text-rose-300 cursor-pointer">Kosongkan</button>
                        </div>
                        <div class="max-h-52 overflow-y-auto space-y-2.5 pr-1">
                            ${allowedSektors.map((sec) => {
                                const kamars = kamarMap[sec] || [];
                                const secSantriCount = santriList.filter((s) => window.isSameSektor(s.sektor, sec)).length;
                                return `
                                    <div class="bg-asrama-bg border border-asrama-border rounded-xl p-2.5 space-y-2">
                                        <label class="flex items-center justify-between text-xs font-bold text-emerald-300 cursor-pointer">
                                            <span class="flex items-center gap-2">
                                                <input type="checkbox" class="ss-sektor-cb rounded" data-sektor="${sec}" checked>
                                                ${sec}
                                            </span>
                                            <span class="text-[11px] text-slate-400 font-normal">${secSantriCount} santri</span>
                                        </label>
                                        <div class="flex flex-wrap gap-1.5 pl-5">
                                            ${kamars.map((k) => {
                                                const cnt = santriList.filter((s) => window.isSameSektor(s.sektor, sec) && s.kamar === k.nama).length;
                                                const key = `${sec}|||${k.nama}`;
                                                return `
                                                    <label class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-asrama-card border border-asrama-border text-[11px] text-slate-200 cursor-pointer">
                                                        <input type="checkbox" class="ss-kamar-cb rounded" data-sektor="${sec}" value="${key}" checked>
                                                        <span>${k.nama} (${cnt})</span>
                                                    </label>
                                                `;
                                            }).join("")}
                                        </div>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                        <div class="space-y-1.5 pt-1 border-t border-asrama-border">
                            <label class="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                                <input id="ss-skip-nis" type="checkbox" checked class="rounded border-asrama-border bg-asrama-bg text-sky-500">
                                <span>Lewati santri yang sudah memiliki NIS (Sudah Sinkron)</span>
                            </label>
                            <label class="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                                <input id="ss-standardize-name" type="checkbox" checked class="rounded border-asrama-border bg-asrama-bg text-emerald-500">
                                <span>Bakukan Nama Santri sesuai Nama Resmi Sekolah</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- TOMBOL PROSES -->
                <div class="flex flex-wrap items-center justify-between gap-3 bg-asrama-card border border-asrama-border rounded-2xl p-4">
                    <span class="text-xs text-slate-300">Langkah 3: Jalankan pencocokan otomatis di browser sebelum menyimpan ke Firestore.</span>
                    <button onclick="SmartSync.startMatching()" class="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold text-xs flex items-center gap-2 cursor-pointer">
                        <i class="ph-bold ph-magic-wand"></i> Mulai Pencocokan Smart Sync
                    </button>
                </div>

                <!-- HASIL PREVIEW -->
                <div id="ss-results-section" class="hidden space-y-4"></div>
            </div>
        `;

        // Bind events
        document.getElementById("ss-excel-input").addEventListener("change", handleExcelUpload);
        document.getElementById("ss-filter-putra").addEventListener("change", (e) => {
            syncState.filterPutraOnly = e.target.checked;
        });
        document.getElementById("ss-skip-nis").addEventListener("change", (e) => {
            syncState.skipExistingNis = e.target.checked;
        });
        document.getElementById("ss-standardize-name").addEventListener("change", (e) => {
            syncState.standardizeNames = e.target.checked;
        });
        document.querySelectorAll(".ss-sektor-cb").forEach((cb) => {
            cb.addEventListener("change", (e) => {
                const sec = e.target.dataset.sektor;
                document.querySelectorAll(`.ss-kamar-cb[data-sektor="${sec}"]`).forEach((kCb) => {
                    kCb.checked = e.target.checked;
                });
            });
        });
    };

    function handleExcelUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (typeof window.XLSX === "undefined") {
            window.showToast("Library Excel (SheetJS) belum siap.", "error");
            return;
        }
        document.getElementById("ss-file-badge").textContent = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const data = new Uint8Array(ev.target.result);
            syncState.workbook = window.XLSX.read(data, { type: "array" });
            syncState.sheetNames = syncState.workbook.SheetNames || [];
            syncState.selectedSheets.clear();

            const autoPattern = /^(VII|VIII|IX|X|XI|XII)\b/i;
            syncState.sheetNames.forEach((name) => {
                if (autoPattern.test(name.trim()) || syncState.sheetNames.length === 1) {
                    syncState.selectedSheets.add(name);
                }
            });

            const listEl = document.getElementById("ss-sheets-list");
            document.getElementById("ss-sheets-container").classList.remove("hidden");
            listEl.innerHTML = syncState.sheetNames.map((name) => `
                <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-asrama-bg border border-asrama-border text-xs text-slate-200 cursor-pointer">
                    <input type="checkbox" class="ss-sheet-cb rounded" value="${name}" ${syncState.selectedSheets.has(name) ? "checked" : ""}>
                    <span>${name}</span>
                </label>
            `).join("");

            document.querySelectorAll(".ss-sheet-cb").forEach((cb) => {
                cb.addEventListener("change", (ev2) => {
                    if (ev2.target.checked) syncState.selectedSheets.add(ev2.target.value);
                    else syncState.selectedSheets.delete(ev2.target.value);
                });
            });
        };
        reader.readAsArrayBuffer(file);
    }

    function renderSyncResults() {
        const sec = document.getElementById("ss-results-section");
        if (!sec) return;
        sec.classList.remove("hidden");

        const res = syncState.results;
        const countHijau = res.filter((r) => r.status === "HIJAU").length;
        const countFixed = res.filter((r) => r.status === "DIPERBAIKI").length;
        const countKuning = res.filter((r) => r.status === "KUNING").length;
        const countMerah = res.filter((r) => r.status === "MERAH").length;
        const readyCount = countHijau + countFixed;

        const q = syncState.searchQuery.toLowerCase();
        const filtered = res.filter((item) => {
            if (syncState.activeTab === "needs_fix" && !["KUNING", "MERAH"].includes(item.status)) return false;
            if (syncState.activeTab === "KUNING" && item.status !== "KUNING") return false;
            if (syncState.activeTab === "MERAH" && item.status !== "MERAH") return false;
            if (syncState.activeTab === "HIJAU" && item.status !== "HIJAU") return false;
            if (syncState.activeTab === "DIPERBAIKI" && item.status !== "DIPERBAIKI") return false;
            if (syncState.activeTab === "PINDAH_KAMAR" && !item.pindahKamarInfo) return false;
            if (!q) return true;
            const hay = `${item.santri.nama} ${item.santri.kamar} ${item.selectedSchool?.nama || ""} ${item.selectedSchool?.nis || ""}`.toLowerCase();
            return hay.includes(q);
        });

        sec.innerHTML = `
            <!-- Stat Cards -->
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div class="bg-asrama-card border border-asrama-border rounded-xl p-3">
                    <p class="text-[11px] text-slate-400">Total Diproses</p>
                    <p class="text-xl font-extrabold text-white">${res.length}</p>
                </div>
                <div class="bg-asrama-card border border-emerald-500/30 rounded-xl p-3">
                    <p class="text-[11px] text-emerald-300">Hijau Auto</p>
                    <p class="text-xl font-extrabold text-emerald-400">${countHijau}</p>
                </div>
                <div class="bg-asrama-card border border-sky-500/30 rounded-xl p-3">
                    <p class="text-[11px] text-sky-300">Diperbaiki Manual</p>
                    <p class="text-xl font-extrabold text-sky-400">${countFixed}</p>
                </div>
                <div class="bg-asrama-card border border-amber-500/30 rounded-xl p-3">
                    <p class="text-[11px] text-amber-300">Sisa Kuning</p>
                    <p class="text-xl font-extrabold text-amber-400">${countKuning}</p>
                </div>
                <div class="bg-asrama-card border border-rose-500/30 rounded-xl p-3">
                    <p class="text-[11px] text-rose-300">Sisa Merah</p>
                    <p class="text-xl font-extrabold text-rose-400">${countMerah}</p>
                </div>
            </div>

            <!-- Filter Tabs & Action Bar -->
            <div class="bg-asrama-card border border-asrama-border rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                <div class="flex flex-wrap gap-1.5">
                    ${[
                        ["needs_fix", `Perlu Diperbaiki (${countKuning + countMerah})`],
                        ["ALL", `Semua (${res.length})`],
                        ["KUNING", `Kuning (${countKuning})`],
                        ["MERAH", `Merah (${countMerah})`],
                        ["HIJAU", `Hijau (${countHijau})`],
                        ["DIPERBAIKI", `Diperbaiki (${countFixed})`],
                        ["PINDAH_KAMAR", "Indikasi Pindah Kamar"]
                    ].map(([id, label]) => `
                        <button onclick="SmartSync.setTab('${id}')" class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${syncState.activeTab === id ? "bg-sky-500 text-slate-950" : "bg-asrama-bg text-slate-300 hover:text-white"}">
                            ${label}
                        </button>
                    `).join("")}
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <input id="ss-search-input" type="text" value="${syncState.searchQuery}" placeholder="Cari santri / NIS..." class="px-3 py-1.5 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-white">
                    <button onclick="SmartSync.exportReport()" class="px-3 py-1.5 rounded-xl bg-asrama-bg hover:bg-asrama-cardHover border border-asrama-border text-xs font-semibold text-slate-200 cursor-pointer">
                        Export Laporan (.xlsx)
                    </button>
                    <button onclick="SmartSync.confirmSave()" ${readyCount === 0 ? "disabled" : ""} class="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-extrabold cursor-pointer">
                        Simpan ke Database (${readyCount} Siap)
                    </button>
                </div>
            </div>

            <!-- Table -->
            <div class="bg-asrama-card border border-asrama-border rounded-2xl overflow-x-auto">
                <table class="w-full text-left border-collapse text-xs">
                    <thead class="bg-asrama-sidebar text-[11px] uppercase text-slate-400 border-b border-asrama-border">
                        <tr>
                            <th class="px-4 py-3">Santri SIAN (Kamar)</th>
                            <th class="px-4 py-3">Status</th>
                            <th class="px-4 py-3">Hasil / Kandidat Sekolah</th>
                            <th class="px-4 py-3">Aksi</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-asrama-border">
                        ${filtered.slice(0, 150).map((item) => renderSyncRow(item)).join("") || `<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400">Tidak ada data pada filter ini.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;

        document.getElementById("ss-search-input").addEventListener("input", (e) => {
            syncState.searchQuery = e.target.value;
            renderSyncResults();
        });
    }

    function renderSyncRow(item) {
        const s = item.santri;
        const badgeColors = {
            HIJAU: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
            DIPERBAIKI: "bg-sky-500/15 text-sky-300 border-sky-500/30",
            KUNING: "bg-amber-500/15 text-amber-300 border-amber-500/30",
            MERAH: "bg-rose-500/15 text-rose-300 border-rose-500/30",
            LEWATI: "bg-slate-500/15 text-slate-300 border-slate-500/30"
        };

        let detailHtml = "";
        if (item.selectedSchool) {
            const sc = item.selectedSchool;
            const nameChanged = sc.nama && sc.nama.toLowerCase() !== String(s.nama || "").toLowerCase();
            detailHtml = `
                <div class="space-y-1">
                    <div class="font-bold text-white">
                        ${nameChanged ? `<span class="text-slate-400 line-through mr-1">${s.nama}</span> → <span class="text-emerald-300">${sc.nama}</span>` : sc.nama}
                    </div>
                    <div class="text-[11px] text-slate-300">
                        NIS: <b>${sc.nis || "-"}</b> • Kelas: <b>${sc.kelas || "-"}</b> (${sc.jenjang || "-"})
                        ${sc.kelas_madin ? ` • Madin: <b>${sc.kelas_madin}</b>` : ""}
                    </div>
                    ${item.pindahKamarInfo ? `<span class="inline-block text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">${item.pindahKamarInfo}</span>` : ""}
                    ${nameChanged ? `
                        <label class="inline-flex items-center gap-1.5 text-[11px] text-sky-300 cursor-pointer mt-1">
                            <input type="checkbox" ${item.useOfficialName ? "checked" : ""} onchange="SmartSync.toggleOfficialName('${s.id}', this.checked)">
                            Gunakan Nama Resmi
                        </label>
                    ` : ""}
                </div>
            `;
        } else if (item.status === "KUNING" && item.candidates.length > 0) {
            detailHtml = `<div class="space-y-1.5">${item.candidates.map((c) => {
                const usedBy = syncState.usedSchoolKeys.get(c.school.schoolKey);
                return `
                    <div class="flex items-center justify-between gap-2 bg-asrama-bg p-2 rounded-lg border border-asrama-border">
                        <div>
                            <div class="font-semibold text-white">${c.school.nama} <span class="text-[10px] text-sky-300">(${Math.round(c.score * 100)}%)</span></div>
                            <div class="text-[10px] text-slate-400">NIS: ${c.school.nis || "-"} • ${c.school.kelas || "-"} • ${c.roomMatch ? '<span class="text-emerald-400">Kamar Sama ✓</span>' : `Kmr Sekolah: ${c.school.kamar || "-"}`} ${usedBy ? '<span class="text-rose-400">(Sudah dipakai)</span>' : ""}</div>
                        </div>
                        <button onclick="SmartSync.pickCandidate('${s.id}', '${c.school.schoolKey}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer">Pilih ✓</button>
                    </div>
                `;
            }).join("")}</div>`;
        } else {
            detailHtml = `<span class="text-slate-400">${item.note}</span>`;
        }

        return `
            <tr class="hover:bg-asrama-cardHover/40">
                <td class="px-4 py-3 align-top">
                    <div class="font-bold text-white">${s.nama}</div>
                    <div class="text-[11px] text-slate-400">${s.kamar || "-"} • ${window.formatShortSektor ? window.formatShortSektor(s.sektor) : s.sektor}</div>
                </td>
                <td class="px-4 py-3 align-top">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeColors[item.status] || ""}">${item.status}</span>
                </td>
                <td class="px-4 py-3 align-top">${detailHtml}</td>
                <td class="px-4 py-3 align-top">
                    <button onclick="SmartSync.openManualModal('${s.id}')" class="px-2.5 py-1 rounded-lg bg-asrama-bg hover:bg-asrama-cardHover border border-asrama-border text-[11px] font-semibold text-sky-300 cursor-pointer">
                        Cari / Manual
                    </button>
                </td>
            </tr>
        `;
    }

    // ------------------------------------------------------------------------
    // 6. PUBLIC API (window.SmartSync)
    // ------------------------------------------------------------------------
    window.SmartSync = {
        startMatching() {
            if (!syncState.workbook || syncState.selectedSheets.size === 0) {
                window.showToast("Upload file Excel dan pilih minimal 1 sheet terlebih dahulu.", "error");
                return;
            }
            syncState.selectedKamars.clear();
            document.querySelectorAll(".ss-kamar-cb:checked").forEach((cb) => syncState.selectedKamars.add(cb.value));
            runMatchingEngine();
        },

        quickSelectFloor(floor) {
            document.querySelectorAll(".ss-sektor-cb").forEach((cb) => {
                const sec = cb.dataset.sektor || "";
                let checked = false;
                if (floor === "ALL") checked = true;
                else if (floor === "NONE") checked = false;
                else checked = sec.includes(`Lt. ${floor}`) || sec.includes(`Lt ${floor}`);
                cb.checked = checked;
            });
            document.querySelectorAll(".ss-kamar-cb").forEach((cb) => {
                const sec = cb.dataset.sektor || "";
                let checked = false;
                if (floor === "ALL") checked = true;
                else if (floor === "NONE") checked = false;
                else checked = sec.includes(`Lt. ${floor}`) || sec.includes(`Lt ${floor}`);
                cb.checked = checked;
            });
        },

        autoCheckRoomsFromExcel() {
            if (!syncState.workbook) {
                window.showToast("Upload file Excel terlebih dahulu.", "error");
                return;
            }
            parseSelectedSheets();
            const roomCounts = new Map();
            syncState.schoolRows.forEach((r) => {
                if (!r.kamar) return;
                const norm = normalizeRoom(r.kamar);
                roomCounts.set(norm, (roomCounts.get(norm) || 0) + 1);
            });
            let checked = 0;
            document.querySelectorAll(".ss-kamar-cb").forEach((cb) => {
                const kamarName = cb.value.split("|||")[1] || "";
                const norm = normalizeRoom(kamarName);
                const match = (roomCounts.get(norm) || 0) >= 2;
                cb.checked = match;
                if (match) checked++;
            });
            window.showToast(`${checked} kamar dicentang sesuai file sekolah.`, "success");
        },

        setTab(tab) {
            syncState.activeTab = tab;
            renderSyncResults();
        },

        toggleOfficialName(santriId, val) {
            const item = syncState.results.find((r) => r.santri.id === santriId);
            if (!item) return;
            item.useOfficialName = val;
            saveDraftItem(santriId, {
                status: item.status,
                schoolKey: item.selectedSchool?.schoolKey,
                useOfficialName: val
            });
        },

        pickCandidate(santriId, schoolKey) {
            const existingOwner = syncState.usedSchoolKeys.get(schoolKey);
            if (existingOwner && existingOwner !== santriId) {
                if (!confirm("Siswa sekolah ini sudah dipakai santri lain. Pindahkan ke santri ini?")) return;
                const prevItem = syncState.results.find((r) => r.santri.id === existingOwner);
                if (prevItem) {
                    prevItem.status = "KUNING";
                    prevItem.selectedSchool = null;
                }
            }
            const item = syncState.results.find((r) => r.santri.id === santriId);
            const school = syncState.schoolRows.find((r) => r.schoolKey === schoolKey);
            if (!item || !school) return;

            item.status = "DIPERBAIKI";
            item.selectedSchool = school;
            syncState.usedSchoolKeys.set(schoolKey, santriId);
            saveDraftItem(santriId, { status: "DIPERBAIKI", schoolKey, useOfficialName: item.useOfficialName });
            renderSyncResults();
        },

        openManualModal(santriId) {
            const item = syncState.results.find((r) => r.santri.id === santriId);
            if (!item) return;
            syncState.manualTargetId = santriId;

            const existing = document.getElementById("ss-manual-modal");
            if (existing) existing.remove();

            const modal = document.createElement("div");
            modal.id = "ss-manual-modal";
            modal.className = "fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4";
            modal.innerHTML = `
                <div class="bg-asrama-card border border-asrama-border rounded-3xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
                    <div class="px-5 py-4 bg-asrama-sidebar border-b border-asrama-border flex items-center justify-between">
                        <div>
                            <h3 class="text-sm font-extrabold text-white">Cari Manual: ${item.santri.nama}</h3>
                            <p class="text-[11px] text-slate-400">Kamar SIAN: ${item.santri.kamar || "-"}</p>
                        </div>
                        <button onclick="document.getElementById('ss-manual-modal').remove()" class="text-slate-400 hover:text-white cursor-pointer"><i class="ph-bold ph-x text-lg"></i></button>
                    </div>
                    <div class="p-4 space-y-3 overflow-y-auto flex-1">
                        <div class="flex flex-wrap gap-2">
                            <input id="ss-modal-search" type="text" placeholder="Ketik nama, NIS, kelas, atau kamar sekolah..." class="flex-1 px-3 py-2 rounded-xl bg-asrama-bg border border-asrama-border text-xs text-white">
                            <button onclick="SmartSync.filterUnusedInRoom('${item.santri.kamar || ""}')" class="px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 text-[11px] font-bold cursor-pointer">
                                Sisa Belum Terpakai di ${item.santri.kamar || "Kamar"}
                            </button>
                        </div>
                        <label class="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                            <input id="ss-modal-hide-used" type="checkbox" checked class="rounded"> Sembunyikan siswa yang sudah dipakai
                        </label>
                        <div id="ss-modal-list" class="space-y-1.5 max-h-52 overflow-y-auto"></div>

                        <!-- Fallback Input Manual -->
                        <div class="pt-3 border-t border-asrama-border space-y-2.5">
                            <p class="text-xs font-bold text-amber-300">Atau Input Manual (Jika belum ada di Excel):</p>
                            <div class="grid grid-cols-2 gap-2">
                                <input id="ss-man-nama" type="text" value="${item.santri.nama}" placeholder="Nama Lengkap" class="px-3 py-1.5 rounded-lg bg-asrama-bg border border-asrama-border text-xs text-white">
                                <input id="ss-man-nis" type="text" value="${item.santri.nis || ""}" placeholder="NIS (Opsional)" class="px-3 py-1.5 rounded-lg bg-asrama-bg border border-asrama-border text-xs text-white">
                                <input id="ss-man-kelas" type="text" value="${item.santri.kelas || ""}" placeholder="Kelas (misal: XII A1)" class="px-3 py-1.5 rounded-lg bg-asrama-bg border border-asrama-border text-xs text-white">
                                <select id="ss-man-jenjang" class="px-3 py-1.5 rounded-lg bg-asrama-bg border border-asrama-border text-xs text-white">
                                    <option value="SMA" ${item.santri.jenjang === "SMA" ? "selected" : ""}>SMA</option>
                                    <option value="SMP" ${item.santri.jenjang === "SMP" ? "selected" : ""}>SMP</option>
                                </select>
                            </div>
                            <div class="flex justify-end gap-2">
                                <button onclick="SmartSync.skipSantri('${santriId}')" class="px-3 py-1.5 rounded-lg bg-slate-700 text-xs text-slate-200 cursor-pointer">Lewati</button>
                                <button onclick="SmartSync.saveManualInput('${santriId}')" class="px-4 py-1.5 rounded-lg bg-emerald-600 text-xs font-bold text-white cursor-pointer">Gunakan Input Manual</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const renderModalList = (onlyRoom = "") => {
                const q = (document.getElementById("ss-modal-search")?.value || "").toLowerCase();
                const hideUsed = document.getElementById("ss-modal-hide-used")?.checked;
                const list = syncState.schoolRows.filter((r) => {
                    if (hideUsed && syncState.usedSchoolKeys.has(r.schoolKey)) return false;
                    if (onlyRoom && !isSameRoom(onlyRoom, r.kamar)) return false;
                    if (!q) return true;
                    return `${r.nama} ${r.nis} ${r.kelas} ${r.kamar}`.toLowerCase().includes(q);
                }).slice(0, 40);

                document.getElementById("ss-modal-list").innerHTML = list.map((r) => `
                    <div class="flex items-center justify-between gap-2 bg-asrama-bg p-2 rounded-lg border border-asrama-border text-xs">
                        <div>
                            <div class="font-bold text-white">${r.nama}</div>
                            <div class="text-[10px] text-slate-400">NIS: ${r.nis || "-"} • ${r.kelas || "-"} • Kmr: ${r.kamar || "-"}</div>
                        </div>
                        <button onclick="SmartSync.pickCandidate('${santriId}', '${r.schoolKey}'); document.getElementById('ss-manual-modal').remove();" class="px-2.5 py-1 rounded-lg bg-sky-500 text-slate-950 font-bold text-[11px] cursor-pointer">Pilih</button>
                    </div>
                `).join("") || `<p class="text-xs text-slate-400 py-2">Tidak ada siswa yang cocok.</p>`;
            };

            document.getElementById("ss-modal-search").addEventListener("input", () => renderModalList());
            document.getElementById("ss-modal-hide-used").addEventListener("change", () => renderModalList());
            window.SmartSync._renderModalList = renderModalList;
            renderModalList();
        },

        filterUnusedInRoom(kamar) {
            if (window.SmartSync._renderModalList) window.SmartSync._renderModalList(kamar);
        },

        saveManualInput(santriId) {
            const nama = document.getElementById("ss-man-nama").value.trim();
            const nis = document.getElementById("ss-man-nis").value.trim();
            const kelas = document.getElementById("ss-man-kelas").value.trim();
            const jenjang = document.getElementById("ss-man-jenjang").value;
            const item = syncState.results.find((r) => r.santri.id === santriId);
            if (!item) return;

            const manualObj = { schoolKey: `MANUAL:${santriId}`, nama, nis, kelas, jenjang, kelas_madin: "" };
            item.status = "DIPERBAIKI";
            item.selectedSchool = manualObj;
            saveDraftItem(santriId, { status: "DIPERBAIKI", manualInput: manualObj, useOfficialName: true });
            document.getElementById("ss-manual-modal").remove();
            renderSyncResults();
        },

        skipSantri(santriId) {
            const item = syncState.results.find((r) => r.santri.id === santriId);
            if (!item) return;
            item.status = "LEWATI";
            item.selectedSchool = null;
            saveDraftItem(santriId, { status: "LEWATI" });
            document.getElementById("ss-manual-modal").remove();
            renderSyncResults();
        },

        confirmSave() {
            const ready = syncState.results.filter((r) => (r.status === "HIJAU" || r.status === "DIPERBAIKI") && r.selectedSchool);
            if (!ready.length) return;
            const renameCount = ready.filter((r) => r.useOfficialName && r.selectedSchool.nama && r.selectedSchool.nama !== r.santri.nama).length;

            if (!confirm(`Siap memperbarui ${ready.length} santri ke Firestore?\n- ${renameCount} santri akan dibakukan namanya.\n- Data kamar, sektor, absensi, izin, dan pelanggaran TIDAK akan berubah.`)) {
                return;
            }
            this.executeSave(ready);
        },

        async executeSave(ready) {
            if (!window.FB || !window.FB.ready) return;
            const CHUNK = 400;
            try {
                for (let i = 0; i < ready.length; i += CHUNK) {
                    const batch = window.FB.writeBatch(window.FB.db);
                    const slice = ready.slice(i, i + CHUNK);
                    slice.forEach((item) => {
                        const s = item.santri;
                        const sc = item.selectedSchool;
                        const payload = {
                            nis: sc.nis || s.nis || "",
                            kelas: sc.kelas || s.kelas || "",
                            jenjang: sc.jenjang || detectJenjang(sc.kelas) || s.jenjang || ""
                        };
                        if (sc.kelas_madin) payload.kelas_madin = sc.kelas_madin;
                        if (item.useOfficialName && sc.nama && sc.nama !== s.nama) {
                            if (!s.nama_lama) payload.nama_lama = s.nama;
                            payload.nama = sc.nama;
                        }
                        batch.update(window.FB.doc(window.FB.db, "santri", s.id), payload);
                    });
                    await batch.commit();
                }
                localStorage.removeItem(DRAFT_KEY);
                window.showToast(`Berhasil menyimpan ${ready.length} santri ke Firestore!`, "success");
            } catch (err) {
                console.error("Gagal batch update Smart Sync:", err);
                window.showToast("Gagal menyimpan ke Firestore: " + err.message, "error");
            }
        },

        backupSantriJson() {
            const santriList = window.getSantriList ? window.getSantriList() : [];
            const blob = new Blob([JSON.stringify(santriList, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `backup-santri-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },

        exportReport() {
            if (typeof window.XLSX === "undefined") return;
            const rows = syncState.results.map((r, i) => ({
                No: i + 1,
                Status: r.status,
                "Nama Lama SIAN": r.santri.nama,
                "Kamar SIAN": r.santri.kamar,
                "Nama Resmi Sekolah": r.selectedSchool?.nama || "-",
                NIS: r.selectedSchool?.nis || "-",
                Kelas: r.selectedSchool?.kelas || "-",
                Jenjang: r.selectedSchool?.jenjang || "-",
                Catatan: r.pindahKamarInfo || r.note
            }));
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(rows), "Hasil Smart Sync");
            window.XLSX.writeFile(wb, `Laporan-Smart-Sync-${new Date().toISOString().slice(0, 10)}.xlsx`);
        }
    };
})();
