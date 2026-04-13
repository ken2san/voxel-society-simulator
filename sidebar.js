// Function to individually update only needs/mood
// --- Record mood/needs history for each character ---
if (!window.characterHistory) window.characterHistory = {};
function recordCharacterHistory() {
    if (!window.characters) return;
    window.characters.forEach(char => {
        if (!window.characterHistory[char.id]) {
            window.characterHistory[char.id] = [];
        }
        const arr = window.characterHistory[char.id];
        const last = arr[arr.length - 1];
        const curr = {
            mood: char.mood,
            hunger: char.needs?.hunger ?? null,
            energy: char.needs?.energy ?? null,
            safety: char.needs?.safety ?? null,
            social: char.needs?.social ?? null
        };
        // Only push if there's any change from the previous state
        let changed = false;
        if (!last) changed = true;
        else {
            if (last.mood !== curr.mood) changed = true;
            else if (last.hunger !== curr.hunger) changed = true;
            else if (last.energy !== curr.energy) changed = true;
            else if (last.safety !== curr.safety) changed = true;
            else if (last.social !== curr.social) changed = true;
        }
        if (changed) {
            arr.push({
                time: Date.now(),
                ...curr
            });
            if (arr.length > 10) arr.shift();
        }
    });
}
if (window.__characterHistoryInterval) clearInterval(window.__characterHistoryInterval);
window.__characterHistoryInterval = setInterval(recordCharacterHistory, 1000);
function renderCharacterNeeds() {
    // Traverse each tr in summary table tbody and update only needs and mood
    const table = document.querySelector('.character-summary-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    // Process only even rows since there are 2 rows per character (summary row + detail row)
    for (let i = 0; i < rows.length; i += 2) {
        const tr = rows[i];
        const charId = tr.children[0]?.textContent;
        const char = window.characters?.find(c => c.id == charId);
        if (!char) continue;
        // mood
        const tdMood = tr.querySelector('.mood-td');
        if (tdMood) {
            let moodIcon = '', moodClass = 'mood-neutral', moodText = '';
            switch (char.mood) {
                case 'happy': moodIcon = '😄'; moodClass = 'mood-happy'; moodText = 'happy'; break;
                case 'tired': moodIcon = '😪'; moodClass = 'mood-tired'; moodText = 'tired'; break;
                case 'lonely': moodIcon = '😢'; moodClass = 'mood-lonely'; moodText = 'lonely'; break;
                case 'active': moodIcon = '🚶'; moodClass = 'mood-active'; moodText = 'active'; break;
                case 'angry': moodIcon = '😠'; moodClass = 'mood-angry'; moodText = 'angry'; break;
                case 'sad': moodIcon = '😔'; moodClass = 'mood-sad'; moodText = 'sad'; break;
                default: moodIcon = '🙂'; moodClass = 'mood-neutral'; moodText = 'neutral';
            }
            const moodSpan = tdMood.querySelector('.mood-badge');
            if (moodSpan) {
                moodSpan.className = 'mood-badge ' + moodClass;
                moodSpan.textContent = `${moodIcon} ${moodText}`;
            }
        }
        // needs (hunger, energy, safety, social)
        const needKeys = ['hunger','energy','safety','social'];
        for (let j = 0; j < needKeys.length; j++) {
            const td = tr.children[3 + j];
            if (td && char.needs && typeof char.needs[needKeys[j]] === 'number') {
                td.textContent = Math.round(char.needs[needKeys[j]]);
            }
        }
    }
}

// Control auto-update based on presence of openedCharId only
if (window.__sidebarNeedsInterval) clearInterval(window.__sidebarNeedsInterval);
window.__sidebarNeedsInterval = setInterval(() => {
    // Do not update at all while detail panel is open
    if (openedCharId) return;
    // Redraw entire summary table
    window.renderCharacterList && window.renderCharacterList();
}, 1000);

// Global registration
window.renderCharacterNeeds = renderCharacterNeeds;
// Explicitly initialize so it doesn't auto-start in initial state
window.characters = undefined;
window.simulationRunning = false;
// Right sidebar: Selected character details
function renderCharacterDetail() {
    if (!rightSidebar) return;

    // If the user is currently editing an input inside the right sidebar,
    // avoid re-rendering the entire panel which would steal focus.
    try {
        const active = document.activeElement;
        if (active && rightSidebar.contains(active) &&
            (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
            return; // keep current focus and avoid clobbering user's typing
        }
    } catch (e) {
        // ignore environment errors
    }
    // --- Hold values in sidebarParams ---
    if (!window.sidebarParams) {
        window.sidebarParams = {
            charNum: 10,
            socialTh: 30,
            groupAffinityTh: 50,
            useRandom: false
        };
    }
    const sidebarParams = window.sidebarParams;
    // Disable parameter fields during simulation (defined only once)
    const paramDisabled = !!window.simulationRunning && window.characters && window.characters.length > 0;
    // Also reflect to global
    window.groupAffinityThreshold = sidebarParams.groupAffinityTh;
    window.socialThreshold = sidebarParams.socialTh; // Set during initialization as well
    // Emergency threshold parameters
    if (sidebarParams.hungerEmergencyThreshold === undefined) sidebarParams.hungerEmergencyThreshold = 5;
    if (sidebarParams.energyEmergencyThreshold === undefined) sidebarParams.energyEmergencyThreshold = 8;
    if (sidebarParams.homeReturnHungerLevel === undefined) sidebarParams.homeReturnHungerLevel = 90;
    if (sidebarParams.homeBuildingPriority === undefined) sidebarParams.homeBuildingPriority = 80;
    if (sidebarParams.woodCollectionPriority === undefined) sidebarParams.woodCollectionPriority = 70;
    window.hungerEmergencyThreshold = sidebarParams.hungerEmergencyThreshold;
    window.energyEmergencyThreshold = sidebarParams.energyEmergencyThreshold;
    window.homeReturnHungerLevel = sidebarParams.homeReturnHungerLevel;
    window.homeBuildingPriority = sidebarParams.homeBuildingPriority;
    window.woodCollectionPriority = sidebarParams.woodCollectionPriority;
    // New parameters: initial affinity value and increase rate
    if (sidebarParams.initialAffinityMin === undefined) sidebarParams.initialAffinityMin = 20;
    if (sidebarParams.initialAffinityMax === undefined) sidebarParams.initialAffinityMax = 40;
    if (sidebarParams.affinityIncreaseRate === undefined) sidebarParams.affinityIncreaseRate = 10;
    if (sidebarParams.affinityDecayRate === undefined) sidebarParams.affinityDecayRate = 0.01; // affinity units per second
    // New control defaults
    if (sidebarParams.pairReproductionCooldownSeconds === undefined) sidebarParams.pairReproductionCooldownSeconds = 60;
    if (sidebarParams.maxAffinity === undefined) sidebarParams.maxAffinity = 100;
    if (sidebarParams.reproductionCooldownSeconds === undefined) sidebarParams.reproductionCooldownSeconds = 10;
    if (sidebarParams.autoRecoverStall === undefined) sidebarParams.autoRecoverStall = true;
    if (sidebarParams.recoverActionCooldown === undefined) sidebarParams.recoverActionCooldown = 0.5;
    if (sidebarParams.maxActionCooldown === undefined) sidebarParams.maxActionCooldown = 8;
    if (sidebarParams.movingReplanStallMs === undefined) sidebarParams.movingReplanStallMs = 2500;
    if (sidebarParams.pathOccupancyLookahead === undefined) sidebarParams.pathOccupancyLookahead = 2;
    if (sidebarParams.recentDigCooldownMs === undefined) sidebarParams.recentDigCooldownMs = 10000;
    if (sidebarParams.digActionCooldown === undefined) sidebarParams.digActionCooldown = 2200;
    if (sidebarParams.worldReservationTTL === undefined) sidebarParams.worldReservationTTL = 5000;
    if (sidebarParams.reservationFallbackCooldown === undefined) sidebarParams.reservationFallbackCooldown = 1000;
    if (sidebarParams.fallbackBackoffMs === undefined) sidebarParams.fallbackBackoffMs = 1500;
    if (sidebarParams.pathInvalidationBackoffFactor === undefined) sidebarParams.pathInvalidationBackoffFactor = 0.2;
    if (sidebarParams.pathInvalidationBackoffMax === undefined) sidebarParams.pathInvalidationBackoffMax = 2.0;
    window.initialAffinityMin = sidebarParams.initialAffinityMin;
    window.initialAffinityMax = sidebarParams.initialAffinityMax;
    window.affinityIncreaseRate = sidebarParams.affinityIncreaseRate;
    window.affinityDecayRate = sidebarParams.affinityDecayRate;
    // Expose new knobs to global window for runtime tuning
    window.pairReproductionCooldownSeconds = sidebarParams.pairReproductionCooldownSeconds;
    window.maxAffinity = sidebarParams.maxAffinity;
    window.reproductionCooldownSeconds = sidebarParams.reproductionCooldownSeconds;
    window.autoRecoverStall = sidebarParams.autoRecoverStall;
    window.recoverActionCooldown = sidebarParams.recoverActionCooldown;
    window.maxActionCooldown = sidebarParams.maxActionCooldown;
    window.movingReplanStallMs = sidebarParams.movingReplanStallMs;
    window.pathOccupancyLookahead = sidebarParams.pathOccupancyLookahead;
    window.recentDigCooldownMs = sidebarParams.recentDigCooldownMs;
    window.digActionCooldown = sidebarParams.digActionCooldown;
    window.worldReservationTTL = sidebarParams.worldReservationTTL;
    window.reservationFallbackCooldown = sidebarParams.reservationFallbackCooldown;
    window.fallbackBackoffMs = sidebarParams.fallbackBackoffMs;
    window.pathInvalidationBackoffFactor = sidebarParams.pathInvalidationBackoffFactor;
    window.pathInvalidationBackoffMax = sidebarParams.pathInvalidationBackoffMax;
    // --- 右サイドバー：AIパラメータ調整UI ---
    rightSidebar.innerHTML = '';
    const paramBox = document.createElement('div');
    // --- AIモード切り替えトグル ---
    if (window.aiMode === undefined) window.aiMode = 'rule';
    const aiToggleRow = document.createElement('div');
    aiToggleRow.style.display = 'flex';
    aiToggleRow.style.alignItems = 'center';
    aiToggleRow.style.gap = '10px';
    const aiToggleLabel = document.createElement('span');
    aiToggleLabel.textContent = 'AI Mode:';
    aiToggleLabel.style.width = '140px';
    aiToggleRow.appendChild(aiToggleLabel);
    const aiToggleBtn = document.createElement('button');
    function updateAiToggleBtn() {
        aiToggleBtn.textContent = (window.aiMode === 'utility') ? 'Utility-based' : 'Rule-based';
        aiToggleBtn.style.background = (window.aiMode === 'utility')
            ? 'linear-gradient(90deg,#ffe082 60%,#f8f4fa 100%)'
            : 'linear-gradient(90deg,#b2ff59 60%,#f8f4fa 100%)';
    }
    updateAiToggleBtn();
    aiToggleBtn.onclick = () => {
        window.aiMode = (window.aiMode === 'rule') ? 'utility' : 'rule';
        updateAiToggleBtn();
    };
    aiToggleBtn.style.fontWeight = 'bold';
    aiToggleBtn.style.padding = '4px 18px';
    aiToggleBtn.style.borderRadius = '8px';
    aiToggleBtn.style.border = '1.5px solid #b0c8e0';
    aiToggleBtn.style.color = '#333';
    aiToggleBtn.style.cursor = 'pointer';
    aiToggleRow.appendChild(aiToggleBtn);
    paramBox.appendChild(aiToggleRow);
    paramBox.style.background = 'rgba(255,255,255,0.93)';
    paramBox.style.borderRadius = '18px';
    paramBox.style.boxShadow = '0 2px 12px #b0c8e033';
    paramBox.style.padding = '18px 18px 14px 18px';
    paramBox.style.margin = '18px 18px 22px 18px';
    paramBox.style.display = 'flex';
    paramBox.style.flexDirection = 'column';
    paramBox.style.gap = '12px';

    // Sticky simulation controls so Start/Pause is always reachable while scrolling.
    const actionBar = document.createElement('div');
    actionBar.style.position = 'sticky';
    actionBar.style.top = '6px';
    actionBar.style.zIndex = '15';
    actionBar.style.display = 'flex';
    actionBar.style.alignItems = 'center';
    actionBar.style.justifyContent = 'space-between';
    actionBar.style.gap = '10px';
    actionBar.style.padding = '10px 12px';
    actionBar.style.borderRadius = '12px';
    actionBar.style.border = '1px solid #d9e6ff';
    actionBar.style.background = 'linear-gradient(120deg, rgba(255,255,255,0.95) 0%, rgba(231,241,255,0.95) 100%)';
    actionBar.style.backdropFilter = 'blur(6px)';
    actionBar.style.boxShadow = '0 6px 18px rgba(0,0,0,0.10)';

    const actionBarLabel = document.createElement('span');
    actionBarLabel.textContent = 'Simulation';
    actionBarLabel.style.fontWeight = '700';
    actionBarLabel.style.fontSize = '0.95em';
    actionBarLabel.style.color = '#2f3b52';
    actionBar.appendChild(actionBarLabel);


    // タイトル
    const title = document.createElement('div');
    title.textContent = 'AI Parameter Controls';
    title.style.fontWeight = 'bold';
    title.style.fontSize = '1.18em';
    title.style.color = '#333';
    title.style.marginBottom = '2px';
    paramBox.appendChild(title);


    // --- グループしきい値スライダー ---
    const groupThRow = document.createElement('div');
    groupThRow.style.display = 'flex';
    groupThRow.style.alignItems = 'center';
    groupThRow.style.gap = '10px';
    const groupThLabel = document.createElement('span');
    groupThLabel.textContent = 'Group Affinity Threshold:';
    groupThLabel.style.width = '140px';
    groupThRow.appendChild(groupThLabel);
    const groupThInput = document.createElement('input');
    groupThInput.type = 'range';
    groupThInput.min = 0;
    groupThInput.max = 100;
    groupThInput.value = sidebarParams.groupAffinityTh;
    groupThInput.style.flex = '1';
    groupThInput.style.margin = '0 8px';
    groupThInput.id = 'groupThInput';
    groupThInput.name = 'groupThInput';
    groupThRow.appendChild(groupThInput);
    const groupThVal = document.createElement('input');
    groupThVal.type = 'number';
    groupThVal.min = 0;
    groupThVal.max = 100;
    groupThVal.value = sidebarParams.groupAffinityTh;
    groupThVal.style.width = '48px';
    groupThVal.id = 'groupThVal';
    groupThVal.name = 'groupThVal';
    groupThRow.appendChild(groupThVal);
    // 双方向同期＋sidebarParams更新
    groupThInput.oninput = () => {
        groupThVal.value = groupThInput.value;
        sidebarParams.groupAffinityTh = parseInt(groupThInput.value);
        window.groupAffinityThreshold = sidebarParams.groupAffinityTh;
    };
    groupThVal.oninput = () => {
        groupThInput.value = groupThVal.value;
        sidebarParams.groupAffinityTh = parseInt(groupThVal.value);
        window.groupAffinityThreshold = sidebarParams.groupAffinityTh;
    };
    paramBox.appendChild(groupThRow);
    groupThInput.disabled = paramDisabled;
    groupThVal.disabled = paramDisabled;

    // --- 初期affinity値スライダー（min/max） ---
    const affinityInitRow = document.createElement('div');
    affinityInitRow.style.display = 'flex';
    affinityInitRow.style.alignItems = 'center';
    affinityInitRow.style.gap = '10px';
    const affinityInitLabel = document.createElement('span');
    affinityInitLabel.textContent = 'Initial Affinity:';
    affinityInitLabel.style.width = '140px';
    affinityInitRow.appendChild(affinityInitLabel);
    // min
    const affinityInitMin = document.createElement('input');
    affinityInitMin.type = 'number';
    affinityInitMin.min = 0;
    affinityInitMin.max = 100;
    affinityInitMin.value = sidebarParams.initialAffinityMin;
    affinityInitMin.style.width = '48px';
    affinityInitMin.disabled = paramDisabled;
    affinityInitMin.id = 'affinityInitMin';
    affinityInitMin.name = 'affinityInitMin';
    affinityInitMin.addEventListener('input', e => {
        sidebarParams.initialAffinityMin = Number(e.target.value);
        window.initialAffinityMin = Number(e.target.value);
    });
    affinityInitRow.appendChild(affinityInitMin);
    // ～
    const tilde = document.createElement('span');
    tilde.textContent = '～';
    affinityInitRow.appendChild(tilde);
    // max
    const affinityInitMax = document.createElement('input');
    affinityInitMax.type = 'number';
    affinityInitMax.min = 0;
    affinityInitMax.max = 100;
    affinityInitMax.value = sidebarParams.initialAffinityMax;
    affinityInitMax.style.width = '48px';
    affinityInitMax.disabled = paramDisabled;
    affinityInitMax.id = 'affinityInitMax';
    affinityInitMax.name = 'affinityInitMax';
    affinityInitMax.addEventListener('input', e => {
        sidebarParams.initialAffinityMax = Number(e.target.value);
        window.initialAffinityMax = Number(e.target.value);
    });
    affinityInitRow.appendChild(affinityInitMax);
    paramBox.appendChild(affinityInitRow);

    // --- affinity上昇速度スライダー ---
    const affinityRateRow = document.createElement('div');
    affinityRateRow.style.display = 'flex';
    affinityRateRow.style.alignItems = 'center';
    affinityRateRow.style.gap = '10px';
    const affinityRateLabel = document.createElement('span');
    affinityRateLabel.textContent = 'Affinity Increase Rate:';
    affinityRateLabel.style.width = '140px';
    affinityRateRow.appendChild(affinityRateLabel);
    const affinityRateInput = document.createElement('input');
    affinityRateInput.type = 'range';
    affinityRateInput.min = 1;
    affinityRateInput.max = 50;
    affinityRateInput.value = sidebarParams.affinityIncreaseRate;
    affinityRateInput.style.width = '120px';
    affinityRateInput.disabled = paramDisabled;
    affinityRateInput.id = 'affinityRateInput';
    affinityRateInput.name = 'affinityRateInput';
    affinityRateInput.addEventListener('input', e => {
        sidebarParams.affinityIncreaseRate = Number(e.target.value);
        affinityRateNumber.value = e.target.value;
        window.affinityIncreaseRate = Number(e.target.value);
    });
    affinityRateRow.appendChild(affinityRateInput);
    const affinityRateNumber = document.createElement('input');
    affinityRateNumber.type = 'number';
    affinityRateNumber.min = 1;
    affinityRateNumber.max = 50;
    affinityRateNumber.value = sidebarParams.affinityIncreaseRate;
    affinityRateNumber.disabled = paramDisabled;
    affinityRateNumber.style.width = '48px';
    affinityRateNumber.id = 'affinityRateNumber';
    affinityRateNumber.name = 'affinityRateNumber';
    affinityRateNumber.addEventListener('input', e => {
        sidebarParams.affinityIncreaseRate = Number(e.target.value);
        affinityRateInput.value = e.target.value;
        window.affinityIncreaseRate = Number(e.target.value);
    });
    affinityRateRow.appendChild(affinityRateNumber);
    paramBox.appendChild(affinityRateRow);

    // --- affinity decay rate slider ---
    const affinityDecayRow = document.createElement('div');
    affinityDecayRow.style.display = 'flex';
    affinityDecayRow.style.alignItems = 'center';
    affinityDecayRow.style.gap = '10px';
    const affinityDecayLabel = document.createElement('span');
    affinityDecayLabel.textContent = 'Affinity Decay (/s):';
    affinityDecayLabel.style.width = '140px';
    affinityDecayRow.appendChild(affinityDecayLabel);
    const affinityDecayInput = document.createElement('input');
    affinityDecayInput.type = 'range';
    affinityDecayInput.min = 0;
    affinityDecayInput.max = 1;
    affinityDecayInput.step = 0.01;
    affinityDecayInput.value = sidebarParams.affinityDecayRate;
    affinityDecayInput.style.width = '120px';
    affinityDecayInput.disabled = paramDisabled;
    affinityDecayInput.id = 'affinityDecayInput';
    affinityDecayInput.name = 'affinityDecayInput';
    affinityDecayInput.addEventListener('input', e => {
        sidebarParams.affinityDecayRate = Number(e.target.value);
        affinityDecayNumber.value = e.target.value;
        window.affinityDecayRate = Number(e.target.value);
    });
    affinityDecayRow.appendChild(affinityDecayInput);
    const affinityDecayNumber = document.createElement('input');
    affinityDecayNumber.type = 'number';
    affinityDecayNumber.min = 0;
    affinityDecayNumber.max = 1;
    affinityDecayNumber.step = 0.01;
    affinityDecayNumber.value = sidebarParams.affinityDecayRate;
    affinityDecayNumber.disabled = paramDisabled;
    affinityDecayNumber.style.width = '64px';
    affinityDecayNumber.id = 'affinityDecayNumber';
    affinityDecayNumber.name = 'affinityDecayNumber';
    affinityDecayNumber.addEventListener('input', e => {
        sidebarParams.affinityDecayRate = Number(e.target.value);
        affinityDecayInput.value = e.target.value;
        window.affinityDecayRate = Number(e.target.value);
    });
    affinityDecayRow.appendChild(affinityDecayNumber);
    paramBox.appendChild(affinityDecayRow);

    // --- Dig cooldown controls ---
    const digRow = document.createElement('div');
    digRow.style.display = 'flex';
    digRow.style.alignItems = 'center';
    digRow.style.gap = '10px';
    const digLabel = document.createElement('span');
    digLabel.textContent = 'Recent Dig Cooldown (ms):';
    digLabel.style.width = '140px';
    digRow.appendChild(digLabel);
    const digInput = document.createElement('input');
    digInput.type = 'number';
    digInput.min = 0;
    digInput.max = 60000;
    digInput.value = sidebarParams.recentDigCooldownMs;
    digInput.style.width = '100px';
    digInput.disabled = paramDisabled;
    digInput.addEventListener('input', e => {
        sidebarParams.recentDigCooldownMs = Number(e.target.value);
        window.recentDigCooldownMs = Number(e.target.value);
    });
    digRow.appendChild(digInput);
    const digActionLabel = document.createElement('span');
    digActionLabel.textContent = ' Dig Action Cooldown (ms):';
    digActionLabel.style.width = '160px';
    digRow.appendChild(digActionLabel);
    const digActionInput = document.createElement('input');
    digActionInput.type = 'number';
    digActionInput.min = 200;
    digActionInput.max = 10000;
    digActionInput.value = sidebarParams.digActionCooldown;
    digActionInput.style.width = '100px';
    digActionInput.disabled = paramDisabled;
    digActionInput.addEventListener('input', e => {
        sidebarParams.digActionCooldown = Number(e.target.value);
        window.digActionCooldown = Number(e.target.value);
    });
    digRow.appendChild(digActionInput);
    paramBox.appendChild(digRow);

    // --- Reservation controls (prevent multiple chars from digging same block) ---
    const reservationRow = document.createElement('div');
    reservationRow.style.display = 'flex';
    reservationRow.style.alignItems = 'center';
    reservationRow.style.gap = '10px';
    const reservationLabel = document.createElement('span');
    reservationLabel.textContent = 'Reservation TTL (ms):';
    reservationLabel.style.width = '140px';
    reservationRow.appendChild(reservationLabel);
    // use an input element for numeric TTL
    const reservationNum = document.createElement('input');
    reservationNum.type = 'number';
    reservationNum.min = 100;
    reservationNum.max = 60000;
    reservationNum.value = sidebarParams.worldReservationTTL;
    reservationNum.style.width = '120px';
    reservationNum.disabled = paramDisabled;
    reservationNum.addEventListener('input', e => {
        sidebarParams.worldReservationTTL = Number(e.target.value);
        window.worldReservationTTL = Number(e.target.value);
    });
    reservationRow.appendChild(reservationNum);

    const reservationFallbackLabel = document.createElement('span');
    reservationFallbackLabel.textContent = 'Fallback Cooldown (ms):';
    reservationFallbackLabel.style.width = '160px';
    reservationRow.appendChild(reservationFallbackLabel);
    const fallbackNum = document.createElement('input');
    fallbackNum.type = 'number';
    fallbackNum.min = 0;
    fallbackNum.max = 10000;
    fallbackNum.value = sidebarParams.reservationFallbackCooldown;
    fallbackNum.style.width = '120px';
    fallbackNum.disabled = paramDisabled;
    fallbackNum.addEventListener('input', e => {
        sidebarParams.reservationFallbackCooldown = Number(e.target.value);
        window.reservationFallbackCooldown = Number(e.target.value);
    });
    reservationRow.appendChild(fallbackNum);
    paramBox.appendChild(reservationRow);

    // --- Backoff: fallback/backoff tuning ---
    const backoffRow = document.createElement('div');
    backoffRow.style.display = 'flex';
    backoffRow.style.flexDirection = 'column';
    backoffRow.style.gap = '8px';

    const fallbackRow = document.createElement('div');
    fallbackRow.style.display = 'flex';
    fallbackRow.style.alignItems = 'center';
    fallbackRow.style.gap = '10px';
    const fallbackLabel = document.createElement('span');
    fallbackLabel.textContent = 'Fallback Backoff (ms):';
    fallbackLabel.style.width = '140px';
    fallbackRow.appendChild(fallbackLabel);
    const fallbackInput = document.createElement('input');
    fallbackInput.type = 'number';
    fallbackInput.min = 0;
    fallbackInput.max = 10000;
    fallbackInput.value = sidebarParams.fallbackBackoffMs;
    fallbackInput.style.width = '100px';
    fallbackInput.disabled = paramDisabled;
    fallbackInput.addEventListener('input', e => {
        sidebarParams.fallbackBackoffMs = Number(e.target.value);
        window.fallbackBackoffMs = Number(e.target.value);
    });
    fallbackRow.appendChild(fallbackInput);
    backoffRow.appendChild(fallbackRow);

    const pinvRow = document.createElement('div');
    pinvRow.style.display = 'flex';
    pinvRow.style.alignItems = 'center';
    pinvRow.style.gap = '10px';
    const pinvLabel = document.createElement('span');
    pinvLabel.textContent = 'Path Invalidate Factor:';
    pinvLabel.style.width = '140px';
    pinvRow.appendChild(pinvLabel);
    const pinvInput = document.createElement('input');
    pinvInput.type = 'range';
    pinvInput.min = 0;
    pinvInput.max = 1;
    pinvInput.step = 0.05;
    pinvInput.value = sidebarParams.pathInvalidationBackoffFactor;
    pinvInput.style.width = '120px';
    pinvInput.disabled = paramDisabled;
    // numeric input for precise editing and two-way sync
    const pinvNumber = document.createElement('input');
    pinvNumber.type = 'number';
    pinvNumber.min = 0;
    pinvNumber.max = 1;
    pinvNumber.step = 0.01;
    pinvNumber.value = sidebarParams.pathInvalidationBackoffFactor;
    pinvNumber.style.width = '64px';
    pinvNumber.disabled = paramDisabled;
    pinvNumber.addEventListener('input', e => {
        let v = Number(e.target.value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(1, v));
        sidebarParams.pathInvalidationBackoffFactor = v;
        window.pathInvalidationBackoffFactor = v;
        pinvInput.value = v;
    });

    pinvInput.addEventListener('input', e => {
        const v = Number(e.target.value);
        sidebarParams.pathInvalidationBackoffFactor = v;
        window.pathInvalidationBackoffFactor = v;
        pinvNumber.value = v;
    });

    pinvRow.appendChild(pinvInput);
    pinvRow.appendChild(pinvNumber);

    const pinvMaxInput = document.createElement('input');
    pinvMaxInput.type = 'number';
    pinvMaxInput.min = 0;
    pinvMaxInput.max = 10;
    pinvMaxInput.step = 0.1;
    pinvMaxInput.value = sidebarParams.pathInvalidationBackoffMax;
    pinvMaxInput.style.width = '64px';
    pinvMaxInput.disabled = paramDisabled;
    pinvMaxInput.addEventListener('input', e => {
        sidebarParams.pathInvalidationBackoffMax = Number(e.target.value);
        window.pathInvalidationBackoffMax = Number(e.target.value);
    });
    pinvRow.appendChild(pinvMaxInput);
    backoffRow.appendChild(pinvRow);
    paramBox.appendChild(backoffRow);

    // --- Perception/Socialize Range Slider ---
    if (sidebarParams.perceptionRange === undefined) sidebarParams.perceptionRange = 2;
    const perceptionRow = document.createElement('div');
    perceptionRow.style.display = 'flex';
    perceptionRow.style.alignItems = 'center';
    perceptionRow.style.gap = '10px';
    const perceptionLabel = document.createElement('span');
    perceptionLabel.textContent = 'Perception Range:';
    perceptionLabel.style.width = '140px';
    perceptionRow.appendChild(perceptionLabel);
    const perceptionInput = document.createElement('input');
    perceptionInput.type = 'range';
    perceptionInput.min = 1;
    perceptionInput.max = 10;
    perceptionInput.value = sidebarParams.perceptionRange;
    perceptionInput.style.width = '120px';
    perceptionInput.disabled = paramDisabled;
    perceptionInput.id = 'perceptionInput';
    perceptionInput.name = 'perceptionInput';
    perceptionInput.addEventListener('input', e => {
        sidebarParams.perceptionRange = Number(e.target.value);
        perceptionNumber.value = e.target.value;
        window.perceptionRange = Number(e.target.value);
    });
    perceptionRow.appendChild(perceptionInput);
    const perceptionNumber = document.createElement('input');
    perceptionNumber.type = 'number';
    perceptionNumber.min = 1;
    perceptionNumber.max = 10;
    perceptionNumber.value = sidebarParams.perceptionRange;
    perceptionNumber.disabled = paramDisabled;
    perceptionNumber.style.width = '48px';
    perceptionNumber.id = 'perceptionNumber';
    perceptionNumber.name = 'perceptionNumber';
    perceptionNumber.addEventListener('input', e => {
        sidebarParams.perceptionRange = Number(e.target.value);
        perceptionInput.value = e.target.value;
        window.perceptionRange = Number(e.target.value);
    });
    perceptionRow.appendChild(perceptionNumber);
    paramBox.appendChild(perceptionRow);

    // --- 繁殖後の友好度リセット値スライダー ---
    if (sidebarParams.affinityResetAfterReproduce === undefined) sidebarParams.affinityResetAfterReproduce = 30;
    const affinityResetRow = document.createElement('div');
    affinityResetRow.style.display = 'flex';
    affinityResetRow.style.alignItems = 'center';
    affinityResetRow.style.gap = '10px';
    const affinityResetLabel = document.createElement('span');
    affinityResetLabel.textContent = 'Affinity After Reproduce:';
    affinityResetLabel.style.width = '140px';
    affinityResetRow.appendChild(affinityResetLabel);
    const affinityResetInput = document.createElement('input');
    affinityResetInput.type = 'range';
    affinityResetInput.min = 0;
    affinityResetInput.max = 50;
    affinityResetInput.step = 1;
    affinityResetInput.value = sidebarParams.affinityResetAfterReproduce;
    affinityResetInput.style.width = '120px';
    affinityResetInput.disabled = paramDisabled;
    affinityResetInput.id = 'affinityResetInput';
    affinityResetInput.name = 'affinityResetInput';
    affinityResetInput.addEventListener('input', e => {
        sidebarParams.affinityResetAfterReproduce = Number(e.target.value);
        affinityResetNumber.value = e.target.value;
        window.affinityResetAfterReproduce = Number(e.target.value);
    });
    affinityResetRow.appendChild(affinityResetInput);
    const affinityResetNumber = document.createElement('input');
    affinityResetNumber.type = 'number';
    affinityResetNumber.min = 0;
    affinityResetNumber.max = 50;
    affinityResetNumber.step = 1;
    affinityResetNumber.value = sidebarParams.affinityResetAfterReproduce;
    affinityResetNumber.disabled = paramDisabled;
    affinityResetNumber.style.width = '48px';
    affinityResetNumber.id = 'affinityResetNumber';
    affinityResetNumber.name = 'affinityResetNumber';
    affinityResetNumber.addEventListener('input', e => {
        sidebarParams.affinityResetAfterReproduce = Number(e.target.value);
        affinityResetInput.value = e.target.value;
        window.affinityResetAfterReproduce = Number(e.target.value);
    });
    affinityResetRow.appendChild(affinityResetNumber);
    paramBox.appendChild(affinityResetRow);

    // --- Pair reproduction cooldown slider ---
    const pairCooldownRow = document.createElement('div');
    pairCooldownRow.style.display = 'flex';
    pairCooldownRow.style.alignItems = 'center';
    pairCooldownRow.style.gap = '10px';
    const pairCooldownLabel = document.createElement('span');
    pairCooldownLabel.textContent = 'Pair Cooldown (s):';
    pairCooldownLabel.style.width = '140px';
    pairCooldownRow.appendChild(pairCooldownLabel);
    const pairCooldownInput = document.createElement('input');
    pairCooldownInput.type = 'range';
    pairCooldownInput.min = 0;
    pairCooldownInput.max = 300;
    pairCooldownInput.step = 1;
    pairCooldownInput.value = sidebarParams.pairReproductionCooldownSeconds;
    pairCooldownInput.style.width = '120px';
    pairCooldownInput.disabled = paramDisabled;
    pairCooldownInput.addEventListener('input', e => {
        sidebarParams.pairReproductionCooldownSeconds = Number(e.target.value);
        pairCooldownNumber.value = e.target.value;
        window.pairReproductionCooldownSeconds = Number(e.target.value);
    });
    pairCooldownRow.appendChild(pairCooldownInput);
    const pairCooldownNumber = document.createElement('input');
    pairCooldownNumber.type = 'number';
    pairCooldownNumber.min = 0;
    pairCooldownNumber.max = 300;
    pairCooldownNumber.step = 1;
    pairCooldownNumber.value = sidebarParams.pairReproductionCooldownSeconds;
    pairCooldownNumber.style.width = '56px';
    pairCooldownNumber.disabled = paramDisabled;
    pairCooldownNumber.addEventListener('input', e => {
        sidebarParams.pairReproductionCooldownSeconds = Number(e.target.value);
        pairCooldownInput.value = e.target.value;
        window.pairReproductionCooldownSeconds = Number(e.target.value);
    });
    pairCooldownRow.appendChild(pairCooldownNumber);
    paramBox.appendChild(pairCooldownRow);

    // --- Max affinity slider ---
    const maxAffinityRow = document.createElement('div');
    maxAffinityRow.style.display = 'flex';
    maxAffinityRow.style.alignItems = 'center';
    maxAffinityRow.style.gap = '10px';
    const maxAffinityLabel = document.createElement('span');
    maxAffinityLabel.textContent = 'Max Affinity:';
    maxAffinityLabel.style.width = '140px';
    maxAffinityRow.appendChild(maxAffinityLabel);
    const maxAffinityInput = document.createElement('input');
    maxAffinityInput.type = 'range';
    maxAffinityInput.min = 50;
    maxAffinityInput.max = 500;
    maxAffinityInput.step = 1;
    maxAffinityInput.value = sidebarParams.maxAffinity;
    maxAffinityInput.style.width = '120px';
    maxAffinityInput.disabled = paramDisabled;
    maxAffinityInput.addEventListener('input', e => {
        sidebarParams.maxAffinity = Number(e.target.value);
        maxAffinityNumber.value = e.target.value;
        window.maxAffinity = Number(e.target.value);
    });
    maxAffinityRow.appendChild(maxAffinityInput);
    const maxAffinityNumber = document.createElement('input');
    maxAffinityNumber.type = 'number';
    maxAffinityNumber.min = 50;
    maxAffinityNumber.max = 500;
    maxAffinityNumber.step = 1;
    maxAffinityNumber.value = sidebarParams.maxAffinity;
    maxAffinityNumber.style.width = '56px';
    maxAffinityNumber.disabled = paramDisabled;
    maxAffinityNumber.addEventListener('input', e => {
        sidebarParams.maxAffinity = Number(e.target.value);
        maxAffinityInput.value = e.target.value;
        window.maxAffinity = Number(e.target.value);
    });
    maxAffinityRow.appendChild(maxAffinityNumber);
    paramBox.appendChild(maxAffinityRow);

    // --- Parent reproduction cooldown slider ---
    const parentCooldownRow = document.createElement('div');
    parentCooldownRow.style.display = 'flex';
    parentCooldownRow.style.alignItems = 'center';
    parentCooldownRow.style.gap = '10px';
    const parentCooldownLabel = document.createElement('span');
    parentCooldownLabel.textContent = 'Parent Cooldown (s):';
    parentCooldownLabel.style.width = '140px';
    parentCooldownRow.appendChild(parentCooldownLabel);
    const parentCooldownInput = document.createElement('input');
    parentCooldownInput.type = 'range';
    parentCooldownInput.min = 0;
    parentCooldownInput.max = 120;
    parentCooldownInput.step = 1;
    parentCooldownInput.value = sidebarParams.reproductionCooldownSeconds;
    parentCooldownInput.style.width = '120px';
    parentCooldownInput.disabled = paramDisabled;
    parentCooldownInput.addEventListener('input', e => {
        sidebarParams.reproductionCooldownSeconds = Number(e.target.value);
        parentCooldownNumber.value = e.target.value;
        window.reproductionCooldownSeconds = Number(e.target.value);
    });
    parentCooldownRow.appendChild(parentCooldownInput);
    const parentCooldownNumber = document.createElement('input');
    parentCooldownNumber.type = 'number';
    parentCooldownNumber.min = 0;
    parentCooldownNumber.max = 120;
    parentCooldownNumber.step = 1;
    parentCooldownNumber.value = sidebarParams.reproductionCooldownSeconds;
    parentCooldownNumber.style.width = '56px';
    parentCooldownNumber.disabled = paramDisabled;
    parentCooldownNumber.addEventListener('input', e => {
        sidebarParams.reproductionCooldownSeconds = Number(e.target.value);
        parentCooldownInput.value = e.target.value;
        window.reproductionCooldownSeconds = Number(e.target.value);
    });
    parentCooldownRow.appendChild(parentCooldownNumber);
    paramBox.appendChild(parentCooldownRow);

    // --- Auto recover stall toggle + recovery cooldown ---
    const autoRecoverRow = document.createElement('div');
    autoRecoverRow.style.display = 'flex';
    autoRecoverRow.style.alignItems = 'center';
    autoRecoverRow.style.gap = '10px';
    const autoRecoverLabel = document.createElement('span');
    autoRecoverLabel.textContent = 'Auto Recover Stall:';
    autoRecoverLabel.style.width = '140px';
    autoRecoverRow.appendChild(autoRecoverLabel);
    const autoRecoverCheckbox = document.createElement('input');
    autoRecoverCheckbox.type = 'checkbox';
    autoRecoverCheckbox.checked = !!sidebarParams.autoRecoverStall;
    autoRecoverCheckbox.disabled = paramDisabled;
    autoRecoverCheckbox.addEventListener('change', e => {
        sidebarParams.autoRecoverStall = !!e.target.checked;
        window.autoRecoverStall = !!e.target.checked;
    });
    autoRecoverRow.appendChild(autoRecoverCheckbox);
    const recoverCooldownNumber = document.createElement('input');
    recoverCooldownNumber.type = 'number';
    recoverCooldownNumber.min = 0;
    recoverCooldownNumber.max = 5;
    recoverCooldownNumber.step = 0.1;
    recoverCooldownNumber.value = sidebarParams.recoverActionCooldown;
    recoverCooldownNumber.style.width = '64px';
    recoverCooldownNumber.disabled = paramDisabled;
    recoverCooldownNumber.addEventListener('input', e => {
        sidebarParams.recoverActionCooldown = Number(e.target.value);
        window.recoverActionCooldown = Number(e.target.value);
    });
    autoRecoverRow.appendChild(recoverCooldownNumber);
    paramBox.appendChild(autoRecoverRow);

    // --- Movement stability controls ---
    const movementStabilityRow = document.createElement('div');
    movementStabilityRow.style.display = 'flex';
    movementStabilityRow.style.alignItems = 'center';
    movementStabilityRow.style.gap = '10px';
    const movementStabilityLabel = document.createElement('span');
    movementStabilityLabel.textContent = 'Move Replan Stall (ms):';
    movementStabilityLabel.style.width = '140px';
    movementStabilityRow.appendChild(movementStabilityLabel);
    const movementStabilityInput = document.createElement('input');
    movementStabilityInput.type = 'number';
    movementStabilityInput.min = 500;
    movementStabilityInput.max = 10000;
    movementStabilityInput.step = 100;
    movementStabilityInput.value = sidebarParams.movingReplanStallMs;
    movementStabilityInput.style.width = '90px';
    movementStabilityInput.disabled = paramDisabled;
    movementStabilityInput.addEventListener('input', e => {
        sidebarParams.movingReplanStallMs = Number(e.target.value);
        window.movingReplanStallMs = Number(e.target.value);
    });
    movementStabilityRow.appendChild(movementStabilityInput);

    const occupancyLabel = document.createElement('span');
    occupancyLabel.textContent = ' Occupancy Lookahead:';
    occupancyLabel.style.width = '150px';
    movementStabilityRow.appendChild(occupancyLabel);
    const occupancyInput = document.createElement('input');
    occupancyInput.type = 'number';
    occupancyInput.min = 1;
    occupancyInput.max = 8;
    occupancyInput.step = 1;
    occupancyInput.value = sidebarParams.pathOccupancyLookahead;
    occupancyInput.style.width = '60px';
    occupancyInput.disabled = paramDisabled;
    occupancyInput.addEventListener('input', e => {
        sidebarParams.pathOccupancyLookahead = Number(e.target.value);
        window.pathOccupancyLookahead = Number(e.target.value);
    });
    movementStabilityRow.appendChild(occupancyInput);
    paramBox.appendChild(movementStabilityRow);

    const cooldownCeilRow = document.createElement('div');
    cooldownCeilRow.style.display = 'flex';
    cooldownCeilRow.style.alignItems = 'center';
    cooldownCeilRow.style.gap = '10px';
    const cooldownCeilLabel = document.createElement('span');
    cooldownCeilLabel.textContent = 'Max Action Cooldown (s):';
    cooldownCeilLabel.style.width = '140px';
    cooldownCeilRow.appendChild(cooldownCeilLabel);
    const cooldownCeilInput = document.createElement('input');
    cooldownCeilInput.type = 'number';
    cooldownCeilInput.min = 2;
    cooldownCeilInput.max = 30;
    cooldownCeilInput.step = 0.5;
    cooldownCeilInput.value = sidebarParams.maxActionCooldown;
    cooldownCeilInput.style.width = '90px';
    cooldownCeilInput.disabled = paramDisabled;
    cooldownCeilInput.addEventListener('input', e => {
        sidebarParams.maxActionCooldown = Number(e.target.value);
        window.maxActionCooldown = Number(e.target.value);
    });
    cooldownCeilRow.appendChild(cooldownCeilInput);
    paramBox.appendChild(cooldownCeilRow);

    // キャラ数
    const charNumRow = document.createElement('div');
    charNumRow.style.display = 'flex';
    charNumRow.style.alignItems = 'center';
    charNumRow.style.gap = '10px';
    const charNumLabel = document.createElement('span');
    charNumLabel.textContent = 'Number of Characters:';
    charNumLabel.style.width = '140px';
    charNumRow.appendChild(charNumLabel);
    const charNumInput = document.createElement('input');
    charNumInput.type = 'range';
    charNumInput.min = 5;
    charNumInput.max = 50;
    charNumInput.value = sidebarParams.charNum;
    charNumInput.style.flex = '1';
    charNumInput.style.margin = '0 8px';
    charNumInput.id = 'charNumInput';
    charNumInput.name = 'charNumInput';
    charNumRow.appendChild(charNumInput);
    const charNumVal = document.createElement('input');
    charNumVal.type = 'number';
    charNumVal.min = 5;
    charNumVal.max = 50;
    charNumVal.value = sidebarParams.charNum;
    charNumVal.style.width = '48px';
    charNumVal.id = 'charNumVal';
    charNumVal.name = 'charNumVal';
    charNumRow.appendChild(charNumVal);
    // 双方向同期＋sidebarParams更新
    charNumInput.oninput = () => {
        charNumVal.value = charNumInput.value;
        sidebarParams.charNum = parseInt(charNumInput.value);
    };
    charNumVal.oninput = () => {
        charNumInput.value = charNumVal.value;
        sidebarParams.charNum = parseInt(charNumVal.value);
    };
    paramBox.appendChild(charNumRow);
    charNumInput.disabled = paramDisabled;
    charNumVal.disabled = paramDisabled;

    // 社交閾値
    const socialRow = document.createElement('div');
    socialRow.style.display = 'flex';
    socialRow.style.alignItems = 'center';
    socialRow.style.gap = '10px';
    const socialLabel = document.createElement('span');
    socialLabel.textContent = 'Social Threshold:';
    socialLabel.style.width = '140px';
    socialRow.appendChild(socialLabel);
    const socialInput = document.createElement('input');
    socialInput.type = 'range';
    socialInput.min = 0;
    socialInput.max = 100;
    socialInput.value = sidebarParams.socialTh;
    socialInput.style.flex = '1';
    socialInput.style.margin = '0 8px';
    socialInput.id = 'socialInput';
    socialInput.name = 'socialInput';
    socialRow.appendChild(socialInput);
    const socialVal = document.createElement('input');
    socialVal.type = 'number';
    socialVal.min = 0;
    socialVal.max = 100;
    socialVal.value = sidebarParams.socialTh;
    socialVal.style.width = '48px';
    socialVal.id = 'socialVal';
    socialVal.name = 'socialVal';
    socialRow.appendChild(socialVal);
    // 双方向同期＋sidebarParams更新
    socialInput.oninput = () => {
        socialVal.value = socialInput.value;
        sidebarParams.socialTh = parseInt(socialInput.value);
        window.socialThreshold = parseInt(socialInput.value); // ← 即座にwindowに反映
    };
    socialVal.oninput = () => {
        socialInput.value = socialVal.value;
        sidebarParams.socialTh = parseInt(socialVal.value);
        window.socialThreshold = parseInt(socialVal.value); // ← 即座にwindowに反映
    };
    paramBox.appendChild(socialRow);
    socialInput.disabled = paramDisabled;
    socialVal.disabled = paramDisabled;

    // --- Hunger Emergency Threshold Slider ---
    if (sidebarParams.hungerEmergencyThreshold === undefined) sidebarParams.hungerEmergencyThreshold = 5;
    const hungerEmergencyRow = document.createElement('div');
    hungerEmergencyRow.style.display = 'flex';
    hungerEmergencyRow.style.alignItems = 'center';
    hungerEmergencyRow.style.gap = '10px';
    const hungerEmergencyLabel = document.createElement('span');
    hungerEmergencyLabel.textContent = 'Hunger Emergency Threshold:';
    hungerEmergencyLabel.style.flex = '1';
    const hungerEmergencyInput = document.createElement('input');
    hungerEmergencyInput.type = 'range';
    hungerEmergencyInput.min = 0;
    hungerEmergencyInput.max = 20;
    hungerEmergencyInput.step = 1;
    hungerEmergencyInput.value = sidebarParams.hungerEmergencyThreshold;
    hungerEmergencyInput.style.flex = '2';
    hungerEmergencyInput.id = 'hungerEmergencyInput';
    hungerEmergencyInput.name = 'hungerEmergencyInput';
    const hungerEmergencyVal = document.createElement('input');
    hungerEmergencyVal.type = 'number';
    hungerEmergencyVal.min = 0;
    hungerEmergencyVal.max = 20;
    hungerEmergencyVal.step = 1;
    hungerEmergencyVal.value = sidebarParams.hungerEmergencyThreshold;
    hungerEmergencyVal.style.width = '60px';
    hungerEmergencyVal.id = 'hungerEmergencyVal';
    hungerEmergencyVal.name = 'hungerEmergencyVal';
    hungerEmergencyRow.appendChild(hungerEmergencyLabel);
    hungerEmergencyRow.appendChild(hungerEmergencyInput);
    hungerEmergencyRow.appendChild(hungerEmergencyVal);
    // 双方向同期＋sidebarParams更新
    hungerEmergencyInput.oninput = () => {
        hungerEmergencyVal.value = hungerEmergencyInput.value;
        sidebarParams.hungerEmergencyThreshold = parseInt(hungerEmergencyInput.value);
        window.hungerEmergencyThreshold = parseInt(hungerEmergencyInput.value);
    };
    hungerEmergencyVal.oninput = () => {
        hungerEmergencyInput.value = hungerEmergencyVal.value;
        sidebarParams.hungerEmergencyThreshold = parseInt(hungerEmergencyVal.value);
        window.hungerEmergencyThreshold = parseInt(hungerEmergencyVal.value);
    };
    paramBox.appendChild(hungerEmergencyRow);
    hungerEmergencyInput.disabled = paramDisabled;
    hungerEmergencyVal.disabled = paramDisabled;

    // --- Energy Emergency Threshold Slider ---
    if (sidebarParams.energyEmergencyThreshold === undefined) sidebarParams.energyEmergencyThreshold = 8;
    const energyEmergencyRow = document.createElement('div');
    energyEmergencyRow.style.display = 'flex';
    energyEmergencyRow.style.alignItems = 'center';
    energyEmergencyRow.style.gap = '10px';
    const energyEmergencyLabel = document.createElement('span');
    energyEmergencyLabel.textContent = 'Energy Emergency Threshold:';
    energyEmergencyLabel.style.flex = '1';
    const energyEmergencyInput = document.createElement('input');
    energyEmergencyInput.type = 'range';
    energyEmergencyInput.min = 0;
    energyEmergencyInput.max = 20;
    energyEmergencyInput.step = 1;
    energyEmergencyInput.value = sidebarParams.energyEmergencyThreshold;
    energyEmergencyInput.style.flex = '2';
    energyEmergencyInput.id = 'energyEmergencyInput';
    energyEmergencyInput.name = 'energyEmergencyInput';
    const energyEmergencyVal = document.createElement('input');
    energyEmergencyVal.type = 'number';
    energyEmergencyVal.min = 0;
    energyEmergencyVal.max = 20;
    energyEmergencyVal.step = 1;
    energyEmergencyVal.value = sidebarParams.energyEmergencyThreshold;
    energyEmergencyVal.style.width = '60px';
    energyEmergencyVal.id = 'energyEmergencyVal';
    energyEmergencyVal.name = 'energyEmergencyVal';
    energyEmergencyRow.appendChild(energyEmergencyLabel);
    energyEmergencyRow.appendChild(energyEmergencyInput);
    energyEmergencyRow.appendChild(energyEmergencyVal);
    // 双方向同期＋sidebarParams更新
    energyEmergencyInput.oninput = () => {
        energyEmergencyVal.value = energyEmergencyInput.value;
        sidebarParams.energyEmergencyThreshold = parseInt(energyEmergencyInput.value);
        window.energyEmergencyThreshold = parseInt(energyEmergencyInput.value);
    };
    energyEmergencyVal.oninput = () => {
        energyEmergencyInput.value = energyEmergencyVal.value;
        sidebarParams.energyEmergencyThreshold = parseInt(energyEmergencyVal.value);
        window.energyEmergencyThreshold = parseInt(energyEmergencyVal.value);
    };
    paramBox.appendChild(energyEmergencyRow);
    energyEmergencyInput.disabled = paramDisabled;
    energyEmergencyVal.disabled = paramDisabled;

    // --- Home Return Hunger Level Slider ---
    if (sidebarParams.homeReturnHungerLevel === undefined) sidebarParams.homeReturnHungerLevel = 90;
    const homeReturnRow = document.createElement('div');
    homeReturnRow.style.display = 'flex';
    homeReturnRow.style.alignItems = 'center';
    homeReturnRow.style.gap = '10px';
    const homeReturnLabel = document.createElement('span');
    homeReturnLabel.textContent = 'Home Return Hunger Level:';
    homeReturnLabel.style.flex = '1';
    const homeReturnInput = document.createElement('input');
    homeReturnInput.type = 'range';
    homeReturnInput.min = 70;
    homeReturnInput.max = 100;
    homeReturnInput.step = 1;
    homeReturnInput.value = sidebarParams.homeReturnHungerLevel;
    homeReturnInput.style.flex = '2';
    homeReturnInput.id = 'homeReturnInput';
    homeReturnInput.name = 'homeReturnInput';
    const homeReturnVal = document.createElement('input');
    homeReturnVal.type = 'number';
    homeReturnVal.min = 70;
    homeReturnVal.max = 100;
    homeReturnVal.step = 1;
    homeReturnVal.value = sidebarParams.homeReturnHungerLevel;
    homeReturnVal.style.width = '60px';
    homeReturnVal.id = 'homeReturnVal';
    homeReturnVal.name = 'homeReturnVal';
    homeReturnRow.appendChild(homeReturnLabel);
    homeReturnRow.appendChild(homeReturnInput);
    homeReturnRow.appendChild(homeReturnVal);
    // 双方向同期＋sidebarParams更新
    homeReturnInput.oninput = () => {
        homeReturnVal.value = homeReturnInput.value;
        sidebarParams.homeReturnHungerLevel = parseInt(homeReturnInput.value);
        window.homeReturnHungerLevel = parseInt(homeReturnInput.value);
    };
    homeReturnVal.oninput = () => {
        homeReturnInput.value = homeReturnVal.value;
        sidebarParams.homeReturnHungerLevel = parseInt(homeReturnVal.value);
        window.homeReturnHungerLevel = parseInt(homeReturnVal.value);
    };
    paramBox.appendChild(homeReturnRow);
    homeReturnInput.disabled = paramDisabled;
    homeReturnVal.disabled = paramDisabled;

    // --- Home Building Priority Slider ---
    if (sidebarParams.homeBuildingPriority === undefined) sidebarParams.homeBuildingPriority = 80;
    const homeBuildRow = document.createElement('div');
    homeBuildRow.style.display = 'flex';
    homeBuildRow.style.alignItems = 'center';
    homeBuildRow.style.gap = '10px';
    const homeBuildLabel = document.createElement('span');
    homeBuildLabel.textContent = '🏠 Home Building Priority:';
    homeBuildLabel.style.flex = '1';
    const homeBuildInput = document.createElement('input');
    homeBuildInput.type = 'range';
    homeBuildInput.min = 0;
    homeBuildInput.max = 100;
    homeBuildInput.step = 1;
    homeBuildInput.value = sidebarParams.homeBuildingPriority;
    homeBuildInput.style.flex = '2';
    homeBuildInput.id = 'homeBuildInput';
    homeBuildInput.name = 'homeBuildInput';
    const homeBuildVal = document.createElement('input');
    homeBuildVal.type = 'number';
    homeBuildVal.min = 0;
    homeBuildVal.max = 100;
    homeBuildVal.step = 1;
    homeBuildVal.value = sidebarParams.homeBuildingPriority;
    homeBuildVal.style.width = '60px';
    homeBuildVal.id = 'homeBuildVal';
    homeBuildVal.name = 'homeBuildVal';
    homeBuildRow.appendChild(homeBuildLabel);
    homeBuildRow.appendChild(homeBuildInput);
    homeBuildRow.appendChild(homeBuildVal);
    // 双方向同期＋sidebarParams更新
    homeBuildInput.oninput = () => {
        homeBuildVal.value = homeBuildInput.value;
        sidebarParams.homeBuildingPriority = parseInt(homeBuildInput.value);
        window.homeBuildingPriority = parseInt(homeBuildInput.value);
    };
    homeBuildVal.oninput = () => {
        homeBuildInput.value = homeBuildVal.value;
        sidebarParams.homeBuildingPriority = parseInt(homeBuildVal.value);
        window.homeBuildingPriority = parseInt(homeBuildVal.value);
    };
    paramBox.appendChild(homeBuildRow);
    homeBuildInput.disabled = paramDisabled;
    homeBuildVal.disabled = paramDisabled;

    // --- Wood Collection Priority Slider ---
    if (sidebarParams.woodCollectionPriority === undefined) sidebarParams.woodCollectionPriority = 70;
    const woodCollectRow = document.createElement('div');
    woodCollectRow.style.display = 'flex';
    woodCollectRow.style.alignItems = 'center';
    woodCollectRow.style.gap = '10px';
    const woodCollectLabel = document.createElement('span');
    woodCollectLabel.textContent = '🪵 Wood Collection Priority:';
    woodCollectLabel.style.flex = '1';
    const woodCollectInput = document.createElement('input');
    woodCollectInput.type = 'range';
    woodCollectInput.min = 0;
    woodCollectInput.max = 100;
    woodCollectInput.step = 1;
    woodCollectInput.value = sidebarParams.woodCollectionPriority;
    woodCollectInput.style.flex = '2';
    woodCollectInput.id = 'woodCollectInput';
    woodCollectInput.name = 'woodCollectInput';
    const woodCollectVal = document.createElement('input');
    woodCollectVal.type = 'number';
    woodCollectVal.min = 0;
    woodCollectVal.max = 100;
    woodCollectVal.step = 1;
    woodCollectVal.value = sidebarParams.woodCollectionPriority;
    woodCollectVal.style.width = '60px';
    woodCollectVal.id = 'woodCollectVal';
    woodCollectVal.name = 'woodCollectVal';
    woodCollectRow.appendChild(woodCollectLabel);
    woodCollectRow.appendChild(woodCollectInput);
    woodCollectRow.appendChild(woodCollectVal);
    // 双方向同期＋sidebarParams更新
    woodCollectInput.oninput = () => {
        woodCollectVal.value = woodCollectInput.value;
        sidebarParams.woodCollectionPriority = parseInt(woodCollectInput.value);
        window.woodCollectionPriority = parseInt(woodCollectInput.value);
    };
    woodCollectVal.oninput = () => {
        woodCollectInput.value = woodCollectVal.value;
        sidebarParams.woodCollectionPriority = parseInt(woodCollectVal.value);
        window.woodCollectionPriority = parseInt(woodCollectVal.value);
    };
    paramBox.appendChild(woodCollectRow);
    woodCollectInput.disabled = paramDisabled;
    woodCollectVal.disabled = paramDisabled;

    // ランダム生成トグル
    const randomRow = document.createElement('div');
    randomRow.style.display = 'flex';
    randomRow.style.alignItems = 'center';
    randomRow.style.gap = '10px';
    const randomLabel = document.createElement('span');
    randomLabel.textContent = 'Randomize Thresholds:';
    randomLabel.style.width = '140px';
    randomRow.appendChild(randomLabel);
    const randomCheck = document.createElement('input');
    randomCheck.type = 'checkbox';
    randomCheck.checked = !!sidebarParams.useRandom;
    randomCheck.id = 'randomCheck';
    randomCheck.name = 'randomCheck';
    randomCheck.oninput = () => {
        sidebarParams.useRandom = randomCheck.checked;
    };
    randomRow.appendChild(randomCheck);
    paramBox.appendChild(randomRow);
    randomCheck.disabled = paramDisabled;

    // Start/Pause toggle button (pinned at top)
    if (window.simulationRunning === undefined) window.simulationRunning = false;
    const toggleBtn = document.createElement('button');
    function updateToggleBtn() {
        if (!window.characters || window.characters.length === 0) {
            toggleBtn.textContent = 'Start';
            toggleBtn.style.background = 'linear-gradient(90deg,#dff4ff 10%,#e9f7f1 100%)';
        } else if (window.simulationRunning) {
            toggleBtn.textContent = 'Pause';
            toggleBtn.style.background = 'linear-gradient(90deg,#ffe8a3 10%,#ffd5b3 100%)';
        } else {
            toggleBtn.textContent = 'Start';
            toggleBtn.style.background = 'linear-gradient(90deg,#bfffb2 10%,#dcffe0 100%)';
        }
    }
    toggleBtn.style.fontSize = '1.0em';
    toggleBtn.style.fontWeight = 'bold';
    toggleBtn.style.padding = '8px 18px';
    toggleBtn.style.borderRadius = '999px';
    toggleBtn.style.border = '1.5px solid #b7cbe6';
    toggleBtn.style.color = '#1f2f46';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.boxShadow = '0 2px 10px rgba(31,47,70,0.12)';
    updateToggleBtn();
    toggleBtn.onclick = () => {
        if (!window.simulationRunning) {
            // Start: regenerate character array from sidebar params (reset)
            const num = parseInt(sidebarParams.charNum);
            const socialTh = parseInt(sidebarParams.socialTh);
            const groupAffinityTh = parseInt(sidebarParams.groupAffinityTh);
            const useRandom = !!sidebarParams.useRandom;
            // Reset existing characters and IDs
            window.characters = [];
            if (window.nextCharacterId !== undefined) window.nextCharacterId = 0;
            // Reflect group threshold globally
            window.groupAffinityThreshold = groupAffinityTh;
            // Call removeAllCharacterObjects from world.js
            import('./world.js').then(worldMod => {
                if (typeof worldMod.removeAllCharacterObjects === 'function') {
                    worldMod.removeAllCharacterObjects();
                }
                if (Array.isArray(worldMod.characters)) worldMod.characters.length = 0;
                const spawnAll = async () => {
                    for (let i = 0; i < num; i++) {
                        const pos = worldMod.findValidSpawn();
                        if (pos) {
                            const char = await worldMod.spawnCharacter(pos);
                            if (char) {
                                char.socialThreshold = useRandom ? Math.floor(Math.random()*101) : socialTh;
                                char.needs = {
                                    hunger: 100,
                                    energy: 100,
                                    safety: 100,
                                    social: socialTh
                                };
                                char.mood = 'neutral';
                            }
                        }
                    }
                    window.characters = worldMod.characters;
                    selectedCharId = window.characters[0]?.id;
                    // --- Reflect parameters to window before group initialization ---
                    window.groupAffinityThreshold = sidebarParams.groupAffinityTh;
                    window.initialAffinityMin = sidebarParams.initialAffinityMin;
                    window.initialAffinityMax = sidebarParams.initialAffinityMax;
                    window.affinityIncreaseRate = sidebarParams.affinityIncreaseRate;
                    window.socialThreshold = socialTh;
                    window.perceptionRange = sidebarParams.perceptionRange;
                    window.hungerEmergencyThreshold = sidebarParams.hungerEmergencyThreshold;
                    window.energyEmergencyThreshold = sidebarParams.energyEmergencyThreshold;
                    window.homeReturnHungerLevel = sidebarParams.homeReturnHungerLevel;
                    // --- Initialize groups here ---
                    import('./character.js').then(charMod => {
                        if (typeof charMod.Character?.initializeAllRelationships === 'function') {
                            charMod.Character.initializeAllRelationships(window.characters);
                        }
                        if (typeof charMod.Character?.detectGroupsAndElectLeaders === 'function') {
                            charMod.Character.detectGroupsAndElectLeaders(window.characters);
                        }
                        window.simulationRunning = true;
                        window.renderCharacterList && window.renderCharacterList();
                        renderCharacterDetail();
                    });
                };
                spawnAll();
            });
        } else {
            window.simulationRunning = false;
            renderCharacterDetail();
        }
    };
    actionBar.appendChild(toggleBtn);
    paramBox.insertBefore(actionBar, paramBox.firstChild);

    rightSidebar.appendChild(paramBox);
}

let selectedCharId = undefined;
let leftSidebar = null;
let rightSidebar = null;
// グループ色マップをグローバル化
let groupColorMap = {};
// サマリー表で開いている詳細キャラID
let openedCharId = undefined;

document.addEventListener('DOMContentLoaded', () => {
    leftSidebar = document.getElementById('sidebar-left');
    rightSidebar = document.getElementById('sidebar-right');
    // サイドバーのUIをゲーム画面に溶け込むよう調整（幅を拡張）
    if (leftSidebar) {
        leftSidebar.style.width = '520px';
        leftSidebar.style.background = 'rgba(255,255,255,0.90)';
        leftSidebar.style.backdropFilter = 'blur(6px)';
        leftSidebar.style.borderRight = '2px solid #ccc';
        leftSidebar.style.boxShadow = '2px 0 16px #0002';
        leftSidebar.style.zIndex = 20;
        leftSidebar.style.position = 'absolute';
        leftSidebar.style.left = '0';
        leftSidebar.style.top = '0';
        leftSidebar.style.height = '100vh';
        leftSidebar.style.overflowY = 'auto';
        leftSidebar.style.pointerEvents = 'auto';
        // leftSidebarの子要素で詳細カードっぽいものがあれば消去
        const detailRows = leftSidebar.querySelectorAll('.character-detail-row');
        detailRows.forEach(el => el.remove());
    }

    // 初期状態: 必ず右サイドバーはキャラ詳細UI（Pause/ResumeトグルUI）
    renderCharacterDetail();
});
console.log('[sidebar.js] loaded');
// グローバルから呼び出せるように
window.renderCharacterList = renderCharacterList;
window.renderCharacterDetail = renderCharacterDetail;

function renderCharacterList() {
    // console.log('[sidebar.js] window.characters:', window.characters); // ←デバッグ用ログを一時停止
    if (!leftSidebar) return;
    // If the user is currently editing an input inside the right sidebar,
    // avoid re-rendering the character list which may toggle detail panels
    // and steal focus from the input.
    try {
        const active = document.activeElement;
        if (active && rightSidebar && rightSidebar.contains(active) &&
            (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
            return; // keep user's typing uninterrupted
        }
    } catch (e) {}
    // キャラが未生成なら何も表示しない
    if (!window.characters || !Array.isArray(window.characters) || window.characters.length === 0) {
        leftSidebar.innerHTML = '';
        return;
    }
    // 詳細カードが残っている場合は消去し、タイトルのみ表示
    leftSidebar.innerHTML = '';
    // タイトルを追加
    const title = document.createElement('h3');
    title.textContent = 'Character List';
    title.style.color = '#222';
    title.style.marginBottom = '8px';
    leftSidebar.appendChild(title);

    // --- 全体サマリー表（アコーディオン型詳細展開付き） ---
    if (window.characters && window.characters.length > 0) {
        const summaryTable = document.createElement('table');
        summaryTable.className = 'character-summary-table';
        // ヘッダー（日本語で分かりやすく＆見やすいスタイル）
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        const headerLabels = [
            'ID',
            'Grp',
            'State',
            'Mood',
            'Hun',
            'Eng',
            'Saf',
            'Soc',
            'Action',
            'Move'
        ];
        headerLabels.forEach(txt => {
            const th = document.createElement('th');
            th.textContent = txt;
            th.style.background = '#f5f5f5';
            th.style.fontWeight = 'bold';
            th.style.fontSize = '0.98em';
            th.style.color = '#333';
            th.style.padding = '4px 2px';
            th.style.borderBottom = '1.5px solid #ddd';
            th.style.textAlign = 'center';
            th.style.whiteSpace = 'nowrap';
            trh.appendChild(th);
        });
        thead.appendChild(trh);
        summaryTable.appendChild(thead);
        // ボディ
        const tbody = document.createElement('tbody');
        window.characters.forEach(char => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            // 詳細展開用のtr
            const detailTr = document.createElement('tr');
            detailTr.className = 'character-detail-row';
            // openedCharIdに一致するキャラなら開く（型を揃えて比較）
            if (String(openedCharId) === String(char.id)) {
                detailTr.style.display = '';
            } else {
                detailTr.style.display = 'none';
            }
            const detailTd = document.createElement('td');
            detailTd.colSpan = 10;
            detailTd.style.padding = '0';
            detailTd.style.background = 'transparent';
            detailTd.appendChild(createCharacterDetailCard(char));
            detailTr.appendChild(detailTd);

            tr.onclick = (e) => {
                // すでに開いている詳細パネルを再度クリックした場合は何もしない（点滅防止）
                if (String(openedCharId) === String(char.id)) {
                    e.stopPropagation();
                    return;
                }
                // すでに開いている詳細を全て閉じる
                tbody.querySelectorAll('.character-detail-row').forEach(row => row.style.display = 'none');
                // クリックしたキャラの詳細だけ開く
                openedCharId = String(char.id);
                detailTr.style.display = '';
                e.stopPropagation();
            };
            // ID
            const tdId = document.createElement('td');
            tdId.textContent = char.id;
            tr.appendChild(tdId);
            // グループ
            const tdGroup = document.createElement('td');
            if (char.groupId !== undefined && char.groupId !== null) {
                tdGroup.textContent = char.groupId;
                if (char.role === 'leader') {
                    const leaderMark = document.createElement('span');
                    leaderMark.textContent = ' 👑';
                    leaderMark.style.color = '#eab308';
                    leaderMark.style.fontWeight = 'bold';
                    leaderMark.title = 'Leader';
                    tdGroup.appendChild(leaderMark);
                }
            } else {
                tdGroup.textContent = '-';
            }
            tr.appendChild(tdGroup);
            // 状態アイコン（state/needsのみ、気分は含めない）
            const tdIcons = document.createElement('td');
            let stateIcons = [];
            // 👑や🧑‍🌾は表示しない（グループ列のみ）
            if (char.state === 'dead') stateIcons.push('💀');
            else if (char.state === 'resting') stateIcons.push('🛏️');
            else if (char.state === 'socializing') stateIcons.push('💬');
            else if (char.state === 'moving') stateIcons.push('🚶');
            // COLLECT_FOOD中は必ず🍎を表示
            if (char.currentAction === 'COLLECT_FOOD' && !stateIcons.includes('🍎')) stateIcons.push('🍎');
            else if (char.needs && char.needs.hunger < 30 && !stateIcons.includes('🍎')) stateIcons.push('🍎');
            if (char.needs && char.needs.energy < 30) stateIcons.push('💤');
            if (char.needs && char.needs.social < 30) stateIcons.push('👥');
            if (stateIcons.length === 0) stateIcons.push('🙂');
            tdIcons.textContent = stateIcons.join(' ');
            tdIcons.title = stateIcons.join(' ');
            tr.appendChild(tdIcons);
            // 気分（moodアイコンのみ）
            const tdMood = document.createElement('td');
            tdMood.className = 'mood-td';
            let moodIcon = '';
            switch (char.mood) {
                case 'happy': moodIcon = '😄'; break;
                case 'tired': moodIcon = '😪'; break;
                case 'lonely': moodIcon = '😢'; break;
                case 'scared': moodIcon = '😱'; break;
                case 'angry': moodIcon = '😠'; break;
                case 'sad': moodIcon = '😔'; break;
                default: moodIcon = '🙂';
            }
            tdMood.textContent = moodIcon;
            tdMood.title = char.mood || 'neutral';
            tr.appendChild(tdMood);
            // needs
            ['hunger','energy','safety','social'].forEach(k => {
                const td = document.createElement('td');
                if (char.needs && typeof char.needs[k] === 'number') {
                    td.textContent = Math.round(char.needs[k]);
                } else {
                    td.textContent = '-';
                }
                tr.appendChild(td);
            });
            // 行動
            const tdAction = document.createElement('td');
            tdAction.textContent = char.currentAction || '-';
            tdAction.className = 'action-text';
            tr.appendChild(tdAction);
            // 移動距離
            const tdMove = document.createElement('td');
            tdMove.textContent = (typeof char.moveDistance === 'number') ? char.moveDistance : '-';
            tr.appendChild(tdMove);
            tbody.appendChild(tr);
            tbody.appendChild(detailTr);
        });
        summaryTable.appendChild(tbody);
        leftSidebar.appendChild(summaryTable);

        // サイドバー余白クリックで詳細全閉じ
        leftSidebar.onclick = function(ev) {
            // サマリー表のtr, td, 詳細カード以外をクリックした場合のみ全閉じ
            let node = ev.target;
            while (node) {
                if (node.tagName === 'TR' || node.tagName === 'TD' || node.classList.contains('character-detail-card')) return;
                node = node.parentElement;
            }
            // 全ての詳細パネルを閉じる
            openedCharId = null;
            leftSidebar.querySelectorAll('.character-detail-row').forEach(row => row.style.display = 'none');
        };
    }
// サマリー表の詳細カード生成
function createCharacterDetailCard(char) {
    const card = document.createElement('div');
    card.className = 'character-detail-card';
    // 上部: ID・グループ・役割・気分バッジのみ（重複排除・シンプル化）
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.flexDirection = 'column';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'center';
    header.style.gap = '0px';
    header.style.marginBottom = '10px';
    // 上段: ID・グループ・役割を横並び
    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.style.justifyContent = 'center';
    topRow.style.gap = '12px';
    // ID
    const idBox = document.createElement('div');
    idBox.textContent = char.id;
    idBox.style.fontWeight = 'bold';
    idBox.style.fontSize = '1.15em';
    idBox.style.color = '#222';
    topRow.appendChild(idBox);
    // グループ
    const groupBox = document.createElement('div');
    groupBox.textContent = `Group ${char.groupId ?? 'Unassigned'}`;
    groupBox.style.color = '#888';
    groupBox.style.fontSize = '0.98em';
    topRow.appendChild(groupBox);
    // 役割
    const roleBox = document.createElement('div');
    roleBox.textContent = char.role === 'leader' ? 'Leader' : char.role === 'worker' ? 'Worker' : 'Member';
    roleBox.style.color = '#666';
    roleBox.style.fontSize = '0.98em';
    topRow.appendChild(roleBox);
    header.appendChild(topRow);
    // 下段: 気分バッジを中央に
    const moodSpan = document.createElement('span');
    let moodIcon = '', moodClass = 'mood-neutral', moodText = '';
    switch (char.mood) {
        case 'happy': moodIcon = '😄'; moodClass = 'mood-happy'; break;
        case 'tired': moodIcon = '😪'; moodClass = 'mood-tired'; break;
        case 'lonely': moodIcon = '😢'; moodClass = 'mood-lonely'; break;
        case 'scared': moodIcon = '😱'; moodClass = 'mood-scared'; break;
        case 'angry': moodIcon = '😠'; moodClass = 'mood-angry'; break;
        case 'sad': moodIcon = '😔'; moodClass = 'mood-sad'; break;
        default: moodIcon = '🙂'; moodClass = 'mood-neutral';
    }
    moodSpan.className = 'mood-badge ' + moodClass;
    moodSpan.textContent = moodIcon;
    moodSpan.style.marginTop = '6px';
    header.appendChild(moodSpan);
    card.appendChild(header);

    // --- プロフィール欄（id, group, role, personality） ---
    const profileBox = document.createElement('div');
    profileBox.className = 'profile-box';
    profileBox.style.marginBottom = '10px';
    // bravery/diligence
    let bravery = '-', diligence = '-';
    if (char.personality && typeof char.personality === 'object') {
        bravery = (char.personality.bravery !== undefined) ? char.personality.bravery.toFixed(2) : '-';
        diligence = (char.personality.diligence !== undefined) ? char.personality.diligence.toFixed(2) : '-';
    }
    // group/role
    const groupStr = char.groupId ? `Group: <b>${char.groupId}</b>` : 'Group: <b>Unassigned</b>';
    const roleStr = char.role === 'leader' ? 'Leader' : char.role === 'worker' ? 'Worker' : 'Member';
    // id
    const idStr = `ID: <b>${char.id}</b>`;
    // プロフィールHTML（年齢・性格・特技は表示しない）
    profileBox.innerHTML = `<b>Profile</b><br>` +
        `${idStr}<br>${groupStr} / Role: <b>${roleStr}</b><br>` +
        `bravery: <b>${bravery}</b> ／ diligence: <b>${diligence}</b>`;
    card.appendChild(profileBox);
    // 状態推移グラフ（直近10秒）
    const histArr = window.characterHistory?.[char.id] || [];
    if (histArr.length > 0) {
        const histDiv = document.createElement('div');
        histDiv.style.margin = '16px 0 18px 0';
        histDiv.style.display = 'flex';
        histDiv.style.flexDirection = 'column';
        histDiv.style.alignItems = 'center';
        // タイトル
        const title = document.createElement('div');
        title.textContent = 'State Transition Graph (Latest 10)';
        title.style.fontWeight = 'bold';
        title.style.fontSize = '1.18em';
        title.style.color = '#333';
        title.style.marginBottom = '6px';
        title.style.textAlign = 'center';
        histDiv.appendChild(title);
        // SVGグラフ描画
        const W = 360, H = 160, P = 38; // 幅・高さ・余白
        const N = Math.min(10, histArr.length);
        if (N < 2) {
            // データ点が1つ以下ならグラフを描画しない
            histDiv.appendChild(document.createTextNode('At least 2 history records are required to render the graph.'));
            card.appendChild(histDiv);
            return card;
        }
        const data = histArr.slice(-N); // 古→新
        // needs最大値
        const maxVal = 100, minVal = 0;
        // mood色マップ
        const moodColor = {
            happy: '#ffe082', tired: '#b0bec5', lonely: '#90caf9', active: '#a5d6a7', angry: '#ef9a9a', sad: '#ce93d8', neutral: '#bdbdbd'
        };
        // needs色
        const needColors = {
            hunger: 'rgba(229,115,115,0.7)', energy: 'rgba(255,213,79,0.7)', safety: 'rgba(100,181,246,0.7)', social: 'rgba(129,199,132,0.7)'
        };
        // needsキー
        const needKeys = ['hunger','energy','safety','social'];
        // X座標
        const xStep = (N > 1) ? (W-P*2) / (N-1) : 0;
        // mood点座標
        function moodToColor(mood) {
            return moodColor[mood] || moodColor['neutral'];
        }
        // needs折れ線
        function getLinePath(key) {
            let path = '';
            data.forEach((h, i) => {
                const v = (typeof h[key] === 'number') ? h[key] : null;
                if (v === null) return;
                const x = P + i * xStep;
                let y;
                if (maxVal === minVal) {
                    y = P + (H-P*2)/2;
                } else {
                    y = P + (H-P*2) * (1 - (v-minVal)/(maxVal-minVal));
                }
                if (isNaN(x) || isNaN(y)) return;
                path += (i === 0 ? 'M' : 'L') + x + ',' + y + ' ';
            });
            return path;
        }
        // mood点
        function getMoodPoints() {
            return data.map((h,i) => {
                const x = P + i * xStep;
                const y = P + 18 + (H-P*2) * 0.08; // needs線より少し上
                return {x, y, mood: h.mood};
            });
        }
        // SVG要素生成
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.style.display = 'block';
        svg.style.background = '#fff';
        svg.style.border = '2px solid #e0e0e0';
        svg.style.borderRadius = '14px';
        svg.style.boxShadow = '0 2px 8px #0001';
        svg.style.margin = '0 auto';
        // needs折れ線
        needKeys.forEach(key => {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', getLinePath(key));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', needColors[key]);
            path.setAttribute('stroke-width', 2.2);
            path.setAttribute('opacity', 0.95);
            svg.appendChild(path);
        });
        // mood点
        getMoodPoints().forEach((pt, i) => {
            const circ = document.createElementNS(svgNS, 'circle');
            circ.setAttribute('cx', pt.x);
            circ.setAttribute('cy', pt.y-12);
            circ.setAttribute('r', 8);
            circ.setAttribute('fill', moodToColor(pt.mood));
            circ.setAttribute('stroke', '#888');
            circ.setAttribute('stroke-width', 1.1);
            circ.setAttribute('opacity', 0.92);
            svg.appendChild(circ);
        });
        histDiv.appendChild(svg);
        // X軸ラベル（時刻）をSVG外に横並びで中央寄せ
        const timeLabels = document.createElement('div');
        timeLabels.style.display = 'flex';
        timeLabels.style.justifyContent = 'center';
        timeLabels.style.gap = '0px';
        timeLabels.style.fontSize = '1em';
        timeLabels.style.color = '#888';
        timeLabels.style.margin = '4px 0 0 0';
        timeLabels.style.width = W + 'px';
        timeLabels.style.maxWidth = W + 'px';
        timeLabels.style.textAlign = 'center';
        data.forEach((h,i) => {
            const t = new Date(h.time).toLocaleTimeString().slice(3,8);
            const span = document.createElement('span');
            span.textContent = t;
            span.style.flex = '1 1 0';
            span.style.textAlign = 'center';
            timeLabels.appendChild(span);
        });
        histDiv.appendChild(timeLabels);
        // 凡例
        const legend = document.createElement('div');
        legend.style.display = 'flex';
        legend.style.justifyContent = 'center';
        legend.style.gap = '18px';
        legend.style.fontSize = '1em';
        legend.style.margin = '6px 0 0 0';
        legend.style.textAlign = 'center';
        needKeys.forEach(k => {
            const span = document.createElement('span');
            span.innerHTML = `<span style=\"display:inline-block;width:18px;height:4px;background:${needColors[k]};margin-right:4px;vertical-align:middle;border-radius:2px;\"></span>${k}`;
            legend.appendChild(span);
        });
        // mood凡例
        const moodLegend = document.createElement('span');
        moodLegend.innerHTML = '<span style="display:inline-block;width:15px;height:15px;border-radius:50%;background:#ffe082;border:1px solid #bbb;margin-right:4px;vertical-align:middle;"></span>mood';
        legend.appendChild(moodLegend);
        histDiv.appendChild(legend);
        card.appendChild(histDiv);
    }
    // --- カウント系情報 ---
    const infoBox = document.createElement('div');
    infoBox.style.marginBottom = '10px';
    // 所持アイテム
    if (char.items && Array.isArray(char.items) && char.items.length > 0) {
        const itemDiv = document.createElement('div');
        itemDiv.innerHTML = `<b>Items:</b> ${char.items.join(', ')}`;
        infoBox.appendChild(itemDiv);
    }
    // 所有土地数
    let landCount = '-';
    if (typeof char.landCount === 'number') landCount = char.landCount;
    else if (char.ownedLand && typeof char.ownedLand.size === 'number') landCount = char.ownedLand.size;
    const landDiv = document.createElement('div');
    landDiv.innerHTML = `<b>Owned Land:</b> ${landCount} plots`;
    infoBox.appendChild(landDiv);
    // 子供数
    let childCount = '-';
    if (typeof char.childCount === 'number') childCount = char.childCount;
    else if (Array.isArray(char.children)) childCount = char.children.length;
    const childDiv = document.createElement('div');
    childDiv.innerHTML = `<b>Children:</b> ${childCount}`;
    infoBox.appendChild(childDiv);
    // 穴を掘った回数
    let digCount = '-';
    if (typeof char.digCount === 'number') digCount = char.digCount;
    const digDiv = document.createElement('div');
    digDiv.innerHTML = `<b>Dig Count:</b> ${digCount}`;
    infoBox.appendChild(digDiv);
    // 建物を建てた回数
    let buildCount = '-';
    if (typeof char.buildCount === 'number') buildCount = char.buildCount;
    const buildDiv = document.createElement('div');
    buildDiv.innerHTML = `<b>Build Count:</b> ${buildCount}`;
    infoBox.appendChild(buildDiv);
    // 食事の回数
    let eatCount = '-';
    if (typeof char.eatCount === 'number') eatCount = char.eatCount;
    const eatDiv = document.createElement('div');
    eatDiv.innerHTML = `<b>Meals:</b> ${eatCount}`;
    infoBox.appendChild(eatDiv);
    // 現在のstateのみは残し、移動距離・現在の行動は詳細カードから削除
    if (char.state) {
        const stateDiv = document.createElement('div');
        stateDiv.innerHTML = `<b>Current State:</b> <span style="font-family:monospace;">${char.state}</span>`;
        infoBox.appendChild(stateDiv);
    }
    card.appendChild(infoBox);
    // 関係性リスト
    if (char.relationships && Array.isArray(char.relationships) && window.characters) {
        const relBox = document.createElement('div');
        relBox.innerHTML = '<b>Relationship List</b>';
        relBox.style.marginBottom = '10px';
        char.relationships.forEach((val, idx) => {
            const relChar = window.characters[idx];
            if (!relChar || relChar.id === char.id) return;
            const relRow = document.createElement('div');
            relRow.className = 'relation-row';
            const relIcon = document.createElement('span');
            relIcon.textContent = relChar.role === 'leader' ? '👑' : relChar.role === 'worker' ? '🧑‍🌾' : '🙂';
            relIcon.style.fontSize = '1.1em';
            relRow.appendChild(relIcon);
            const relName = document.createElement('span');
            relName.className = 'relation-label';
            relName.textContent = relChar.id;
            relRow.appendChild(relName);
            const relBarBg = document.createElement('div');
            relBarBg.className = 'relation-bar-bg';
            const relBar = document.createElement('div');
            relBar.className = 'relation-bar';
            relBar.style.width = Math.max(0, Math.min(100, val)) + '%';
            relBarBg.appendChild(relBar);
            relRow.appendChild(relBarBg);
            const relVal = document.createElement('span');
            relVal.className = 'relation-val';
            relVal.textContent = val;
            relRow.appendChild(relVal);
            relBox.appendChild(relRow);
        });
        card.appendChild(relBox);
    }
    return card;
}

    // 初期選択キャラが未設定なら自動で最初のキャラを選択
    if (selectedCharId === undefined && window.characters.length > 0) {
        selectedCharId = String(window.characters[0].id);
    }

    // サイドバー初回描画時に右も必ず表示
    if (typeof renderCharacterDetail === 'function') {
        renderCharacterDetail();
    }
}
