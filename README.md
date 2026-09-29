# ⚽ TIPNI TO!

<p align="center">
  <strong>PWA tipovací aplikace pro fotbalové i hokejové soutěže</strong><br>
  Postaveno na hybridní architektuře Cloudflare R2 a Firebase Realtime Database.<br>
  Blesková odezva pro hráče a distribuce dat bez zbytečného přetěžování databáze.
</p>

<p align="center">
  <a href="https://tipni-to.netlify.app"><img src="https://img.shields.io/badge/Živá_Aplikace-tipni--to.netlify.app-059669?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/PWA-Nainstalovatelná-10b981?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA Ready">
  <img src="https://img.shields.io/badge/Storage-Cloudflare_R2-f38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare R2">
  <img src="https://img.shields.io/badge/Backend-Firebase_v11-ffca28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase">
  <img src="https://img.shields.io/badge/Engine-Node.js_22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22">
</p>

---

## 🎮 Co aplikace nabízí

* **Multi-ligové tipování:** Podpora fotbalu i hokeje (Chance Liga, Premier League, Tipsport Extraliga, Liga mistrů, MS v hokeji a MS ve fotbale) s odlišnými pravidly bodování (přesné výsledky, tendence, penalty za nenatipování i bonusy na postup v prodloužení/nájezdech)[cite: 1, 17].
* **Živé výsledky a Špehovací oko:** Tipy všech hráčů jsou až do začátku zápasu skryté pod zámkem[cite: 1]. Jakmile utkání odstartuje, zámek se změní na oko, tipy soupeřů se odemknou a aplikace v reálném čase počítá průběžné body i virtuální pořadí v tabulce[cite: 1].
* **3D FUT Karty tipérů:** Na základě reálné úspěšnosti předpovědí systém počítá hráči celkový OVR rating (1–99), 6 atributů (přesnost, odvaha, psychika ve šlágrech, stabilita, forma, efektivita) a přiřadí herní styl (*Odstřelovač, Taktik, Predátor...*)[cite: 1]. Karta nabízí 3D otočení se statistikami a možnost exportu grafického štítku do obrázku[cite: 1].
* **H2H Duel Aréna:** Přímé porovnání dvou libovolných hráčů ze žebříčku[cite: 1]. Srovnává vzájemnou bilanci vyhraných kol, formu z posledních utkání, shodu tipů i odlišné předpovědi v nadcházejících zápasech[cite: 1].
* **Pohár (Tipni Cup):** Paralelní vyřazovací turnaj navázaný na běžné ligové tipy[cite: 1]. Hráči jsou po úvodních kolech rozděleni Hadím draftem do čtyř skupin a nejlepší postupují do pavouka na dvoukolové odvety[cite: 1].
* **Ligový Radar:** Automatická analýza extrémů sezóny – bodově nejbohatší zápas kola (Zlatý důl), zápasy s nulovým ziskem pro celou soutěž (Totální výbuch), ojedinělé trefy jediného hráče proti všem (Vlci samotáři) i statistika úspěšnosti tipů na jednotlivé kluby[cite: 1].
* **PWA a ochrana formulářů:** Aplikaci lze nainstalovat na plochu mobilu (Android i iOS) pro běh na celou obrazovku bez lišt prohlížeče[cite: 1]. Formulářový interceptor navíc hlídá rozepsané tipy a zabrání jejich nechtěnému zahození při překliku nebo gestu zpět[cite: 1].

---

## 🛠️ Jak to funguje a technické řešení

* **Distribuce dat přes Cloudflare R2:** Rozpisy zápasů, ligové tabulky a souhrny kol se nečtou přímo z databáze Firestore[cite: 1, 18]. Frontend je stahuje jako statické JSON soubory z CDN úložiště Cloudflare R2[cite: 1, 18].
* **Realtime maják (Firebase RTDB):** Frontend drží jedno odlehčené WebSocket spojení na uzel v Realtime Database (`system/leagues_pulse`)[cite: 1, 18]. Když padne gól nebo administrátor upraví zápas, maják vyšle krátký impuls a klient si stáhne čerstvý JSON z R2[cite: 1, 18].
* **Backend daemon a sportovní feed:** Zápasový stavový skript (`bot.mjs`) běží na instanci platformy Render a zpracovává data ze SportAPI7[cite: 1]. Mimo hrací dny usíná a před zápasy ho budí plánovač z Google Cloud Tasks, který zároveň rozesílá Web Push notifikace hráčům bez natipováno[cite: 1]. Během rozehraných zápasů zůstává aktivní v minutové smyčce a průběžně aktualizuje tabulky[cite: 1].
* **Zabezpečené zápisy (Cloud Functions v2):** Zápis tipů, správa uživatelských rolí (RBAC), administrátorské zásahy i kompletní anonymizace profilu při smazání účtu podle GDPR probíhají přes Cloud Functions na Node.js 22[cite: 1, 9, 11].

| Vrstva | Použité technologie |
|---|---|
| **Frontend** | Vanilla JavaScript (ES6 moduly), Alpine.js v3, CSS3 (Dark UI)[cite: 1] |
| **PWA & Mobil** | Service Worker (Cache-First + Stale-While-Revalidate), Web App Manifest[cite: 1] |
| **BaaS & Databáze** | Firebase Auth, Cloud Firestore, Realtime Database[cite: 1] |
| **Storage & Hosting** | Cloudflare R2 (S3 API), Netlify CDN[cite: 1, 13] |
| **Backend & Plánovač** | Node.js 22, Cloud Functions v2, Google Cloud Tasks[cite: 1, 11] |
| **Data Feed** | SportAPI7 (SofaScore feed)[cite: 1] |

---

## 📸 Náhledy z aplikace

<!-- Zde můžeš v GitHub editoru (přes ikonu tužky) přetáhnout vlastní screenshoty přímo do tabulky -->

| 🃏 3D FUT Karta tipéra | 🏆 Živé ligové pořadí | ⚔️ H2H Duel 1 na 1 |
| :---: | :---: | :---: |
| ![FUT Karta](https://via.placeholder.com/400x550/0f172a/38bdf8?text=FUT+Karta+hráče) | ![Pořadí](https://via.placeholder.com/400x550/0f172a/10b981?text=Živé+pořadí) | ![H2H Duel](https://via.placeholder.com/400x550/0f172a/ef4444?text=H2H+Duel) |
| *OVR rating, atributy a herní styl* | *Průběžný LIVE přepočet během hry* | *Přímé srovnání soupeřů na 18 metrik* |

| 🌳 Pohár (Tipni Cup) | 👀 Ligový Radar & Extrémy | 📱 Herní rozpis & Kurzy |
| :---: | :---: | :---: |
| ![Pohár](https://via.placeholder.com/400x550/0f172a/ea580c?text=KO+Pavouk+Poháru) | ![Radar](https://via.placeholder.com/400x550/0f172a/fbbf24?text=Ligový+Radar) | ![Rozpis](https://via.placeholder.com/400x550/0f172a/10b981?text=Herní+rozpis) |
| *Hadí draft skupin a vyřazovací pavouk* | *Zlatý důl, Vlci samotáři i kluby* | *Zadávání tipů, 1-X-2 kurzy a zámky* |

---

## 👨‍💻 Autor a odkazy

* **Web aplikace:** [tipni-to.netlify.app](https://tipni-to.netlify.app)[cite: 1]
* **GitHub profil:** [@jaydym13-lgtm](https://github.com/jaydym13-lgtm)