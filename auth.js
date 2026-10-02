// =========================================================================
// 🔐 TIPNI TO! - ŽIVÁ AUTENTIKACE A SLEDOVÁNÍ ROLÍ V REÁLNÉM ČASE (auth.js)
// =========================================================================

import { signInWithEmailAndPassword, signOut, onIdTokenChanged, GoogleAuthProvider, signInWithPopup, linkWithPopup, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, deleteDoc, onSnapshot, updateDoc, serverTimestamp, collection, arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import { getDatabase, ref as rtdbRef, onValue as onRtdbValue, onDisconnect, set as setRtdb, serverTimestamp as rtdbServerTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// 🟢 NATIVNÍ REALTIME DATABASE PRESENCE ENGINE (0 FIRESTORE READS, 0 KČ)
let rtdbConnectedUnsubscribe = null;
let rtdbCurrentPresenceUid = null;

window.spustRtdbPresence = (uid) => {
    if (!uid || !window.app) return;
    if (rtdbCurrentPresenceUid === uid && rtdbConnectedUnsubscribe) return;

    const user = window.auth?.currentUser;
    if (!user || user.uid !== uid) return;

    // 🛡️ ČISTÉ OVĚŘENÍ BEZ TIMEOUTU: Počkáme na nativní Promise tokenu před zápisem do socketu
    user.getIdTokenResult().then(() => {
        if (window.auth?.currentUser?.uid !== uid) return;

        if (rtdbConnectedUnsubscribe) {
            rtdbConnectedUnsubscribe();
            rtdbConnectedUnsubscribe = null;
        }

        rtdbCurrentPresenceUid = uid;
        const rtdb = getDatabase(window.app);
        const myStatusRef = rtdbRef(rtdb, `status/${uid}`);
        const connectedRef = rtdbRef(rtdb, '.info/connected');

        rtdbConnectedUnsubscribe = onRtdbValue(connectedRef, (snap) => {
            if (snap.val() === true) {
                onDisconnect(myStatusRef).set({
                    online: false,
                    lastSeen: rtdbServerTimestamp()
                });
                setRtdb(myStatusRef, {
                    online: true,
                    lastSeen: rtdbServerTimestamp()
                });
            }
        });
    }).catch((err) => {
        console.warn("RTDB presence auth sync error:", err);
    });
};

window.odpojRtdbPresence = async (uid) => {
    rtdbCurrentPresenceUid = null;
    if (rtdbConnectedUnsubscribe) {
        rtdbConnectedUnsubscribe();
        rtdbConnectedUnsubscribe = null;
    }
    const targetUid = uid || window.auth?.currentUser?.uid;
    if (targetUid && window.app) {
        try {
            const rtdb = getDatabase(window.app);
            const myStatusRef = rtdbRef(rtdb, `status/${targetUid}`);
            await setRtdb(myStatusRef, {
                online: false,
                lastSeen: rtdbServerTimestamp()
            });
        } catch (e) {}
    }
};

// 👀 VSTUP PRO HOSTA S ŽIVOU RTDB TELEMETRIÍ (ZERO AUTH)
window.enterAsGuest = () => {
    const store = Alpine.store('appState');
    if (!store) return;

    store.isGuest = true;
    store.nickname = 'Host';
    store.selectedLeague = null;
    store.selectedAdminLeague = null;
    localStorage.setItem('savedScreen', 'leaguesScreen');
    localStorage.removeItem('savedLeague');

    try {
        let guestSessionId = sessionStorage.getItem('tipni_guest_session_id');
        const isNewSession = !guestSessionId;
        if (!guestSessionId) {
            guestSessionId = 'guest_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
            sessionStorage.setItem('tipni_guest_session_id', guestSessionId);
        }

        if (window.app) {
            const rtdb = getDatabase(window.app);
            const myGuestRef = rtdbRef(rtdb, `guest_presence/${guestSessionId}`);

            onDisconnect(myGuestRef).remove();
            setRtdb(myGuestRef, {
                online: true,
                ts: rtdbServerTimestamp()
            });

            if (isNewSession) {
                const totalRef = rtdbRef(rtdb, 'guest_stats/total');
                const lastSeenRef = rtdbRef(rtdb, 'guest_stats/lastSeen');
                runTransaction(totalRef, (count) => (count || 0) + 1);
                setRtdb(lastSeenRef, rtdbServerTimestamp());
            }
        }
    } catch (err) {
        console.warn("RTDB guest telemetry error:", err);
    }

    window.goToScreen('leaguesScreen', false);
};

// 🔗 PROPOJENÍ STÁVAJÍCÍHO ÚČTU S GOOGLE (PO PŘIHLÁŠENÍ HESLEM V MENU)
window.linkCurrentAccountWithGoogle = async () => {
    try {
        const user = window.auth.currentUser;
        if (!user) return;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await linkWithPopup(user, provider);
        if (typeof window.showToast === 'function') {
            window.showToast("🎉 Účet úspěšně propojen s Googlem! Příště se přihlásíš 1 klikem.", false);
        }
        const store = Alpine.store('appState');
        if (store) store.canLinkGoogle = false;
    } catch (err) {
        if (err.code === 'auth/popup-closed-by-user') return;
        console.error("Chyba propojení:", err);
        if (typeof window.showToast === 'function') {
            if (err.code === 'auth/credential-already-in-use') {
                window.showToast("🛑 Tento Google účet už používá jiný hráč!", true);
            } else {
                window.showToast("❌ Chyba propojení: " + err.message, true);
            }
        }
    }
};

// 🎓 ZÁPIS DOKONČENÍ PRŮVODCE DO CLOUDU (FIRESTORE)
window.completeTutorial = async () => {
    const user = window.auth?.currentUser;
    if (!user) return;
    try {
        await updateDoc(doc(window.db, 'users', user.uid), {
            hasSeenTutorial: true
        });
    } catch (err) {
        console.warn("Uložení stavu průvodce selhalo:", err);
    }
};

// 🔑 PŘIHLÁŠENÍ E-MAILEM A HESLEM (S OKAMŽITÝM PŘEPNUTÍM OBRAZOVKY)
window.checkLogin = async () => {
    const email = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorBox = document.getElementById('loginError');
    const store = Alpine.store('appState');

    try {
        if (store) store.currentScreen = 'splashScreen';
        if (typeof window.showSplash === 'function') window.showSplash("Přihlašuji...");
        const userCredential = await signInWithEmailAndPassword(window.auth, email, pass);
        console.log("Firebase Auth: Ověření úspěšné.");
        if (errorBox) errorBox.style.display = 'none';

    } catch (error) {
        if (store) store.currentScreen = 'loginScreen';
        if (typeof window.hideSplash === 'function') window.hideSplash();
        console.error("Chyba přihlášení:", error.message);
        if (errorBox) {
            errorBox.style.display = 'block';
            errorBox.innerText = "❌ Chyba: Špatný e-mail nebo heslo.";
        }
    }
};

// 🌐 1. PŘIHLÁŠENÍ & REGISTRACE PŘES GOOGLE (ČISTÝ STANDARDNÍ TOK)
window.loginWithGoogle = async () => {
    const errorBox = document.getElementById('loginError');
    if (errorBox) errorBox.style.display = 'none';

    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(window.auth, provider);
    } catch (error) {
        if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return;
        console.error("Chyba Google přihlášení:", error.message);
        if (typeof window.showToast === 'function') {
            window.showToast("❌ Chyba Google: " + (error.code === 'auth/unauthorized-domain' ? 'Doména nepovolena ve Firebase Console!' : error.message), true);
        }
    }
};
window.registerWithGoogle = window.loginWithGoogle;

// ✉️ 5. REGISTRACE POMOCÍ E-MAILU A HESLA
window.registerWithEmail = async () => {
    const email = document.getElementById('regEmail')?.value?.trim() || '';
    const pass = document.getElementById('regPassword')?.value || '';
    const passConfirm = document.getElementById('regPasswordConfirm')?.value || '';

    if (!email || !pass || !passConfirm) {
        if (typeof window.showToast === 'function') window.showToast("Vyplň prosím e-mail i obě hesla.", true);
        return;
    }
    if (pass.length < 6) {
        if (typeof window.showToast === 'function') window.showToast("Heslo musí mít minimálně 6 znaků.", true);
        return;
    }
    if (pass !== passConfirm) {
        if (typeof window.showToast === 'function') window.showToast("Zadaná hesla se neshodují!", true);
        return;
    }

    if (typeof window.showSplash === 'function') window.showSplash("Vytvářím účet...");

    try {
        const cred = await createUserWithEmailAndPassword(window.auth, email, pass);
    } catch (err) {
        if (typeof window.hideSplash === 'function') window.hideSplash();
        console.error("Chyba registrace e-mailem:", err);
        let msg = "Registrace se nezdařila.";
        if (err.code === 'auth/email-already-in-use') msg = "Tento e-mail je již zaregistrován. Přihlas se.";
        else if (err.code === 'auth/invalid-email') msg = "Neplatný formát e-mailu.";
        else if (err.code === 'auth/weak-password') msg = "Heslo je příliš slabé.";
        if (typeof window.showToast === 'function') window.showToast("❌ " + msg, true);
    }
};
// ŽIVÉ PŘEPÍNÁNÍ VIDITELNOSTI HESLA (OČKO) - UNIVERZÁLNÍ PRO LOGIN I REGISTRACI
window.togglePasswordVisibility = (inputId = 'password', toggleId = 'togglePassword') => {
    const passwordInput = document.getElementById(inputId);
    const toggleIcon = document.getElementById(toggleId);
    if (!passwordInput) return;
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        if (toggleIcon) toggleIcon.innerText = '🙈';
    } else {
        passwordInput.type = 'password';
        if (toggleIcon) toggleIcon.innerText = '👁️';
    }
};

window.logout = async () => {
    const store = Alpine.store('appState');
    if (store?.isGuest) {
        const guestSessionId = sessionStorage.getItem('tipni_guest_session_id');
        if (guestSessionId && window.app) {
            try {
                const rtdb = getDatabase(window.app);
                await setRtdb(rtdbRef(rtdb, `guest_presence/${guestSessionId}`), null);
            } catch(e) {}
        }
        sessionStorage.removeItem('tipni_guest_session_id');
        store.isGuest = false;
        store.nickname = '';
        localStorage.removeItem('savedScreen');
        localStorage.removeItem('savedLeague');
        location.reload();
        return;
    }

    if (window.userProfileUnsubscribe) { 
        window.userProfileUnsubscribe(); 
        window.userProfileUnsubscribe = null; 
    }
    if (window.userOnlineUnsubscribe) { 
        window.userOnlineUnsubscribe(); 
        window.userOnlineUnsubscribe = null; 
    }
    if (window.userSezonaUnsubscribe) { 
        window.userSezonaUnsubscribe(); 
        window.userSezonaUnsubscribe = null; 
    }
    if (window.globalAdminUsersUnsubscribe) { 
        window.globalAdminUsersUnsubscribe(); 
        window.globalAdminUsersUnsubscribe = null; 
    }

    if (window.activeSurveyUnsubscribe) {
        window.activeSurveyUnsubscribe();
        window.activeSurveyUnsubscribe = null;
    }

    // 🧹 Úklid databáze před odchodem: Kompletní promazání relačních klíčů z paměti zařízení
    const user = window.auth.currentUser;
    if (user) {
        await window.odpojRtdbPresence(user.uid);
    }

    // Dokonalé vyčištění klientského stavu (zabezpečení proti míchání účtů na 1 mobilu)
    localStorage.removeItem('savedScreen');
    localStorage.removeItem('savedLeague');

    await signOut(window.auth);
    location.reload();
};

// Globální proměnné pro uložení vypínačů živého spojení
window.userProfileUnsubscribe = window.userProfileUnsubscribe || null;
window.userOnlineUnsubscribe = window.userOnlineUnsubscribe || null;
window.userSezonaUnsubscribe = window.userSezonaUnsubscribe || null;
window.globalAdminUsersUnsubscribe = window.globalAdminUsersUnsubscribe || null;

// 🚚 JEDNORÁZOVÁ MIGRACE Z FIRESTORE DO RTDB (SPUSTÍ SE JEN PŘI PRÁZDNÉM STAVU)
window.migrujUzivateleDoRtdb = async () => {
    const store = Alpine.store('appState');
    if (!store?.isSuperAdmin) return;
    try {
        const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-functions.js");
        const syncCF = httpsCallable(window.functions, 'syncAllUsersToRtdbCF');
        const res = await syncCF();
        if (typeof window.showToast === 'function') {
            window.showToast(`🚚 ${res.data.message}`);
        }
    } catch (e) {
        console.warn("Automatická migrace do RTDB:", e.message);
    }
};

// 👥 ŽIVÝ RADAR UŽIVATELŮ (RTDB WEBSOCKET ENGINE - 0 FIRESTORE READS, 0 KČ)
window.spustZivyAdminRadarUzivatelu = () => {
    if (window.globalAdminUsersUnsubscribe) return;
    const store = Alpine.store('appState');
    if (store && (!store.adminUsers || store.adminUsers.length === 0)) {
        store.adminUsers = [];
        store.adminUsersLoaded = false;
    }

    const rtdb = getDatabase(window.app);
    const rosterRef = rtdbRef(rtdb, 'admin_roster');

    window.globalAdminUsersUnsubscribe = onRtdbValue(rosterRef, (snapshot) => {
        const data = snapshot.val() || {};
        const userIds = Object.keys(data);

        // 🚀 Samodiagnostika: Pokud je RTDB větev ještě prázdná, SuperAdmin provede jednorázovou migraci
        if (userIds.length === 0 && store?.isSuperAdmin) {
            window.migrujUzivateleDoRtdb();
            return;
        }

        const uzivatele = [];
        const spravci = [];
        const MASTER_LIGY = ['Chance Liga', 'Premier League', 'Liga mistrů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];
        const liveCounts = {};
        MASTER_LIGY.forEach(l => { liveCounts[l] = 0; });

        userIds.forEach(uid => {
            const uData = data[uid] || {};

            // 🎯 Počítáme VŠECHNY hráče v lize včetně SuperAdmina
            MASTER_LIGY.forEach(lName => {
                const hasLeague = uData.isSuperAdmin === true || (Array.isArray(uData.leagues) && uData.leagues.includes(lName));
                if (hasLeague) {
                    liveCounts[lName]++;
                }
            });

            // 👑 SPRÁVCI PRO LOUTKOVODIČE: Všichni administrátoři i SuperAdmin
            if (uData.isAdmin === true || uData.isSuperAdmin === true) {
                spravci.push({
                    id: uid,
                    ...uData
                });
            }

            // 👥 TABULKA UŽIVATELŮ: Pouze běžní hráči (SuperAdmin zde nestraší)
            if (uData.isSuperAdmin !== true) {
                uzivatele.push({
                    id: uid,
                    ...uData,
                    maZadnouLigu: !uData.leagues || uData.leagues.length === 0
                });
            }
        });

        // 🎯 Abecední řazení A–Z podle české diakritiky
        uzivatele.sort((a, b) => (a.nickname || 'Nový Hráč').localeCompare(b.nickname || 'Nový Hráč', 'cs'));
        spravci.sort((a, b) => (a.nickname || 'Admin').localeCompare(b.nickname || 'Admin', 'cs'));

        // 🎯 STABILNÍ POČÍTADLO: Aktivní hráči s ligou (mimo čekárnu)
        const aktivniTiperiCount = userIds.filter(uid => {
            const u = data[uid] || {};
            return u.isSuperAdmin === true || (Array.isArray(u.leagues) && u.leagues.length > 0);
        }).length;

        window.adminUsersCache = uzivatele;
        window.adminManagersCache = spravci;

        if (store) {
            store.adminUsers = uzivatele;
            store.adminManagers = spravci;
            store.adminUsersLoaded = true;
            store.leaguePlayerCounts = liveCounts;
            store.communityTotal = aktivniTiperiCount;
            store.leagueFilterTick++;
        }

        // ⚡ OKAMŽITÉ PŘEKRESLENÍ SUPERADMIN PANELU (BEZ F5)
        if (store?.currentScreen === 'superAdminScreen' && window.superAdminActiveTab === 'users' && typeof window.vykresliSuperAdminUzivatele === 'function') {
            window.vykresliSuperAdminUzivatele(uzivatele);
        }

        console.log(`👥 ŽIVÝ RADAR UŽIVATELŮ (RTDB 0 READS): Aktualizováno ${uzivatele.length} hráčů.`);
    }, (err) => console.error("Chyba RTDB radaru uživatelů:", err));
};

// 🎯 DYNAMICKÝ LISTENER TIPŮ: Umí se okamžitě přehlástit na jakoukoliv vybranou sezónu
window.obnovSluchatkoMojeTipy = (uid) => {
    if (!uid) return;
    if (window.userSezonaUnsubscribe) {
        window.userSezonaUnsubscribe();
        window.userSezonaUnsubscribe = null;
    }

    const store = Alpine.store('appState');
    const aktivniSezona = store?.activeSeason || window.SEZONA_ID || '2026_2027';

    window.userSezonaUnsubscribe = onSnapshot(doc(window.db, 'users', uid, 'sezony', aktivniSezona), (sezonaSnap) => {
        console.log(`🪐 Detekována živá změna herní sezóny [${aktivniSezona}]!`);
        const sezonaData = sezonaSnap.exists() ? sezonaSnap.data() : {};
        
        if (store) {
            store.rawSezonaData = sezonaData;
        }

        const aktLiga = store?.selectedLeague || localStorage.getItem('savedLeague') || 'Chance Liga';
        if (typeof window.aktualizujMojeTipyProLigu === 'function') {
            window.aktualizujMojeTipyProLigu(aktLiga);
        }

        if (store?.currentScreen === 'matchesScreen' && store?.selectedLeague && typeof window.renderMatches === 'function') {
            window.renderMatches(store.selectedLeague);
        }
    }, (err) => console.error("Chyba streamu sezóny:", err));
};

// 🔐 DETERMINISTICKÝ AUTH & PROFILOVÝ ROUTER (BEZ TIMEOUTŮ A BEZ RACE CONDITIONS)
const vykonejBezpecnyAuthRouting = (user) => {
    const store = Alpine.store('appState');
    if (!store) return;

    if (!user) {
        // 🛑 JISTIČ HOSTA: Pokud si aplikaci prohlíží host, neodhazujeme ho na login obrazovku
        if (store.isGuest) return;

        if (window.userProfileUnsubscribe) { 
            window.userProfileUnsubscribe(); 
            window.userProfileUnsubscribe = null; 
        }
        if (window.userOnlineUnsubscribe) {
            window.userOnlineUnsubscribe();
            window.userOnlineUnsubscribe = null;
        }
        if (window.userSezonaUnsubscribe) {
            window.userSezonaUnsubscribe();
            window.userSezonaUnsubscribe = null;
        }
        window.odpojRtdbPresence();
        window.currentAuthUid = null;

        if (store.currentScreen !== 'loginScreen') {
            store.currentScreen = 'loginScreen';
        }
        store.isAdmin = false;
        store.isSuperAdmin = false;
        store.adminLeagues = [];
        store.nickname = '';
        store._leagues = [];
        
        if (typeof window.hideSplash === 'function') window.hideSplash();
        return;
    }

    console.log("Uživatel ověřen přes native token stream, UID:", user.uid);
    window.spustRtdbPresence(user.uid);

    if (store.currentScreen === 'loginScreen') {
        store.currentScreen = 'splashScreen';
    }
    if (typeof window.showSplash === 'function') {
        window.showSplash("Načítání profilu...");
    } else if (typeof window.setSplashText === 'function') {
        window.setSplashText("Načítání profilu...");
    }

    const emailLabel = document.getElementById('userMenuEmail');
    if (emailLabel) emailLabel.innerText = user.email || '';

    // 🛡️ JISTIČ SMYČKY: Pokud už pro toto UID živé sluchátko běží, neobnovujeme
    if (window.currentAuthUid === user.uid && window.userProfileUnsubscribe) {
        return;
    }
    window.currentAuthUid = user.uid;

    if (window.userProfileUnsubscribe) window.userProfileUnsubscribe();

    const userDocRef = doc(window.db, 'users', user.uid);

    window.userProfileUnsubscribe = onSnapshot(userDocRef, (docSnap) => {
        console.log("🔔 Detekována živá změna profilu na Firebase přes UID!");

        const userData = docSnap.exists() ? docSnap.data() : null;
        const targetLeagues = userData?.leagues || [];

        // ⚡ OKAMŽITÁ HYDRATACE Z DISKOVÉ CACHE (0 ms bez čekání na síť)
        store.isSuperAdmin = userData?.isSuperAdmin === true;
        store.isAdmin = userData?.isAdmin === true || store.isSuperAdmin;
        store.adminLeagues = userData?.adminLeagues || [];
        store.canLinkGoogle = !user.providerData.some(p => p.providerId === 'google.com');
        store.leagueOrder = userData?.leagueOrder || [];
        store.lastLeagueOrderChange = userData?.lastLeagueOrderChange?.toMillis ? userData.lastLeagueOrderChange.toMillis() : (userData?.lastLeagueOrderChange || 0);

        if (store.isAdmin) {
            window.spustZivyAdminRadarUzivatelu();
            if (typeof window.nacistAdminModul === 'function') {
                window.nacistAdminModul();
            }
        } else if (window.globalAdminUsersUnsubscribe) {
            window.globalAdminUsersUnsubscribe();
            window.globalAdminUsersUnsubscribe = null;
        }

        store.showSurveys = userData?.showSurveys !== undefined ? userData.showSurveys : true;

        store.notifyUntipped = localStorage.getItem('tipni_notify_untipped') === 'true' || userData?.notifyUntipped === true;

        const AKTIVNI_MASTER_LIGY = ['Chance Liga', 'Premier League', 'Liga mistrů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];
        store.leagues = store.isSuperAdmin 
            ? AKTIVNI_MASTER_LIGY 
            : (targetLeagues.length > 0 ? targetLeagues : []);

        window.obnovSluchatkoMojeTipy(user.uid);

        // 🎯 ATOMICKÝ START: Máme přezdívku z cache? Okamžitě otevíráme appku!
        if (userData && userData.nickname) {
            store.nickname = userData.nickname;
            const nickLabel = document.getElementById('userMenuNickname');
            if (nickLabel) nickLabel.innerText = store.nickname;

            if (typeof window.zkontrolujAktivniAnketu === 'function') {
                window.zkontrolujAktivniAnketu();
            }

            if (store.currentScreen === 'splashScreen' || store.currentScreen === 'nicknameScreen' || store.currentScreen === 'loginScreen') {
                const pending = window.pendingDeepLink;
                if (pending && pending.league && typeof window.selectLeague === 'function') {
                    window.pendingDeepLink = null;
                    window.selectLeague(pending.league, pending.screen || 'matchesScreen');
                } else {
                    store.selectedLeague = null;
                    store.selectedAdminLeague = null;
                    localStorage.removeItem('savedLeague');
                    localStorage.setItem('savedScreen', 'leaguesScreen');
                    window.goToScreen('leaguesScreen', false);
                }
            }
            // 🎭 POČKÁME NA ALPINE: Opona sjede až ve chvíli, kdy jsou karty lig kompletně v DOMu
            if (typeof window.hideSplash === 'function') {
                if (window.Alpine?.nextTick) {
                    Alpine.nextTick(() => window.hideSplash());
                } else {
                    window.hideSplash();
                }
            }

            if (userData.hasSeenTutorial !== true && typeof window.openTutorial === 'function') {
                window.openTutorial();
            }
        } else {
            const nickLabel = document.getElementById('userMenuNickname');
            if (nickLabel) nickLabel.innerText = "Nový hráč";
            store.currentScreen = 'nicknameScreen';
            if (typeof window.hideSplash === 'function') window.hideSplash();
        }

        user.getIdTokenResult().then(tokenResult => {
            const claims = tokenResult?.claims || {};
            if (claims.isSuperAdmin) store.isSuperAdmin = true;
            if (claims.isAdmin) store.isAdmin = true;
            if (claims.adminLeagues && Array.isArray(claims.adminLeagues)) {
                store.adminLeagues = claims.adminLeagues;
            }
            if (claims.leagues && (!store.leagues || store.leagues.length === 0)) {
                store.leagues = claims.leagues;
            }
        }).catch(() => {});

    }, (err) => {
        console.error("Kritická chyba živého spojení přes UID:", err);
    });
};

// 🚀 DETERMINISTICKÝ START HLÍDAČE IDENTITY
onIdTokenChanged(window.auth, (user) => {
    if (typeof window.setSplashText === 'function') window.setSplashText("Ověřuji uživatele...");

    if (window.Alpine && Alpine.store('appState')) {
        vykonejBezpecnyAuthRouting(user);
    } else {
        document.addEventListener('alpine:initialized', () => {
            vykonejBezpecnyAuthRouting(user);
        }, { once: true });
    }
});

// Odchycení instalačního promptu pro oranžové tlačítko
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) installBtn.style.display = 'block';
});

window.triggerPwaInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        const installBtn = document.getElementById('pwaInstallBtn');
        if (installBtn) installBtn.style.display = 'none';
    }
    deferredPrompt = null;
};

window.addEventListener('appinstalled', () => {
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) installBtn.style.display = 'none';
    deferredPrompt = null;
});