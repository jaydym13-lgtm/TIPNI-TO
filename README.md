# ⚽ TIPNI TO!

<p align="center">
  <strong>PWA sportovní tipovačka pro fotbal i hokej</strong><br>
  Hybridní architektura Cloudflare R2 + Firebase Realtime Database.<br>
  Okamžitá odezva, 0 zbytečných čtení z databáze a nulové provozní náklady.
</p>

<p align="center">
  <a href="https://tipni-to.netlify.app"><img src="https://img.shields.io/badge/Živá_Aplikace-tipni--to.netlify.app-059669?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/PWA-Nainstalovatelná-10b981?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA Ready">
  <img src="https://img.shields.io/badge/Storage-Cloudflare_R2-f38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare R2">
  <img src="https://img.shields.io/badge/Backend-Firebase_v11-ffca28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase">
  <img src="https://img.shields.io/badge/Engine-Node.js_22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22">
</p>

---

<!-- 📸 HLAVNÍ BANNER / SCREENSHOT APLIKACE (přetáhni sem obrázek v editaci na GitHubu) -->
<p align="center">
  <img src="https://via.placeholder.com/1200x600/111827/10b981?text=TIPNI+TO!+%E2%80%A2+Hlavn%C3%AD+rozcestn%C3%ADk+a+katalog+sout%C4%9Bz%C3%AD" alt="Náhled aplikace TIPNI TO!">
</p>

---

## 📸 Náhledy z aplikace

| 🃏 3D FUT Karty & OVR | 🏆 Živé ligové pořadí | ⚔️ H2H Duel 1 na 1 |
| :---: | :---: | :---: |
| ![FUT Karta](https://via.placeholder.com/400x550/0f172a/38bdf8?text=FUT+Karta+hráče) | ![Pořadí](https://via.placeholder.com/400x550/0f172a/10b981?text=Živé+pořadí) | ![H2H Duel](https://via.placeholder.com/400x550/0f172a/ef4444?text=H2H+Duel) |
| *OVR rating (1–99) a herní styl* | *Průběžný LIVE přepočet během hry* | *Přímé srovnání 18 metrik* |

| 🌳 Pohár (Tipni Cup) | 👀 Ligový Radar & Extrémy | 📱 Mobilní zážitek (PWA) |
| :---: | :---: | :---: |
| ![Pohár](https://via.placeholder.com/400x550/0f172a/ea580c?text=KO+Pavouk+Poháru) | ![Radar](https://via.placeholder.com/400x550/0f172a/fbbf24?text=Ligový+Radar) | ![PWA](https://via.placeholder.com/400x550/0f172a/c084fc?text=PWA+Full+Screen) |
| *Hadí draft a vyřazovací K.O.* | *Zlatý důl, Vlci samotáři i kluby* | *Běh na celou obrazovku bez lišt* |

---

## ⚡ Architektura bez provozních nákladů

Běžné realtime databáze (Firestore) při desítkách hráčů a stovkách zápasů generují obrovské množství čtení, které leze do peněz a při špičkách zpomaluje mobily.

**Aplikace tento problém řeší hybridním rozdělením zátěže:**

<pre>
                  ┌────────────────────────────────────────┐
                  │    SportAPI7 (SofaScore Live Feed)     │
                  └───────────────────┬────────────────────┘
                                      │ (minutový polling během hry)
                                      ▼
                  ┌────────────────────────────────────────┐
                  │    Node.js 22 Daemon (Render Free)     │ ◄─── Cloud Tasks budík (T-2 min)
                  └───────┬────────────────────────┬───────┘
                          │                        │
         (Atomické zápisy)│                        │ (Statická distribuce)
                          ▼                        ▼
     ┌───────────────────────────────┐  ┌──────────────────────────────────┐
     │ Firebase Realtime Database    │  │       Cloudflare R2 CDN          │
     │ Maják: system/leagues_pulse   │  │   rozpis.json / leaderboard.json │
     └──────────────┬────────────────┘  └──────────────────┬───────────────┘
                    │ (~15ms signál)                       │ (Gzip JSONy, 0 reads)
                    └───────────────────► 📱 ◄─────────────┘
                                   Mobilní PWA Klient
</pre>

* **Čtení z R2 CDN (0 Firestore Reads):** Prohlížení rozpisů, žebříčků i statistik nesahá do placené databáze. Klient stahuje statické JSONy z globální sítě Cloudflare R2.
* **Bleskový RTDB Maják (10–20 ms):** Frontend drží jedno odlehčené WebSocket spojení na uzel `system/leagues_pulse` v Realtime Database. Když padne gól nebo administrátor změní termín, maják vyšle impuls o velikosti pár bajtů a klient si jednorázově stáhne čerstvý JSON z R2.
* **Chytré probouzení na Renderu (Free Tier):** Bot běží na bezplatném tarifu a mimo hrací dny usíná. **Google Cloud Tasks** hlídá termíny:
  * **T-62 min:** Pošle Web Push notifikaci hráčům, kteří dosud nenatipovali.
  * **T-2 min:** Probudí bota na Renderu přes HTTP endpoint `/cron`.
  * Během zápasů drží bota při životě interní smyčka. Jakmile skončí poslední zápas, instance se automaticky uspí.

---

## 🎮 Herní funkce

* **🃏 3D FUT Karty hráčů:** Algoritmus počítá kariérní **OVR rating (1–99)** a 6 atributů: Přesnost (PŘE), Odvahu (ODV), Psychiku v šlágrech (CLU), Stabilitu (STA), Formu (FOR) a Efektivitu (EFE). Automaticky určuje herní archetyp (*Odstřelovač, Taktik, Predátor...*). Karta nabízí 3D otočení se statistikami a export do obrázku.
* **⚔️ H2H Duel Aréna:** Vyzvi soupeře z tabulky na přímý souboj 1 na 1 se srovnáním 18 metrik (bilance kol, forma z 5 zápasů i špionáž odlišných tipů).
* **🌳 Pohár (Tipni Cup):** Samostatný turnaj pro fotbalové ligy. Nasazení probíhá Hadím draftem do 4 skupin a pokračuje vyřazovacím K.O. pavoukem na odvety. Body se berou automaticky z běžných ligových tipů.
* **👀 Ligový Radar:** Sleduje extrémy sezóny – *Zlatý důl* (nejvíce bodů v kole), *Totální výbuchy* (0 bodů pro celou ligu), *Vlci samotáři* (jediný správný tipér proti davu), *Smolař sezóny* i statistiku štědrosti klubů.
* **🔒 Špehovací oko (T-0):** Do začátku zápasu jsou všechny tipy zamčené pod zámkem. Přesně v čase startu se zámek změní na oko 👁️ a odkryje tipy všech soupeřů včetně procentuálního rozložení komunity.

---

## 🛠️ Použitý stack

| Vrstva | Použité technologie |
|---|---|
| **Frontend** | JavaScript (ES6 moduly), Alpine.js v3, CSS3 (Dark UI) |
| **PWA & Offline** | Service Worker (Cache-First + Stale-While-Revalidate), Web App Manifest |
| **BaaS & Databáze** | Firebase Auth, Cloud Firestore, Realtime Database |
| **Storage & Hosting** | Cloudflare R2 (S3 API), Netlify CDN |
| **Backend & Cron** | Node.js 22, Cloud Functions v2, Google Cloud Tasks |
| **Live Daemon** | Node.js na Render Free Tieru, SportAPI7 (SofaScore live feed) |

---

## 🛡️ Vychytávky pod kapotou

* **Formulářový interceptor:** Hlídá rozpracované tipy. Při nechtěném kliknutí jinam, gestu zpět na telefonu nebo zavření okna vyskočí varovný dialog.
* **Dynamický Canvas font engine:** Písmo dlouhých názvů týmů a přezdívek se za běhu měří v paměti přes HTML5 Canvas a plynule škáluje, aby text nepřetekl kartu na žádném mobilu.
* **In-App výmaz účtu (GDPR):** Možnost trvalého smazání profilu přímo v aplikaci s bezpečnou anonymizací historických bodů, aby se nerozbily tabulky ostatním hráčům.

---

## 👨‍💻 Autor

Vyvinuto jako nezávislý komunitní projekt s důrazem na rychlost a efektivní využití moderních bezplatných cloudových vrstev.

* **GitHub:** [@jaydym13-lgtm](https://github.com/jaydym13-lgtm)
* **Živá verze:** [tipni-to.netlify.app](https://tipni-to.netlify.app)