# TIPNI TO!

<p align="center">
  <a href="https://tipni-to.netlify.app"><img src="https://img.shields.io/badge/Živá_Aplikace-tipni--to.netlify.app-059669?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/PWA-Nainstalovatelná-10b981?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA Ready">
  <img src="https://img.shields.io/badge/Storage-Cloudflare_R2-f38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare R2">
  <img src="https://img.shields.io/badge/Backend-Firebase_v11-ffca28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase">
  <img src="https://img.shields.io/badge/Engine-Node.js_22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22">
</p>

<p align="center">
  <strong>PWA tipovací aplikace pro fotbalové i hokejové soutěže</strong><br>
  Postaveno na hybridní architektuře Cloudflare R2 a Firebase Realtime Database.<br>
  Blesková odezva pro hráče a distribuce dat bez zbytečného přetěžování databáze.
</p>

---

## 🎮 Co aplikace nabízí

* **Multi-ligové tipování:** Podpora fotbalu i hokeje (Chance Liga, Premier League, Tipsport Extraliga, Liga mistrů, MS v hokeji a MS ve fotbale) s odlišnými pravidly bodování (přesné výsledky, tendence, penalty za nenatipování i bonusy na postup v prodloužení/nájezdech).
* **Živé výsledky a Špehovací oko:** Tipy všech hráčů jsou až do začátku zápasu skryté pod zámkem. Jakmile utkání odstartuje, zámek se změní na oko, tipy soupeřů se odemknou a aplikace v reálném čase počítá průběžné body i virtuální pořadí v tabulce.
* **3D FUT Karty tipérů:** Na základě reálné úspěšnosti předpovědí systém počítá hráči celkový OVR rating (1–99), 6 atributů (přesnost, odvaha, psychika ve šlágrech, stabilita, forma, efektivita) a přiřadí herní styl (*Odstřelovač, Taktik, Predátor...*). Karta nabízí 3D otočení se statistikami a možnost exportu grafického štítku do obrázku.
* **H2H Duel Aréna:** Přímé porovnání dvou libovolných hráčů ze žebříčku. Srovnává vzájemnou bilanci vyhraných kol, formu z posledních utkání, shodu tipů i odlišné předpovědi v nadcházejících zápasech.
* **Pohár (Tipni Cup):** Paralelní vyřazovací turnaj navázaný na běžné ligové tipy. Hráči jsou po úvodních kolech rozděleni Hadím draftem do čtyř skupin a nejlepší postupují do pavouka na dvoukolové odvety.
* **Ligový Radar:** Automatická analýza extrémů sezóny – bodově nejbohatší zápas kola (Zlatý důl), zápasy s nulovým ziskem pro celou soutěž (Totální výbuch), ojedinělé trefy jediného hráče proti všem (Vlci samotáři) i statistika úspěšnosti tipů na jednotlivé kluby.
* **PWA a ochrana formulářů:** Aplikaci lze nainstalovat na plochu mobilu (Android i iOS) pro běh na celou obrazovku bez lišt prohlížeče. Formulářový interceptor navíc hlídá rozepsané tipy a zabrání jejich nechtěnému zahození při překliku nebo gestu zpět.
* **Admin modul „Loutkovodič“:** Praktická asistence pro správce ligy v reálném provozu – možnost v nouzi podat či upravit tip za kteréhokoliv hráče (např. když někteří lidé neumí nebo nechtějí používat aplikace v mobilu). Vše probíhá bezpečně přes autorizovanou Cloud Function bez manuálních zásahů do databáze.
* **Export pro sociální sítě:** Generování čistých obrázkových snapshotů (PNG) přímo v prohlížeči pomocí HTML5 Canvas. Hráči si mohou jedním kliknutím stáhnout svou aktuální FUT kartu, administrátoři i ligovou tabulku a souhrn odehraného kola a okamžitě je nasdílet do komunitních skupin na Facebooku, WhatsAppu či Messengeru bez nutnosti dělat ořezy ze snímků obrazovky.

---

## 🛠️ Jak to funguje a technické řešení

* **Distribuce dat přes Cloudflare R2:** Rozpisy zápasů, ligové tabulky a souhrny kol se nečtou přímo z databáze Firestore. Frontend je stahuje jako statické JSON soubory z CDN úložiště Cloudflare R2.
* **Realtime maják (Firebase RTDB):** Frontend drží jedno odlehčené WebSocket spojení na uzel v Realtime Database (`system/leagues_pulse`). Když padne gól nebo administrátor upraví zápas, maják vyšle krátký impuls a klient si stáhne čerstvý JSON z R2.
* **Backend daemon a sportovní feed:** Zápasový stavový skript (`bot.mjs`) běží na instanci platformy Render a zpracovává data ze SportAPI7. Mimo hrací dny usíná a před zápasy ho budí plánovač z Google Cloud Tasks, který zároveň rozesílá Web Push notifikace hráčům bez natipováných zápasů (pokud mají zapnuté push notifikace). Během rozehraných zápasů zůstává aktivní v minutové smyčce a průběžně aktualizuje tabulky.
* **Zabezpečené zápisy (Cloud Functions v2):** Zápis tipů, správa uživatelských rolí (RBAC), administrátorské zásahy i kompletní anonymizace profilu při smazání účtu podle GDPR probíhají přes Cloud Functions na Node.js 22.

| Vrstva | Použité technologie |
|---|---|
| **Frontend** | Vanilla JavaScript (ES6 moduly), Alpine.js v3, CSS3 (Dark UI) |
| **PWA & Mobil** | Service Worker (Cache-First + Stale-While-Revalidate), Web App Manifest |
| **BaaS & Databáze** | Firebase Auth, Cloud Firestore, Realtime Database |
| **Storage & Hosting** | Cloudflare R2 (S3 API), Netlify CDN |
| **Backend & Plánovač** | Node.js 22, Cloud Functions v2, Google Cloud Tasks |
| **Data Feed** | SportAPI7 (SofaScore feed) |

---

## 📸 Náhledy z aplikace

| 🔐 Vstup do arény | 🏟️ Výběr soutěže (Katalog lig) |
| :---: | :---: |
| <img width="450" height="1000" alt="Screenshot_2026-09-30-07-23-53-747_com android chrome" src="https://github.com/user-attachments/assets/804a0273-0872-48d7-9a2c-a963b39375f4" /> | <img width="450" height="1000" alt="Screenshot_2026-09-30-07-24-08-564_com android chrome" src="https://github.com/user-attachments/assets/136140dd-d438-4d9a-ab6e-1b040716c303" /> |
| *Přihlášení, Google účet a instalace PWA na plochu* | *Výběr soutěže (rozšířený fanouškovský režim s grafikou)* |

| 🃏 3D FUT Karta tipéra | 🏆 Živé ligové pořadí |
| :---: | :---: |
| <img width="450" height="1000" alt="fut karta" src="https://github.com/user-attachments/assets/75d49b79-f7dc-46c9-b972-9326d05cdf13" /> | <img width="450" height="1000" alt="live" src="https://github.com/user-attachments/assets/718ae931-bcef-4351-bafd-98fdca3300ba" /> |
| *OVR rating, atributy a herní styl* | *Průběžný LIVE přepočet během hry* |

| ⚔️️ H2H Duel 1 na 1 | 🌳 Pohár (Tipni Cup) |
| :---: | :---: |
| <img width="450" height="1000" alt="H2H" src="https://github.com/user-attachments/assets/fb2e326b-9cda-40c2-9a4d-ac0d5f54c000" /> | <img width="450" height="1000" alt="pohar" src="https://github.com/user-attachments/assets/4115d9db-e94c-4ab5-b224-a584c09bc005" /> |
| *Přímé srovnání soupeřů na 18 metrik* | *Hadí draft skupin a vyřazovací pavouk* |

| 👀 Ligový Radar & Extrémy | 📱 Herní rozpis & Kurzy |
| :---: | :---: |
| <img width="450" height="1000" alt="radar" src="https://github.com/user-attachments/assets/cfef77c3-8586-4eeb-9b4a-5d95cab395c4" /> | <img width="450" height="1000" alt="rozpis" src="https://github.com/user-attachments/assets/7f046b40-9e36-45f1-a19d-8b19bee7e2cc" /> |
| *Zlatý důl, Vlci samotáři i kluby* | *Zadávání tipů, 1-X-2 kurzy a zámky* |

---

## 🚀 Plánovaný rozvoj

* **Uzavřené miniligy:** Podpora soukromých skupin v rámci stejné soutěže, kde mohou přátelé nebo kolegové z práce tipovat na stejném rozpisu, ale v oddělené soukromé tabulce.
* **Rozšiřování soutěží:** Engine je navržen tak, aby umožňoval rychlé přidání jakékoliv další fotbalové či hokejové ligy.

---

## 👨‍💻 Autor a poděkování

* **Vývoj a architektura:** [@jaydym13-lgtm](https://github.com/jaydym13-lgtm)
* **Herní pravidla a bodový balanc:**
  * ⚽ **Švéřa** – systém bodování fotbalových soutěží
  * 🏒 **Ďoubas** – systém bodování hokejových soutěží 
* **Web aplikace:** [tipni-to.netlify.app](https://tipni-to.netlify.app)
