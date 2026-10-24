// =========================================================================
// 👥 TIPNI TO! - SOUKROMÉ SKUPINY & MINILIGY ENGINE (groups.js)
// Realtime Database Zero-Cost Engine (0 Firestore reads i writes pro skupiny)
// =========================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, auth, admin, FieldValue, DEFAULT_SEASON_ID, RENDER_BOT_URL, BOT_SECRET } = require("./init");
const { getDatabase } = require("firebase-admin/database");

// 🔤 BEZPEČNÁ ABECEDA PRO 6MÍSTNÝ KÓD (vynechány snadno zaměnitelné znaky: 0, O, 1, I, L)
const KOD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function vygeneruj6MistyKod() {
  let kod = "";
  for (let i = 0; i < 6; i++) {
    kod += KOD_CHARS.charAt(Math.floor(Math.random() * KOD_CHARS.length));
  }
  return kod;
}

// 📡 LOKÁLNÍ MAJÁK A VÝZVA PRO BOTA
async function cinkniSkupinovyMajak(leagueName) {
  const ligaKlic = String(leagueName || "").replace(/ /g, "_");
  const rtdb = getDatabase();

  try {
    await rtdb.ref(`system/leagues_pulse/${ligaKlic}`).set({
      ts: Date.now(),
      source: "user",
      type: "groups",
      league: leagueName
    });
  } catch (e) {}

  if (RENDER_BOT_URL) {
    try {
      const secretParam = BOT_SECRET ? `&key=${BOT_SECRET}` : "";
      fetch(`${RENDER_BOT_URL.replace(/\/+$/, "")}/recalculate?league=${encodeURIComponent(leagueName)}${secretParam}`, {
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});
    } catch (e) {}
  }
}

// 🛡️ POMOCNÁ KONTROLA GILOTINY PODLE TERMÍNU PRVNÍHO ZÁPASU LIGY
async function zkontrolujGilotinuLigy(leagueName, sezonaId = DEFAULT_SEASON_ID) {
  const ligaRef = db.collection("ligy").doc(leagueName);
  const ligaDoc = await ligaRef.get();
  let zacatekMs = 0;

  if (ligaDoc.exists && ligaDoc.data()?.zacatek) {
    const z = ligaDoc.data().zacatek;
    zacatekMs = z.toDate ? z.toDate().getTime() : (z.seconds ? z.seconds * 1000 : new Date(z).getTime());
  } else {
    // 🛡️ AUTO-HEAL: Pokud v lize zacatek chybí, vyhledáme datum 1. zápasu v sezóně
    const snap = await ligaRef.collection("sezony").doc(sezonaId)
      .collection("zapasy")
      .orderBy("datum", "asc")
      .limit(1)
      .get();

    if (!snap.empty) {
      const d = snap.docs[0].data()?.datum;
      if (d) {
        zacatekMs = d.toDate ? d.toDate().getTime() : (d.seconds ? d.seconds * 1000 : new Date(d).getTime());
        await ligaRef.set({ zacatek: admin.firestore.Timestamp.fromMillis(zacatekMs) }, { merge: true });
      }
    }
  }

  if (zacatekMs > 0 && Date.now() >= zacatekMs) {
    throw new HttpsError(
      "failed-precondition",
      "Sezóna této ligy již odstartovala! Skupiny jsou uzamčeny a nelze zakládat nové ani se připojovat."
    );
  }
}

// 🧹 EXEKUCE GILOTINY V RTDB: Aktivace part s >=10 členy a okamžitý tvrdý výmaz neúplných (<10)
async function evaluateGroupsGuillotine(leagueName, sezonaId = DEFAULT_SEASON_ID) {
  try {
    const ligaRef = db.collection("ligy").doc(leagueName);
    const ligaDoc = await ligaRef.get();
    let zacatekMs = 0;

    if (ligaDoc.exists && ligaDoc.data()?.zacatek) {
      const z = ligaDoc.data().zacatek;
      zacatekMs = z.toDate ? z.toDate().getTime() : (z.seconds ? z.seconds * 1000 : new Date(z).getTime());
    }

    if (zacatekMs === 0 || Date.now() + (3 * 60 * 1000) < zacatekMs) {
      return { skipped: true };
    }

    const rtdb = getDatabase();
    const ligaKlic = String(leagueName || "").replace(/ /g, "_");
    const snap = await rtdb.ref(`skupiny/${sezonaId}/${ligaKlic}`).get();

    if (!snap.exists()) return { processed: 0, aktivovano: 0, smazano: 0 };

    const skupinyObj = snap.val() || {};
    let aktivovano = 0;
    let smazano = 0;

    for (const [gId, grp] of Object.entries(skupinyObj)) {
      if (grp.status !== "PENDING") continue;
      const clenove = Array.isArray(grp.clenove) ? grp.clenove : [];

      if (clenove.length >= 10) {
        await rtdb.ref(`skupiny/${sezonaId}/${ligaKlic}/${gId}`).update({
          status: "ACTIVE",
          activatedAt: Date.now(),
          aktualizovano: Date.now()
        });
        aktivovano++;
      } else {
        await rtdb.ref(`skupiny/${sezonaId}/${ligaKlic}/${gId}`).remove();
        smazano++;
      }
    }

    if (aktivovano > 0 || smazano > 0) {
      await cinkniSkupinovyMajak(leagueName);
    }

    console.log(`🧹 GILOTINA SKUPIN RTDB [${leagueName}]: Aktivováno ${aktivovano} part, smazáno ${smazano} neúplných skupin.`);
    return { processed: Object.keys(skupinyObj).length, aktivovano, smazano };
  } catch (err) {
    console.error(`❌ Chyba v evaluateGroupsGuillotine pro ${leagueName}:`, err);
    return { error: err.message };
  }
}

// ➕ FUNKCE 1: Založení nové skupiny v RTDB s generováním 6místného kódu
const createGroupCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro založení skupiny musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const rawNazev = (request.data?.nazev || "").trim();
  const liga = (request.data?.liga || "").trim();
  const sezonaId = request.data?.sezonaId || DEFAULT_SEASON_ID || "2026_2027";

  if (!liga) {
    throw new HttpsError("invalid-argument", "Chybí název soutěže!");
  }
  const POVOLENE_LIGY = [
    'Chance Liga',
    'Premier League',
    'Liga mistrů',
    'Tipsport Extraliga',
    'MS v hokeji',
    'MS ve fotbale'
  ];

  if (!POVOLENE_LIGY.includes(liga)) {
    throw new HttpsError("invalid-argument", `Soutěž "${liga}" není v systému podporována!`);
  }

  if (!rawNazev || rawNazev.length < 3 || rawNazev.length > 30) {
    throw new HttpsError("invalid-argument", "Název skupiny musí mít 3 až 30 znaků!");
  }

  // ⏱️ Ochrana proti spamu a zběsilému klikání (Rate-limit 3s)
  const rtdb = getDatabase();
  const limitRef = rtdb.ref(`system/rate_limits/groups_create/${uid}`);
  const limitSnap = await limitRef.get();
  const lastCall = limitSnap.val() || 0;
  const nowMs = Date.now();

  if (nowMs - lastCall < 3000) {
    throw new HttpsError("resource-exhausted", "Zpomal! Počkej chvíli před dalším pokusem.");
  }
  await limitRef.set(nowMs);

  // 1. Kontrola gilotiny výkopu prvního zápasu
  await zkontrolujGilotinuLigy(liga, sezonaId);

  // 2. Normalizace názvu pro kontrolu unikátnosti v rámci dané ligy
  const cleanNazev = rawNazev.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

  const ligaKlic = String(liga).replace(/ /g, "_");
  const seasonGroupsSnap = await rtdb.ref(`skupiny/${sezonaId}`).get();
  const allLeaguesData = seasonGroupsSnap.exists() ? (seasonGroupsSnap.val() || {}) : {};
  const currentLeagueGroups = allLeaguesData[ligaKlic] || {};

  // 3. Kontrola: Zakladatel smí mít v dané lize maximálně 1 aktivní/čekající skupinu
  const maAktivni = Object.values(currentLeagueGroups).some(g => g.autorUid === uid && g.status !== "CANCELLED");
  if (maAktivni) {
    throw new HttpsError("already-exists", `V soutěži ${liga} už máš založenou jednu skupinu!`);
  }

  // 4. Kontrola duplicity názvu v dané lize
  const nazevExistuje = Object.values(currentLeagueGroups).some(g => g.cleanNazev === cleanNazev && g.status !== "CANCELLED");
  if (nazevExistuje) {
    throw new HttpsError("already-exists", `Skupina s názvem "${rawNazev}" již v této lize existuje! Zvol jiný název.`);
  }

  // 5. Vygenerování 6místného kódu unikátního v celé sezóně
  let kod = "";
  let jeUnikatni = false;
  let pokusu = 0;

  while (!jeUnikatni && pokusu < 10) {
    pokusu++;
    kod = vygeneruj6MistyKod();
    let kolize = false;
    for (const lData of Object.values(allLeaguesData)) {
      if (lData && lData[kod]) {
        kolize = true;
        break;
      }
    }
    if (!kolize) {
      jeUnikatni = true;
    }
  }

  if (!jeUnikatni) {
    throw new HttpsError("internal", "Nepodařilo se vygenerovat unikátní kód, zkus to prosím znovu.");
  }

  // 6. Uložení skupiny do RTDB
  const groupPayload = {
    id: kod,
    kod: kod,
    nazev: rawNazev,
    cleanNazev: cleanNazev,
    liga: liga,
    sezonaId: sezonaId,
    autorUid: uid,
    status: "PENDING", // PENDING = čeká na gilotinu a 10 hráčů
    clenove: [uid],
    ghostUids: [],
    pocetClenu: 1,
    createdAt: Date.now(),
    aktualizovano: Date.now()
  };

  await rtdb.ref(`skupiny/${sezonaId}/${ligaKlic}/${kod}`).set(groupPayload);

  // 👥 Privátní index hráče pro bezpečné a bleskové načtení vlastních part v mobilu (0 reads)
  await rtdb.ref(`user_groups/${uid}/${ligaKlic}/${kod}`).set({
    id: kod,
    kod: kod,
    nazev: rawNazev,
    liga: liga,
    autorUid: uid,
    status: "PENDING",
    joinedAt: Date.now()
  });

  // 7. Automatické odemčení licence soutěže pro zakladatele, pokud ji ještě neměl
  try {
    const userRef = db.collection("users").doc(uid);
    const uSnap = await userRef.get();
    const uData = uSnap.exists ? uSnap.data() : {};
    const curLeagues = uData.leagues || [];
    if (!curLeagues.includes(liga)) {
      await userRef.update({ leagues: admin.firestore.FieldValue.arrayUnion(liga) });
      try {
        await auth.setCustomUserClaims(uid, {
          ...((await auth.getUser(uid)).customClaims || {}),
          leagues: [...curLeagues, liga]
        });
      } catch (e) {}
    }

    const rosterLeaguesRef = rtdb.ref(`admin_roster/${uid}/leagues`);
    const rSnap = await rosterLeaguesRef.get();
    const aktualniLigy = rSnap.val() || [];
    if (!aktualniLigy.includes(liga)) {
      aktualniLigy.push(liga);
      await rosterLeaguesRef.set(aktualniLigy);
    }
  } catch (err) {
    console.warn("Automatická aktivace licence při založení skupiny varování:", err.message);
  }

  await cinkniSkupinovyMajak(liga);

  return {
    success: true,
    kod: kod,
    nazev: rawNazev,
    liga: liga,
    message: `Parta "${rawNazev}" byla úspěšně založena! Kód pro kamarády: ${kod}`
  };
});

// 🔑 FUNKCE 2: Atomické připojení ke skupině v RTDB podle kódu
const joinGroupCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro připojení ke skupině musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const rawKod = (request.data?.kod || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isGhostMode = Boolean(request.data?.isGhostMode);
  const sezonaId = request.data?.sezonaId || DEFAULT_SEASON_ID || "2026_2027";

  if (!rawKod || rawKod.length !== 6) {
    throw new HttpsError("invalid-argument", "Zadaný kód musí mít přesně 6 znaků!");
  }

  // ⏱️ OCHRANA PROTI BRUTE-FORCE HÁDÁNÍ KÓDŮ (Rate-limit 3s přes RTDB)
  const rtdb = getDatabase();
  const limitRef = rtdb.ref(`system/rate_limits/groups_join/${uid}`);
  const limitSnap = await limitRef.get();
  const lastCall = limitSnap.val() || 0;
  const nowMs = Date.now();

  if (nowMs - lastCall < 3000) {
    throw new HttpsError("resource-exhausted", "Zpomal! Kód lze zadávat maximálně jednou za 3 sekundy.");
  }
  await limitRef.set(nowMs);

  // 1. Nalezení skupiny napříč ligami v dané sezóně
  const seasonSnap = await rtdb.ref(`skupiny/${sezonaId}`).get();
  if (!seasonSnap.exists()) {
    throw new HttpsError("not-found", "Skupina s tímto kódem neexistuje! Zkontroluj překlep.");
  }

  const allLeagues = seasonSnap.val() || {};
  let targetLeagueKey = null;
  let targetGroup = null;

  for (const [lKlic, groupsInLeague] of Object.entries(allLeagues)) {
    if (groupsInLeague && groupsInLeague[rawKod]) {
      targetLeagueKey = lKlic;
      targetGroup = groupsInLeague[rawKod];
      break;
    }
  }

  if (!targetGroup) {
    throw new HttpsError("not-found", "Skupina s tímto kódem neexistuje! Zkontroluj překlep.");
  }

  if (targetGroup.status === "CANCELLED") {
    throw new HttpsError("failed-precondition", "Tato skupina byla zrušena.");
  }

  // 2. Kontrola gilotiny ligy
  await zkontrolujGilotinuLigy(targetGroup.liga, sezonaId);

  const clenove = Array.isArray(targetGroup.clenove) ? targetGroup.clenove : [];

  // Hráč už je členem -> vrátíme úspěch bez duplicitního zápisu
  if (clenove.includes(uid)) {
    return {
      success: true,
      alreadyMember: true,
      kod: rawKod,
      nazev: targetGroup.nazev,
      liga: targetGroup.liga,
      pocetClenu: targetGroup.pocetClenu || clenove.length,
      message: `Ve skupině "${targetGroup.nazev}" již jsi zapsán!`
    };
  }

  // 3. Zápis nového člena do RTDB
  const novyClenove = [...clenove, uid];
  const ghostUids = Array.isArray(targetGroup.ghostUids) ? targetGroup.ghostUids : [];
  const novyGhostUids = (isGhostMode && !ghostUids.includes(uid)) ? [...ghostUids, uid] : ghostUids;

  await rtdb.ref(`skupiny/${sezonaId}/${targetLeagueKey}/${rawKod}`).update({
    clenove: novyClenove,
    ghostUids: novyGhostUids,
    pocetClenu: novyClenove.length,
    aktualizovano: Date.now()
  });

  // 👥 Privátní index hráče pro bezpečné načtení party v mobilu (0 reads)
  await rtdb.ref(`user_groups/${uid}/${targetLeagueKey}/${rawKod}`).set({
    id: rawKod,
    kod: rawKod,
    nazev: targetGroup.nazev,
    liga: targetGroup.liga,
    autorUid: targetGroup.autorUid || null,
    status: targetGroup.status || "PENDING",
    joinedAt: Date.now()
  });

  // 4. Automatická aktivace licence pro soutěž
  const liga = targetGroup.liga;
  try {
    const userRef = db.collection("users").doc(uid);
    const uSnap = await userRef.get();
    const uData = uSnap.exists ? uSnap.data() : {};
    const curLeagues = uData.leagues || [];
    if (!curLeagues.includes(liga)) {
      await userRef.update({ leagues: admin.firestore.FieldValue.arrayUnion(liga) });
      try {
        await auth.setCustomUserClaims(uid, {
          ...((await auth.getUser(uid)).customClaims || {}),
          leagues: [...curLeagues, liga]
        });
      } catch (e) {}
    }

    const rosterLeaguesRef = rtdb.ref(`admin_roster/${uid}/leagues`);
    const rSnap = await rosterLeaguesRef.get();
    const aktualniLigy = rSnap.val() || [];
    if (!aktualniLigy.includes(liga)) {
      aktualniLigy.push(liga);
      await rosterLeaguesRef.set(aktualniLigy);
    }
  } catch (err) {
    console.warn("Automatická aktivace licence při vstupu do skupiny varování:", err.message);
  }

  await cinkniSkupinovyMajak(liga);

  return {
    success: true,
    kod: rawKod,
    nazev: targetGroup.nazev,
    liga: targetGroup.liga,
    pocetClenu: novyClenove.length,
    message: `Vítej v partě "${targetGroup.nazev}"!`
  };
});

// 🤖 FUNKCE 3: Doplnění bota TipniTo jako 10. hráče do neúplné party (Pravidlo 9+1)
const addBotToGroupCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro doplnění bota musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const { groupId, leagueName } = request.data || {};
  const sezonaId = request.data?.sezonaId || DEFAULT_SEASON_ID || "2026_2027";

  if (!groupId || !leagueName) {
    throw new HttpsError("invalid-argument", "Chybí ID skupiny nebo název ligy!");
  }

  // 1. Kontrola, zda sezóna ještě neodstartovala
  await zkontrolujGilotinuLigy(leagueName, sezonaId);

  const rtdb = getDatabase();
  const ligaKlic = String(leagueName).replace(/ /g, "_");
  const groupRef = rtdb.ref(`skupiny/${sezonaId}/${ligaKlic}/${groupId}`);
  const gSnap = await groupRef.get();

  if (!gSnap.exists()) {
    throw new HttpsError("not-found", "Skupina nebyla nalezena!");
  }

  const gData = gSnap.val() || {};

  // 2. Bota smí přizvat výhradně zakladatel party
  if (gData.autorUid !== uid) {
    throw new HttpsError("permission-denied", "Bota může do party doplnit pouze její zakladatel!");
  }

  const clenove = Array.isArray(gData.clenove) ? gData.clenove : [];

  // 3. Pojistka: Maximálně 1 bot na skupinu
  if (clenove.includes("bot_tipnito")) {
    throw new HttpsError("already-exists", "Bot TipniTo už v této partičce je!");
  }

  // 4. Přidání bota zakladatelem bez ohledu na počet členů
  const novyClenove = [...clenove, "bot_tipnito"];

  await groupRef.update({
    clenove: novyClenove,
    hasBot: true,
    pocetClenu: novyClenove.length,
    aktualizovano: Date.now()
  });

  // Zápis privátního indexu party pro bota do user_groups
  await rtdb.ref(`user_groups/bot_tipnito/${ligaKlic}/${groupId}`).set({
    id: groupId,
    kod: gData.kod || groupId,
    nazev: gData.nazev,
    liga: leagueName,
    status: gData.status || "PENDING",
    joinedAt: Date.now()
  });

  await cinkniSkupinovyMajak(leagueName);

  return {
    success: true,
    message: `🤖 Bot TipniTo byl úspěšně přidán do party "${gData.nazev}"!`
  };
});

// ✏️ FUNKCE 4: Přejmenování skupiny (Správce 1x za 24h, SuperAdmin neomezeně)
const renameGroupCF = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Pro přejmenování skupiny musíš být přihlášen!");
  }

  const uid = request.auth.uid;
  const isSuperAdmin = request.auth.token.isSuperAdmin === true || uid === "tfLmfp1twLbcFsxWrgNkZ7iQRC22";
  const { groupId, leagueName, newNazev } = request.data || {};
  const sezonaId = request.data?.sezonaId || DEFAULT_SEASON_ID || "2026_2027";

  if (!groupId || !leagueName || !newNazev) {
    throw new HttpsError("invalid-argument", "Chybí ID skupiny, liga nebo nový název!");
  }

  const cistyNazev = String(newNazev).trim();
  if (cistyNazev.length < 3 || cistyNazev.length > 30) {
    throw new HttpsError("invalid-argument", "Název skupiny musí mít 3 až 30 znaků!");
  }

  const rtdb = getDatabase();
  const ligaKlic = String(leagueName).replace(/ /g, "_");
  const groupRef = rtdb.ref(`skupiny/${sezonaId}/${ligaKlic}/${groupId}`);
  const snap = await groupRef.get();

  if (!snap.exists()) {
    throw new HttpsError("not-found", "Skupina nebyla nalezena!");
  }

  const grp = snap.val() || {};

  // 1. Oprávnění: Pouze správce skupiny (autorUid) nebo SuperAdmin
  const isOwner = (grp.autorUid === uid);
  if (!isOwner && !isSuperAdmin) {
    throw new HttpsError("permission-denied", "Pouze správce této partičky nebo SuperAdmin může změnit její název!");
  }

  // 2. Cooldown 24 hodin: Kontroluje se pouze u běžného správce, pokud již dříve název měnil
  if (!isSuperAdmin && grp.lastRename) {
    const cooldownMs = 24 * 60 * 60 * 1000;
    const diff = Date.now() - grp.lastRename;
    if (diff < cooldownMs) {
      const zbyvaHodin = Math.ceil((cooldownMs - diff) / (60 * 60 * 1000));
      throw new HttpsError(
        "resource-exhausted",
        `Název partičky lze změnit maximálně 1× za 24 hodin! Další změnu můžeš provést za ${zbyvaHodin} hod.`
      );
    }
  }

  // 3. Kontrola duplicity názvu v rámci dané ligy
  const cleanNazev = cistyNazev.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

  const allLeagueGroupsSnap = await rtdb.ref(`skupiny/${sezonaId}/${ligaKlic}`).get();
  const allLeagueGroups = allLeagueGroupsSnap.exists() ? (allLeagueGroupsSnap.val() || {}) : {};

  const duplicita = Object.entries(allLeagueGroups).some(([gId, gData]) => {
    return gId !== groupId && gData.cleanNazev === cleanNazev && gData.status !== "CANCELLED";
  });

  if (duplicita) {
    throw new HttpsError("already-exists", `Partička s názvem "${cistyNazev}" již v této lize existuje! Zvol jiný název.`);
  }

  // 4. Atomický multi-path zápis do RTDB (hlavní skupina + všichni členové)
  const now = Date.now();
  const updates = {};
  updates[`skupiny/${sezonaId}/${ligaKlic}/${groupId}/nazev`] = cistyNazev;
  updates[`skupiny/${sezonaId}/${ligaKlic}/${groupId}/cleanNazev`] = cleanNazev;
  updates[`skupiny/${sezonaId}/${ligaKlic}/${groupId}/lastRename`] = now;
  updates[`skupiny/${sezonaId}/${ligaKlic}/${groupId}/aktualizovano`] = now;

  const clenove = Array.isArray(grp.clenove) ? grp.clenove : [];
  for (const mUid of clenove) {
    updates[`user_groups/${mUid}/${ligaKlic}/${groupId}/nazev`] = cistyNazev;
    updates[`user_groups/${mUid}/${ligaKlic}/${groupId}/autorUid`] = grp.autorUid || uid;
  }

  await rtdb.ref().update(updates);

  // 5. Cinknutí majáku pro živou aktualizaci všech telefonů i bota
  await cinkniSkupinovyMajak(leagueName);

  return {
    success: true,
    newNazev: cistyNazev,
    message: `Název partičky byl úspěšně změněn na "${cistyNazev}"!`
  };
});

module.exports = {
  createGroupCF,
  joinGroupCF,
  addBotToGroupCF,
  renameGroupCF,
  evaluateGroupsGuillotine,
  zkontrolujGilotinuLigy
};