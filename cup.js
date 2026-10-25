// =========================================================================
// 🏆 TIPNI TO! - POHÁROVÝ ENGINE: CHANCE CUP & PREMIER CUP (cup.js)
// =========================================================================

// 🚀 SPOUŠTĚČ POHÁRU Z MENU
window.openSpecificCup = async (leagueName) => {
    const store = Alpine.store('appState');
    if (store) {
        store.isMenuOpen = false;
        store.selectedLeague = leagueName;
        store.cupActiveTab = 'arena';
    }

    if (typeof window.selectLeague === 'function') {
        await window.selectLeague(leagueName, 'cupScreen');
    } else {
        window.goToScreen('cupScreen');
        window.renderCupScreen(leagueName);
    }
};

// 🎯 DOJEZD NA POZICI PŘIHLÁŠENÉHO HRÁČE V ARÉNĚ
window.scrollToMyCupPosition = () => {
    const myRow = document.querySelector('.cup-arena-row.is-me');
    if (myRow) {
        myRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

// 🤖 FORMÁTOVAČ JMÉNA HRÁČE (CENTRÁLNÍ DELEGACE NA UI.JS)
const formatCupPlayerNick = (player, fallback = 'Hráč') => {
    return window.formatPlayerNick ? window.formatPlayerNick(player, fallback) : (player?.nick || player?.nickname || fallback);
};

// 🎨 HLAVNÍ RENDERER POHÁRU (POHÁROVÁ ARÉNA & K.O. PAVOUK)
window.renderCupScreen = async (overrideLeague) => {
    const container = document.getElementById('cupScreenContent');
    const titleEl = document.getElementById('cupMainTitle');
    if (!container) return;

    const store = Alpine.store('appState');
    const myUid = window.auth?.currentUser?.uid || store?.userUid;
    const leagueName = overrideLeague || store?.selectedLeague || localStorage.getItem('savedLeague') || 'Chance Liga';
    const activeTab = store?.cupActiveTab || 'arena';

    if (titleEl) {
        titleEl.innerHTML = `
            <svg class="micro-tile-cup-svg" viewBox="0 0 24 24" style="width: 22px; height: 22px;">
                <path fill="url(#silverGradGlobalCup)" d="M20.25 3H3.75C3.34 3 3 3.34 3 3.75V6c0 2.89 1.96 5.34 4.67 5.9.75 1.66 2.2 2.92 3.95 3.32V18H8.5c-.28 0-.5.22-.5.5v2c0 .28.22.5.5.5h7c.28 0 .5-.22.5-.5v-2c0-.28-.22-.5-.5-.5h-3.12v-2.78c1.75-.4 3.2-1.66 3.95-3.32 2.71-.56 4.67-3.01 4.67-5.9V3.75c0-.41-.34-.75-.75-.75zM5 6V5h2.13v3.87C5.9 8.27 5 6.99 5 6zm14 0c0 .99-.9 2.27-2.13 2.87V5H19v1z"/>
            </svg>
            <span>TIPNI CUP</span>
        `;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 📋 PODZÁLOŽKA 1: PRAVIDLA TURNAJE
    // ─────────────────────────────────────────────────────────────────────
    if (activeTab === 'rules') {
        container.innerHTML = `
            <div class="cup-wrapper">
                <div class="cup-rules-card">
                    <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; padding: 12px;">
                        <h4 style="color: #38bdf8; margin: 0 0 6px 0; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                            <span>💡</span> JAK POHÁR FUNGUJE V PRAXI
                        </h4>
                        <p style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.5; margin: 0;">
                            <strong>Netipují se žádné zápasy navíc!</strong> Do turnaje se automaticky přenášejí body z tvých běžných ligových tipů. Hraješ svou ligu a systém tvé body paralelně započítává do Pohárové arény a vyřazovacích duelů.<br><br>
                            🌍 <strong>Společný celoligový šampionát:</strong> Tipni Cup je otevřený turnaj pro úplně všechny tipéry v dané lize bez ohledu na soukromé partičky. V pavouku se tak potkáš nejen se svou partou, ale změříš síly s celou komunitou soutěže.
                        </p>
                    </div>

                    <div class="cup-rules-section">
                        <span class="cup-rules-title" style="color: #fbbf24;">1. Harmonogram turnaje (Cíl: 30. kolo)</span>
                        <p class="cup-rules-text">
                            • <strong>1.–9. kolo:</strong> 🎯 Ligový start (Hraje se běžná liga. Pořadí po 9. kole určí nasazení pro Pohár).<br>
                            • <strong>10.–17. kolo:</strong> 🏟️ <strong>Pohárová aréna</strong> (8 kol ligové fáze od 0 bodů v jedné společné tabulce).<br>
                            • <strong>18.–29. kolo:</strong> 🥊 <strong>Play-off</strong> (Odvety na 2 kola • Špička má volný los, spodní příčky bojují v předkole).<br>
                            • <strong>30. kolo:</strong> 🏆 <strong>Grand Finále</strong> (Rozhodující finálový zápas ALL-IN před ligovou nadstavbou).
                        </p>
                    </div>

                    <div class="cup-rules-section">
                        <span class="cup-rules-title" style="color: #34d399;">2. Odstupňovaná postupová pásma (Královská & Pohárová volna)</span>
                        <p class="cup-rules-text">
                            Z Pohárové arény nevypadává nikdo! Po 17. kole se tabulka rozdělí na tři pásma:<br>
                            • 👑 <strong>Zelené pásmo (Královské volno):</strong> Nejlepší hráči získávají <strong>2 kola volno</strong> – přeskakují 1. i 2. předkolo a nastupují až přímo do hlavní fáze.<br>
                            • ⭐ <strong>Modré pásmo (Pohárové volno):</strong> Střed tabulky získává <strong>1 kolo volno</strong> – přeskakuje 1. předkolo a nastupuje do 2. předkola.<br>
                            • 🥊 <strong>Oranžové pásmo (1. Předkolo):</strong> Spodní patro tabulky hned v 1. předkole bojuje o postup dál.
                        </p>
                    </div>

                    <div class="cup-rules-section">
                        <span class="cup-rules-title" style="color: #38bdf8;">3. Kritéria při shodě bodů v Pohárové aréně</span>
                        <p class="cup-rules-text">
                            Při rovnosti bodů po 17. kole rozhoduje postupně:<br>
                            1. Vyšší počet <strong>přesných výsledků</strong> v Aréně (10.–17. kolo).<br>
                            2. Vyšší počet <strong>přesných TOP zápasů</strong> v Aréně.<br>
                            3. Vyšší počet <strong>správných tendencí (1, X, 2)</strong> v Aréně.<br>
                            4. Nejvyšší <strong>bodový zisk za jedno kolo</strong> v Aréně (High Score).<br>
                            5. Lepší postavení v ligové tabulce <strong>po 9. kole (Nasazení / Seed)</strong>.
                        </p>
                    </div>

                    <div class="cup-rules-section">
                        <span class="cup-rules-title" style="color: #f97316;">4. Pomocná kritéria při rovnosti bodů v Play-off</span>
                        <p class="cup-rules-text">
                            Pokud vyřazovací duel po sečtení obou kol skončí remízou, o postupu rozhoduje:<br>
                            1. Vyšší součet <strong>přesných výsledků</strong> v daném duelu.<br>
                            2. Vyšší součet <strong>přesných TOP zápasů</strong> v daném duelu.<br>
                            3. Vyšší součet <strong>správných tendencí (1, X, 2)</strong> v daném duelu.<br>
                            4. Vyšší pozice v konečné tabulce <strong>Pohárové arény</strong>.
                        </p>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 📡 NAČTENÍ DAT POHÁRU Z DATA STORU / R2
    // ─────────────────────────────────────────────────────────────────────
    const serverCupData = store?.cupData?.[leagueName] || window.tipniCupData?.[leagueName];
    if (!serverCupData) {
        container.innerHTML = `
            <div class="cup-wrapper" style="text-align: center; padding: 40px 10px;">
                <div style="font-size: 2rem; margin-bottom: 10px;">⏳</div>
                <div style="color: #94a3b8; font-size: 0.9rem;">Načítám data pro Tipni Cup...</div>
            </div>
        `;
        return;
    }

    const arenaList = serverCupData.arena || [];
    const byesCount = Number(serverCupData.byesCount) || 0;
    const isLocked = serverCupData.status === 'ARENA' || serverCupData.status === 'PLAYOFF';

    // ─────────────────────────────────────────────────────────────────────
    // 🌳 PODZÁLOŽKA 2: K.O. PAVOUK (PLAY-OFF)
    // ─────────────────────────────────────────────────────────────────────
    if (activeTab === 'bracket') {
        const playoffStages = serverCupData.playoff?.rounds || [];

        if (playoffStages.length === 0) {
            container.innerHTML = `
                <div class="cup-wrapper">
                    <div class="cup-preview-badge">
                        <span>🌳</span>
                        <span>PLAY-OFF SE OTEVŘE PO DOHRÁNÍ ARÉNY (PO 17. KOLE)</span>
                    </div>
                    <div class="db-empty-msg" style="padding: 30px; text-align: center; color: #9ca3af; font-size: 0.85rem; line-height: 1.5;">
                        Aktuálně probíhá ligová fáze v Pohárové aréně. Po odehrání 17. kola bot vyhodnotí tabulku, rozdá Královská volna a automaticky nalosuje kompletní strom Play-off. 🏟️
                    </div>
                </div>
            `;
            return;
        }

        const renderDuelCardHtml = (duel) => {
            const isMeInDuel = Boolean(myUid && (duel.p1?.uid === myUid || duel.p2?.uid === myUid));
            const p1Wins = duel.winnerUid && duel.winnerUid === duel.p1?.uid;
            const p2Wins = duel.winnerUid && duel.winnerUid === duel.p2?.uid;
            const opponentUid = duel.p1?.uid === myUid ? duel.p2?.uid : duel.p1?.uid;

            return `
                <div class="cup-bracket-match-card ${isMeInDuel ? 'is-my-match' : ''}">
                    <div class="cup-duel-header">
                        <span>${duel.title || 'Vyřazovací duel'}</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span>${duel.statusText || ''}</span>
                            ${isMeInDuel && opponentUid ? `
                                <button type="button" class="action-btn" style="height: 22px; padding: 0 6px; font-size: 0.65rem; background: #2563eb; border: 1px solid #60a5fa; border-radius: 4px; margin: 0; font-family: 'Oswald', sans-serif; cursor: pointer;" onclick="if(typeof window.showH2HModal === 'function') window.showH2HModal('${opponentUid}');">
                                    ⚔️ H2H
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <div class="cup-duel-row ${p1Wins ? 'is-winner' : ''}">
                        <div class="cup-duel-player">
                            <span style="color: #64748b; font-size: 0.75rem;">#${duel.p1?.seed || '-'}</span>
                            <strong>${formatCupPlayerNick(duel.p1, 'Čeká')}</strong>
                            ${p1Wins ? ' 👑' : ''}
                        </div>
                        <div class="cup-duel-scores">
                            ${duel.p1?.leg2 !== null && duel.p1?.leg2 !== undefined ? `<span class="cup-duel-legs">(${duel.p1?.leg1 ?? '-'} + ${duel.p1?.leg2 ?? '-'})</span>` : ''}
                            <span class="cup-duel-total ${p1Wins ? 'is-winning' : ''}">${duel.p1?.totalPts ?? 0} b.</span>
                        </div>
                    </div>

                    <div class="cup-duel-row ${p2Wins ? 'is-winner' : ''}">
                        <div class="cup-duel-player">
                            <span style="color: #64748b; font-size: 0.75rem;">#${duel.p2?.seed || '-'}</span>
                            <strong>${formatCupPlayerNick(duel.p2, 'Čeká')}</strong>
                            ${p2Wins ? ' 👑' : ''}
                        </div>
                        <div class="cup-duel-scores">
                            ${duel.p2?.leg2 !== null && duel.p2?.leg2 !== undefined ? `<span class="cup-duel-legs">(${duel.p2?.leg1 ?? '-'} + ${duel.p2?.leg2 ?? '-'})</span>` : ''}
                            <span class="cup-duel-total ${p2Wins ? 'is-winning' : ''}">${duel.p2?.totalPts ?? 0} b.</span>
                        </div>
                    </div>
                </div>
            `;
        };

        container.innerHTML = `
            <div class="cup-wrapper">
                <div class="cup-preview-badge" style="border-color: #f97316; color: #fb923c;">
                    <span>🌳</span>
                    <span>ŽIVÝ STAV PLAY-OFF • TIPNI CUP</span>
                </div>
                <div class="cup-bracket-scroll-container">
                    ${playoffStages.map((stage) => `
                        <div class="cup-stage-box">
                            <div class="cup-stage-header">
                                <span>${stage.name}</span>
                                <span style="color: #94a3b8; font-size: 0.75rem;">${stage.info || ''}</span>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
                                ${(stage.duels || []).map(d => renderDuelCardHtml(d)).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        return;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🏟️ PODZÁLOŽKA 3: POHÁROVÁ ARÉNA (LIGOVÁ TABULKA VŠECH HRÁČŮ)
    // ─────────────────────────────────────────────────────────────────────
    if (arenaList.length === 0) {
        container.innerHTML = `
            <div class="cup-wrapper">
                <div class="db-empty-msg" style="padding: 40px; text-align: center; color: #9ca3af;">
                    V Pohárové aréně zatím nejsou žádní hráči.
                </div>
            </div>
        `;
        return;
    }

    const myRankIndex = arenaList.findIndex(p => p.uid === myUid);
    const myRank = myRankIndex !== -1 ? (myRankIndex + 1) : null;

    const doubleByes = Number(serverCupData.doubleByesCount) || Number(serverCupData.byesCount) || 0;
    const singleByes = Number(serverCupData.singleByesCount) || 0;

    const badgeTitle = isLocked
        ? 'POHÁROVÁ ARÉNA (10.–17. KOLO)'
        : 'NÁHLED NASAZENÍ • START V 10. KOLE (body se v Poháru nulují)';

    let arenaRowsHtml = '';
    arenaList.forEach((p, idx) => {
        const rank = idx + 1;
        const isMe = Boolean(myUid && p.uid === myUid);

        let badgeClass = 'is-predkolo';
        let badgeText = '🥊 PŘEDKOLO';

        if (rank <= doubleByes) {
            badgeClass = 'is-bye';
            badgeText = '👑 KRÁLOVSKÉ VOLNO';
        } else if (singleByes > 0 && rank <= doubleByes + singleByes) {
            badgeClass = 'is-single-bye';
            badgeText = '⭐ POHÁROVÉ VOLNO';
        }

        arenaRowsHtml += `
            <div class="cup-arena-row ${badgeClass} ${isMe ? 'is-me' : ''}" data-uid="${p.uid}">
                <div class="cup-arena-left">
                    <span class="cup-arena-rank">${rank}.</span>
                    <span class="cup-arena-nick">${formatCupPlayerNick(p)}</span>
                </div>
                <div class="cup-arena-right">
                    <span class="cup-arena-badge ${badgeClass}">${badgeText}</span>
                    <span class="cup-arena-pts">${p.pts || 0} b.</span>
                </div>
            </div>
        `;
    });

    const targetStageName = (serverCupData.targetStageSize === 8) ? 'Čtvrtfinále' : ((serverCupData.targetStageSize === 32) ? '1/16-finále' : 'Osmifinále');

    const arenaLegendHtml = doubleByes > 0 ? `
        <div class="cup-arena-legend">
            <div class="cup-legend-item">
                <span class="cup-legend-box is-bye"></span>
                <span>1.–${doubleByes}. místo: Přímý postup do ${targetStageName}</span>
            </div>
            ${singleByes > 0 ? `
            <div class="cup-legend-item">
                <span class="cup-legend-box is-single-bye"></span>
                <span>${doubleByes + 1}.–${doubleByes + singleByes}. místo: Nasazení do 2. předkola</span>
            </div>` : ''}
            <div class="cup-legend-item">
                <span class="cup-legend-box is-predkolo"></span>
                <span>${doubleByes + singleByes + 1}.–${arenaList.length}. místo: 1. předkolo</span>
            </div>
            <div class="cup-legend-note">
                ⚔️ Všechny vyřazovací duely se hrají na 2 kola (součet bodů z odvet). Grand Finále na 1 zápas.
            </div>
        </div>
    ` : '';

    const myPosFabHtml = myRank ? `
        <button type="button" class="cup-my-pos-fab" onclick="window.scrollToMyCupPosition()">
            🎯 MOJE POZICE (#${myRank})
        </button>
    ` : '';

    container.innerHTML = `
        <div class="cup-wrapper">
            <div class="cup-preview-badge" style="${isLocked ? 'border-color: #10b981; color: #34d399;' : ''}">
                <span>${isLocked ? '🏟️' : '🔮'}</span>
                <span>${badgeTitle}</span>
            </div>

            <div class="cup-arena-container">
                ${arenaRowsHtml}
            </div>

            ${arenaLegendHtml}

            ${myPosFabHtml}
        </div>
    `;
};