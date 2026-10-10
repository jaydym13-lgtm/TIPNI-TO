// =========================================================================
// ⚙️ TIPNI TO! - ADMIN PANEL & PŘEPOČETNÍ ENGINE NA CLOUDU (admin.js)
// =========================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, auth, admin, DEFAULT_SEASON_ID, RENDER_BOT_URL, BOT_SECRET } = require("./init");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getDatabase } = require("firebase-admin/database");

// 📡 RTDB MAJÁK: Okamžitý signál pro mobily i bota s Echo Guard ochranou (0 Firestore reads)
async function cinkniRtdbMajak(leagueName, typ = "all") {
  try {
    const lKlic = String(leagueName || "").replace(/ /g, "_");
    const rtdb = getDatabase();
    await rtdb.ref(`system/leagues_pulse/${lKlic}`).set({
      ts: Date.now(),
      source: "admin",
      type: typ,
      league: leagueName
    });
  } catch (err) {
    console.warn(`⚠️ RTDB Maják varování pro ${leagueName}:`, err.message);
  }
}

// ⚡ DELEGACE PŘEPOČTU NA BOTA: Asynchronní dispečer na Render daemon (0 Firestore reads v CF)
async function vyzviBotaKPrepoctu(leagueName = "all") {
  try {
    const lQuery = leagueName ? encodeURIComponent(leagueName) : "all";
    const botUrl = `${RENDER_BOT_URL.replace(/\/+$/, "")}/recalculate?league=${lQuery}`;
    console.log(`📡 ADMIN DISPEČER: Posílám signál botovi k přepočtu [${leagueName || "all"}]...`);

    const res = await fetch(botUrl, {
      method: "GET",
      headers: { "x-bot-secret": BOT_SECRET },
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      console.warn(`⚠️ ADMIN DISPEČER: Bot odpověděl chybovým kódem ${res.status}`);
      return false;
    }

    console.log(`✅ ADMIN DISPEČER: Bot potvrdil zařazení do fronty (status ${res.status}).`);
    return true;
  } catch (err) {
    console.warn(`⚠️ ADMIN DISPEČER: Nepodařilo se kontaktovat bota pro přepočet [${leagueName}]:`, err.message);
    return false;
  }
}

// 👑 FUNKCE 1: Správa oprávnění uživatelů
const manageUserPermissionsCF = onCall(async (request) => {
  // 🛡️ POUZE SUPER ADMIN SMÍ MĚNIT LICENCE A ROLE!
  if (!request.auth || !request.auth.token.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Pouze Super Admin má právo udělovat licence a administrátorská práva!");
  }

  const { targetUid, isAdminRole, leagues, adminLeagues } = request.data;
  const safeAdminLeagues = Array.isArray(adminLeagues) ? adminLeagues : [];

  try {
    await auth.setCustomUserClaims(targetUid, {
      isAdmin: isAdminRole,
      isSuperAdmin: request.auth.token.isSuperAdmin && targetUid === request.auth.uid,
      leagues: leagues,
      adminLeagues: safeAdminLeagues
    });

    await db.collection("users").doc(targetUid).update({
      isAdmin: isAdminRole,
      leagues: leagues,
      adminLeagues: safeAdminLeagues
    });

    // 🔒 BLESKOVÉ ZNEPLATNĚNÍ RELACE: Hráč nemůže ani minutu surfovat se starými právy
    await auth.revokeRefreshTokens(targetUid);

    const vsechnyDostupneLigy = ['Chance Liga', 'Premier League', 'Liga mistrů', 'MS ve fotbale', 'Tipsport Extraliga', 'MS v hokeji'];
    const registrPromises = vsechnyDostupneLigy.map(async (liga) => {
      const registrRef = db.collection("ligy").doc(liga).collection("stav").doc("registrovani");
      if (leagues.includes(liga)) {
        await registrRef.set({ [targetUid]: true }, { merge: true });
      } else {
        await registrRef.set({ [targetUid]: admin.firestore.FieldValue.delete() }, { merge: true });
      }
    });
    await Promise.all(registrPromises);

    // ⚡ RTDB SYNCHRONIZACE: Okamžitá aktualizace soupisky bez čtení z Firestore
    try {
      await getDatabase().ref(`admin_roster/${targetUid}`).update({
        isAdmin: isAdminRole,
        leagues: leagues,
        adminLeagues: safeAdminLeagues
      });
    } catch (rtdbErr) {
      console.warn("RTDB sync varování:", rtdbErr.message);
    }

    return { success: true, message: "Cejchy a ligové přístupy bezpečně aktualizovány!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🌪️ FUNKCE 2: Nuclear Purge
const purgeUserAbsoluteCF = onCall(async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený admin smí ukládat proxy data přes loutkovodiče!");
  }

  const { targetUid } = request.data;

  try {
    const batch = db.batch();
    const sezonaId = request.data.sezonaId || "2026_2027";

    batch.delete(db.collection("users").doc(targetUid).collection("sezony").doc(sezonaId));
    batch.delete(db.collection("uzivatele_online").doc(targetUid));
    batch.delete(db.collection("users").doc(targetUid));

    await batch.commit();
    try {
      await auth.revokeRefreshTokens(targetUid);
    } catch (e) {}
    await auth.deleteUser(targetUid);

    // ⚡ RTDB SYNCHRONIZACE: Okamžité vymazání soupisky i online přítomnosti
    try {
      const rtdb = getDatabase();
      await rtdb.ref(`admin_roster/${targetUid}`).remove();
      await rtdb.ref(`status/${targetUid}`).remove();
    } catch (rtdbErr) {
      console.warn("RTDB purge varování:", rtdbErr.message);
    }

    return { success: true, message: "Uživatel byl kompletně vymazán ze vesmíru!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 👑 FUNKCE 3: Loutkovodič (Autonomní okamžitý zápis do DB + R2 s delta aktualizací)
const saveProxyDataCF = onCall({ 
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený administrátor smí ukládat data přes loutkovodiče!");
  }

  const { targetUid, targetEmail, leagueName, vitez, strelec, tipyMapa } = request.data;
  const sezonaId = request.data.sezonaId || "2026_2027";
  const { kanadske } = request.data;
  const { updateBonus } = request.data;

  const isCallerSuperAdmin = request.auth.token.isSuperAdmin === true;
  const callerAdminLeagues = request.auth.token.adminLeagues || [];

  // 🛡️ 1. Ověření, že administrátor smí spravovat zapisovanou ligu
  if (!isCallerSuperAdmin && !callerAdminLeagues.includes(leagueName)) {
    throw new HttpsError("permission-denied", `Nemáš administrátorská oprávnění pro soutěž ${leagueName}!`);
  }

  // 🛡️ 2. Ověření, že cíl není Super Admin a není administrátorem v této lize
  const targetDoc = await db.collection("users").doc(targetUid).get();
  if (targetDoc.exists) {
    const tData = targetDoc.data() || {};
    if (tData.isSuperAdmin === true) {
      throw new HttpsError("permission-denied", "Účet Super Admina nelze ovládat přes Loutkovodiče!");
    }
    if (!isCallerSuperAdmin && (tData.adminLeagues || []).includes(leagueName)) {
      throw new HttpsError("permission-denied", `Hráč je v soutěži ${leagueName} rovněž administrátorem a nelze jej loutkovodit!`);
    }
  }

  try {
    const userSezonaRef = db.collection("users").doc(targetUid).collection("sezony").doc(sezonaId);
    const ligaKlic = leagueName.replace(/ /g, "_");
    
    const dotUpdateMap = {};

    if (updateBonus === true) {
      if (typeof vitez === "string") dotUpdateMap[`souteze.${ligaKlic}.bonusy.vitez`] = vitez.trim();
      if (typeof strelec === "string") dotUpdateMap[`souteze.${ligaKlic}.bonusy.strelec`] = strelec.trim();
      if (typeof kanadske === "string") dotUpdateMap[`souteze.${ligaKlic}.bonusy.kanadske`] = kanadske.trim();
      dotUpdateMap[`souteze.${ligaKlic}.bonusy.userId`] = targetUid;
      dotUpdateMap[`souteze.${ligaKlic}.bonusy.userEmail`] = targetEmail;
    }

    const dotceneMatchIds = tipyMapa ? Object.keys(tipyMapa) : [];
    for (const matchId of dotceneMatchIds) {
      const tipData = tipyMapa[matchId];
      if (tipData.isDeleted) {
        dotUpdateMap[`souteze.${ligaKlic}.tipy.${matchId}`] = admin.firestore.FieldValue.delete();
      } else {
        dotUpdateMap[`souteze.${ligaKlic}.tipy.${matchId}`] = {
          userId: targetUid,
          userEmail: targetEmail,
          matchId: matchId,
          tip_domaci: parseInt(tipData.tip_domaci, 10),
          tip_hoste: parseInt(tipData.tip_hoste, 10),
          postup: tipData.postup || ""
        };
      }
    }

    const docSnap = await userSezonaRef.get();
    if (docSnap.exists) {
      await userSezonaRef.update(dotUpdateMap);
    } else {
      await userSezonaRef.set(dotUpdateMap, { merge: true });
    }

    // ⚡ DELEGACE: Přepočet žebříčků i nahrávání na R2 obstará autonomní bot na Renderu
    await vyzviBotaKPrepoctu(leagueName);

    return { success: true, message: "Data byla přes loutkovodiče úspěšně uložena a bot zahájil přepočet!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 👑 FUNKCE 4: Generální rekalkulace žebříčku
const recalculateLeaderboardCF = onCall({ 
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  console.log("🚀 FORSÁŽ CLOUDU: Aktivuji bleskový přepočet žebříčku na R2.");
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený administrátor smí vynutit rekalkulaci žebříčku!");
  }

  const rawData = request.data || {};
  let leagueName = "";
  let sezonaId = DEFAULT_SEASON_ID;

  if (typeof rawData === 'string') {
    leagueName = rawData;
  } else if (typeof rawData === 'object') {
    leagueName = rawData.leagueName || "";
    sezonaId = rawData.sezonaId || DEFAULT_SEASON_ID;
  }

  if (!leagueName || typeof leagueName !== 'string') {
    throw new HttpsError("invalid-argument", "Chybí validní textový název soutěže k přepočtení!");
  }

  try {
    // ⚡ DELEGACE: Ruční přepočet delegován na Render daemona
    await vyzviBotaKPrepoctu(leagueName);
    return { success: true, message: `Generální přepočet ligy ${leagueName} pro sezónu ${sezonaId} byl delegován na bota!` };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🔮 FUNKCE 5: Transfér herních dat (Přelévání bodů, licencí a kompletní úklid RTDB & R2)
const transferUserDataCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || !request.auth.token.isSuperAdmin) {
    throw new HttpsError("permission-denied", "Tento vládní transfér smí spustit pouze Super Admin!");
  }

  const oldEmail = (request.data.oldEmail || "").trim().toLowerCase();
  const newEmail = (request.data.newEmail || "").trim().toLowerCase();
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID || "2026_2027";

  if (!oldEmail || !newEmail) {
    throw new HttpsError("invalid-argument", "Musíš zadat starý i nový e-mail!");
  }

  try {
    const [oldUserQuery, newUserQuery] = await Promise.all([
      db.collection("users").where("email", "==", oldEmail).get(),
      db.collection("users").where("email", "==", newEmail).get()
    ]);

    if (oldUserQuery.empty) {
      throw new HttpsError("not-found", `Původní uživatel s e-mailem ${oldEmail} nebyl v databázi nalezen!`);
    }
    if (newUserQuery.empty) {
      throw new HttpsError("not-found", `Cílový nový uživatel s e-mailem ${newEmail} neexistuje! Musí se nejprve registrovat.`);
    }

    const oldUserDoc = oldUserQuery.docs[0];
    const newUserDoc = newUserQuery.docs[0];
    const oldUid = oldUserDoc.id;
    const newUid = newUserDoc.id;
    const oldData = oldUserDoc.data() || {};
    const newData = newUserDoc.data() || {};

    const oldLeagues = oldData.leagues || [];
    const oldIsAdmin = oldData.isAdmin === true;
    const oldIsSuperAdmin = oldData.isSuperAdmin === true;

    // Sloučení licencí a zachování původní přezdívky
    const mergedLeagues = Array.from(new Set([...(newData.leagues || []), ...oldLeagues]));
    const targetNickname = oldData.nickname || newData.nickname || 'Hráč';

    // 1. Přenesení rolí a lig v Auth Claims nového uživatele
    try {
      await auth.setCustomUserClaims(newUid, {
        isAdmin: oldIsAdmin || newData.isAdmin === true,
        isSuperAdmin: oldIsSuperAdmin || newData.isSuperAdmin === true,
        leagues: mergedLeagues
      });
    } catch (claimsErr) {
      console.warn("Chyba při zápisu claims pro nového uživatele:", claimsErr.message);
    }

    // 2. Aktualizace Firestore profilu nového uživatele (včetně přezdívky)
    await db.collection("users").doc(newUid).update({
      nickname: targetNickname,
      leagues: mergedLeagues,
      isAdmin: oldIsAdmin || newData.isAdmin === true,
      isSuperAdmin: oldIsSuperAdmin || newData.isSuperAdmin === true
    });

    // 3. Aktualizace RTDB admin_roster (s původním nickem) a okamžitý úklid starého účtu
    const rtdb = getDatabase();
    try {
      await rtdb.ref(`admin_roster/${newUid}`).update({
        nickname: targetNickname,
        email: newEmail,
        leagues: mergedLeagues,
        isAdmin: oldIsAdmin || newData.isAdmin === true,
        isSuperAdmin: oldIsSuperAdmin || newData.isSuperAdmin === true
      });
      await rtdb.ref(`admin_roster/${oldUid}`).remove();
      await rtdb.ref(`status/${oldUid}`).remove();
    } catch (rtdbErr) {
      console.warn("RTDB sync/purge varování při transféru:", rtdbErr.message);
    }

    // 4. Přelití tipů v sezónním monolitu
    const oldSezonaRef = db.collection("users").doc(oldUid).collection("sezony").doc(sezonaId);
    const oldSezonaSnap = await oldSezonaRef.get();

    const staráDataSezóny = oldSezonaSnap.exists ? (oldSezonaSnap.data() || {}) : {};
    const staréSouteze = staráDataSezóny.souteze || {};
    const upravenéSouteze = {};

    Object.keys(staréSouteze).forEach(ligaKlic => {
      upravenéSouteze[ligaKlic] = { ...staréSouteze[ligaKlic] };

      if (upravenéSouteze[ligaKlic].tipy) {
        const upravenéTipy = {};
        Object.keys(upravenéSouteze[ligaKlic].tipy).forEach(matchId => {
          upravenéTipy[matchId] = {
            ...upravenéSouteze[ligaKlic].tipy[matchId],
            userId: newUid,
            userEmail: newEmail
          };
        });
        upravenéSouteze[ligaKlic].tipy = upravenéTipy;
      }

      if (upravenéSouteze[ligaKlic].bonusy) {
        upravenéSouteze[ligaKlic].bonusy = {
          ...upravenéSouteze[ligaKlic].bonusy,
          userId: newUid,
          userEmail: newEmail
        };
      }
    });

    const batch = db.batch();
    const newSezonaRef = db.collection("users").doc(newUid).collection("sezony").doc(sezonaId);

    if (Object.keys(upravenéSouteze).length > 0) {
      batch.set(newSezonaRef, { souteze: upravenéSouteze }, { merge: true });
    }
    if (oldSezonaSnap.exists) {
      batch.delete(oldSezonaRef);
    }
    batch.delete(db.collection("users").doc(oldUid));
    batch.delete(db.collection("uzivatele_online").doc(oldUid));

    await batch.commit();

    try {
      await auth.deleteUser(oldUid);
    } catch (authErr) {
      console.warn("Uživatel v Auth již neexistoval nebo nelze smazat:", authErr.message);
    }

    // 5. Úklid starých JSON souborů historie na Cloudflare R2
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const dotceneLigyZTipu = Object.keys(staréSouteze).map(lKlic => lKlic.replace(/_/g, " "));
    const vsechnyDotceneLigy = Array.from(new Set([...mergedLeagues, ...dotceneLigyZTipu]));

    for (const liga of vsechnyDotceneLigy) {
      const lKlic = liga.replace(/ /g, "_");
      try {
        await r2Client.send(new DeleteObjectCommand({
          Bucket: "tipni-to-data",
          Key: `sezony/${sezonaId}/${lKlic}/historie_hrace_${oldUid}.json`
        }));
      } catch (delErr) {
        console.warn(`Nepodařilo se smazat starou historii na R2 pro ligu ${liga}:`, delErr.message);
      }
    }

    // 6. Automatický přepočet všech zasažených lig (delegován na bota)
    for (const liga of vsechnyDotceneLigy) {
      await vyzviBotaKPrepoctu(liga);
    }

    return { 
      success: true, 
      message: `Transfér dokončen! Body a licence byly převedeny na ${newEmail}, starý účet smazán a žebříčky přepočítány.` 
    };

  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 📅 FUNKCE 10: Okamžitá změna data zápasu bez závislosti na botovi
const updateMatchDateCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí měnit termín zápasu!");
  }

  const { leagueName, matchId, newDateIso } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId || !newDateIso) {
    throw new HttpsError("invalid-argument", "Chybí název ligy, ID zápasu nebo nové datum!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");
    const parsedDate = new Date(newDateIso);

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);

    await matchRef.update({
      datum: admin.firestore.Timestamp.fromDate(parsedDate)
    });

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const r2Key = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    let rozpisData = null;

    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: r2Key
      }));
      const rawText = await getRes.Body.transformToString();
      rozpisData = JSON.parse(rawText);
    } catch (e) {
      console.warn("Nepodařilo se stáhnout stávající rozpis.json z R2:", e.message);
    }

    if (rozpisData && rozpisData.zapasyMapa && rozpisData.zapasyMapa[matchId]) {
      rozpisData.zapasyMapa[matchId].datum = newDateIso;
      rozpisData.aktualizovano = new Date().toISOString();

      await r2Client.send(new PutObjectCommand({
        Bucket: "tipni-to-data",
        Key: r2Key,
        Body: JSON.stringify(rozpisData),
        ContentType: "application/json",
        CacheControl: "no-cache, no-store, must-revalidate"
      }));
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    // ⏰ CLOUD TASKS: Okamžité přeplánování budíků T-62 (notifikace) a T-2 (wake-up) pro nový termín
    try {
      const { naplanujBudikProKickoff } = require("./tasks");
      await naplanujBudikProKickoff(parsedDate.getTime());
    } catch (taskErr) {
      console.warn("Nepodařilo se přeplánovat budík Cloud Tasks:", taskErr.message);
    }

    return { success: true, message: "Termín zápasu bezpečně upraven a synchronizován!" };
  } catch (error) {
    console.error("Chyba při změně data zápasu:", error);
    throw new HttpsError("internal", error.message);
  }
});

// 📊 FUNKCE 11: Ruční zápis kurzů zápasu (Firestore + rozpis.json + central_odds.json)
const saveMatchOddsCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí zadávat kurzy zápasů!");
  }

  const { leagueName, matchId, odds } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId || !odds || !odds["1"] || !odds["2"]) {
    throw new HttpsError("invalid-argument", "Chybí název ligy, ID zápasu nebo platné kurzy!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);

    const matchDoc = await matchRef.get();
    const matchData = matchDoc.exists ? matchDoc.data() : {};

    await matchRef.set({ odds: odds }, { merge: true });

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: rozpisKey
      }));
      const rawText = await getRes.Body.transformToString();
      const rozpisObj = JSON.parse(rawText);

      if (rozpisObj && rozpisObj.zapasyMapa && rozpisObj.zapasyMapa[matchId]) {
        rozpisObj.zapasyMapa[matchId].odds = odds;
        rozpisObj.aktualizovano = new Date().toISOString();

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Nepodařilo se upravit rozpis.json na R2:", e.message);
    }

    const centralOddsKey = `sezony/${sezonaId}/central_odds.json`;
    try {
      let centralOddsObj = {};
      try {
        const getOddsRes = await r2Client.send(new GetObjectCommand({
          Bucket: "tipni-to-data",
          Key: centralOddsKey
        }));
        const rawOddsText = await getOddsRes.Body.transformToString();
        centralOddsObj = JSON.parse(rawOddsText);
      } catch (err) {}

      if (!centralOddsObj[leagueName]) centralOddsObj[leagueName] = {};
      centralOddsObj[leagueName][matchId] = odds;

      let datumIso = "";
      if (matchData.datum) {
        datumIso = matchData.datum.toDate ? matchData.datum.toDate().toISOString().split("T")[0] : new Date(matchData.datum.seconds ? matchData.datum.seconds * 1000 : matchData.datum).toISOString().split("T")[0];
      }
      if (matchData.domaci && matchData.hoste && datumIso) {
        const datedKey = `${String(matchData.domaci).toLowerCase().trim()} vs ${String(matchData.hoste).toLowerCase().trim()}_${datumIso}`;
        centralOddsObj[leagueName][datedKey] = odds;
      }
      if (matchData.domaci && matchData.hoste) {
        delete centralOddsObj[leagueName][`${String(matchData.domaci).toLowerCase().trim()} vs ${String(matchData.hoste).toLowerCase().trim()}`];
      }

      await r2Client.send(new PutObjectCommand({
        Bucket: "tipni-to-data",
        Key: centralOddsKey,
        Body: JSON.stringify(centralOddsObj, null, 2),
        ContentType: "application/json"
      }));
    } catch (e) {
      console.warn("Nepodařilo se zapsat do central_odds.json na R2:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: "Kurzy bezpečně zapsány a synchronizovány!" };
  } catch (error) {
    console.error("Chyba při ručním zápisu kurzů:", error);
    throw new HttpsError("internal", error.message);
  }
});

// 🗑️ FUNKCE 11b: Ruční smazání kurzu zápasu (Firestore + rozpis.json + central_odds.json)
const deleteMatchOddsCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí mazat kurzy!");
  }

  const { leagueName, matchId } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId) {
    throw new HttpsError("invalid-argument", "Chybí název ligy nebo ID zápasu!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);

    const matchDoc = await matchRef.get();
    const matchData = matchDoc.exists ? matchDoc.data() : {};
    await matchRef.update({ odds: admin.firestore.FieldValue.delete() }).catch(() => {});

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({ Bucket: "tipni-to-data", Key: rozpisKey }));
      const rozpisObj = JSON.parse(await getRes.Body.transformToString());
      if (rozpisObj && rozpisObj.zapasyMapa && rozpisObj.zapasyMapa[matchId]) {
        delete rozpisObj.zapasyMapa[matchId].odds;
        rozpisObj.aktualizovano = new Date().toISOString();
        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Chyba mazání z rozpis.json:", e.message);
    }

    const centralOddsKey = `sezony/${sezonaId}/central_odds.json`;
    try {
      const getOddsRes = await r2Client.send(new GetObjectCommand({ Bucket: "tipni-to-data", Key: centralOddsKey }));
      const centralOddsObj = JSON.parse(await getOddsRes.Body.transformToString());

      if (centralOddsObj[leagueName]) {
        delete centralOddsObj[leagueName][matchId];

        let datumIso = "";
        if (matchData.datum) {
          datumIso = matchData.datum.toDate ? matchData.datum.toDate().toISOString().split("T")[0] : new Date(matchData.datum.seconds ? matchData.datum.seconds * 1000 : matchData.datum).toISOString().split("T")[0];
        }
        if (matchData.domaci && matchData.hoste) {
          const dNorm = String(matchData.domaci).toLowerCase().trim();
          const hNorm = String(matchData.hoste).toLowerCase().trim();
          delete centralOddsObj[leagueName][`${dNorm} vs ${hNorm}`];
          if (datumIso) delete centralOddsObj[leagueName][`${dNorm} vs ${hNorm}_${datumIso}`];
        }

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: centralOddsKey,
          Body: JSON.stringify(centralOddsObj, null, 2),
          ContentType: "application/json"
        }));
      }
    } catch (e) {
      console.warn("Chyba mazání z central_odds.json:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: "Kurz byl úspěšně vymazán ze všech systémů!" };
  } catch (error) {
    throw new HttpsError("internal", error.message);
  }
});

// 🗑️ FUNKCE 12: Bezpečné smazání zápasu z Firestore i rozpis.json na R2 + signál pro mobily
const deleteMatchCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí mazat zápasy!");
  }

  const { leagueName, matchId } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId) {
    throw new HttpsError("invalid-argument", "Chybí název ligy nebo ID zápasu ke smazání!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);
    await matchRef.delete();

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: rozpisKey
      }));
      const rawText = await getRes.Body.transformToString();
      const rozpisObj = JSON.parse(rawText);

      if (rozpisObj && rozpisObj.zapasyMapa && rozpisObj.zapasyMapa[matchId]) {
        delete rozpisObj.zapasyMapa[matchId];
        rozpisObj.aktualizovano = new Date().toISOString();

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Nepodařilo se vymazat zápas z rozpis.json na R2:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: "Zápas byl úspěšně vymazán z Firestore i R2!" };
  } catch (error) {
    console.error("Chyba při mazání zápasu:", error);
    throw new HttpsError("internal", error.message);
  }
});

// ⏳ FUNKCE 13: Ruční odložení / vrácení zápasu do hry s ochranou proti přepsání botem
const toggleMatchPostponedCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí měnit stav odložení zápasu!");
  }

  const { leagueName, matchId, isPostponed } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId) {
    throw new HttpsError("invalid-argument", "Chybí název ligy nebo ID zápasu!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");
    const newStatus = isPostponed ? "POSTPONED" : "SCHEDULED";

    const matchRef = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy").doc(matchId);

    await matchRef.update({
      apiStatus: newStatus,
      manuallyPostponed: Boolean(isPostponed)
    });

    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: rozpisKey
      }));
      const rawText = await getRes.Body.transformToString();
      const rozpisObj = JSON.parse(rawText);

      if (rozpisObj && rozpisObj.zapasyMapa && rozpisObj.zapasyMapa[matchId]) {
        rozpisObj.zapasyMapa[matchId].apiStatus = newStatus;
        rozpisObj.zapasyMapa[matchId].manuallyPostponed = Boolean(isPostponed);
        rozpisObj.aktualizovano = new Date().toISOString();

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Nepodařilo se upravit stav odložení v rozpis.json na R2:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, message: `Stav zápasu úspěšně změněn na ${newStatus}!` };
  } catch (error) {
    console.error("Chyba při změně stavu odložení:", error);
    throw new HttpsError("internal", error.message);
  }
});

// 🔥 FUNKCE 13b: Přepnutí TOP zápasu (Firestore + rozpis.json na R2 + RTDB maják)
const toggleTopMatchCF = onCall({
  cors: true,
  secrets: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
}, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze administrátor smí měnit TOP zápas!");
  }

  const { leagueName, matchId } = request.data;
  const sezonaId = request.data.sezonaId || DEFAULT_SEASON_ID;

  if (!leagueName || !matchId) {
    throw new HttpsError("invalid-argument", "Chybí název ligy nebo ID zápasu!");
  }

  try {
    const ligaKlic = leagueName.replace(/ /g, "_");
    const zapasyColl = db.collection("ligy").doc(leagueName)
      .collection("sezony").doc(sezonaId)
      .collection("zapasy");

    const targetDoc = await zapasyColl.doc(matchId).get();
    if (!targetDoc.exists) {
      throw new HttpsError("not-found", "Zápas nebyl nalezen!");
    }

    const targetData = targetDoc.data() || {};
    const budeTop = !targetData.isTopMatch;
    const targetKolo = String(targetData.kolo || "").trim();

    const batch = db.batch();
    const unTopMatchIds = [];

    // Pojistka na max 1 TOP zápas na kolo: ostatním zápasům v tomtéž kole TOP vypneme
    if (budeTop && targetKolo) {
      const roundMatchesSnap = await zapasyColl.where("kolo", "==", targetKolo).get();
      roundMatchesSnap.forEach(docSnap => {
        if (docSnap.id !== matchId && docSnap.data().isTopMatch) {
          batch.update(docSnap.ref, { isTopMatch: false });
          unTopMatchIds.push(docSnap.id);
        }
      });
    }

    batch.update(zapasyColl.doc(matchId), { isTopMatch: budeTop });
    await batch.commit();

    // 📦 R2 SYNCHRONIZACE: Okamžitá úprava statického rozpis.json na Cloudflare R2
    const r2Client = new S3Client({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      region: "auto",
    });

    const rozpisKey = `sezony/${sezonaId}/${ligaKlic}/rozpis.json`;
    try {
      const getRes = await r2Client.send(new GetObjectCommand({
        Bucket: "tipni-to-data",
        Key: rozpisKey
      }));
      const rawText = await getRes.Body.transformToString();
      const rozpisObj = JSON.parse(rawText);

      if (rozpisObj && rozpisObj.zapasyMapa) {
        unTopMatchIds.forEach(id => {
          if (rozpisObj.zapasyMapa[id]) {
            rozpisObj.zapasyMapa[id].isTopMatch = false;
          }
        });
        if (rozpisObj.zapasyMapa[matchId]) {
          rozpisObj.zapasyMapa[matchId].isTopMatch = budeTop;
        }
        rozpisObj.aktualizovano = new Date().toISOString();

        await r2Client.send(new PutObjectCommand({
          Bucket: "tipni-to-data",
          Key: rozpisKey,
          Body: JSON.stringify(rozpisObj),
          ContentType: "application/json",
          CacheControl: "no-cache, no-store, must-revalidate"
        }));
      }
    } catch (e) {
      console.warn("Nepodařilo se upravit TOP zápas v rozpis.json na R2:", e.message);
    }

    const pulsRef = db.collection("ligy").doc(leagueName).collection("stav").doc("puls");
    await pulsRef.set({
      verzeRozpisu: admin.firestore.FieldValue.increment(1),
      aktualizovano: admin.firestore.Timestamp.now()
    }, { merge: true });

    await cinkniRtdbMajak(leagueName, "rozpis");

    return { success: true, isTopMatch: budeTop, message: budeTop ? "Zápas označen jako TOP!" : "Označení TOP odebráno." };
  } catch (error) {
    console.error("Chyba při změně TOP zápasu:", error);
    throw new HttpsError("internal", error.message);
  }
});

// 🚚 FUNKCE 14: Jednorázová migrace všech uživatelů do RTDB admin_roster
const syncAllUsersToRtdbCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || (!request.auth.token.isAdmin && !request.auth.token.isSuperAdmin)) {
    throw new HttpsError("permission-denied", "Pouze prověřený admin smí synchronizovat uživatele!");
  }

  try {
    const usersSnap = await db.collection("users").get();
    const rtdb = getDatabase();
    const updates = {};

    usersSnap.forEach(uDoc => {
      const u = uDoc.data() || {};
      updates[uDoc.id] = {
        nickname: u.nickname || 'Nový Hráč',
        email: u.email || '',
        leagues: u.leagues || [],
        isAdmin: u.isAdmin === true,
        isSuperAdmin: u.isSuperAdmin === true,
        showSurveys: u.showSurveys !== undefined ? u.showSurveys : true,
        notifyUntipped: u.notifyUntipped === true,
        lastSeen: u.lastSeen?.toMillis ? u.lastSeen.toMillis() : (u.lastSeen || null)
      };
    });

    await rtdb.ref("admin_roster").set(updates);
    return { success: true, count: usersSnap.size, message: `Úspěšně přeneseno ${usersSnap.size} uživatelů do RTDB (0 reads režim aktivní)!` };
  } catch (err) {
    throw new HttpsError("internal", err.message);
  }
});

// 🗑️ FUNKCE 15: Samostatné smazání a anonymizace vlastního účtu (GDPR Google Play)
const deleteMyAccountCF = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Musíš být přihlášen!");
  }

  const uid = request.auth.uid;

  try {
    const shortId = uid.slice(0, 4).toUpperCase();
    const anonNick = `Bývalý hráč #${shortId}`;
    const anonEmail = `deleted_${uid.slice(0, 8)}@deleted.local`;

    // 1. Smazání z Firebase Auth (okamžitá ztráta přihlášení)
    try {
      await auth.deleteUser(uid);
    } catch (authErr) {
      console.warn("Uživatel v Auth již neexistoval:", authErr.message);
    }

    // 2. Smazání z RTDB (admin_roster a online status)
    try {
      const rtdb = getDatabase();
      await rtdb.ref(`admin_roster/${uid}`).remove();
      await rtdb.ref(`status/${uid}`).remove();
    } catch (rtdbErr) {
      console.warn("RTDB remove varování:", rtdbErr.message);
    }

    // 3. Odstranění z online tabulky Firestore
    await db.collection("uzivatele_online").doc(uid).delete().catch(() => {});

    // 4. Anonymizace profilu ve Firestore (body v sezónách zůstávají zafixované)
    await db.collection("users").doc(uid).update({
      nickname: anonNick,
      email: anonEmail,
      fcmTokens: admin.firestore.FieldValue.delete(),
      pushToken: admin.firestore.FieldValue.delete(),
      notifyUntipped: false,
      showSurveys: false,
      isDeleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: "Tvůj účet byl trvale smazán a data anonymizována." };
  } catch (error) {
    console.error("Chyba při mazání vlastního účtu:", error);
    throw new HttpsError("internal", error.message);
  }
});

module.exports = {
  manageUserPermissionsCF,
  purgeUserAbsoluteCF,
  saveProxyDataCF,
  recalculateLeaderboardCF,
  transferUserDataCF,
  updateMatchDateCF,
  saveMatchOddsCF,
  deleteMatchOddsCF,
  deleteMatchCF,
  toggleMatchPostponedCF,
  toggleTopMatchCF,
  syncAllUsersToRtdbCF,
  deleteMyAccountCF
};