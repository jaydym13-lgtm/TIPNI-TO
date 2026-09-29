# ⚽ TIPNI TO! – PWA Sportovní Tipovačka

[![PWA Ready](https://img.shields.io/badge/PWA-Ready-10b981?style=for-the-badge&logo=pwa)](https://tipni-to.netlify.app)
[![Firebase](https://img.shields.io/badge/Firebase-v11-ffca28?style=for-the-badge&logo=firebase)](https://firebase.google.com)
[![Cloudflare R2](https://img.shields.io/badge/Storage-Cloudflare_R2-f38020?style=for-the-badge&logo=cloudflare)](https://cloudflare.com)

Multi-ligová komunitní tipovací platforma pro fotbal a hokej postavená na distribuci statických dat přes Cloudflare R2 a reaktivním majáku ve Firebase Realtime Database.

🔗 **Aplikace:** [https://tipni-to.netlify.app](https://tipni-to.netlify.app)

---

## 🏛️ Architektura a tok dat

Systém je rozdělený na tři části: klientskou PWA aplikaci, serverless backend pro zápisy a stavového bota na platformě Render.

### 1. Klientská distribuce (Cloudflare R2 + RTDB Maják)
* **Čtení dat bez zátěže databáze:** Rozpisy zápasů, ligové tabulky a souhrny kol se nestahují z Firestore. Frontend načítá statické JSON soubory (`rozpis.json`, `leaderboard.json`, `hall_of_fame.json`) přímo z CDN Cloudflare R2.
* **WebSocket signál (Firebase RTDB):** Frontend má otevřený posluchač na odlehčený uzel v Realtime Database (`system/leagues_pulse`). Jakmile se změní stav zápasu nebo proběhne přepočet, maják pošle timestamp a aplikace stáhne čerstvý balík z R2.

### 2. Správa a probouzení bota (Render Free Tier + Cloud Tasks)
* **Ekonomický běh:** Stavový daemon (`bot.mjs`) běží na bezplatném tarifu platformy Render. Pokud se nehrají zápasy, instance usíná.
* **Řízené probouzení (Google Cloud Tasks):**
  * **T-62 min:** Cloud Function odešle Web Push notifikaci hráčům, kteří na nadcházející zápas ještě nemají natipováno.
  * **T-2 min:** HTTP budík probudí instanci bota na Renderu přes endpoint `/cron`.
* **Udržení v chodu:** Pokud je v některé lize zápas ve stavu `IN_PLAY` nebo těsně před ním, bot zůstává aktivní, v minutové smyčce stahuje live feed ze SportAPI7 a v reálném čase počítá tabulky na R2.

### 3. Zabezpečené operace (Cloud Functions v2)
* Ukládání tipů, dlouhodobých bonusů, správa práv uživatelů a administrátorský zápis (Loutkovodič) běží přes Cloud Functions v regionu `europe-west1`.
* Uživatelé nemají přímý zápisový přístup k ligovým výsledkům ani cizím tipům.

---

## 🎮 Herní mechaniky

* **FUT Karty hráčů:** Výpočet OVR ratingu (1–99), herního archetypu (*Odstřelovač, Taktik, Predátor...*) a statistik přímo z reálných tipů. Možnost 3D rotace karty a exportu do PNG.
* **Síň slávy:** Celkový žebříček napříč soutěžemi s koeficientem podle počtu aktivních lig hráče.
* **H2H Duel:** Přímé porovnání dvou hráčů (forma z posledních 5 zápasů, vzájemná bilance kol, shoda tipů a přímé souboje).
* **Tipni Cup:** Paralelní pohárová soutěž navázaná na ligové tipy (Hadí draft pro nasazení do skupin + vyřazovací K.O. pavouk).
* **Ligový Radar:** Automatické vyhodnocení milníků – Zlatý důl (zápas s nejvíce body), Totální výbuchy (0 bodů pro celou soutěž), Vlci samotáři (jediný správný tipér) a úspěšnost tipů na jednotlivé kluby.
* **PWA režim:** Možnost instalace na plochu (Android/iOS), běh přes Service Worker a záchytný dialog chránící rozepsané tipy před zavřením stránky.

---

## 🛠️ Použité technologie

| Vrstva | Technologie |
|---|---|
| **Frontend** | Vanilla JavaScript (ES6 Modules), Alpine.js v3, CSS3 |
| **BaaS & DB** | Firebase Auth, Cloud Firestore, Realtime Database |
| **Storage & Hosting**| Cloudflare R2 (S3 API), Netlify |
| **Backend & Úlohy** | Node.js 22, Cloud Functions for Firebase v2, Google Cloud Tasks |
| **Worker / Bot** | Node.js (Render Free Service), Express HTTP probe |
| **Datové API** | SportAPI7 (RapidAPI) |

---

## 🔒 Bezpečnost a správa dat

* **Role (RBAC):** Oddělení rolí hráč, administrátor a SuperAdmin přes Firebase Custom Claims.
* **Ochrana proti spamu:** Serverové i klientské časové zámky (cooldowny) na odesílání tipů.
* **GDPR výmaz:** Možnost smazání účtu přímo z aplikace s anonymizací odehraných bodů, aby nedošlo k poškození historických výsledků soutěže.

---

## 👨‍💻 Autor

* **GitHub:** [@jaydym13-lgtm](https://github.com/jaydym13-lgtm)
* **Web:** [tipni-to.netlify.app](https://tipni-to.netlify.app)