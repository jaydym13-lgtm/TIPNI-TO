// =========================================================================
// 🚀 TIPNI TO! - HLAVNÍ CORE SOUBOR V11 MODULAR (app.js)
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app-check.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, doc, getDoc, setDoc, onSnapshot, updateDoc, serverTimestamp, disableNetwork, enableNetwork, setLogLevel, arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js";
import { CONFIG } from "./config.js";
import { getActiveChangelog, formatChangelogDate } from "./changelog.js";

import { getDatabase, ref as rtdbRef, onValue as onRtdbValue, update as rtdbUpdate, goOnline, goOffline } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// 🔇 UMLČENÍ VAROVÁNÍ SDK: Potlačí interní BloomFilter a cache warningy z konzole
setLogLevel('error');

export const app = initializeApp(CONFIG.FIREBASE_CONFIG);

let firestoreDb;
try {
    firestoreDb = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        })
    });
} catch (err) {
    console.warn("⚠️ IndexedDB persistence selhala, aktivuji nouzovou paměťovou cache:", err);
    firestoreDb = initializeFirestore(app, {
        localCache: memoryLocalCache()
    });
}
export const db = firestoreDb;
export const auth = getAuth(app);
export const functions = getFunctions(app, "europe-west1");
export const rtdb = getDatabase(app);

// Zpětná kompatibilita pro vanilkové provázání modulů
window.app = app; window.db = db; window.auth = auth; window.functions = functions; window.rtdb = rtdb;

// 🔇 PRODUKČNÍ ŠTÍT KONZOLE: Na mobilech hráčů kompletně umlčí logy a ušetří baterii i RAM
const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if (!isDev) {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
}

// 👑 NEPRŮSTŘELNÝ ASYNC HYBRIDNÍ BOOTSTRAP: Garantuje registraci storu bez ohledu na Race Condition sítě
const vstrikniStoresDoPameti = () => {
    if (window.__tipniToStoresReady) return;
    window.__tipniToStoresReady = true;

    Alpine.store('appState', {
        currentScreen: 'splashScreen', 
        activeSeason: localStorage.getItem('savedSeason') || '2026_2027',
        dostupneSezony: [
			{ id: '2026_2027', label: 'Sezóna 2026/2027', archived: false }
		],
        get isArchived() {
            const vybranaSezona = this.dostupneSezony.find(s => s.id === this.activeSeason);
            return vybranaSezona ? vybranaSezona.archived : false;
        },
        dirtyTipsCount: 0,
        incompleteTipsCount: 0,
        fanGraphics: localStorage.getItem('tipni_fan_graphics') === 'true',
        selectedLeague: null,
        selectedAdminLeague: null,
        adminActiveTab: 'users',
        superAdminActiveTab: 'users', // 👑 Aktivní podzáložka SuperAdmin kokpitu ('users' | 'tools' | 'odds')
        adminMatches: [],
        adminUsers: [],
        adminLeagues: [], // 🏒 Seznam lig, které smí přihlášený admin spravovat
        adminOpenedUserId: null, // 🔒 Držák otevřeného uživatele v Admin panelu (null = vše zavřeno)

        // 👥 SOUKROMÉ PARTIČKY (FÁZE 3 UX ENGINE)
        selectedGroupId: null, // null = celá liga / globál, jinak kód party
        myGroupsList: [],
        groupModalOpen: false,

        get currentGroupTitle() {
            if (!this.selectedGroupId) return 'Celá liga (Globální tabulka)';
            const grp = this.myGroupsList.find(g => g.id === this.selectedGroupId || g.kod === this.selectedGroupId);
            return grp ? grp.nazev : 'Moje partička';
        },

        favGroupId: null, // ⚡ Okamžitá reaktivita: mění se přímo v paměti Alpine

        get isCurrentGroupFav() {
            if (!this.selectedGroupId) return this.favGroupId === 'GLOBAL';
            return Boolean(this.selectedGroupId && this.selectedGroupId === this.favGroupId);
        },

        // 🎯 LIGY, KTERÉ MÁ SPRÁVCE POVOLENÉ OVLÁDAT (Super Admin má vše, běžný admin jen své)
        get allowedAdminLeagues() {
            if (this.isSuperAdmin) return CONFIG.MASTER_LEAGUES || [];
            if (this.adminLeagues && Array.isArray(this.adminLeagues) && this.adminLeagues.length > 0) {
                return this.adminLeagues;
            }
            return [];
        },

        // 👥 SOUPISKA HRÁČŮ VYFILTROVANÁ POUZE PRO SOUTĚŽE DANÉHO SPRÁVCE
        get filteredAdminUsers() {
            if (this.isSuperAdmin) return this.adminUsers || [];
            const povoleneLigy = this.allowedAdminLeagues;
            return (this.adminUsers || []).filter(u => {
                const hracovyLigy = u.leagues || [];
                return hracovyLigy.some(l => povoleneLigy.includes(l));
            });
        },
        // 🛡️ ZDA MÁ HRÁČ V MÝCH KOMPETENCÍCH ROLI ADMINA (V cizí lize je běžný hráč)
        isUserAdminInContext(userItem) {
            if (!userItem) return false;
            if (userItem.isSuperAdmin) return true;
            if (this.isSuperAdmin) return userItem.isAdmin === true;
            const mojeLigy = this.allowedAdminLeagues || [];
            const jehoAdminLigy = userItem.adminLeagues || [];
            return jehoAdminLigy.some(l => mojeLigy.includes(l));
        },

        // 🎭 LZE HRÁČE LOUTKOVODIT? (Nesmí být Super Admin a v mých ligách nesmí být správcem)
        canProxyUser(userItem) {
            if (!userItem) return false;
            if (this.isSuperAdmin) return true;
            if (userItem.isSuperAdmin) return false;
            const mojeLigy = this.allowedAdminLeagues || [];
            const jehoLigy = userItem.leagues || [];
            const jehoAdminLigy = userItem.adminLeagues || [];
            return mojeLigy.some(l => jehoLigy.includes(l) && !jehoAdminLigy.includes(l));
        },

        // 📋 SOUTĚŽE DOSTUPNÉ V LOUTKOVODIČI PRO KONKRÉTNÍHO VYBRANÉHO HRÁČE
        get loutkovodicAvailableLeagues() {
            const uid = this.loutkovodicTargetUid;
            if (!uid) return this.allowedAdminLeagues || [];
            const target = (this.adminUsers || []).find(u => u.id === uid) 
                        || (this.adminManagers || []).find(u => u.id === uid) 
                        || {};
            const targetLeagues = target.leagues || [];
            const targetAdminLeagues = target.adminLeagues || [];
            const mojeLigy = this.allowedAdminLeagues || [];

            if (this.isSuperAdmin) {
                return targetLeagues.length > 0 ? targetLeagues : mojeLigy;
            }

            return mojeLigy.filter(l => targetLeagues.includes(l) && !targetAdminLeagues.includes(l));
        },
        myOvr: parseInt(localStorage.getItem('tipni_cache_my_ovr') || '0', 10),
        profileTargetUid: null,
        profileReturnScreen: 'leaguesScreen',
        hallOfFameData: (() => {
            try { return JSON.parse(localStorage.getItem('tipni_cache_hof_' + (localStorage.getItem('savedSeason') || '2026_2027')) || 'null'); } catch(e){ return null; }
        })(),

        // 👥 STAV KOMUNITY Z REALTIME DATABASE (0 FIRESTORE READS, LIVE WEBSOCKET)
        communityOnline: 1,
        communityTotal: (() => {
            try {
                const h = JSON.parse(localStorage.getItem('tipni_cache_hof_' + (localStorage.getItem('savedSeason') || '2026_2027')) || 'null');
                return (h?.all || h?.players || []).length || 46;
            } catch(e) { return 46; }
        })(),
        onlineUidsSet: new Set(),
        communityLastSeen: {},

        // 👀 REŽIM HOSTA & ANONYMNÍ TELEMETRIE (ZERO AUTH)
        isGuest: false,
        showAllLeagues: localStorage.getItem('tipni_show_all_leagues') === 'true',
        guestOnlineCount: 0,
        guestTotalVisits: 0,
        guestLastSeen: null,

        // 📊 POČÍTADLO ZÁPASŮ BEZ KURZŮ PRO NOTIFIKAČNÍ ODZNAK V MENU
        get missingOddsCount() {
            return this.missingOddsList.length;
        },

        // 🔍 SEZNAM ZÁPASŮ NA NEJBLIŽŠÍCH 7 DNÍ BEZ VYPSANÝCH KURZŮ
        get missingOddsList() {
            const _tick = this.leagueFilterTick;
            const MASTER_LIGY = CONFIG.MASTER_LEAGUES;
            const sezId = this.activeSeason || window.SEZONA_ID || "2026_2027";
            const now = Date.now();
            const result = [];

            const melByZapasUzMitKurz = (casZapasu, isHockey) => {
                // Zápasy vzdálenější než 7 dní zcela ignorujeme
                if (casZapasu > now + (7 * 24 * 60 * 60 * 1000)) return false;

                const mDate = new Date(casZapasu);
                const mDay = mDate.getDay(); // 0=Ne, 1=Po, 2=Út, 3=St, 4=Čt, 5=Pá, 6=So
                const mHour = mDate.getHours();
                const syncDate = new Date(casZapasu);

                if (isHockey) {
                    // 🏒 HOKEJ (Tipsport Extraliga): 3 synchronizační mantinely
                    // 1. Blok: Sobota 12:00 -> pokrývá Ne a Po do 10:00 (a So od 12:00)
                    if ((mDay === 6 && mHour >= 12) || mDay === 0 || (mDay === 1 && mHour < 10)) {
                        const daysBack = (mDay === 6) ? 0 : (mDay === 0 ? 1 : 2);
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(12, 0, 0, 0);
                    }
                    // 2. Blok: Pondělí 10:00 -> pokrývá Út a St, a Čt do 09:00
                    else if ((mDay === 1 && mHour >= 10) || mDay === 2 || mDay === 3 || (mDay === 4 && mHour < 9)) {
                        const daysBack = (mDay === 1) ? 0 : (mDay === 2 ? 1 : (mDay === 3 ? 2 : 3));
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(10, 0, 0, 0);
                    }
                    // 3. Blok: Čtvrtek 09:00 -> pokrývá Čt od 09:00, Pá a So do 12:00
                    else {
                        const daysBack = (mDay === 4) ? 0 : (mDay === 5 ? 1 : 2);
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(9, 0, 0, 0);
                    }
                } else {
                    // ⚽ FOTBAL: 2 herní bloky podle plánovače Cloud Functions
                    // Víkendový blok: Pátek až Pondělí -> stahuje se v Úterý v 17:00
                    if (mDay === 5 || mDay === 6 || mDay === 0 || mDay === 1) {
                        const daysBack = (mDay === 5 ? 3 : (mDay === 6 ? 4 : (mDay === 0 ? 5 : 6)));
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(17, 0, 0, 0);
                    }
                    // Všední blok: Úterý až Čtvrtek -> dočišťuje se v Pondělí ve 04:00
                    else {
                        const daysBack = mDay - 1; // Út(2)->1, St(3)->2, Čt(4)->3
                        syncDate.setDate(syncDate.getDate() - daysBack);
                        syncDate.setHours(4, 0, 0, 0);
                    }
                }

                return now >= syncDate.getTime();
            };

            MASTER_LIGY.forEach(leagueName => {
                const isHockey = leagueName.includes("Extraliga") || leagueName.includes("hokej");
                const lKlic = String(leagueName).replace(/ /g, "_");
                let rozpisObj = this.leaguesMemoryCache?.[leagueName]?.rozpisData;
                
                if (!rozpisObj) {
                    try {
                        const raw = localStorage.getItem(`tipni_cache_rozpis_${sezId}_${lKlic}`);
                        if (raw) rozpisObj = JSON.parse(raw);
                    } catch (e) {}
                }

                if (rozpisObj && rozpisObj.zapasyMapa) {
                    Object.entries(rozpisObj.zapasyMapa).forEach(([mId, z]) => {
                        const casZapasu = Date.parse(z.datum) || 0;
                        const jeOdehrany = z.vysledek_domaci !== undefined || z.apiStatus === "IN_PLAY" || z.apiStatus === "PAUSED" || z.apiStatus === "FINISHED";
                        const jeOdlozen = z.apiStatus === "POSTPONED";
                        const maKurz = z.odds && (z.odds["1"] || z.odds[1]);

                        // 🎯 Zápas se zařadí do chybějících POUZE tehdy, pokud už podle plánovače bota proběhl jeho termín stažení
                        if (!jeOdehrany && !jeOdlozen && !maKurz && casZapasu > now && melByZapasUzMitKurz(casZapasu, isHockey)) {
                            result.push({
                                ...z,
                                id: mId,
                                league: leagueName,
                                datumMs: casZapasu
                            });
                        }
                    });
                }
            });

            return result.sort((a, b) => a.datumMs - b.datumMs);
        },
        adminMatchesLoaded: false,
        adminUsersLoaded: false,
        adminGlobalVitez: '',
        adminGlobalStrelec: '',
        showSurveys: true,
        notifyUntipped: false,
        activeSurveyData: null,
        surveyModalOpen: false,
        loutkovodicReturnScreen: 'adminScreen',
        loutkovodicTargetUid: '',
        loutkovodicTargetEmail: '',
        loutkovodicTargetNickname: '',
        loutkovodicSelectedLeague: '',
        loutkovodicBonusVitez: '',
        loutkovodicBonusStrelec: '',
        loutkovodicBonusKanadske: '',
        loutkovodicInitialBonusVitez: '',
        loutkovodicInitialBonusStrelec: '',
        loutkovodicInitialBonusKanadske: '',
        loutkovodicMatches: [],
        loutkovodicMatchesLoaded: false,
        loutkovodicBonusOpen: false,
        loutkovodicKolaIndex: 0,
        get unikatniKolaLoutkovodic() {
            if (!this.loutkovodicMatches || this.loutkovodicMatches.length === 0) return [];
            const listKol = this.loutkovodicMatches.map(m => window.prelozFaziTurnaje ? window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff) : (m.kolo || 'Šampionát'));
            return [...new Set(listKol)].filter(k => String(k).trim() !== '');
        },
        get dynamickyFeedLoutkovodic() {
            if (!this.loutkovodicMatches || this.loutkovodicMatches.length === 0) return [];
            const kola = this.unikatniKolaLoutkovodic;
            if (kola.length === 0) return this.loutkovodicMatches;
            const vybraneKolo = kola[this.loutkovodicKolaIndex] || kola[0];
            return this.loutkovodicMatches.filter(m => (window.prelozFaziTurnaje ? window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff) : (m.kolo || 'Šampionát')) === vybraneKolo);
        },
        isMenuOpen: false,
        isAdmin: false,
        isSuperAdmin: false,
        tutorialOpen: false,
        tutorialStep: 0,
        tutorialTotalSteps: 10,
        nickname: '',
        isLive: false,
        // 🔴 Okamžitá paměťová hydratace LIVE odznaků (0 ms bez probliknutí rozhraní)
        liveLeaguesMap: (() => {
            try { return JSON.parse(localStorage.getItem('tipni_cache_live_map') || '{}'); } catch(e) { return {}; }
        })(),
        liveTicks: {}, // ⏱️ Přesné živé minuty zápasů z Realtime Database (0 Firestore Reads)
        isLeaguesReady: true, // ⚡ Okamžitý start: Zobrazí obsah ihned z disku telefonu
        _leagues: [],
        leagueFilterTick: 0,
        // ⚡ L1 RAM CACHE: Okamžitá synchronní hydratace známých lig do RAM paměti (0 ms přepínání)
        leaguesMemoryCache: (() => {
            const cache = {};
            const sezId = localStorage.getItem('savedSeason') || '2026_2027';
            (CONFIG.MASTER_LEAGUES || []).forEach(lName => {
                const lKlic = String(lName).replace(/ /g, '_');
                try {
                    const rRaw = localStorage.getItem(`tipni_cache_rozpis_${sezId}_${lKlic}`);
                    const lbRaw = localStorage.getItem(`tipni_cache_lb_${sezId}_${lKlic}`);
                    if (rRaw || lbRaw) {
                        cache[lName] = {
                            rozpisData: rRaw ? JSON.parse(rRaw) : null,
                            leaderboardData: lbRaw ? JSON.parse(lbRaw) : null
                        };
                    }
                } catch (e) {}
            });
            return cache;
        })(),
        reorderModalOpen: false,
        reorderList: [],
        lastLeagueOrderChange: 0,

        leagueOrder: [],
        // 👥 Okamžitá paměťová hydratace počtu hráčů v soutěžích
        leaguePlayerCounts: (() => {
            try { return JSON.parse(localStorage.getItem('tipni_cache_player_counts') || '{}'); } catch(e) { return {}; }
        })(),
        getLeagueSubtext(liga) {
            const _tick = this.leagueFilterTick;
            let pocet = this.leaguePlayerCounts[liga];
            
            // ⚡ Instantní fallback z cache, aby číslo neprobliklo na 0
            if (pocet === undefined) {
                const sezId = this.activeSeason || window.SEZONA_ID || "2026_2027";
                const lKlic = String(liga || '').replace(/ /g, "_");
                try {
                    const cachedLb = localStorage.getItem(`tipni_cache_lb_${sezId}_${lKlic}`);
                    if (cachedLb) {
                        const parsed = JSON.parse(cachedLb);
                        if (parsed && parsed.zebricek) {
                            pocet = parsed.zebricek.length;
                            this.leaguePlayerCounts[liga] = pocet;
                        }
                    }
                } catch(e) {}
            }

            const finalCount = pocet ?? 0;
            if (finalCount === 1) return '1 hráč v tipovačce';
            if (finalCount >= 2 && finalCount <= 4) return `${finalCount} hráči v tipovačce`;
            return `${finalCount} hráčů v tipovačce`;
        },

        getSportIcon(liga) {
            const l = String(liga || this.selectedLeague || '').toLowerCase();
            return (l.includes('extraliga') || l.includes('hokej')) ? '🏒' : '⚽';
        },

        // 🔍 POMOCNÝ INTERNÍ FILTR A SEŘAZOVAČ PODLE POŘADÍ
        _filtrujAseradLigy(seznam) {
            if (!seznam || !Array.isArray(seznam) || seznam.length === 0) return [];
            const sezId = this.activeSeason || window.SEZONA_ID || "2026_2027";
            const vyfiltrovane = seznam.filter(liga => {
                const lKlic = String(liga).replace(/ /g, "_");
                try {
                    const cached = localStorage.getItem(`tipni_cache_rozpis_${sezId}_${lKlic}`);
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        if (parsed && (parsed.hasMatches === false || (parsed.zapasyMapa && Object.keys(parsed.zapasyMapa).length === 0))) {
                            return false;
                        }
                    } else {
                        if (!this.isLeaguesReady) return false;
                    }
                } catch(e) {}
                return true;
            });

            const poradi = this.leagueOrder || [];
            if (poradi.length > 0 && !this.isGuest) {
                vyfiltrovane.sort((a, b) => {
                    let idxA = poradi.indexOf(a);
                    let idxB = poradi.indexOf(b);
                    if (idxA === -1) idxA = 999;
                    if (idxB === -1) idxB = 999;
                    return idxA - idxB;
                });
            }
            return vyfiltrovane;
        },

        // 🏆 AKTIVNÍ SOUTĚŽE HRÁČE (VŽDY NAHOŘE)
        get myEnrolledLeagues() {
            const _tick = this.leagueFilterTick;
            const MASTER_LIGY = CONFIG.MASTER_LEAGUES || [];
            if (this.isSuperAdmin || this.isGuest) {
                return this._filtrujAseradLigy(MASTER_LIGY);
            }
            return this._filtrujAseradLigy(this._leagues || []);
        },

        // 👀 NEAKTIVNÍ SOUTĚŽE K NAHLÉDNUTÍ (SHOWROOM DOLE + AUTOMATICKÝ NÁHLED PRO NOVÁČKY)
        get previewLeagues() {
            const _tick = this.leagueFilterTick;
            if (this.isSuperAdmin || this.isGuest) return [];
            const moje = this._leagues || [];
            // Pokud nováček nemá žádnou ligu, automaticky mu otevřeme všechny soutěže k nahlédnutí
            if (!this.showAllLeagues && moje.length > 0) return [];
            const MASTER_LIGY = CONFIG.MASTER_LEAGUES || [];
            const kNahledu = MASTER_LIGY.filter(l => !moje.includes(l));
            return this._filtrujAseradLigy(kNahledu);
        },

        // 🙈 CELKOVÝ SEZNAM PRO MENU A MODÁL ŘAZENÍ
        get leagues() {
            return [...this.myEnrolledLeagues, ...this.previewLeagues];
        },

        // 🔒 ZAMYKACÍ ZÁMEK: Vrátí true pouze pro soutěže, které má hráč schválené v licenci
        get isEnrolledInSelectedLeague() {
            if (this.isGuest) return false;
            if (this.isSuperAdmin) return true;
            const mojeLigy = this._leagues || [];
            return mojeLigy.includes(this.selectedLeague);
        },

        set leagues(val) {
            this._leagues = val;
            this.leagueFilterTick++;
        },
        rawSezonaData: {}, // 📦 Ukládá kompletní surový balík sezóny pro bleskové vytažení tipů
	mojeTipy: {},
        mojeBonusy: {},
        mojeStatistiky: {},
        matchViewMode: 'upcoming',
        rozvrtaneTipy: {},
        vysledkyKolaIndex: 0, // Nezávislý index pro listování výhradně v záložce Výsledky
        godModeActive: false, // 🔄 Vlajka pro filtraci a přepínání Admin / Player světů přes štítek
        showScrollTop: false, // ⦡ Reaktivní stav pro zobrazení chytré šipky v hlavičce
        canInstallPwa: false, // 📲 Reaktivní stav pro tlačítko instalace PWA
        isIos: /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
        isStandalone: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
        canLinkGoogle: false,
        authMode: 'login',
        toggleGodMode() {
            if (this.isSuperAdmin) {
                this.godModeActive = !this.godModeActive;
            }
        },

        changelogList: [],
        hasUnreadChangelog: false,
        appVersion: localStorage.getItem('tipni_app_version') || '',

        obnovChangelogStav() {
            const aktivni = getActiveChangelog();
            this.changelogList = aktivni;
            if (aktivni.length === 0) {
                this.hasUnreadChangelog = false;
                return;
            }
            const nejnovejsiId = aktivni[0].id;
            const posledniPrecteneId = localStorage.getItem('tipni_last_changelog_id');
            this.hasUnreadChangelog = (nejnovejsiId !== posledniPrecteneId);
        },

        openChangelogModal() {
            if (this.changelogList.length > 0) {
                const nejnovejsiId = this.changelogList[0].id;
                localStorage.setItem('tipni_last_changelog_id', nejnovejsiId);
            }
            this.hasUnreadChangelog = false;

            const zpravy = this.changelogList;
            if (zpravy.length === 0) {
                window.openGlobalUiModal('CO JE NOVÉHO? 🚀', '<div style="text-align:center; padding:25px; color:#9ca3af; font-size:0.9rem;">Za posledních 30 dní neproběhly žádné nové aktualizace.</div>');
                return;
            }

            let html = '<div class="changelog-modal-wrapper">';
            zpravy.forEach(item => {
                let badgeClass = 'badge-feature';
                let badgeLabel = '🚀 NOVINKA';
                if (item.type === 'IMPROVEMENT') { badgeClass = 'badge-improvement'; badgeLabel = '⚡ VYLEPŠENÍ'; }
                else if (item.type === 'FIX') { badgeClass = 'badge-fix'; badgeLabel = '🛠️ OPRAVA'; }
                else if (item.type === 'SECURITY') { badgeClass = 'badge-security'; badgeLabel = '🔒 BEZPEČNOST'; }

                const datumFormatted = formatChangelogDate(item.datetime);

                html += `
                    <div class="changelog-card">
                        <div class="changelog-card-header">
                            <span class="changelog-badge ${badgeClass}">${badgeLabel}</span>
                            <span class="changelog-card-date">🕒 ${datumFormatted}</span>
                        </div>
                        <div class="changelog-card-title">${item.title}</div>
                        <div class="changelog-card-desc">${item.desc}</div>
                    </div>
                `;
            });
            html += '</div>';

            window.openGlobalUiModal('CO JE NOVÉHO? 🚀', html);
        },

        adminKolaIndex: 0, // Index vybraného kola v Admin karuselu
        cacheTimeline: [], // 🚀 BLESKOVÁ MEMOIZOVANÁ PAMĚŤ (0ms zpoždění)

        // 👑 ADMIN: Unikátní seznam všech kol v administraci
        get unikatniKolaAdminu() {
            if (!this.adminMatches || this.adminMatches.length === 0) return [];
            const listKol = this.adminMatches.map(m => window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff));
            return [...new Set(listKol)].filter(k => String(k).trim() !== '');
        },

        // 👑 ADMIN: Dynamický feed zápasů vyfiltrovaných podle zvoleného kola v karuselu
        get dynamickyFeedAdminZapasu() {
            if (!this.adminMatches || this.adminMatches.length === 0) return [];
            const kola = this.unikatniKolaAdminu;
            if (kola.length === 0) return this.adminMatches;
            
            const vybraneKolo = kola[this.adminKolaIndex] || kola[0];
            return this.adminMatches.filter(m => window.prelozFaziTurnaje(m.stage, m.kolo, m.isPlayoff) === vybraneKolo);
        },

        obnovCacheTimeline() {
            if (!this._rozpisData || !this._rozpisData.zapasyMapa) {
                this.cacheTimeline = [];
                return;
            }
            const parsujDatumMs = (d) => {
                if (!d) return 0;
                if (typeof d.toDate === 'function') return d.toDate().getTime();
                if (typeof d.seconds === 'number') return d.seconds * 1000;
                const parsed = Date.parse(d);
                return isNaN(parsed) ? 0 : parsed;
            };

            this.cacheTimeline = Object.entries(this._rozpisData.zapasyMapa)
                .map(([id, z]) => {
                    const dMs = parsujDatumMs(z.datum);
                    let cachedDateObj = null;
                    let cachedDateText = null;

                    return {
                        ...z,
                        id,
                        datumMs: dMs,
                        get datumObj() {
                            if (!cachedDateObj) cachedDateObj = new Date(this.datumMs || Date.now());
                            return cachedDateObj;
                        },
                        get datumText() {
                            if (cachedDateText === null) {
                                if (!this.datumMs) {
                                    cachedDateText = '';
                                } else {
                                    const d = this.datumObj;
                                    cachedDateText = `${d.getDate()}. ${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                                }
                            }
                            return cachedDateText;
                        }
                    };
                })
                .sort((a, b) => a.datumMs - b.datumMs);
        },

        get serazenaTimelineZapasu() {
            if (this.cacheTimeline.length === 0 && this._rozpisData?.zapasyMapa) {
                this.obnovCacheTimeline();
            }
            return this.cacheTimeline;
        },

        // 📊 REAKTIVNÍ DETEKTOR STARTU LIGY PRO ALPINE.JS
        get isLeagueStarted() {
            if (!this.serazenaTimelineZapasu || this.serazenaTimelineZapasu.length === 0) return false;
            const prvniZapas = this.serazenaTimelineZapasu[0];
            const casStartu = prvniZapas.datumObj ? prvniZapas.datumObj.getTime() : 0;
            if (casStartu > 0 && casStartu < Date.now()) return true;
            return this.serazenaTimelineZapasu.some(m => 
                m.isLive || m.apiStatus === 'IN_PLAY' || m.apiStatus === 'PAUSED' || m.apiStatus === 'FINISHED' || (m.vysledek_domaci !== undefined && m.vysledek_domaci !== null)
            );
        },

        // 🛡️ POMOCNÝ DETEKTOR: Prověří, zda je zápas odložený bez nového budoucího termínu
        jeZapasOdlozenyBezTerminu(z) {
            const now = Date.now();
            const zMs = z.datumObj ? z.datumObj.getTime() : 0;
            const jeOficialneOdlozen = z.apiStatus === 'POSTPONED' || z.status === 'POSTPONED';

            // 1. Zápas je v API označen jako odložený a nemá nové datum v budoucnosti
            if (jeOficialneOdlozen && (!zMs || zMs <= now)) return true;

            // 2. Záchranný štít: Zápas měl výkop před více než 3,5 hodinami, nemá výsledek a neběží live
            const nemaSkore = z.vysledek_domaci === undefined || z.vysledek_domaci === null;
            const nebeziLive = z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED' && !z.isLive;
            const jeStaraMinulost = zMs > 0 && (now - zMs > 3.5 * 60 * 60 * 1000);

            if (nemaSkore && nebeziLive && jeStaraMinulost) return true;

            return false;
        },

        // 🔍 SEZNAM KOL ZOBRAZENÝCH V NÁHLEDU NADCHÁZEJÍCÍCH ZÁPASŮ (PRO PŘESKOK V KARUSELU)
        get nejblizsi2KolaProgramu() {
            if (this.programKolaIndex === 0) {
                const feed = this.dynamickyFeedZapasu || [];
                const list = feed.map(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff));
                return [...new Set(list)].filter(k => String(k).trim() !== '');
            }
            return [];
        },

        // 🔍 SEZNAM KOL ZOBRAZENÝCH V NÁHLEDU POSLEDNÍCH VÝSLEDKŮ (PRO PŘESKOK V KARUSELU)
        get posledni2KolaVysledku() {
            if (this.vysledkyKolaIndex === 0) {
                const feed = this.dynamickyFeedZapasu || [];
                const list = feed.map(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff));
                return [...new Set(list)].filter(k => String(k).trim() !== '');
            }
            return [];
        },

        // Dynamická roletka pro Výsledky (0ms bleskový odběr z R2 s lokálním fallbackem)
        get unikatniKolaVysledku() {
            if (this._rozpisData?.unikatniKolaVysledku && Array.isArray(this._rozpisData.unikatniKolaVysledku) && this._rozpisData.unikatniKolaVysledku.length > 0) {
                return this._rozpisData.unikatniKolaVysledku;
            }
            const vyhodnocene = this.serazenaTimelineZapasu.filter(z => 
                z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED'
            );
            const listKol = vyhodnocene.map(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff));
            const unikatni = [...new Set(listKol)].filter(k => String(k).trim() !== '');
            return ['Poslední zápasy', ...unikatni.reverse()];
        },

        // Dynamická roletka pro Program utkání (0ms bleskový odběr z R2 s lokálním fallbackem)
        get unikatniKolaProgramu() {
            if (this._rozpisData?.unikatniKolaProgramu && Array.isArray(this._rozpisData.unikatniKolaProgramu) && this._rozpisData.unikatniKolaProgramu.length > 0) {
                return this._rozpisData.unikatniKolaProgramu;
            }
            const budouci = this.serazenaTimelineZapasu.filter(z => {
                const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                return !jeVyhodnoceny && !obaNeznamy && !this.jeZapasOdlozenyBezTerminu(z);
            });
            const kolaPoradi = [];
            const videno = new Set();
            budouci.forEach(z => {
                const nazev = window.prelozFaziTurnaje ? window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) : (z.kolo || '');
                const cisty = String(nazev).trim();
                if (cisty && !videno.has(cisty)) {
                    videno.add(cisty);
                    kolaPoradi.push(cisty);
                }
            });
            return ['Nadcházející zápasy', ...kolaPoradi];
        },

        // 🎯 CENTRÁLNÍ PIPELINE PRO NADCHÁZEJÍCÍ ZÁPASY A VÝSLEDKY (ČISTÁ ČASOVÁ OSA S PRIORITOU MIN. 8 ZÁPASŮ)
        get dynamickyFeedZapasu() {
            if (this.matchViewMode === 'results') {
                const vyhodnocene = this.serazenaTimelineZapasu.filter(z => 
                    z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED'
                );
                const vybranaVolba = this.unikatniKolaVysledku[this.vysledkyKolaIndex] || 'Poslední zápasy';

                // 1. REŽIM VÝSLEDKŮ: POSLEDNÍ ZÁPASY (ČISTÁ REVERZNÍ CHRONOLOGIE DO MINULOSTI)
                if (this.vysledkyKolaIndex === 0 || vybranaVolba === 'Poslední zápasy') {
                    if (vyhodnocene.length === 0) return [];
                    const obracene = vyhodnocene.slice().reverse();
                    if (obracene.length <= 8) return obracene;

                    const vybraneVysledky = [];
                    let datumPoslednihoMs = 0;

                    for (let i = 0; i < obracene.length; i++) {
                        const z = obracene[i];
                        const zMs = z.datumMs || (z.datumObj ? z.datumObj.getTime() : 0);

                        if (vybraneVysledky.length < 8) {
                            vybraneVysledky.push(z);
                            datumPoslednihoMs = zMs;
                        } else {
                            // Dobereme zápasy ze stejného hracího dne (do 24 h od 8. zápasu), aby nebyl rozseknutý večer
                            if (datumPoslednihoMs && Math.abs(datumPoslednihoMs - zMs) <= 24 * 60 * 60 * 1000) {
                                vybraneVysledky.push(z);
                            } else {
                                break;
                            }
                        }
                    }
                    return vybraneVysledky;
                } else {
                    // Pevná kartotéka konkrétního kola z roletky
                    return vyhodnocene.filter(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) === vybranaVolba);
                }
            } else {
                const budouciZapasy = this.serazenaTimelineZapasu.filter(z => {
                    const jeVyhodnoceny = (z.vysledek_domaci !== undefined && z.apiStatus !== 'IN_PLAY' && z.apiStatus !== 'PAUSED');
                    const obaNeznamy = (z.domaci === 'Neznámý' && z.hoste === 'Neznámý');
                    return !jeVyhodnoceny && !obaNeznamy && !this.jeZapasOdlozenyBezTerminu(z);
                });

                const vybranaVolba = this.unikatniKolaProgramu[this.programKolaIndex] || 'Nadcházející zápasy';

                // 2. REŽIM PROGRAMU: NADCHÁZEJÍCÍ ZÁPASY (2 KOMPLETNÍ NEJBLIŽŠÍ KOLA)
                if (this.programKolaIndex === 0 || vybranaVolba === 'Nadcházející zápasy') {
                    const vybraneZapasy = [];
                    const nalezenaKola = new Set();

                    for (let i = 0; i < budouciZapasy.length; i++) {
                        const z = budouciZapasy[i];
                        const koloRaw = window.prelozFaziTurnaje ? window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) : (z.kolo || 'Šampionát');
                        const cisteKolo = String(koloRaw || 'Šampionát').trim();

                        if (!nalezenaKola.has(cisteKolo)) {
                            if (nalezenaKola.size >= 2) {
                                // Máme nasbíraná 2 celá nadcházející kola -> zde feed uzavíráme
                                break;
                            }
                            nalezenaKola.add(cisteKolo);
                        }
                        vybraneZapasy.push(z);
                    }
                    return vybraneZapasy;
                } else {
                    // Pevná kartotéka konkrétního kola z roletky (zde se zobrazí všechny zápasy daného kola včetně vzdálených dohrávek)
                    return budouciZapasy.filter(z => window.prelozFaziTurnaje(z.stage, z.kolo, z.isPlayoff) === vybranaVolba);
                }
            }
        },

        // 🧮 AUTOMATICKÝ SOUČET BODŮ (POUZE PRO SKUTEČNĚ UKONČENÉ A VYHODNOCENÉ ZÁPASY)
        get bodyAktualnihoFeedu() {
            const feed = this.serazenaTimelineZapasu;
            if (!feed || feed.length === 0) return 0;
            const league = this.selectedLeague;
            let total = 0;

            feed.forEach(match => {
                const isEvaluated = match.vysledek_domaci !== undefined && 
                                    match.vysledek_domaci !== null && 
                                    match.apiStatus !== 'IN_PLAY' && 
                                    match.apiStatus !== 'PAUSED' && 
                                    match.apiStatus !== 'POSTPONED';

                if (isEvaluated) {
                    const tip = this.mojeTipy[match.id];
                    const tDomaci = tip ? tip.tip_domaci : undefined;
                    const tHoste = tip ? tip.tip_hoste : undefined;
                    const tPostup = tip ? tip.postup : '';
                    const jeNenatipovano = tDomaci === undefined || tDomaci === null || tDomaci === '';

                    if (jeNenatipovano) {
                        const pravidla = window.PRAVIDLA_LIG?.[league] || window.PRAVIDLA_LIG?.["DEFAULT"];
                        total += (pravidla?.penaltyNenatipovano || 0);
                    } else if (typeof window.vypocitejBodyZapasu === 'function') {
                        total += window.vypocitejBodyZapasu(tDomaci, tHoste, match.vysledek_domaci, match.vysledek_hoste, league, tPostup, match.postup, match.isPlayoff, match.isTopMatch);
                    }
                }
            });

            return total;
        },

        _rozpisData: null,
        _leaderboardData: null,

        get rozpisData() { return this._rozpisData; },
        set rozpisData(val) {
            this._rozpisData = val;
            this.obnovCacheTimeline();
        },

        get leaderboardData() { return this._leaderboardData; },
        set leaderboardData(val) {
            this._leaderboardData = val;
        }
    });
    
    // Aktivujeme kompletní navigační strom funkcí
    initTipniToAlpine();

    // 🚀 Aktivujeme kontrolu nepřečtených novinek
    Alpine.store('appState').obnovChangelogStav();

    // 📡 ODLEHČENÝ SPOUŠTĚČ RADARŮ: Spustí se až při reálném vstupu na herní obrazovku
	let _realtimeRadarySpusteny = false;
	window.spustGlobalniRealtimeRadary = () => {
		if (_realtimeRadarySpusteny) return;
		_realtimeRadarySpusteny = true;

		const statusRef = rtdbRef(rtdb, 'status');
		onRtdbValue(statusRef, (snap) => {
			const data = snap.val() || {};
			const allUids = Object.keys(data);
			const onlineUids = allUids.filter(uid => data[uid] && data[uid].online === true);
			const store = Alpine.store('appState');
			if (store) {
				store.communityOnline = onlineUids.length;
				store.onlineUidsSet = new Set(onlineUids);
				store.communityPresenceMap = data;
				const myUid = window.auth?.currentUser?.uid;
				if (myUid && data[myUid] && typeof data[myUid].richGraphics === 'boolean') {
					if (store.fanGraphics !== data[myUid].richGraphics) {
						store.fanGraphics = data[myUid].richGraphics;
						localStorage.setItem('tipni_fan_graphics', data[myUid].richGraphics ? 'true' : 'false');
						store.leagueFilterTick++;
					}
				}
				if (typeof window.obnovZivouPritomnostSuperAdmin === 'function') {
					window.obnovZivouPritomnostSuperAdmin();
				}
			}
		});

		const liveTicksRef = rtdbRef(rtdb, 'live_ticks');
		onRtdbValue(liveTicksRef, (snap) => {
			const data = snap.val() || {};
			const store = Alpine.store('appState');
			if (store) {
				store.liveTicks = data;
			}
		});

		const hofPulseRef = rtdbRef(rtdb, 'system/hof_pulse');
		let isFirstHofPulse = true;
		onRtdbValue(hofPulseRef, async (snap) => {
			if (isFirstHofPulse) {
				isFirstHofPulse = false;
				return;
			}
			const store = Alpine.store('appState');
			if (!store) return;
			const sezId = store.activeSeason || window.SEZONA_ID || "2026_2027";
			try {
				const res = await fetch(`${CONFIG.R2_BASE_URL}/sezony/${sezId}/hall_of_fame.json?v=${Date.now()}`);
				if (res.ok) {
					const freshHof = await res.json();
					store.hallOfFameData = freshHof;
					try { localStorage.setItem(`tipni_cache_hof_${sezId}`, JSON.stringify(freshHof)); } catch(e){}
					const currentUid = window.auth?.currentUser?.uid;
					const meInHof = (freshHof.all || freshHof.players)?.find(p => p.uid === currentUid);
					if (meInHof) {
						store.myOvr = meInHof.masterOvr || meInHof.ovr;
						localStorage.setItem('tipni_cache_my_ovr', String(store.myOvr));
					} else {
						store.myOvr = 0;
						localStorage.removeItem('tipni_cache_my_ovr');
					}
					if (store.currentScreen === 'hallOfFameScreen' && typeof window.renderHallOfFame === 'function') {
						window.renderHallOfFame(window.hofActiveFilter || 'ALL');
					}
				}
			} catch(e) {}
		});

		const guestPresenceRef = rtdbRef(rtdb, 'guest_presence');
		onRtdbValue(guestPresenceRef, (snap) => {
			const data = snap.val() || {};
			const count = Object.keys(data).length;
			const store = Alpine.store('appState');
			if (store) {
				store.guestOnlineCount = count;
				if (typeof window.obnovZivouPritomnostSuperAdmin === 'function') {
					window.obnovZivouPritomnostSuperAdmin();
				}
			}
		});

		const guestStatsRef = rtdbRef(rtdb, 'guest_stats');
		onRtdbValue(guestStatsRef, (snap) => {
			const data = snap.val() || {};
			const store = Alpine.store('appState');
			if (store) {
				store.guestTotalVisits = data.total || 0;
				store.guestLastSeen = data.lastSeen || null;
				if (typeof window.obnovZivouPritomnostSuperAdmin === 'function') {
					window.obnovZivouPritomnostSuperAdmin();
				}
			}
		});

		const globalPulseRef = rtdbRef(rtdb, 'system/leagues_pulse');
		let isFirstGlobalPulse = true;
		onRtdbValue(globalPulseRef, (snap) => {
			const pulses = snap.val() || {};
			if (isFirstGlobalPulse) {
				isFirstGlobalPulse = false;
				Object.entries(pulses).forEach(([lKlic, p]) => {
					if (p?.ts) window.lastKnownPulsSignatures[p.league || lKlic.replace(/_/g, ' ')] = p.ts;
				});
				return;
			}

			const store = Alpine.store('appState');
			if (!store) return;

			Object.entries(pulses).forEach(([lKlic, pData]) => {
				if (!pData || !pData.ts) return;
				const lName = pData.league || lKlic.replace(/_/g, ' ');

				if (store.selectedLeague === lName) return;

				const staryTs = window.lastKnownPulsSignatures[lName] || 0;
				if (pData.ts > staryTs) {
					window.lastKnownPulsSignatures[lName] = pData.ts;

					const sezId = store.activeSeason || window.SEZONA_ID || "2026_2027";
					const aktualizujCacheNaPozadi = async () => {
						try {
							const res = await fetch(`${CONFIG.R2_BASE_URL}/sezony/${sezId}/${lKlic}/rozpis.json?v=${pData.ts}`);
							if (res.ok) {
								const freshRozpis = await res.json();
								if (store.leaguesMemoryCache?.[lName]) {
									store.leaguesMemoryCache[lName].rozpisData = freshRozpis;
								}
								try { localStorage.setItem(`tipni_cache_rozpis_${sezId}_${lKlic}`, JSON.stringify(freshRozpis)); } catch(e){}
								store.leagueFilterTick++;
							}
						} catch(e) {}
					};

					if ('requestIdleCallback' in window) {
						window.requestIdleCallback(aktualizujCacheNaPozadi);
					} else {
						requestAnimationFrame(aktualizujCacheNaPozadi);
					}
				}
			});
		});
	};
};

if (window.Alpine) {
    vstrikniStoresDoPameti();
} else {
    document.addEventListener('alpine:init', vstrikniStoresDoPameti);
}

// 🏷️ PŘÍJEM CENTRÁLNÍ VERZE & AUTOMATICKÝ ENGINE AKTUALIZACÍ (ZERO DOWNTIME)
let isAppReloading = false;
window.pendingAppReload = false;

if ('serviceWorker' in navigator) {
    // 1. Řádná registrace Service Workera a uložení instance pro ping
    navigator.serviceWorker.register('/sw.js').then((reg) => {
        window.swRegistration = reg;
        reg.update().catch(() => {});

        if (reg.active) {
            reg.active.postMessage({ type: 'GET_VERSION' });
        }
    }).catch(err => console.error("❌ SW Registrace selhala:", err));

    navigator.serviceWorker.ready.then((reg) => {
        window.swRegistration = reg;
        if (reg.active) {
            reg.active.postMessage({ type: 'GET_VERSION' });
        }
    });

    // 2. Příjem verze pro zobrazení v pravém dolním rohu
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'APP_VERSION') {
            const ver = event.data.version;
            const store = window.Alpine?.store('appState');
            if (store) store.appVersion = ver;
            localStorage.setItem('tipni_app_version', ver);
        }
    // 🖼️ ŽIVÁ VÝMĚNA LOGA NA DISPLEJI (BEZ NUTNOSTI REFRESHOVAT STRÁNKU)
        if (event.data && event.data.type === 'AUTO_IMAGE_UPDATED') {
            const updatedUrl = event.data.url;
            document.querySelectorAll('img').forEach((img) => {
                if (img.src && img.src.split('?')[0] === updatedUrl.split('?')[0]) {
                    img.src = `${updatedUrl}?t=${Date.now()}`;
                }
            });
        }

        // 🔔 BLESKOVÝ SKOK Z NOTIFIKACE (PŘI BĚHU NA POZADÍ)
        if (event.data && event.data.type === 'PUSH_NOTIFICATION_CLICK' && event.data.url) {
            try {
                const u = new URL(event.data.url, window.location.origin);
                const leagueParam = u.searchParams.get('league');
                const targetScreen = u.hash ? u.hash.replace('#', '') : 'matchesScreen';
                const cleanLeague = leagueParam ? decodeURIComponent(leagueParam).replace(/_/g, " ") : null;

                const store = window.Alpine?.store('appState');
                if (store) {
                    if (cleanLeague && typeof window.selectLeague === 'function') {
                        window.selectLeague(cleanLeague, targetScreen);
                    } else if (typeof window.goToScreen === 'function') {
                        window.goToScreen(targetScreen);
                    }
                }
            } catch (err) {
                console.warn("Chyba navigace z notifikace:", err);
            }
        }
    });

    // 3. 🚀 AUTOMATICKÝ SIGNÁL: Jakmile nový SW převezme vládu, provedeme tichý reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isAppReloading) return;
        isAppReloading = true;

        // 🛡️ OCHRANNÝ ŠTÍT: Pokud má hráč zrovna rozepsaný formulář, reload počká
        if (window.isAppFormDirty) {
            window.pendingAppReload = true;
            console.log("⏳ DETEKOVÁNA NOVÁ VERZE: Formulář rozepsán, reload odložen po uložení.");
        } else {
            console.log("🚀 DETEKOVÁNA NOVÁ VERZE: Provádím automatický bleskový update...");
            window.location.reload();
        }
    });
}

// 🛡️ INTELIGENTNÍ SÍŤOVÝ JISTIČ (Balíček 3): Na localhostu App Check vypínáme, abychom zlikvidovali chybu 403 a odemkli možnost okamžitého přihlášení.
if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider('6LemMiEtAAAAAH_PrIFI0yeP06zY1IQoelK9-q8K'),
        isTokenAutoRefreshEnabled: true
    });
    console.log("🛡️ APP CHECK: Finanční štít aktivován pro produkční stadion.");
} else {
    console.log("🐛 APP CHECK BYPASS: Detekován lokální stadion. App Check dočasně odpojen pro bezchybný login.");
}

console.log("⚽ TIPNI TO! úspěšně propojeno přes moderní Firebase v11 SDK s čistou offline cache.");
// Globalni odhlašovače živých radarů
window.globalLiveMenuUnsubscribe = null;

// 🛡️ DYNAMICKÝ LAZY-LOADING PRO ADMIN MODUL (Pouze pro oprávněné)
let adminModulePromise = null;
window.nacistAdminModul = () => {
    if (!adminModulePromise) {
        adminModulePromise = import('./admin.js');
    }
    return adminModulePromise;
};

// --- ALPINE.JS INITIALIZATION ---
const initTipniToAlpine = () => {

    // ⚡ BLESKOVÉ CDN ÚLOŽIŠTĚ PRO ŽEBŘÍČKY A ROZPISY (CLOUDFLARE R2)
    const R2_BASE_URL = CONFIG.R2_BASE_URL;
    window.liveIntervalRadar = null;
    window.SEZONA_ID = localStorage.getItem('savedSeason') || "2026_2027";
    // ⚙️ PŘEPÍNAČ ZOBRAZOVÁNÍ ANKET V NASTAVENÍ
    window.toggleShowSurveys = async (checked) => {
        const store = Alpine.store('appState');
        const user = window.auth?.currentUser;
        if (store) store.showSurveys = checked;
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                showSurveys: checked
            });
            if (typeof window.showToast === 'function') {
                window.showToast(checked ? "🔔 Ankety povoleny." : "🔕 Ankety vypnuty.");
            }
            if (checked && typeof window.zkontrolujAktivniAnketu === 'function') {
                window.zkontrolujAktivniAnketu();
            }
        } catch (e) {
            console.error("Chyba nastavení anket:", e);
        }
    };

    // 🔔 PŘEPÍNAČ NOTIFIKACÍ PŘED VÝKOPEM (ČISTÝ R2 ZÁPIS PŘES CLOUD FUNCTION)
    window.toggleUntippedNotifications = async (checked) => {
        const store = Alpine.store('appState');
        const user = window.auth?.currentUser;
        if (!user || !store) return;

        const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const togglePushCF = httpsCallable(window.functions, 'togglePushSubscriptionCF');

        if (!checked) {
            store.notifyUntipped = false;
            localStorage.setItem('tipni_notify_untipped', 'false');
            try {
                await togglePushCF({ enabled: false });
                window.showToast("🔕 Upozornění před začátkem zápasu vypnuto.");
            } catch (e) {
                console.error("Chyba vypnutí notifikací:", e);
            }
            return;
        }

        if (!('Notification' in window)) {
            window.showToast("Tento prohlížeč nepodporuje notifikace ❌", true);
            store.notifyUntipped = false;
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            window.showToast("Oprávnění pro notifikace bylo zamítnuto 🔕", true);
            store.notifyUntipped = false;
            return;
        }

        window.showToast("⏳ Registruji zařízení pro push notifikace...", false);

        try {
            const reg = await navigator.serviceWorker.ready;
            const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging.js");
            
            const messaging = getMessaging(window.app);
            const token = await getToken(messaging, {
                serviceWorkerRegistration: reg,
                vapidKey: CONFIG.VAPID_KEY
            });

            if (!token) throw new Error("Nepodařilo se vygenerovat registrační token.");

            await togglePushCF({ enabled: true, token: token });

            store.notifyUntipped = true;
            localStorage.setItem('tipni_notify_untipped', 'true');
            window.showToast("🔔 Upozornění před začátkem zápasu úspěšně aktivováno!");
        } catch (err) {
            console.error("Chyba aktivace push notifikací:", err);
            store.notifyUntipped = false;
            window.showToast("❌ Chyba aktivace: " + (err.message || "Registrace selhala"), true);
        }
    };

    // 🗑️ IN-APP VÝMAZ ÚČTU (POVINNÉ PRO GOOGLE PLAY)
    window.deleteMyAccount = async () => {
        const potvrdil = confirm("🚨 OPRAVDU CHCEŠ TRVALE SMAZAT SVŮJ ÚČET?\n\nTato akce je nevratná. Tvůj přihlašovací účet i e-mail budou okamžitě zničeny. Tvé odehrané body v probíhajících soutěžích zůstanou zafixované pod anonymním označením, aby se nerozbila tabulka ostatním hráčům.");
        if (!potvrdil) return;

        if (typeof window.showSplash === 'function') window.showSplash("Mažu účet...");

        try {
            const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
            const deleteMyAccountCF = httpsCallable(window.functions, 'deleteMyAccountCF');
            await deleteMyAccountCF();

            localStorage.clear();
            alert("Tvůj účet byl úspěšně smazán. Děkujeme za účast ve hře!");
            window.location.reload();
        } catch (err) {
            console.error("Chyba při mazání účtu:", err);
            if (typeof window.hideSplash === 'function') window.hideSplash();
            window.showToast("❌ Chyba při mazání účtu: " + (err.message || "Požadavek selhal"), true);
        }
    };

    // 📊 REAKTIVNÍ ENGINE DYNAMICKÝCH ANKET (REALTIME STREAM S DETERMINISTICKÝM LIFECYCLE)
    window.activeSurveyUnsubscribe = window.activeSurveyUnsubscribe || null;

    window.zkontrolujAktivniAnketu = () => {
        const store = Alpine.store('appState');
        const user = window.auth?.currentUser;

        // Pokud jsou ankety v nastavení vypnuty, uživatel je host nebo odhlášen, odpojíme stream
        if (!store || !user || store.showSurveys === false || store.isGuest) {
            if (window.activeSurveyUnsubscribe) {
                window.activeSurveyUnsubscribe();
                window.activeSurveyUnsubscribe = null;
            }
            store.activeSurveyData = null;
            store.surveyModalOpen = false;
            return;
        }

        // Idempotentní pojistka: zabrání duplicitnímu odběru téhož dokumentu
        if (window.activeSurveyUnsubscribe) return;

        const surveyRef = doc(db, "ankety", "aktivni");

        window.activeSurveyUnsubscribe = onSnapshot(surveyRef, async (surveySnap) => {
            // Pokud dokument v databázi neexistuje, modal zůstává zavřený bez chyb
            if (!surveySnap.exists()) {
                store.activeSurveyData = null;
                store.surveyModalOpen = false;
                return;
            }

            const sData = surveySnap.data();
            if (sData.isOpen === false || sData.stav === 'UZAVRENO') {
                store.activeSurveyData = null;
                store.surveyModalOpen = false;
                return;
            }

            // 1. Kontrola časového limitu (Deadlinu)
            if (sData.konecDatum) {
                const kMs = sData.konecDatum.toDate ? sData.konecDatum.toDate().getTime() : (sData.konecDatum.seconds ? sData.konecDatum.seconds * 1000 : new Date(sData.konecDatum).getTime());
                if (kMs && Date.now() > kMs) {
                    store.activeSurveyData = null;
                    store.surveyModalOpen = false;
                    return;
                }
                
                const dObj = new Date(kMs);
                sData.konecText = `${dObj.getDate()}. ${dObj.getMonth() + 1}. ${String(dObj.getHours()).padStart(2, '0')}:${String(dObj.getMinutes()).padStart(2, '0')}`;
            }

            // 2. Kontrola cílových soutěží
            const cilove = sData.ciloveLigy || ['all'];
            if (!cilove.includes('all')) {
                const userLeagues = store._leagues || store.leagues || [];
                const maOpravnenouLigu = cilove.some(l => userLeagues.includes(l));
                if (!maOpravnenouLigu) {
                    store.activeSurveyData = null;
                    store.surveyModalOpen = false;
                    return;
                }
            }

            // 3. Kontrola hlasu uživatele
            try {
                const voteRef = doc(db, "ankety", "aktivni", "hlasy", user.uid);
                const voteSnap = await getDoc(voteRef);
                if (voteSnap.exists()) {
                    store.activeSurveyData = null;
                    store.surveyModalOpen = false;
                    return;
                }
            } catch (err) {
                return;
            }

            store.activeSurveyData = sData;
            store.surveyModalOpen = true;
        }, (err) => {
            if (err.code !== 'permission-denied') {
                console.warn("Anketa realtime stream notice:", err.message);
            }
        });
    };

    window.submitDynamicSurveyVote = async (optionIndex, optionText) => {
        const store = Alpine.store('appState');
        const user = window.auth?.currentUser;
        if (!user || !store) return;

        const nick = store.nickname || document.getElementById('userMenuNickname')?.textContent || 'Hráč';
        store.surveyModalOpen = false;

        try {
            const voteRef = doc(db, "ankety", "aktivni", "hlasy", user.uid);
            await setDoc(voteRef, {
                uid: user.uid,
                nickname: nick,
                optionIndex: optionIndex,
                optionText: optionText || '',
                hlasovanoAt: serverTimestamp()
            });
            if (typeof window.showToast === 'function') {
                window.showToast(optionIndex === 'declined' ? "Volba uložena." : "Díky za tvůj hlas v anketě! 🗳️");
            }
        } catch (e) {
            console.error("Chyba zápisu hlasu:", e);
            if (typeof window.showToast === 'function') {
                window.showToast("❌ Hlasování již skončilo nebo nastala chyba.", true);
            }
        }
    };

    window.skipDynamicSurvey = () => {
        const store = Alpine.store('appState');
        if (store) store.surveyModalOpen = false;
    };

    window.goToScreen = async (screenName, pushHistory = true) => {
        if (window.pendingAppReload && !window.isAppFormDirty) {
            window.location.reload();
            return;
        }

        const store = Alpine.store('appState');
        store.showScrollTop = false;

        if (screenName === 'adminScreen' || screenName === 'superAdminScreen' || screenName === 'loutkovodicScreen') {
            await window.nacistAdminModul();
        }

            // 🚀 BLESKOVÝ START: Realtime WebSockety zapneme až po opuštění úvodních načítacích clon
		if (screenName !== 'splashScreen' && screenName !== 'loginScreen' && screenName !== 'nicknameScreen') {
			if (typeof window.spustGlobalniRealtimeRadary === 'function') {
				window.spustGlobalniRealtimeRadary();
			}
		}

		// 🔒 AUTO-RESET: Při odchodu ze žebříčku automaticky zavřeme roletku rekordů i všechny rozbalené karty hráčů
		if (screenName !== 'leaderboardScreen') {
			window.leaderboardRecordsOpen = false;
			window.rozbaleneUidsCacheGlobal = [];
		}

            // 🔒 AUTO-RESET ADMIN & SUPERADMIN: Zavření všech roletek hráčů
            store.adminOpenedUserId = null;
            document.querySelectorAll('#superAdminUsersRoletyWrapper .leaderboard-row-dropdown').forEach(el => {
                el.style.display = 'none';
            });
            document.querySelectorAll('#superAdminUsersRoletyWrapper .super-arrow-icon').forEach(el => {
                el.innerText = '▼';
            });

            // 🚨 BALÍČEK 4: HYBRIDNÍ SÍŤOVÝ RADAR (Uspávání pro ochranu administrace)
            if (screenName === 'adminScreen' || screenName === 'superAdminScreen') {
                if (typeof window.globalLiveMenuUnsubscribe === 'function') {
                    window.globalLiveMenuUnsubscribe();
                }
            } else if (store.selectedLeague && typeof window.naplanujZiveKanaly === 'function') {
                window.naplanujZiveKanaly(store.selectedLeague);
            }

            if (screenName === 'adminScreen' && !store.isAdmin) {
                store.currentScreen = 'leaguesScreen';
                localStorage.setItem('savedScreen', 'leaguesScreen');
                if (typeof window.hideSplash === 'function') window.hideSplash();
                return;
            }
            if (screenName === 'superAdminScreen' && !store.isSuperAdmin) {
                store.currentScreen = 'leaguesScreen';
                localStorage.setItem('savedScreen', 'leaguesScreen');
                if (typeof window.hideSplash === 'function') window.hideSplash();
                return;
            }

            store.currentScreen = screenName;
            store.isMenuOpen = false;

            if (screenName !== 'splashScreen' && screenName !== 'loginScreen' && screenName !== 'nicknameScreen') {
                localStorage.setItem('savedScreen', screenName);
                if (pushHistory) {
                    const curSt = history.state;
                    const nSt = {
                        screen: screenName,
                        mode: store.matchViewMode || 'upcoming',
                        league: store.selectedLeague || null
                    };
                    if (!curSt || curSt.screen !== nSt.screen || curSt.mode !== nSt.mode || curSt.league !== nSt.league) {
                        history.pushState(nSt, '', '#' + screenName);
                    }
                }
            }
            
            if (screenName === 'leaguesScreen') {
                store.selectedLeague = null;
                store.selectedAdminLeague = null;
                store.isLive = false;
                localStorage.removeItem('savedLeague');
                if (typeof window.globalLiveMenuUnsubscribe === 'function') { window.globalLiveMenuUnsubscribe(); }
                if (window.globalLiveRozpisUnsubscribe) { window.globalLiveRozpisUnsubscribe(); window.globalLiveRozpisUnsubscribe = null; }
            }
            
            if (screenName === 'leaguesScreen' || screenName === 'hallOfFameScreen') {
                document.querySelectorAll('.league-themed-screen').forEach(el => el.style.setProperty('--league-bg', 'none'));
            }

            if (screenName === 'hallOfFameScreen') {
                store.selectedLeague = null;
                store.selectedAdminLeague = null;
                if (typeof window.renderHallOfFame === 'function') {
                    window.renderHallOfFame('ALL');
                }
                const hofScreen = document.getElementById('hallOfFameScreen');
                if (hofScreen) hofScreen.scrollTop = 0;
                // 🚀 POZADÍ: Tichá kontrola čerstvosti dat z R2 (proti uvíznutí ve staré cache)
                const sezId = store.activeSeason || window.SEZONA_ID || "2026_2027";
                fetch(`${CONFIG.R2_BASE_URL}/sezony/${sezId}/hall_of_fame.json?v=${Date.now()}`)
                    .then(res => res.ok ? res.json() : null)
                    .then(freshHof => {
                        if (freshHof) {
                            store.hallOfFameData = freshHof;
                            try { localStorage.setItem(`tipni_cache_hof_${sezId}`, JSON.stringify(freshHof)); } catch(e){}
                            const currentUid = window.auth?.currentUser?.uid;
                            const meInHof = (freshHof.all || freshHof.players)?.find(p => p.uid === currentUid);
                            if (meInHof) {
                                store.myOvr = meInHof.masterOvr || meInHof.ovr;
                                localStorage.setItem('tipni_cache_my_ovr', String(store.myOvr));
                            }
                            if (store.currentScreen === 'hallOfFameScreen' && typeof window.renderHallOfFame === 'function') {
                                window.renderHallOfFame(window.hofActiveFilter || 'ALL');
                            }
                        }
                    })
                    .catch(() => {});
            }

            if (screenName === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                window.leaderboardActiveSubTab = 'table';
                window.renderLeaderboard(true);
                const lbScreen = document.getElementById('leaderboardScreen');
                if (lbScreen) lbScreen.scrollTop = 0; 
            }
            
            if (screenName === 'scoringScreen' && typeof window.renderScoring === 'function') {
                window.renderScoring();
            }
            
            if (screenName === 'matchesScreen' && store.selectedLeague && typeof window.renderMatches === 'function') {
                window.renderMatches(store.selectedLeague);
                if (typeof window.loadBonusTips === 'function') {
                    window.loadBonusTips(store.selectedLeague);
                }
                const bonusBox = document.querySelector('.bonus-collapse-box');
                if (bonusBox && window.Alpine) { Alpine.$data(bonusBox).open = false; } 
                const mScreen = document.getElementById('matchesScreen');
                if (mScreen) mScreen.scrollTop = 0; 
            }

            if (screenName === 'cupScreen' && typeof window.renderCupScreen === 'function') {
                const lName = store.selectedLeague || localStorage.getItem('savedLeague') || 'Premier League';
                window.renderCupScreen(lName);
            }

            if (screenName === 'profileScreen' && typeof window.renderPlayerProfile === 'function') {
                window.renderPlayerProfile(store.profileTargetUid);
            }

            if (screenName === 'superAdminScreen' && typeof window.renderSuperAdmin === 'function') {
                window.renderSuperAdmin();
            }
            
            if (screenName === 'adminScreen') {
                store.selectedLeague = null;
                // 🎯 RESET DRŽÁKU POZICE PŘI VSTUPU DO ADMINU ODJINUD
                window.adminLeagueKoloInitialized = false;
                store.selectedAdminLeague = null;
                store.adminActiveTab = 'users';
                if (typeof window.renderAdminMatches === 'function') {
                    window.renderAdminMatches();
                }
            }

            // 👑 UNIVERSÁLNÍ SCROLL JISTIČ: Počká na dokončení Alpine cyklu a zaručí 100% čistý start každé obrazovky od nuly
            if (typeof window.hideSplash === 'function') {
                if (typeof Alpine !== 'undefined' && Alpine.nextTick) {
                    Alpine.nextTick(() => {
                        window.hideSplash();
                        const scr = document.getElementById(screenName);
                        if (scr) scr.scrollTop = 0;
                    });
                } else {
                    window.hideSplash();
                    const scr = document.getElementById(screenName);
                    if (scr) scr.scrollTop = 0;
                }
            } else {
                const scr = document.getElementById(screenName);
                if (scr) scr.scrollTop = 0;
            }
        };

    // Seniorní enterprise překladový engine s inteligentní detekcí vyřazovacích bojů
    window.prelozFaziTurnaje = (stage, kolo, isPlayoff) => {
        const s = String(stage || '').toUpperCase();
        if (s === 'LAST_32') return 'Šestnáctifinále';
        if (s === 'LAST_16') return 'Osmifinále';
        if (s === 'QUARTER_FINALS') return 'Čtvrtfinále';
        if (s === 'SEMI_FINALS') return 'Semifinále';
        if (s === 'THIRD_PLACE') return 'Zápas o 3. místo';
        if (s === 'FINAL') return 'Finále';
        
        if (isPlayoff) return 'Play-off';

        const k = String(kolo || '').trim();
        if (k && k !== 'Šampionát') return k;
        
        return 'Základní skupiny';
    };

       // 🎯 LOGICKÝ KARUSEL VÝSLEDKŮ: ◀ DOLEVA (MINULOST / STARŠÍ KOLA) | ▶ DOPRAVA (NOVĚJŠÍ KOLA / NEJNOVĚJŠÍ)
    window.posunKoloVysledky = (smer) => {
        const store = Alpine.store('appState');
        if (!store || !store.unikatniKolaVysledku || store.unikatniKolaVysledku.length === 0) return;

        // ◀ KLIK DOLEVA (Do minulosti / k nižším / starším kolům)
        if (smer < 0) {
            // Z "Poslední zápasy" (Index 0) skočíme na první starší kolo, které už není v posledních 2 kolech
            if (store.vysledkyKolaIndex === 0) {
                const posl2 = store.posledni2KolaVysledku || [];
                let targetIdx = 1;
                while (targetIdx < store.unikatniKolaVysledku.length) {
                    const koloNazev = store.unikatniKolaVysledku[targetIdx];
                    if (!posl2.includes(koloNazev)) {
                        break;
                    }
                    targetIdx++;
                }
                if (targetIdx < store.unikatniKolaVysledku.length) {
                    store.vysledkyKolaIndex = targetIdx;
                } else if (store.unikatniKolaVysledku.length > 1) {
                    store.vysledkyKolaIndex = 1;
                }
                return;
            }

            // Z konkrétního kola jdeme dál do minulosti (zvětšujeme index v poli unikatniKolaVysledku)
            let novyIndex = store.vysledkyKolaIndex + 1;
            if (novyIndex < store.unikatniKolaVysledku.length) {
                store.vysledkyKolaIndex = novyIndex;
            }
        } 
        // ▶ KLIK DOPRAVA (K novějším kolům / k nejnovějšímu stavu)
        else if (smer > 0) {
            // Snižujeme index (např. 1. kolo -> 2. kolo -> 3. kolo -> 4. kolo -> Poslední zápasy)
            let novyIndex = store.vysledkyKolaIndex - 1;
            if (novyIndex >= 0) {
                store.vysledkyKolaIndex = novyIndex;
            }
        }
    };

    // 🎯 CHYTRÝ KARUSEL PROGRAMU: Skok z "Nadcházející zápasy" (Index 0) přeskočí všechna již zobrazená kola
    window.posunKoloProgram = (smer) => {
        const store = Alpine.store('appState');
        if (!store || !store.unikatniKolaProgramu || store.unikatniKolaProgramu.length === 0) return;

        // Skok DOPRAVA z "Nadcházející zápasy" (Index 0)
        if (smer > 0 && store.programKolaIndex === 0) {
            const nej2 = store.nejblizsi2KolaProgramu || []; // Např. ["1. kolo", "2. kolo"]
            let targetIdx = 1;
            while (targetIdx < store.unikatniKolaProgramu.length) {
                const koloNazev = store.unikatniKolaProgramu[targetIdx];
                if (!nej2.includes(koloNazev)) {
                    break; // Najde první kolo, které NENÍ zobrazené na displeji (např. "3. kolo")
                }
                targetIdx++;
            }
            if (targetIdx < store.unikatniKolaProgramu.length) {
                store.programKolaIndex = targetIdx;
                return;
            } else {
                // Pokud jsou všechna nadcházející kola již na displeji, nikam dál neskáče
                return;
            }
        }

        // Standardní posun o krok
        let novyIndex = store.programKolaIndex + smer;
        if (novyIndex >= 0 && novyIndex < store.unikatniKolaProgramu.length) {
            store.programKolaIndex = novyIndex;
        }
    };

    // Čisté klientské přepínání stránek v karuselu Admin panelu
    window.posunKoloAdmin = (smer) => {
        const store = Alpine.store('appState');
        let novyIndex = store.adminKolaIndex + smer;
        if (novyIndex >= 0 && novyIndex < store.unikatniKolaAdminu.length) {
            store.adminKolaIndex = novyIndex;
        }
    };

    // ⦡ SMART SCROLL ENGINE: Najde aktivní běžící screen a plynule ho vyveze na absolutní vrchol
    window.scrollToTop = () => {
        const store = Alpine.store('appState');
        const aktivniScreenId = store.currentScreen;
        if (!aktivniScreenId) return;

        const kontejner = document.getElementById(aktivniScreenId);
        if (kontejner) {
            kontejner.scrollTo({
                top: 0,
                behavior: 'smooth' /* Plynulý prémiový dojezd bez trhání displeje */
            });
        }
    };

    // =========================================================================
    // ↕️ MANUÁLNÍ ŘAZENÍ SOUTĚŽÍ & SHOWROOM TOGGLER
    // =========================================================================
    window.toggleShowAllLeagues = (checked) => {
        const store = Alpine.store('appState');
        if (!store) return;
        store.showAllLeagues = Boolean(checked);
        localStorage.setItem('tipni_show_all_leagues', store.showAllLeagues ? 'true' : 'false');
        store.leagueFilterTick++;
        // Ihned aktualizujeme seznam v otevřeném modálu
        if (store.reorderModalOpen) {
            store.reorderList = [...store.leagues];
        }
    };

    window.openReorderLeaguesModal = () => {
        const store = Alpine.store('appState');
        if (!store || !store.leagues) return;
        store.reorderList = [...store.leagues];
        store.reorderModalOpen = true;
    };

    window.moveLeagueOrder = (index, direction) => {
        const store = Alpine.store('appState');
        if (!store || !store.reorderList) return;
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= store.reorderList.length) return;
        
        const list = [...store.reorderList];
        const [movedItem] = list.splice(index, 1);
        list.splice(newIndex, 0, movedItem);
        store.reorderList = list;
    };

    window.saveLeagueOrder = async () => {
        const store = Alpine.store('appState');
        const currentUser = window.auth?.currentUser;
        if (!store || !currentUser) return;

        // ⏱️ FRONTEND COOLDOWN KONTROLA (24 HODIN)
        const lastChange = store.lastLeagueOrderChange || 0;
        const now = Date.now();
        const cooldownMs = 24 * 60 * 60 * 1000;
        
        if (lastChange && (now - lastChange < cooldownMs) && !store.isSuperAdmin) {
            const zbyvaHodin = Math.ceil((cooldownMs - (now - lastChange)) / (60 * 60 * 1000));
            if (typeof window.showToast === 'function') {
                window.showToast(`Pořadí můžeš změnit až za ${zbyvaHodin} hod. ⏳`, true);
            }
            return;
        }

        try {
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, {
                leagueOrder: store.reorderList,
                lastLeagueOrderChange: serverTimestamp()
            });

            store.leagueOrder = [...store.reorderList];
            store.lastLeagueOrderChange = now;
            store.leagueFilterTick++; // 🔔 Bleskové překreslení katalogu a menu
            store.reorderModalOpen = false;

            if (typeof window.showToast === 'function') {
                window.showToast("✅ Pořadí tipovaček úspěšně uloženo!");
            }
        } catch (err) {
            console.error("Chyba při ukládání pořadí lig:", err);
            if (typeof window.showToast === 'function') {
                window.showToast("Změna byla zablokována (limit 24h) ❌", true);
            }
        }
    };
    
// ➕ PŘIPOJENÍ K SOUTĚŽI Z REŽIMU NÁHLEDU (DIVÁK -> TIPÉR)
        window.pripojitSeKLize = async (leagueName) => {
            const user = window.auth?.currentUser;
            const store = Alpine.store('appState');
            if (!user) {
                if (typeof window.showToast === 'function') window.showToast("⚠️ Pro účast v tipovačce se musíš přihlásit!", true);
                return;
            }
            if (!leagueName) return;

            if (typeof window.showSplash === 'function') {
                window.showSplash("Připojuji tě k soutěži...");
            }

            try {
                const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
                const joinLeagueCF = httpsCallable(window.functions, 'joinLeagueCF');
                await joinLeagueCF({ leagueName });

                if (store) {
                    const cur = store._leagues || [];
                    if (!cur.includes(leagueName)) {
                        store._leagues = [...cur, leagueName];
                        store.leagueFilterTick++;
                    }
                }

                if (typeof window.showToast === 'function') {
                    window.showToast(`🎉 Vítej v tipovačce ${leagueName}! Můžeš tipovat.`);
                }
            } catch (err) {
                console.error("Chyba při připojování k soutěži:", err);
                if (typeof window.showToast === 'function') {
                    window.showToast("❌ Chyba: " + (err.message || "Nepodařilo se připojit k soutěži."), true);
                }
            } finally {
                if (typeof window.hideSplash === 'function') {
                    window.hideSplash();
                }
            }
        };

    window.globalLivePulsUnsubscribe = window.globalLivePulsUnsubscribe || null;
    window.lastKnownPulsSignatures = window.lastKnownPulsSignatures || {};

    window.zapniZiveStreamy = (leagueName) => {
        if (window.globalLivePulsUnsubscribe) {
            window.globalLivePulsUnsubscribe();
            window.globalLivePulsUnsubscribe = null;
        }
        if (window.liveIntervalRadar) {
            clearInterval(window.liveIntervalRadar);
            window.liveIntervalRadar = null;
        }

        const store = Alpine.store('appState');
        const ligaKlic = String(leagueName || '').replace(/ /g, "_");
        const sezonaId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
        const pathPrefix = `sezony/${sezonaId}/${ligaKlic}`;

        const sosniDataZR2 = async () => {
            if (document.hidden) return;
            try {
                const keshRazitko = Date.now();
                const isChanceLiga = String(leagueName || '').toLowerCase().includes('chance');

                // ⚡ 1. KROK: Bleskové paralelní stažení HTTP odpovědí ze sítě
                const [resLb, resRozpis, resCup] = await Promise.all([
                    fetch(`${R2_BASE_URL}/${pathPrefix}/leaderboard.json?v=${keshRazitko}`),
                    fetch(`${R2_BASE_URL}/${pathPrefix}/rozpis.json?v=${keshRazitko}`),
                    isChanceLiga ? fetch(`${R2_BASE_URL}/${pathPrefix}/cup.json?v=${keshRazitko}`).catch(() => null) : Promise.resolve(null)
                ]);

                // ⚡ 2. KROK: Bleskové paralelní rozparsování všech JSONů současně
                const [lbData, rData, cData] = await Promise.all([
                    resLb && resLb.ok ? resLb.json().catch(() => null) : null,
                    resRozpis && resRozpis.ok ? resRozpis.json().catch(() => null) : null,
                    resCup && resCup.ok ? resCup.json().catch(() => null) : null
                ]);

                if (cData) {
                    if (!store.cupData) store.cupData = {};
                    store.cupData[leagueName] = cData;
                    window.tipniCupData = window.tipniCupData || {};
                    window.tipniCupData[leagueName] = cData;
                }

                let jeZivyZapas = false;

                if (rData) {
                    const staryAktualizovano = store._rozpisData?.aktualizovano;
                    const novyAktualizovano = rData.aktualizovano;

                    if (!staryAktualizovano || staryAktualizovano !== novyAktualizovano) {
                        store.rozpisData = rData;
                    }

                    jeZivyZapas = rData.isLive || Object.values(rData.zapasyMapa || {}).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                    store.isLive = jeZivyZapas;
                    if (!store.liveLeaguesMap) store.liveLeaguesMap = {};
                    store.liveLeaguesMap[leagueName] = Boolean(jeZivyZapas);
                    try { localStorage.setItem('tipni_cache_live_map', JSON.stringify(store.liveLeaguesMap)); } catch(e){}

                    if (!store.isLive && window.leaderboardActiveTab === 'live') {
                        window.leaderboardActiveTab = 'total';
                    }
                }

                if (lbData) {
                    const staryLbAktualizovano = store._leaderboardData?.aktualizovano;
                    const novyLbAktualizovano = lbData.aktualizovano;

                    if (!staryLbAktualizovano || staryLbAktualizovano !== novyLbAktualizovano) {
                        store.leaderboardData = lbData;
                        window.globalniZebricek = lbData.zebricek || [];
                        window.globalniZebricekLive = lbData.zebricekLive || [];
                        window.mapaPrezdivek = lbData.mapaPrezdivek || {};

                        if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                            window.renderLeaderboard();
                        }
                        if (store.currentScreen === 'cupScreen' && typeof window.renderCupScreen === 'function') {
                            window.renderCupScreen(leagueName);
                        }
                        if (store.currentScreen === 'profileScreen' && typeof window.renderPlayerProfile === 'function') {
                            window.renderPlayerProfile(store.profileTargetUid);
                        }
                    }
                }

                // ⚡ Uložení rozparsovaných objektů do L1 RAM pro instantní přepínání (0 ms)
                if (!store.leaguesMemoryCache) store.leaguesMemoryCache = {};
                store.leaguesMemoryCache[leagueName] = {
                    rozpisData: rData || store.rozpisData,
                    leaderboardData: lbData || store.leaderboardData,
                    cupData: cData || store.cupData?.[leagueName]
                };

                // 🔄 ZÁLOŽNÍ RADAR: Běží pouze v případě aktivního live zápasu
                if (jeZivyZapas && !window.liveIntervalRadar) {
                    window.liveIntervalRadar = setInterval(() => sosniDataZR2(), 20000);
                } else if (!jeZivyZapas && window.liveIntervalRadar) {
                    clearInterval(window.liveIntervalRadar);
                    window.liveIntervalRadar = null;
                }

            } catch (err) {
                console.warn("🚧 Cloudflare R2 Radar: Soubory se na serveru připravují.");
            }
        };

        // 🔴 BLESKOVÝ RTDB MAJÁK (0 FIRESTORE READS, 0 KČ, 10–20 ms WEBSOCKET ODEZVA)
        try {
            const leaguePulseRef = rtdbRef(rtdb, `system/leagues_pulse/${ligaKlic}`);
            let isFirstLeaguePulse = true;

            const rtdbUnsub = onRtdbValue(leaguePulseRef, (snap) => {
                const pData = snap.val();
                if (isFirstLeaguePulse) {
                    isFirstLeaguePulse = false;
                    if (pData?.ts) window.lastKnownPulsSignatures[leagueName] = pData.ts;
                    return;
                }

                if (pData && pData.ts && window.lastKnownPulsSignatures[leagueName] !== pData.ts) {
                    window.lastKnownPulsSignatures[leagueName] = pData.ts;
                    sosniDataZR2();
                    if (pData.type === 'groups' && typeof window.nactiMojePartickyProLigu === 'function') {
                        window.nactiMojePartickyProLigu(leagueName);
                    }
                }
            }, (err) => console.warn("RTDB Puls listener warning:", err));

            window.globalLivePulsUnsubscribe = rtdbUnsub;
        } catch(e) {}

        window.globalLiveMenuUnsubscribe = () => {
            if (typeof window.globalLivePulsUnsubscribe === 'function') {
                window.globalLivePulsUnsubscribe();
                window.globalLivePulsUnsubscribe = null;
            }
            if (window.liveIntervalRadar) {
                clearInterval(window.liveIntervalRadar);
                window.liveIntervalRadar = null;
            }
            window.globalLiveMenuUnsubscribe = null;
        };

        return sosniDataZR2();
    };

    window.naplanujZiveKanaly = async (lName) => {
        return window.zapniZiveStreamy(lName);
    };

    window.changeSeason = (sezonaId) => {
        const store = Alpine.store('appState');
        if (!store) return;
        
        store.activeSeason = sezonaId;
        localStorage.setItem('savedSeason', sezonaId);
        window.SEZONA_ID = sezonaId;

        const label = store.dostupneSezony.find(s => s.id === sezonaId)?.label || sezonaId;
        if (typeof window.showToast === 'function') {
            window.showToast(`📅 Přepnuto: ${label}`);
        }

        // 🎯 BLESKOVÝ RE-SUBSCRIBE SLUCHÁTKA TIPŮ PRO NOVOU SEZÓNU
        const currentUser = window.auth?.currentUser;
        if (currentUser && typeof window.obnovSluchatkoMojeTipy === 'function') {
            window.obnovSluchatkoMojeTipy(currentUser.uid);
        }

        if (store.selectedLeague) {
            if (window.globalLiveMenuUnsubscribe) { window.globalLiveMenuUnsubscribe(); window.globalLiveMenuUnsubscribe = null; }
            window.naplanujZiveKanaly(store.selectedLeague);
        }

        if (typeof window.prefetchVsechnyLigy === 'function') {
            window.prefetchVsechnyLigy();
        }
    };

    // 🏎️ PROFI SENIOR LEAGUE SELECTOR (EAGER PARALLEL BOOTSTRAP / 0 ms LATENCY)
    window.handleMenuLeagueClick = (leagueName) => {
        window.selectLeague(leagueName);
    };

    let isSelectingLeagueRunning = false;

    window.selectLeague = async (leagueName, targetScreen = 'matchesScreen') => {
        if (!leagueName || isSelectingLeagueRunning) return;
        isSelectingLeagueRunning = true;

        const store = Alpine.store('appState');

        try {
            // 🛑 OCHRANA ROZPRACOVANÝCH TIPŮ: Pokud hráč odchází z ligy, varujeme ho
            if (window.isAppFormDirty && store?.selectedLeague && store.selectedLeague !== leagueName) {
                if (store) store.isMenuOpen = false;
                if (typeof window.zobrazVarovnyModal === 'function') {
                    window.zobrazVarovnyModal(() => {
                        window.isAppFormDirty = false;
                        if (window.dirtyInputsRegistry) window.dirtyInputsRegistry.clear();
                        window.selectLeague(leagueName, targetScreen);
                    });
                    return;
                }
                window.isAppFormDirty = false;
                if (window.dirtyInputsRegistry) window.dirtyInputsRegistry.clear();
            }

            // 🔒 AUTO-RESET: Při změně ligy vždy startujeme se zavřenou roletkou rekordů i karet hráčů
            window.leaderboardRecordsOpen = false;
            window.rozbaleneUidsCacheGlobal = [];

            // 🚀 1. ÚROVEŇ: BLESKOVÝ VÝBĚR PŘÍMO Z L1 RAM PAMĚTI (0.001 ms)
            let maNacitanouKesi = false;
            const memoryHit = store.leaguesMemoryCache?.[leagueName];

            if (memoryHit && memoryHit.rozpisData) {
                store.rozpisData = memoryHit.rozpisData;
                if (memoryHit.leaderboardData) store.leaderboardData = memoryHit.leaderboardData;
                if (memoryHit.cupData) {
                    if (!store.cupData) store.cupData = {};
                    store.cupData[leagueName] = memoryHit.cupData;
                    window.tipniCupData = window.tipniCupData || {};
                    window.tipniCupData[leagueName] = memoryHit.cupData;
                }
                maNacitanouKesi = true;
            } else {
                // 💽 2. ÚROVEŇ: ZÁLOŽNÍ RYCHLÁ KONTROLA Z DISKU (LOCALSTORAGE)
                const sezId = store.activeSeason || window.SEZONA_ID || "2026_2027";
                const lKlic = String(leagueName).replace(/ /g, "_");
                try {
                    const cachedRozpis = localStorage.getItem(`tipni_cache_rozpis_${sezId}_${lKlic}`);
                    const cachedLb = localStorage.getItem(`tipni_cache_lb_${sezId}_${lKlic}`);
                    if (cachedRozpis) {
                        const parsedR = JSON.parse(cachedRozpis);
                        const parsedLb = cachedLb ? JSON.parse(cachedLb) : null;
                        store.rozpisData = parsedR;
                        if (parsedLb) store.leaderboardData = parsedLb;
                        if (!store.leaguesMemoryCache) store.leaguesMemoryCache = {};
                        store.leaguesMemoryCache[leagueName] = { rozpisData: parsedR, leaderboardData: parsedLb };
                        maNacitanouKesi = true;
                    }
                } catch (e) {}
            }

            if (!maNacitanouKesi && typeof window.showSplash === 'function') {
                window.showSplash("Načítání...");
            }

            store.selectedLeague = leagueName;
            store.selectedAdminLeague = null;
            store.currentScreen = targetScreen;
            if (targetScreen === 'matchesScreen') {
                store.matchViewMode = 'upcoming';
                store.programKolaIndex = 0;
            }

            if (typeof window.getLeagueStadium === 'function') {
                const bgUrl = window.getLeagueStadium(leagueName);
                const bgVal = bgUrl ? `url('${bgUrl}')` : 'none';
                document.querySelectorAll('.league-themed-screen').forEach(el => el.style.setProperty('--league-bg', bgVal));
            }

            // 👥 PŘÍPRAVA PARTIČEK PRO TUTO LIGU
            if (typeof window.nactiMojePartickyProLigu === 'function') {
                window.nactiMojePartickyProLigu(leagueName);
            }

            // 🎯 BLESKOVÝ PROPOJOVAČ: Vytáhne z paměti tipy pro tuto vybranou ligu
            if (typeof window.aktualizujMojeTipyProLigu === 'function') {
                window.aktualizujMojeTipyProLigu(leagueName);
            }

            localStorage.setItem('savedLeague', leagueName);
            localStorage.setItem('savedScreen', targetScreen);

            if (typeof window.globalLiveMenuUnsubscribe === 'function') { 
                window.globalLiveMenuUnsubscribe(); 
                window.globalLiveMenuUnsubscribe = null; 
            }
            if (window.liveSchedulerTimeout) { 
                clearTimeout(window.liveSchedulerTimeout); 
                window.liveSchedulerTimeout = null; 
            }

            window.lastVerzeRozpisu = -1;
            window.lastVerzeZebricku = -1;

            if (targetScreen === 'matchesScreen' && typeof window.renderMatches === 'function') {
                window.renderMatches(leagueName);
            } else if (targetScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
                window.renderLeaderboard();
            } else if (targetScreen === 'cupScreen' && typeof window.renderCupScreen === 'function') {
                window.renderCupScreen(leagueName);
            }

            const scr = document.getElementById(targetScreen);
            if (scr) scr.scrollTop = 0;

            // 📡 NEBLOKUJÍCÍ RADAR: Živé kanály se napojí na pozadí
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => window.naplanujZiveKanaly(leagueName), { timeout: 1500 });
            } else {
                requestAnimationFrame(() => window.naplanujZiveKanaly(leagueName));
            }
        } catch (err) {
            console.error("❌ Kritická chyba při přepínání ligy:", err);
            if (typeof window.showToast === 'function') {
                window.showToast("Došlo k chybě při načítání soutěže ⚠️", true);
            }
        } finally {
            if (store) store.isMenuOpen = false;
            if (typeof window.hideSplash === 'function') window.hideSplash();
            isSelectingLeagueRunning = false;
        }
    };

    // 🔮 TICHÝ NEBLOKUJÍCÍ PREFETCHER: Aktualizuje data na pozadí bez zdržení startu a bez probliknutí
    window.prefetchVsechnyLigy = async () => {
        const store = Alpine.store('appState');
        const seznamKeKontrole = CONFIG.MASTER_LEAGUES;
        if (!seznamKeKontrole || seznamKeKontrole.length === 0 || !navigator.onLine) return;
        
        const sezId = store?.activeSeason || window.SEZONA_ID || "2026_2027";
        const keshRazitko = Math.floor(Date.now() / 30000);

        if (store && !store.leaguesMemoryCache) store.leaguesMemoryCache = {};

        const sliby = seznamKeKontrole.map(async (lName) => {
            const lKlic = String(lName).replace(/ /g, "_");
            const pathPrefix = `sezony/${sezId}/${lKlic}`;
            const isChanceOrPL = lName === "Chance Liga" || lName === "Premier League";

            try {
                const [rData, lbData, cData] = await Promise.all([
                    fetch(`${R2_BASE_URL}/${pathPrefix}/rozpis.json?v=${keshRazitko}`)
                        .then(r => r.status === 404 ? { zapasyMapa: {}, hasMatches: false } : (r.ok ? r.json() : null))
                        .catch(() => null),
                    fetch(`${R2_BASE_URL}/${pathPrefix}/leaderboard.json?v=${keshRazitko}`)
                        .then(r => r.ok ? r.json() : null)
                        .catch(() => null),
                    isChanceOrPL
                        ? fetch(`${R2_BASE_URL}/${pathPrefix}/cup.json?v=${keshRazitko}`)
                            .then(r => r.ok ? r.json() : null)
                            .catch(() => null)
                        : Promise.resolve(null)
                ]);

                if (rData) {
                    try { localStorage.setItem(`tipni_cache_rozpis_${sezId}_${lKlic}`, JSON.stringify(rData)); } catch(e){}
                    const jeLive = rData.isLive || Object.values(rData.zapasyMapa || {}).some(zap => zap.apiStatus === "IN_PLAY" || zap.apiStatus === "PAUSED");
                    if (store) {
                        if (!store.liveLeaguesMap) store.liveLeaguesMap = {};
                        store.liveLeaguesMap[lName] = Boolean(jeLive);
                        try { localStorage.setItem('tipni_cache_live_map', JSON.stringify(store.liveLeaguesMap)); } catch(e){}
                    }
                }

                if (lbData) {
                    try { localStorage.setItem(`tipni_cache_lb_${sezId}_${lKlic}`, JSON.stringify(lbData)); } catch(e){}
                    if (store) {
                        store.leaguePlayerCounts[lName] = lbData.zebricek?.length || 0;
                        try { localStorage.setItem('tipni_cache_player_counts', JSON.stringify(store.leaguePlayerCounts)); } catch(e){}
                    }
                }

                // ⚡ L1 RAM CACHE: Přímý zápis rozparsovaných objektů do RAM pro 0 ms přepínání
                if (store && (rData || lbData)) {
                    if (!store.leaguesMemoryCache[lName]) store.leaguesMemoryCache[lName] = {};
                    if (rData) store.leaguesMemoryCache[lName].rozpisData = rData;
                    if (lbData) store.leaguesMemoryCache[lName].leaderboardData = lbData;
                    if (cData) {
                        store.leaguesMemoryCache[lName].cupData = cData;
                        if (!store.cupData) store.cupData = {};
                        store.cupData[lName] = cData;
                    }
                }
            } catch (err) {}
        });

        // 🏛️ PREFETCH OFICIÁLNÍHO SOUBORU SÍNĚ SLÁVY Z R2 (AKTUALIZUJE I CELKOVÝ POČET HRÁČŮ)
        const fetchHof = fetch(`${R2_BASE_URL}/sezony/${sezId}/hall_of_fame.json?v=${keshRazitko}`)
            .then(r => r.ok ? r.json() : null)
            .then(hofData => {
                if (hofData && store) {
                    store.hallOfFameData = hofData;
                    const totalPlayers = (hofData.all || hofData.players || []).length;
                    if (totalPlayers > 0) store.communityTotal = totalPlayers;
                    try { localStorage.setItem(`tipni_cache_hof_${sezId}`, JSON.stringify(hofData)); } catch(e){}
                    const currentUid = window.auth?.currentUser?.uid;
                    const meInHof = (hofData.all || hofData.players)?.find(p => p.uid === currentUid);
                    if (meInHof) {
        store.myOvr = meInHof.masterOvr || meInHof.ovr;
        localStorage.setItem('tipni_cache_my_ovr', String(store.myOvr));
    } else {
        store.myOvr = 0;
        localStorage.removeItem('tipni_cache_my_ovr');
    }
                }
            }).catch(() => {});

        sliby.push(fetchHof);
        await Promise.all(sliby);
        if (store) {
            store.leagueFilterTick++;
        }
    };

    // 🚀 DETERMINISTICKÝ START PREFETCHERU: 100% bez časovačů (přesně po vykreslení snímku na GPU)
    const naplanujPrefetch = () => {
        if (typeof window.prefetchVsechnyLigy !== 'function') return;

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => window.prefetchVsechnyLigy());
        } else {
            // Dvojitý rAF počká na dokončení kompozice prvního snímku prohlížeče
            requestAnimationFrame(() => {
                requestAnimationFrame(() => window.prefetchVsechnyLigy());
            });
        }
    };

    if (document.readyState === 'complete') {
        naplanujPrefetch();
    } else {
        window.addEventListener('load', naplanujPrefetch, { once: true });
    }

    // 🔗 DEEP-LINK HANDLER PRO PUSH NOTIFIKACE (Předání do bezpečné fronty pro Auth)
    const urlParams = new URLSearchParams(window.location.search);
    const deepLeagueParam = urlParams.get('league');

    if (deepLeagueParam) {
        const cleanLeague = decodeURIComponent(deepLeagueParam).replace(/_/g, " ");
        const targetScreen = window.location.hash ? window.location.hash.replace('#', '') : 'matchesScreen';

        // 1. Zápis do startovní paměti aplikace
        localStorage.setItem('savedLeague', cleanLeague);
        localStorage.setItem('savedScreen', targetScreen);

        // 2. Čisté odstranění parametru z URL lišty bez reloadu
        window.history.replaceState(null, '', window.location.pathname + '#' + targetScreen);

        // 3. Uložíme do fronty pro Auth router (odpálí se až po načtení profilu a práv hráče)
        window.pendingDeepLink = { league: cleanLeague, screen: targetScreen };
    }

    // 🪝 LIFECYCLE BOOTSTRAP: Globální autentizace
    onAuthStateChanged(window.auth, async (user) => {
        if (!user) return;
    });

// ⦡ UNIVERZÁLNÍ PASIVNÍ DETEKTOR SCROLLU (FUNGUJE NA VŠECH OBRAZOVKÁCH I V ADMINU)
    window.addEventListener('scroll', (e) => {
        const target = e.target;
        if (target && target.classList && target.classList.contains('screen-scroll')) {
            const store = window.Alpine?.store('appState');
            if (!store) return;
            const shouldShow = target.scrollTop > 100;
            if (store.showScrollTop !== shouldShow) {
                store.showScrollTop = shouldShow;
            }
        }
    }, { passive: true, capture: true });

// 📊 TOURNAMENT LIFECYCLE: Bezpečně spočítá, zda už padl první herní gól nebo uplynul čas výkopu
    window.isLeagueStarted = () => {
        const store = Alpine.store('appState');
        if (!store.serazenaTimelineZapasu || store.serazenaTimelineZapasu.length === 0) return false;

        // 1. Kontrola času: Je čas startu úplně prvního zápasu v minulosti?
        const prvniZapas = store.serazenaTimelineZapasu[0];
        const casStartu = prvniZapas.datumObj ? prvniZapas.datumObj.getTime() : 0;
        if (casStartu > 0 && casStartu < Date.now()) return true;

        // 2. Kontrola stavu: Běží už live přenos, nebo už existuje nějaký hotový výsledek?
        const uzSeHrajeNeboDohralo = store.serazenaTimelineZapasu.some(m => 
            m.isLive || 
            m.status === 'live' || 
            m.status === 'finished' || 
            m.vysledek_domaci !== undefined && m.vysledek_domaci !== null
        );

        return uzSeHrajeNeboDohralo;
    };
// 🏆 PLAYOFF / HOKEJ OT INTERACTIVE TOGGLER: Okamžitý reaktivní flip volby vítěze (i před uložením)
    window.nastavPostup = (matchId, volba) => {
        const store = Alpine.store('appState');
        if (!store) return;
        
        if (!store.rozvrtaneTipy) store.rozvrtaneTipy = {};
        store.rozvrtaneTipy[`${matchId}_postup`] = volba;

        // Synchronizace se skrytým inputem v DOMu pro hromadný zápis
        const hiddenEl = document.getElementById(`playoff-user-val-${matchId}`);
        if (hiddenEl) hiddenEl.value = volba;

        const klicRegistru = `playoff-user-val-${matchId}`;
        const savedPostup = store.mojeTipy?.[matchId]?.postup || '';

        if (volba !== savedPostup) {
            window.dirtyInputsRegistry.add(klicRegistru);
        } else {
            window.dirtyInputsRegistry.delete(klicRegistru);
        }
        window.isAppFormDirty = (window.dirtyInputsRegistry.size > 0);
        if (typeof window.prepocitejPocitadlaTipu === 'function') {
            window.prepocitejPocitadlaTipu();
        }
    };

// 🎯 POMOCNÝ VYTAHOVAČ A SYNCHRONIZÁTOR TIPŮ PRO VYBRANOU LIGU
	window.aktualizujMojeTipyProLigu = (leagueName) => {
		const store = Alpine.store('appState');
		if (!store) return;
		const lName = leagueName || store.selectedLeague || localStorage.getItem('savedLeague') || 'Chance Liga';
		const ligaKlic = String(lName).replace(/ /g, '_');
		const souteze = store.rawSezonaData?.souteze || {};
		const soutezData = souteze[ligaKlic] || {};

		store.mojeTipy = soutezData.tipy || {};
		store.mojeBonusy = {
			vitez: soutezData.bonusy?.vitez || '',
			strelec: soutezData.bonusy?.strelec || '',
			kanadske: soutezData.bonusy?.kanadske || ''
		};
		store.mojeStatistiky = soutezData.statistiky || {};

		// 🚦 BATCH AUTO-FILL: Příprava roletek i postupů v 1 jediném kroku
		if (store.mojeTipy) {
			const bleskoveRozvrtane = { ...(store.rozvrtaneTipy || {}) };
			Object.keys(store.mojeTipy).forEach(matchId => {
				const tip = store.mojeTipy[matchId];
				if (tip && tip.tip_domaci !== undefined && tip.tip_hoste !== undefined) {
					bleskoveRozvrtane[`${matchId}_domaci`] = String(tip.tip_domaci);
					bleskoveRozvrtane[`${matchId}_hoste`] = String(tip.tip_hoste);
					bleskoveRozvrtane[`${matchId}_postup`] = tip.postup || '';
				}
			});
			store.rozvrtaneTipy = bleskoveRozvrtane;
		}
	};
};

// 📱 INTELIGENTNÍ REŽIM SPÁNKU & PROBUZENÍ SÍTĚ (ČISTÝ EVENT-DRIVEN SYSTÉM BEZ POLLINGU)
document.addEventListener("visibilitychange", async () => {
	const store = window.Alpine?.store('appState');

	// 💤 1. MOBIL JDE DO KAPSY (USPAT SÍŤ A UKLIDIT ZDROJE)
	if (document.hidden) {
		// 🛡️ TICHÝ ZÁCHRANNÝ AUTO-FLUSH: Pokud hráč zamkne mobil s neuloženými tipy, odešleme je na pozadí
		if (store && store.currentScreen === 'matchesScreen' && store.dirtyTipsCount > 0 && store.selectedLeague && typeof window.saveAllUserTips === 'function') {
			window.saveAllUserTips(store.selectedLeague, null, true);
		}
		if (window.liveIntervalRadar) {
			clearInterval(window.liveIntervalRadar);
			window.liveIntervalRadar = null;
		}
		if (typeof window.globalLiveMenuUnsubscribe === 'function') {
			window.globalLiveMenuUnsubscribe();
		}
		try { await disableNetwork(db); } catch (e) {}
	} 
	// ⚡ 2. MOBIL VYTAŽEN Z KAPSY (BLESKOVÉ PROBUZENÍ POUZE PŘES WEBSOCKET)
	else {
		try { await enableNetwork(db); } catch (e) {}
		try { if (rtdb) goOnline(rtdb); } catch (e) {}

		// 🍏 iOS WebKit WAKEUP PULSE: Okamžitá obnova tokenu
		if (window.auth?.currentUser) {
			window.auth.currentUser.getIdToken(true).catch(() => {});
		}

		if (window.pendingAppReload && !window.isAppFormDirty) {
			window.location.reload();
			return;
		}

		if (window.swRegistration) {
			window.swRegistration.update().catch(() => {});
		}

		if (store?.selectedLeague) {
			window.zapniZiveStreamy(store.selectedLeague);
		}
	}
});

// 🎯 SMART NAVIGATOR: Otevře výsledky a při přechodu odjinud nastaví první náhled kola
window.otevriVysledky = () => {
    const store = Alpine.store('appState');
    if (store) {
        store.matchViewMode = 'results';
        store.vysledkyKolaIndex = 0; // Skok na "Poslední zápasy" pouze při kliknutí na tlačitko v navigaci
    }
    window.goToScreen('matchesScreen');
};

// 🎯 SMART PROGRAM: Otevře program utkání a při přechodu odjinud nastaví prvotní náhled nadcházejících kol
window.otevriProgramUtkani = () => {
    const store = Alpine.store('appState');
    if (store) {
        store.matchViewMode = 'upcoming';
        store.programKolaIndex = 0; // Skok na "Nadcházející zápasy" pouze při kliknutí na tlačítko v navigaci
    }
    window.goToScreen('matchesScreen');
};

// 👑 SUPERADMIN NAVIGATOR: Přímý skok ze jména v menu do konkrétní záložky Vládního kokpitu
window.openSuperAdminTab = async (tabName = 'users') => {
    const store = Alpine.store('appState');
    if (store) {
        store.superAdminActiveTab = tabName;
        store.isMenuOpen = false;
    }
    window.superAdminActiveTab = tabName;
    await window.nacistAdminModul();
    window.goToScreen('superAdminScreen');
    if (typeof window.switchSuperAdminTab === 'function') {
        window.switchSuperAdminTab(tabName);
    } else if (typeof window.renderSuperAdmin === 'function') {
        window.renderSuperAdmin(tabName);
    }
};

// 🎓 STORY TUTORIAL ENGINE: REAKTIVNÍ OVLÁDÁNÍ 10KROKOVÉHO PRŮVODCE
window.openTutorial = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    store.tutorialStep = 0;
    store.tutorialOpen = true;
};

window.closeTutorial = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    store.tutorialOpen = false;
    if (typeof window.completeTutorial === 'function') {
        window.completeTutorial();
    }
};

window.nextTutorialStep = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    if (store.tutorialStep < store.tutorialTotalSteps - 1) {
        store.tutorialStep++;
    } else {
        window.closeTutorial();
    }
};

window.prevTutorialStep = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    if (store.tutorialStep > 0) {
        store.tutorialStep--;
    }
};

window.setTutorialStep = (idx) => {
    const store = Alpine.store('appState');
    if (!store) return;
    if (idx >= 0 && idx < store.tutorialTotalSteps) {
        store.tutorialStep = idx;
    }
};

// =========================================================================
// 📲 PWA INSTALLATION ENGINE (PŘÍMÁ INSTALACE Z HAMBURGER MENU)
// =========================================================================
let deferredPwaPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    const store = window.Alpine?.store('appState');
    if (store && !window.matchMedia('(display-mode: standalone)').matches) {
        store.canInstallPwa = true;
    }
});

window.addEventListener('appinstalled', () => {
    deferredPwaPrompt = null;
    const store = window.Alpine?.store('appState');
    if (store) store.canInstallPwa = false;
    console.log("🎉 PWA Aplikace úspěšně nainstalována do zařízení!");
});

window.triggerPwaInstall = async () => {
    if (!deferredPwaPrompt) return;
    deferredPwaPrompt.prompt();
    const { outcome } = await deferredPwaPrompt.userChoice;
    if (outcome === 'accepted') {
        const store = window.Alpine?.store('appState');
        if (store) store.canInstallPwa = false;
    }
    deferredPwaPrompt = null;
};

// 🏷️ POMOCNÉ VYTAHOVAČE LOG, ŠTÍTKŮ A POPISŮ PRO KATALOG
window.getLeagueBadge = (liga) => {
    const l = String(liga || '').toLowerCase();
    if (l.includes('premier')) return 'EN • ANGLIE';
    if (l.includes('chance')) return 'CZ • ČESKO';
    if (l.includes('mistr') || l.includes('ucl') || l.includes('champions')) return 'UEFA • EVROPA';
    if (l.includes('extraliga')) return 'CZ • EXTRALIGA';
    if (l.includes('hokeji')) return 'MS • HOKEJ';
    return 'FIFA • SVĚT';
};

// 🎨 TAJNÝ 3VTEŘINOVÝ SPÍNAČ FANOUŠKOVSKÉ GRAFIKY
let dotHoldTimer = null;
window.startDotHoldTimer = () => {
    window.clearDotHoldTimer();
    const dot = document.getElementById('presencePulseDot');
    if (dot) dot.classList.add('is-holding');

    dotHoldTimer = setTimeout(() => {
        window.clearDotHoldTimer();
        window.toggleFanGraphics();
    }, 3000);
};

window.clearDotHoldTimer = () => {
    if (dotHoldTimer) {
        clearTimeout(dotHoldTimer);
        dotHoldTimer = null;
    }
    const dot = document.getElementById('presencePulseDot');
    if (dot) dot.classList.remove('is-holding');
};

window.toggleFanGraphics = () => {
    const store = Alpine.store('appState');
    if (!store) return;
    const novyStav = !store.fanGraphics;
    store.fanGraphics = novyStav;
    localStorage.setItem('tipni_fan_graphics', novyStav ? 'true' : 'false');

    // 📡 Okamžitý zápis do RTDB pro aktuálního uživatele
    const user = window.auth?.currentUser;
    if (user && window.rtdb) {
        rtdbUpdate(rtdbRef(window.rtdb, `status/${user.uid}`), {
            richGraphics: novyStav
        }).catch(() => {});
    }

    // 📳 Haptická odezva
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100, 50, 150]);
    }

    if (typeof window.showToast === 'function') {
        window.showToast(novyStav ? "🎨 Fanouškovský režim aktivován!" : "🛡️ Bezpečný režim aktivován");
    }

    // 🔄 Okamžité překreslení rozhraní
    store.leagueFilterTick++;
    if (store.selectedLeague && typeof window.getLeagueStadium === 'function') {
        const bgVal = window.getLeagueStadium(store.selectedLeague);
        document.documentElement.style.setProperty('--league-bg', bgVal ? `url('${bgVal}')` : 'none');
    }
    if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
        window.renderLeaderboard(false);
    }
    if (store.currentScreen === 'profileScreen' && typeof window.renderPlayerProfile === 'function') {
        window.renderPlayerProfile(store.profileTargetUid);
    }
};

window.getLeagueTrophy = (liga) => {
    const isFan = Boolean(Alpine.store('appState')?.fanGraphics);
    if (!isFan) return '';

    const l = String(liga || '').toLowerCase();
    const r2Base = CONFIG.R2_BASE_URL;
    if (l.includes('premier')) return `${r2Base}/leagues/trophies/premier_league.png`;
    if (l.includes('chance')) return `${r2Base}/leagues/trophies/chance_liga.png`;
    if (l.includes('mistr') || l.includes('ucl')) return `${r2Base}/leagues/trophies/liga_mistru.png`;
    if (l.includes('extraliga')) return `${r2Base}/leagues/trophies/extraliga.png`;
    if (l.includes('hokeji')) return `${r2Base}/leagues/trophies/ms_hokej.png`;
    return `${r2Base}/leagues/trophies/ms_fotbal.png`;
};

window.getLeagueStadium = (liga) => {
    const isFan = Boolean(Alpine.store('appState')?.fanGraphics);
    if (!isFan) return '';

    const l = String(liga || '').toLowerCase();
    const r2Base = CONFIG.R2_BASE_URL;
    if (l.includes('premier')) return `${r2Base}/leagues/stadiums/premier_league.webp`;
    if (l.includes('chance')) return `${r2Base}/leagues/stadiums/chance_liga.webp`;
    if (l.includes('mistr') || l.includes('ucl')) return `${r2Base}/leagues/stadiums/liga_mistru.webp`;
    if (l.includes('extraliga')) return `${r2Base}/leagues/stadiums/extraliga.webp`;
    if (l.includes('hokeji')) return `${r2Base}/leagues/stadiums/ms_hokej.webp`;
    return `${r2Base}/leagues/stadiums/ms_fotbal.webp`;
};

// 🛡️ KRUHOVÉ SVG VLAJKY (BEZPEČNÝ MÓD) vs. OFICIÁLNÍ LOGA Z R2 (FANOUŠKOVSKÝ MÓD)
const SAFE_SVG_FLAGS = {
    // 🇨🇿 Česká vlajka (Chance Liga i Tipsport Extraliga)
    cz: `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><clipPath id="c"><circle cx="16" cy="16" r="16"/></clipPath></defs><g clip-path="url(#c)"><rect width="32" height="16" fill="#ffffff"/><rect y="16" width="32" height="16" fill="#d7141a"/><polygon points="0,0 16,16 0,32" fill="#11457e"/></g></svg>')}`,
    // 🇬🇧 Premier League (Union Jack v kruhu)
    gb: `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><clipPath id="c"><circle cx="16" cy="16" r="16"/></clipPath></defs><g clip-path="url(#c)"><rect width="32" height="32" fill="#012169"/><path d="M0,0 L32,32 M32,0 L0,32" stroke="#ffffff" stroke-width="5.5"/><path d="M0,0 L32,32 M32,0 L0,32" stroke="#c8102e" stroke-width="2.5"/><path d="M16,0 V32 M0,16 H32" stroke="#ffffff" stroke-width="8.5"/><path d="M16,0 V32 M0,16 H32" stroke="#c8102e" stroke-width="5"/></g></svg>')}`,
    // 🌍 Stylový kruhový glóbus (Liga mistrů, MS ve fotbale, MS v hokeji)
    globe: `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><clipPath id="c"><circle cx="16" cy="16" r="16"/></clipPath></defs><g clip-path="url(#c)"><rect width="32" height="32" fill="#0284c7"/><path d="M4,10 Q10,6 16,9 Q20,12 18,18 Q14,24 8,22 Z" fill="#10b981"/><path d="M19,6 Q25,4 28,10 Q26,16 23,17 Q20,14 19,6 Z" fill="#10b981"/><path d="M16,21 Q24,20 25,27 Q18,31 14,28 Z" fill="#10b981"/><circle cx="16" cy="16" r="15.5" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1"/></g></svg>')}`
};

window.getLeagueLogo = (liga) => {
    const isFan = Boolean(Alpine.store('appState')?.fanGraphics);
    const l = String(liga || '').toLowerCase();
    const r2Base = CONFIG.R2_BASE_URL;

    if (isFan) {
        if (l.includes('premier')) return `${r2Base}/leagues/logos/premier_league.png`;
        if (l.includes('chance')) return `${r2Base}/leagues/logos/chance_liga.png`;
        if (l.includes('mistr') || l.includes('ucl')) return `${r2Base}/leagues/logos/liga_mistru.png`;
        if (l.includes('extraliga')) return `${r2Base}/leagues/logos/extraliga.png`;
        if (l.includes('hokeji')) return `${r2Base}/leagues/logos/ms_hokej.png`;
        return `${r2Base}/leagues/logos/ms_fotbal.png`;
    }

    if (l.includes('premier')) return SAFE_SVG_FLAGS.gb;
    if (l.includes('chance')) return SAFE_SVG_FLAGS.cz;
    if (l.includes('extraliga')) return SAFE_SVG_FLAGS.cz;
    return SAFE_SVG_FLAGS.globe;
};

// =========================================================================
// 👥 KONTROLER PRO CENTROVANÝ MODÁL A PŘEPÍNÁNÍ PARTIČEK
// =========================================================================
window.openGroupModal = () => {
    const store = Alpine.store('appState');
    if (store) store.groupModalOpen = true;
};

window.closeGroupModal = () => {
    const store = Alpine.store('appState');
    if (store) store.groupModalOpen = false;
};

// Kompatibilita
window.openGroupSheet = window.openGroupModal;
window.closeGroupSheet = window.closeGroupModal;

window.selectGroup = async (groupId) => {
    const store = Alpine.store('appState');
    if (!store) return;
    store.selectedGroupId = groupId;
    store.groupModalOpen = false;

    if (store.currentScreen === 'leaderboardScreen' && typeof window.renderLeaderboard === 'function') {
        await window.renderLeaderboard();
    }
};

window.toggleFavGroup = () => {
    const store = Alpine.store('appState');
    if (!store || !store.selectedLeague) return;
    const targetId = store.selectedGroupId || 'GLOBAL';
    const key = `tipni_fav_group_${store.selectedLeague}`;
    if (store.isCurrentGroupFav) {
        localStorage.removeItem(key);
        store.favGroupId = null;
        window.showToast(targetId === 'GLOBAL' ? "⭐ Výchozí zobrazení celé ligy zrušeno." : "⭐ Výchozí partička zrušena.");
    } else {
        localStorage.setItem(key, targetId);
        store.favGroupId = targetId;
        window.showToast(`⭐ "${store.currentGroupTitle}" nastavena jako výchozí!`);
    }
};

window.toggleFavGroupFor = (groupId) => {
    const store = Alpine.store('appState');
    if (!store || !store.selectedLeague || !groupId) return;
    const key = `tipni_fav_group_${store.selectedLeague}`;
    if (store.favGroupId === groupId) {
        localStorage.removeItem(key);
        store.favGroupId = null;
        window.showToast(groupId === 'GLOBAL' ? "⭐ Výchozí zobrazení celé ligy zrušeno." : "⭐ Výchozí partička zrušena.");
    } else {
        localStorage.setItem(key, groupId);
        store.favGroupId = groupId;
        window.showToast(groupId === 'GLOBAL' ? "⭐ Celá liga nastavena jako výchozí!" : "⭐ Partička nastavena jako výchozí!");
    }
};

window.nactiMojePartickyProLigu = async (leagueName) => {
    const store = Alpine.store('appState');
    const uid = window.auth?.currentUser?.uid;
    if (!store || !uid || !window.rtdb || !leagueName) return;

    const ligaKlic = String(leagueName).replace(/ /g, "_");
    try {
        const { get, ref } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js");
        const snap = await get(ref(window.rtdb, `user_groups/${uid}/${ligaKlic}`));
        const rawObj = snap.exists() ? (snap.val() || {}) : {};
        
        // 1. Seřadíme partičky chronologicky podle času vstupu
        store.myGroupsList = Object.entries(rawObj)
            .map(([id, d]) => ({ id, ...d }))
            .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

        // 2. Synchronizace hvězdičky z localStorage
        const favId = localStorage.getItem(`tipni_fav_group_${leagueName}`);
        store.favGroupId = favId || null;

        // 3. Rozhodovací strom: Hvězdička má přednost -> jinak 1. partička -> jinak Globál
        if (favId === 'GLOBAL') {
            store.selectedGroupId = null;
        } else if (favId && store.myGroupsList.some(g => g.id === favId || g.kod === favId)) {
            store.selectedGroupId = favId;
        } else if (store.myGroupsList.length > 0) {
            store.selectedGroupId = store.myGroupsList[0].id || store.myGroupsList[0].kod;
        } else {
            store.selectedGroupId = null;
        }
    } catch(e) {
        store.myGroupsList = [];
        store.selectedGroupId = null;
        store.favGroupId = null;
    }
};

// ✏️ MODÁL PRO PŘEJMENOVÁNÍ PARTIČKY (Správce 1x za 24h, SuperAdmin neomezeně)
window.openRenameGroupModal = (groupId, currentName) => {
    window.closeGroupModal();
    const store = Alpine.store('appState');
    const isSuper = Boolean(store?.isSuperAdmin);

    const modalHtml = `
        <div style="padding: 10px; width: 100%; box-sizing: border-box; text-align: center;">
            <p style="color: #9ca3af; font-size: 0.85rem; margin: 0 0 14px 0; line-height: 1.4;">
                Zadej nový název partičky ${isSuper ? '<span style="color:#fbbf24; font-weight:bold;">(SuperAdmin: bez limitu)</span>' : '<span style="color:#38bdf8;">(Správce: max. 1× za 24h)</span>'}:
            </p>
            <input type="text" id="modal-rename-group-input" maxlength="30" value="${window.escapeHTML(currentName || '')}" placeholder="Nový název..." 
                   style="height: 42px; width: 100%; background: #111827; border: 1.5px solid #38bdf8; border-radius: 8px; color: #ffffff; font-size: 0.95rem; font-weight: bold; text-align: center; margin: 0 0 14px 0; box-sizing: border-box;">
            <button type="button" class="action-btn" style="background: #059669; color: #ffffff; height: 42px; font-family: 'Oswald', sans-serif; font-size: 0.88rem; font-weight: 700; border-radius: 8px; margin: 0; width: 100%;" 
                    onclick="window.submitRenameGroupAction('${groupId}')">ULOŽIT NOVÝ NÁZEV</button>
        </div>
    `;
    window.openGlobalUiModal("✏️ PŘEJMENOVAT PARTIČKU", modalHtml);
};

window.submitRenameGroupAction = async (groupId) => {
    const input = document.getElementById("modal-rename-group-input");
    const val = input ? input.value.trim() : "";
    const store = Alpine.store('appState');
    const leagueName = store?.selectedLeague || window.superAdminSelectedGroupLeague;

    if (!val || val.length < 3) {
        window.showToast("Název musí mít alespoň 3 znaky! ⚠️", true);
        return;
    }

    window.showToast("⏳ Ukládám nový název partičky...", false);
    try {
        const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const renameGroupCF = httpsCallable(window.functions, "renameGroupCF");
        const res = await renameGroupCF({ 
            groupId: groupId, 
            leagueName: leagueName, 
            newNazev: val 
        });

        document.querySelectorAll(".spy-modal-overlay.dynamic-global-modal").forEach(el => el.remove());
        window.showToast(res.data?.message || "✅ Název úspěšně změněn!");

        // Okamžité překreslení na displeji
        if (leagueName && typeof window.nactiMojePartickyProLigu === 'function') {
            await window.nactiMojePartickyProLigu(leagueName);
        }
        if (store?.currentScreen === 'superAdminScreen' && typeof window.renderSuperAdminGroups === 'function') {
            await window.renderSuperAdminGroups();
        }
    } catch(e) {
        window.showToast("❌ " + (e.message || "Změna názvu se nezdařila"), true);
    }
};

window.openJoinGroupModal = () => {
    window.closeGroupModal();
    const modalHtml = `
        <div style="padding: 10px; width: 100%; box-sizing: border-box; text-align: center;">
            <p style="color: #9ca3af; font-size: 0.85rem; margin: 0 0 14px 0; line-height: 1.4;">
                Zadej 6místný kód, který jsi dostal od kamaráda nebo zakladatele party:
            </p>
            <input type="text" id="modal-join-group-code" maxlength="6" placeholder="KÓD PARTY" 
                   style="height: 44px; width: 100%; background: #111827; border: 1.5px solid #38bdf8; border-radius: 8px; color: #fbbf24; font-family: monospace; font-size: 1.25rem; font-weight: 800; letter-spacing: 2px; text-align: center; text-transform: uppercase; margin: 0 0 14px 0; box-sizing: border-box;">
            <button type="button" class="action-btn" style="background: #2563eb; color: #ffffff; height: 42px; font-family: 'Oswald', sans-serif; font-size: 0.88rem; font-weight: 700; border-radius: 8px; margin: 0; width: 100%;" 
                    onclick="window.submitJoinGroupAction()">PŘIPOJIT SE K PARTIČCE</button>
        </div>
    `;
    window.openGlobalUiModal("🔑 ZADAT KÓD PARTY", modalHtml);
};

window.submitJoinGroupAction = async () => {
    const input = document.getElementById("modal-join-group-code");
    const val = input ? input.value.trim().toUpperCase() : "";
    if (!val || val.length !== 6) {
        window.showToast("Zadej platný 6místný kód! ⚠️", true);
        return;
    }

    window.showToast("⏳ Připojuji k partě...", false);
    try {
        const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const joinGroupCF = httpsCallable(window.functions, "joinGroupCF");
        const res = await joinGroupCF({ kod: val });

        document.querySelectorAll(".spy-modal-overlay").forEach(el => el.remove());
        window.showToast(res.data?.message || "✅ Vítej v partičce!");

        const store = Alpine.store('appState');
        if (store?.selectedLeague) {
            await window.nactiMojePartickyProLigu(store.selectedLeague);
            await window.selectGroup(val);
        }
    } catch(e) {
        window.showToast("❌ Chyba: " + (e.message || "Skupinu se nepodařilo najít"), true);
    }
};

window.openCreateGroupModal = () => {
    window.closeGroupModal();
    const store = Alpine.store('appState');
    const leagueName = store?.selectedLeague || "Tipsport Extraliga";

    const modalHtml = `
        <div style="padding: 10px; width: 100%; box-sizing: border-box; text-align: center;">
            <p style="color: #9ca3af; font-size: 0.85rem; margin: 0 0 14px 0; line-height: 1.4;">
                Zadej název své party pro soutěž <strong style="color: #38bdf8;">${leagueName}</strong>:
            </p>
            <input type="text" id="modal-create-group-name" maxlength="30" placeholder="Např. Hospoda U Kocoura" 
                   style="height: 42px; width: 100%; background: #111827; border: 1.5px solid #10b981; border-radius: 8px; color: #ffffff; font-size: 0.95rem; font-weight: bold; text-align: center; margin: 0 0 14px 0; box-sizing: border-box;">
            <button type="button" class="action-btn" style="background: #059669; color: #ffffff; height: 42px; font-family: 'Oswald', sans-serif; font-size: 0.88rem; font-weight: 700; border-radius: 8px; margin: 0; width: 100%;" 
                    onclick="window.submitCreateGroupAction()">VYTVOŘIT A ZÍSKAT KÓD</button>
        </div>
    `;
    window.openGlobalUiModal("➕ ZALOŽIT NOVOU PARTU", modalHtml);
};

window.submitCreateGroupAction = async () => {
    const input = document.getElementById("modal-create-group-name");
    const val = input ? input.value.trim() : "";
    const store = Alpine.store('appState');
    const leagueName = store?.selectedLeague;

    if (!val || val.length < 3) {
        window.showToast("Název musí mít alespoň 3 znaky! ⚠️", true);
        return;
    }

    window.showToast("⏳ Zakládám partičku...", false);
    try {
        const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const createGroupCF = httpsCallable(window.functions, "createGroupCF");
        const res = await createGroupCF({ leagueName: leagueName, nazev: val });

        document.querySelectorAll(".spy-modal-overlay").forEach(el => el.remove());
        window.showToast(res.data?.message || "✅ Partička byla založena!");

        if (leagueName) {
            await window.nactiMojePartickyProLigu(leagueName);
            if (res.data?.kod) {
                await window.selectGroup(res.data.kod);
            }
        }
    } catch(e) {
        window.showToast("❌ Chyba: " + (e.message || "Založení se nezdařilo"), true);
    }
};