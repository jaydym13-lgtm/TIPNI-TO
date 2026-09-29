# ⚽ TIPNI TO! – Moderní PWA Sportovní Tipovačka

[![PWA Ready](https://img.shields.io/badge/PWA-Ready-10b981?style=for-the-badge&logo=pwa)](https://tipni-to.netlify.app)
[![Firebase](https://img.shields.io/badge/Firebase-v11-ffca28?style=for-the-badge&logo=firebase)](https://firebase.google.com)
[![Cloudflare R2](https://img.shields.io/badge/Storage-Cloudflare_R2-f38020?style=for-the-badge&logo=cloudflare)](https://cloudflare.com)
[![License](https://img.shields.io/badge/License-Proprietary-blue?style=for-the-badge)](#)

Komplexní multi-ligová komunitní tipovací platforma vyvinutá s důrazem na **extrémní výkon, nulové zbytečné databázové dotazy (0 Firestore Reads architecture)** a offline-first přístup.

🔗 **Živé demo aplikace:** [https://tipni-to.netlify.app](https://tipni-to.netlify.app)

---

## 🏛️ Klíčové architektonické pilíře

Projekt byl od základů navržen tak, aby minimalizoval provozní náklady při zachování okamžité (sub-second) odezvy v reálném čase pro desítky až stovky souběžně tipujících hráčů.

### 1. Hybridní distribuce dat (Cloudflare R2 + Firebase RTDB Maják)
* **0 Firestore Reads při prohlížení:** Herní rozpisy, ligové tabulky a souhrny jsou servírovány jako komprimované statické JSONy z globální sítě **Cloudflare R2** s minimální latencí.
* **WebSocket Maják (10–20 ms):** Namísto drahých trvalých posluchačů ve Firestore naslouchá frontend na odlehčený signální uzel ve **Firebase Realtime Database** (`system/leagues_pulse`). Při změně skóre nebo vyhodnocení zápasu maják vyšle jednorázový signál a aplikace bleskově stáhne aktualizovaný balík z R2.
* **E-Tag Image Revalidation:** Znaky týmů, trofeje a stadiony jsou lokálně mezipaměťovány v Service Workeru a ověřovány podmíněným dotazem s HTTP ETagem.

### 2. Spolehlivý stavový backend (Daemon & Cloud Functions)
* **Node.js 22 Background Daemon (`bot.mjs`):** Trvale běžící služba na platformě Render hlídá termíny zápasů přes live stream SportAPI7, provádí automatické zmrazení tipů v T-0 výkopu a generuje agregované žebříčky.
* **Atomické Cloud Functions v2:** Citlivé operace (zápis tipů, změna práv, GDPR anonymizace a loutkovodič pro správce) běží izolovaně v evropském regionu `europe-west1`.
* **Google Cloud Tasks:** Automatické plánování úloh s milisekundovou přesností:
  * **T-62 min:** Cílené odeslání Web Push notifikace hráčům, kteří na nadcházející zápas dosud nenatipovali.
  * **T-2 min:** Keep-alive budík pro probuzení backendového daemona před zahájením utkání.

---

## 🎮 Unikátní herní funkce

* **🃏 Sběratelské FUT Karty hráčů:** Automatický výpočet kariérního OVR ratingu (1–99), herního archetypu (*Odstřelovač, Taktik, Predátor...*) a 6 klíčových metrik z reálných tipů. Možnost 3D otočení karty a generování exportovatelného grafického štítku pro sociální sítě.
* **🏛️ Globální Síň slávy:** Celkový žebříček napříč všemi soutěžemi s koeficientem všestrannosti podle počtu hraných lig.
* **⚔️ H2H Duel Aréna:** Přímé porovnání 1 na 1 mezi kterýmikoliv dvěma tipéry (srovnání 18 metrik, vzájemná bilance kol, forma a špionáž opačných tipů).
* **🏆 Pohárová pyramida (Tipni Cup):** Paralelní pohárový turnaj běžící automaticky z běžných ligových tipů. Využívá Hadí draft pro nasazení do 4 skupin a vícestupňový vyřazovací K.O. pavouk na odvety.
* **👀 Ligový Radar:** Automatická detekce extrémů sezóny – *Zlatý důl* (bodově nejbohatší zápas), *Totální výbuchy* (0 bodů pro celou soutěž), *Vlci samotáři* (jediný správný tipér proti davu), *Smolař sezóny* a analýza štědrosti klubů.
* **📲 PWA & Offline-First:** Plná podpora instalace na plochu telefonu (Android/iOS), spouštění na celou obrazovku bez lišt prohlížeče a ochrana rozpracovaných formulářů před nechtěným opuštěním.

---

## 🛠️ Použitý technologický stack

| Oblast | Technologie |
|---|---|
| **Frontend** | Vanilla JavaScript (ES6 Modules), Alpine.js v3, CSS3 Variables (Dark/Light mode) |
| **PWA & Offline** | Service Worker (Stale-While-Revalidate + Cache-First), Web App Manifest |
| **BaaS / Databáze** | Firebase Authentication, Cloud Firestore, Realtime Database |
| **Cloud & Storage** | Cloudflare R2 (S3 API), Google Cloud Tasks, Netlify Hosting |
| **Backend & Daemon** | Node.js 22 LTS, Cloud Functions for Firebase v2, Express HTTP Probe |
| **Data Engine** | SportAPI7 (SofaScore feed), RapidAPI |

---

## 🔒 Bezpečnost & Data Privacy (GDPR)

* **Role-Based Access Control (RBAC):** Přísně oddělené role běžného hráče, administrátora a SuperAdmina řízené přes Firebase Custom Claims a Firestore Security Rules.
* **Anti-Spam & Rate Limiting:** Klientské i serverové časové zámky (cooldowny) na odesílání tipů a změnu pořadí soutěží.
* **In-App Account Deletion:** Plná shoda s pravidly Google Play a GDPR – možnost okamžitého smazání účtu s automatickou anonymizací historických herních bodů pro zachování integrity tabulek ostatních hráčů.

---

## 👨‍💻 Autor

Vyvinuto jako nezávislý komunitní projekt zaměřený na čistý kód, moderní webové standardy a škálovatelnou cloudovou architekturu.

* **GitHub:** [@jaydym13-lgtm](https://github.com/jaydym13-lgtm)
* **Web projektu:** [tipni-to.netlify.app](https://tipni-to.netlify.app)