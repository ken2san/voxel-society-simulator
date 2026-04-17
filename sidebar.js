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

// --- Idle district distribution cache ---
// Stores per-district estimated char counts based on random terrain sampling.
// Replaced on every slider change or district mode change (idle mode only).
let _idleDistrictCounts = null;
let _idleDistrictResampleKey = null; // "charNum:districtMode" — skip if unchanged

async function resampleIdleDistrictCounts() {
    if (window.simulationRunning || window.__simHasUserStarted) return;
    const charNum = Math.max(1, Number(window.sidebarParams?.charNum || 10));
    const mode = Math.max(1, Number(window.sidebarParams?.districtMode || 1));
    const key = `${charNum}:${mode}:${Math.random()}`; // always unique so slider re-rolls
    _idleDistrictResampleKey = key;
    try {
        const worldMod = await import('./world.js');
        const counts = new Array(mode).fill(0);
        for (let i = 0; i < charNum; i++) {
            const pos = worldMod.findValidSpawn();
            if (pos) {
                const idx = worldMod.getDistrictIndexForPosition(pos, mode);
                const safeIdx = Math.max(0, Math.min(mode - 1, Number(idx) || 0));
                counts[safeIdx]++;
            }
        }
        if (_idleDistrictResampleKey === key) {
            _idleDistrictCounts = counts;
            window.renderCharacterList && window.renderCharacterList();
        }
    } catch (_) {
        _idleDistrictCounts = null;
    }
}

function getMoodDisplay(mood) {
    switch (mood) {
        case 'happy': return { icon: '😄', className: 'mood-happy', text: 'happy' };
        case 'tired': return { icon: '😪', className: 'mood-tired', text: 'tired' };
        case 'lonely': return { icon: '😢', className: 'mood-lonely', text: 'lonely' };
        case 'active': return { icon: '😌', className: 'mood-neutral', text: 'active' };
        case 'scared': return { icon: '😱', className: 'mood-scared', text: 'scared' };
        case 'angry': return { icon: '😠', className: 'mood-angry', text: 'angry' };
        case 'sad': return { icon: '😔', className: 'mood-sad', text: 'sad' };
        case 'social': return { icon: '😊', className: 'mood-happy', text: 'social' };
        case 'hungry': return { icon: '🤤', className: 'mood-neutral', text: 'hungry' };
        case 'dead': return { icon: '∅', className: 'mood-neutral', text: 'none' };
        case 'confused': return { icon: '😵', className: 'mood-neutral', text: 'confused' };
        case 'excited': return { icon: '✨', className: 'mood-neutral', text: 'excited' };
        default: return { icon: '🙂', className: 'mood-neutral', text: 'neutral' };
    }
}

function getStatusDisplay(char) {
    let icon = '⏸';
    let stateLabel = char.state || 'idle';

    if (char.state === 'dead') {
        icon = '💀'; stateLabel = 'dead';
    } else if (char.state === 'resting') {
        icon = '🛏️'; stateLabel = 'resting';
    } else if (char.state === 'socializing') {
        icon = '💬'; stateLabel = 'socializing';
    } else if (char.state === 'moving') {
        icon = '🚶'; stateLabel = 'moving';
    } else if (char.state === 'working') {
        icon = '🛠️'; stateLabel = 'working';
    } else if (char.state === 'meeting') {
        icon = '🤝'; stateLabel = 'meeting';
    } else if (char.state === 'confused') {
        icon = '❓'; stateLabel = 'confused';
    }

    // Icon-first Status: state icon + optional action icon (no action text in cell).
    const rawAction = char.currentAction && char.currentAction !== '-' ? String(char.currentAction) : null;
    const actionNorm = rawAction ? rawAction.toUpperCase() : null;
    const iconOnlyActions = new Set(['WANDER', 'WONDER', 'SOCIALIZE', 'REST', 'MOVE']);
    const redundantActionByState = {
        // When already in moving state, the walk icon is sufficient.
        moving: new Set(['*']),
        socializing: new Set(['SOCIALIZE']),
        resting: new Set(['REST']),
        meeting: new Set(['MEETING'])
    };
    const stateSet = redundantActionByState[char.state] || null;
    const isRedundantAction = !!(
        actionNorm && (
            iconOnlyActions.has(actionNorm) ||
            (stateSet && (stateSet.has('*') || stateSet.has(actionNorm)))
        )
    );
    const action = isRedundantAction ? null : rawAction;
    const actionIconByType = {
        COLLECT_FOOD: '🍎',
        BUILD_HOME: '🏠',
        CRAFT_TOOL: '🔧',
        DESTROY_BLOCK: '⛏️',
        CHOP_WOOD: '🪓',
        SEEK_SHELTER_TO_REST: '🏚️',
        MEETING: '🤝'
    };
    const actionIcon = action ? (actionIconByType[actionNorm] || null) : null;
    const text = actionIcon ? `${icon} ${actionIcon}` : icon;
    const title = action ? `${stateLabel} / ${action}` : stateLabel;

    return { text, title };
}

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
            const mood = getMoodDisplay(char.mood);
            const moodSpan = tdMood.querySelector('.mood-badge');
            if (moodSpan) {
                moodSpan.className = 'mood-badge ' + mood.className;
                moodSpan.textContent = `${mood.icon} ${mood.text}`;
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
// Keep any initial population created by main.js visible in the sidebar.
if (window.simulationRunning === undefined) window.simulationRunning = false;
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
        const existingCharCount = Array.isArray(window.characters) && window.characters.length > 0
            ? window.characters.length
            : 10;
        window.sidebarParams = {
            charNum: existingCharCount,
            socialTh: 30,
            groupAffinityTh: 50,
            useRandom: false,
            populationMetricsExpanded: false
        };
    } else if ((window.sidebarParams.charNum === undefined || window.sidebarParams.charNum <= 0) && Array.isArray(window.characters) && window.characters.length > 0) {
        window.sidebarParams.charNum = window.characters.length;
    }
    const sidebarParams = window.sidebarParams;
    // Disable parameter fields during simulation (defined only once)
    const paramDisabled = !!window.simulationRunning && window.characters && window.characters.length > 0;

    // --- sidebarParams defaults and window.* mirroring ---
    // To add a new parameter: add ONE entry here. Init and global mirror are both automatic.
    const PARAM_DEFAULTS = {
        hungerEmergencyThreshold:           5,
        energyEmergencyThreshold:           32,
        wanderReserveEnergy:               10,
        hungerDecayRate:                    0.7,
        foodSeekHungerThreshold:           35,
        foodTargetRetrySeconds:            25,
        activeEnergyDrainRate:              2.0,
        unsafeNightSafetyDecayRate:         5.0,
        daytimeSafetyRecoveryRate:          16.0,
        restEnergyRecoveryRate:             18.0,
        characterLifespan:                  240,
        homeReturnHungerLevel:              90,
        homeBuildingPriority:               80,
        explorationBaseRate:                0.05,
        explorationMinRate:                 0.02,
        explorationMaxRate:                 0.12,
        explorationAdaptBoost:              0.25,
        explorationForagePenalty:           0.75,
        explorationRestPenalty:             0.90,
        socialAdaptationBoost:              0.35,
        socialForagePenalty:                0.25,
        socialRestPenalty:                  0.20,
        lowPrioritySocialOffset:            8,
        supportSeekingDrive:                0.12,
        trustedTieBonus:                    10,
        socialAnchorBias:                   0.18,
        initialAffinityMin:                 10,
        initialAffinityMax:                 35,
        kinshipAffinityBonus:               70,
        affinityIncreaseRate:               8,
        affinityDecayRate:                  0.01,
        socialNeedRecovery:                 1.0,
        socialNeedDecayRate:                1.5,
        supportComfortRecoveryRate:         3.0,
        supportGroupComfortScale:           0.5,
        supportNightSafetyAllyBonus:        1.5,
        supportNightSafetyBondedBonus:      3.0,
        bondPersistence:                    1.25,
        acquaintanceAffinityThreshold:      30,
        allyAffinityThreshold:              38,
        bondedAffinityThreshold:            42,
        nearbySupportRadius:                4,
        supportGroupBonus:                  0.26,
        supportAllyPresenceBonus:           0.22,
        supportBondedWeight:                0.24,
        supportAllyWeight:                  0.12,
        supportNearbyWeight:                0.10,
        supportTopAffinityWeight:           0.22,
        socialPressureFoodWeight:           0.28,
        socialPressureHousingWeight:        0.30,
        socialPressureTimeWeight:           0.22,
        socialPressureSupportWeight:        0.10,
        socialPressureStabilityWeight:      0.10,
        opportunityPressureWeight:          0.36,
        opportunitySupportWeight:           0.22,
        opportunityStabilityWeight:         0.16,
        opportunityConflictWeight:          0.10,
        opportunityPopulationWeight:        0.10,
        opportunityFoodWeight:              0.06,
        perceptionRange:                    4,
        pairReproductionCooldownSeconds:    36,
        maxAffinity:                        100,
        reproductionCooldownSeconds:        10,
        fruitRegenIntervalSeconds:          60,
        seasonCycleSeconds:                 120,
        seasonAmplitude:                    0.6,
        initialAgeMaxRatio:                 0.65,
        traitAffinityCapReduction:          0.6,
        affinityFloor:                       5,
        minReproductionAgeRatio:             0.18,
        isolationPenalty:                    0.4,
        autoRecoverStall:                   true,
        recoverActionCooldown:              0.5,
        maxActionCooldown:                  8,
        movingReplanStallMs:                2500,
        pathOccupancyLookahead:             2,
        recentDigCooldownMs:                10000,
        digActionCooldown:                  2200,
        worldReservationTTL:                5000,
        reproduceAffinityThreshold:         35,
        reproductionReadinessThreshold:     0.45,
        reproductionAnxietyCohesionBonus:   0.08,
        reproductionPressurePenalty:        0.18,
        affinityResetAfterReproduce:        68,
        mutationRate:                       0.05,
        starvationDeathDelaySeconds:        10,
        districtMode:                       1,
        activeDistrictIndex:                0,
    };
    for (const [key, def] of Object.entries(PARAM_DEFAULTS)) {
        if (sidebarParams[key] === undefined) sidebarParams[key] = def;
        window[key] = sidebarParams[key];
    }
    // Rename mappings: sidebarParams uses shorter keys, window.* uses full names
    window.groupAffinityThreshold = sidebarParams.groupAffinityTh;
    window.socialThreshold = sidebarParams.socialTh;
    // --- 右サイドバー：AIパラメータ調整UI ---
    rightSidebar.innerHTML = '';
    const paramBox = document.createElement('div');
    // --- Tab panel containers (declared early so rows can be routed before the tab bar is built) ---
    const PARAM_TAB_DEFS = [
        { label: 'Setup',    icon: '⚙️' },
        { label: 'Social',   icon: '👥' },
        { label: 'Behavior', icon: '🎯' },
        { label: 'Advanced', icon: '🔧' },
    ];
    if (sidebarParams.activeParamTab === undefined) sidebarParams.activeParamTab = 0;
    if (sidebarParams.paramSearchQuery === undefined) sidebarParams.paramSearchQuery = '';
    let activeParamTab = Math.max(0, Math.min(PARAM_TAB_DEFS.length - 1, Number(sidebarParams.activeParamTab) || 0));
    const tabPanels = PARAM_TAB_DEFS.map(() => {
        const p = document.createElement('div');
        p.style.display = 'none';
        p.style.flexDirection = 'column';
        p.style.gap = '10px';
        return p;
    });
    tabPanels[activeParamTab].style.display = 'flex';
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
        if (paramDisabled) return;
        window.aiMode = (window.aiMode === 'rule') ? 'utility' : 'rule';
        updateAiToggleBtn();
    };
    aiToggleBtn.style.fontWeight = 'bold';
    aiToggleBtn.style.padding = '4px 18px';
    aiToggleBtn.style.borderRadius = '8px';
    aiToggleBtn.style.border = '1.5px solid #b0c8e0';
    aiToggleBtn.style.color = '#333';
    aiToggleBtn.style.cursor = paramDisabled ? 'not-allowed' : 'pointer';
    aiToggleBtn.style.opacity = paramDisabled ? '0.55' : '1';
    aiToggleBtn.disabled = paramDisabled;
    aiToggleRow.appendChild(aiToggleBtn);
    aiToggleRow.dataset.label = 'AI Mode';
    tabPanels[0].appendChild(aiToggleRow);
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


    // --- Tab bar ---
    const tabBar = document.createElement('div');
    tabBar.style.display = 'flex';
    tabBar.style.gap = '4px';
    const tabBtns = PARAM_TAB_DEFS.map((def, i) => {
        const btn = document.createElement('button');
        btn.style.flex = '1';
        btn.style.padding = '5px 2px';
        btn.style.fontSize = '0.70em';
        btn.style.fontWeight = '600';
        btn.style.borderRadius = '8px';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.style.lineHeight = '1.4';
        btn.style.background = i === activeParamTab ? '#3b82f6' : '#e8eef6';
        btn.style.color = i === activeParamTab ? '#fff' : '#4a5568';
        btn.onclick = () => {
            activeParamTab = i;
            sidebarParams.activeParamTab = i;
            tabPanels.forEach((p, j) => { p.style.display = j === i ? 'flex' : 'none'; });
            tabBtns.forEach((b, j) => {
                b.style.background = j === i ? '#3b82f6' : '#e8eef6';
                b.style.color = j === i ? '#fff' : '#4a5568';
            });
            applyParamSearch(searchInput.value);
        };
        tabBar.appendChild(btn);
        return btn;
    });
    function updateTabBtnLabels(counts) {
        PARAM_TAB_DEFS.forEach((def, i) => {
            const c = counts ? counts[i] : -1;
            tabBtns[i].textContent = c >= 0
                ? `${def.icon} ${def.label} (${c})`
                : `${def.icon} ${def.label}`;
        });
    }
    updateTabBtnLabels(null);

    // --- Search bar ---
    const searchWrap = document.createElement('div');
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 Filter parameters…';
    searchInput.style.width = '100%';
    searchInput.style.boxSizing = 'border-box';
    searchInput.style.padding = '5px 10px';
    searchInput.style.borderRadius = '8px';
    searchInput.style.border = '1.5px solid #d0dff0';
    searchInput.style.fontSize = '0.84em';
    searchInput.style.background = '#f5f8ff';
    searchInput.style.outline = 'none';
    searchInput.value = sidebarParams.paramSearchQuery || '';
    searchWrap.appendChild(searchInput);

    function applyParamSearch(q) {
        q = (q || '').trim().toLowerCase();
        const counts = PARAM_TAB_DEFS.map(() => 0);
        tabPanels.forEach((panel, ti) => {
            panel.querySelectorAll('[data-label]').forEach(row => {
                const label = (row.dataset.label || '').toLowerCase();
                const match = !q || label.includes(q);
                row.style.display = match ? 'flex' : 'none';
                if (match) counts[ti]++;
            });
        });
        if (q) {
            updateTabBtnLabels(counts);
            if (counts[activeParamTab] === 0) {
                const firstMatch = counts.findIndex(c => c > 0);
                if (firstMatch >= 0) tabBtns[firstMatch].click();
            }
        } else {
            updateTabBtnLabels(null);
        }
    }
    searchInput.addEventListener('input', () => {
        sidebarParams.paramSearchQuery = searchInput.value;
        applyParamSearch(searchInput.value);
    });

    paramBox.appendChild(tabBar);
    paramBox.appendChild(searchWrap);
    tabPanels.forEach(p => paramBox.appendChild(p));
    applyParamSearch(searchInput.value);

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
    groupThRow.dataset.label = 'Group Affinity Threshold';
    tabPanels[1].appendChild(groupThRow);
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
    affinityInitRow.dataset.label = 'Initial Affinity';
    tabPanels[1].appendChild(affinityInitRow);

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
    affinityRateRow.dataset.label = 'Affinity Increase Rate';
    tabPanels[1].appendChild(affinityRateRow);

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
    affinityDecayRow.dataset.label = 'Affinity Decay';
    tabPanels[1].appendChild(affinityDecayRow);

    // --- social need recovery multiplier ---
    const socialRecoveryRow = document.createElement('div');
    socialRecoveryRow.style.display = 'flex';
    socialRecoveryRow.style.alignItems = 'center';
    socialRecoveryRow.style.gap = '10px';
    const socialRecoveryLabel = document.createElement('span');
    socialRecoveryLabel.textContent = 'Social Need Recovery:';
    socialRecoveryLabel.style.width = '140px';
    socialRecoveryRow.appendChild(socialRecoveryLabel);
    const socialRecoveryInput = document.createElement('input');
    socialRecoveryInput.type = 'range';
    socialRecoveryInput.min = 0.5;
    socialRecoveryInput.max = 2.0;
    socialRecoveryInput.step = 0.05;
    socialRecoveryInput.value = sidebarParams.socialNeedRecovery;
    socialRecoveryInput.style.width = '120px';
    socialRecoveryInput.disabled = paramDisabled;
    socialRecoveryInput.addEventListener('input', e => {
        const v = Number(e.target.value);
        sidebarParams.socialNeedRecovery = v;
        socialRecoveryNumber.value = v;
        window.socialNeedRecovery = v;
    });
    socialRecoveryRow.appendChild(socialRecoveryInput);
    const socialRecoveryNumber = document.createElement('input');
    socialRecoveryNumber.type = 'number';
    socialRecoveryNumber.min = 0.5;
    socialRecoveryNumber.max = 2.0;
    socialRecoveryNumber.step = 0.05;
    socialRecoveryNumber.value = sidebarParams.socialNeedRecovery;
    socialRecoveryNumber.disabled = paramDisabled;
    socialRecoveryNumber.style.width = '64px';
    socialRecoveryNumber.addEventListener('input', e => {
        const v = Number(e.target.value);
        sidebarParams.socialNeedRecovery = v;
        socialRecoveryInput.value = v;
        window.socialNeedRecovery = v;
    });
    socialRecoveryRow.appendChild(socialRecoveryNumber);
    socialRecoveryRow.dataset.label = 'Social Need Recovery';
    tabPanels[1].appendChild(socialRecoveryRow);

    // --- bond persistence multiplier ---
    const bondPersistenceRow = document.createElement('div');
    bondPersistenceRow.style.display = 'flex';
    bondPersistenceRow.style.alignItems = 'center';
    bondPersistenceRow.style.gap = '10px';
    const bondPersistenceLabel = document.createElement('span');
    bondPersistenceLabel.textContent = 'Bond Persistence:';
    bondPersistenceLabel.style.width = '140px';
    bondPersistenceRow.appendChild(bondPersistenceLabel);
    const bondPersistenceInput = document.createElement('input');
    bondPersistenceInput.type = 'range';
    bondPersistenceInput.min = 0.5;
    bondPersistenceInput.max = 2.0;
    bondPersistenceInput.step = 0.05;
    bondPersistenceInput.value = sidebarParams.bondPersistence;
    bondPersistenceInput.style.width = '120px';
    bondPersistenceInput.disabled = paramDisabled;
    bondPersistenceInput.addEventListener('input', e => {
        const v = Number(e.target.value);
        sidebarParams.bondPersistence = v;
        bondPersistenceNumber.value = v;
        window.bondPersistence = v;
    });
    bondPersistenceRow.appendChild(bondPersistenceInput);
    const bondPersistenceNumber = document.createElement('input');
    bondPersistenceNumber.type = 'number';
    bondPersistenceNumber.min = 0.5;
    bondPersistenceNumber.max = 2.0;
    bondPersistenceNumber.step = 0.05;
    bondPersistenceNumber.value = sidebarParams.bondPersistence;
    bondPersistenceNumber.disabled = paramDisabled;
    bondPersistenceNumber.style.width = '64px';
    bondPersistenceNumber.addEventListener('input', e => {
        const v = Number(e.target.value);
        sidebarParams.bondPersistence = v;
        bondPersistenceInput.value = v;
        window.bondPersistence = v;
    });
    bondPersistenceRow.appendChild(bondPersistenceNumber);
    bondPersistenceRow.dataset.label = 'Bond Persistence';
    tabPanels[1].appendChild(bondPersistenceRow);

    function appendCompactSliderInput(row, labelText, key, { min = 0, max = 100, step = 1, width = '56px', sliderWidth = '88px' } = {}) {
        const miniLabel = document.createElement('span');
        miniLabel.textContent = labelText;
        miniLabel.style.fontSize = '0.82em';
        miniLabel.style.color = '#475569';
        row.appendChild(miniLabel);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.value = String(sidebarParams[key]);
        slider.style.width = sliderWidth;
        slider.disabled = paramDisabled;
        row.appendChild(slider);

        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(sidebarParams[key]);
        input.style.width = width;
        input.disabled = paramDisabled;

        const syncValue = (value) => {
            const raw = Number(value);
            const next = Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : Number(sidebarParams[key]);
            sidebarParams[key] = next;
            window[key] = next;
            slider.value = String(next);
            input.value = String(next);
        };
        slider.addEventListener('input', e => syncValue(e.target.value));
        input.addEventListener('input', e => syncValue(e.target.value));
        row.appendChild(input);
    }

    const relationThresholdRow = document.createElement('div');
    relationThresholdRow.style.display = 'flex';
    relationThresholdRow.style.alignItems = 'center';
    relationThresholdRow.style.flexWrap = 'wrap';
    relationThresholdRow.style.gap = '8px';
    const relationThresholdLabel = document.createElement('span');
    relationThresholdLabel.textContent = 'Tie Thresholds:';
    relationThresholdLabel.style.width = '140px';
    relationThresholdRow.appendChild(relationThresholdLabel);
    appendCompactSliderInput(relationThresholdRow, 'Acq', 'acquaintanceAffinityThreshold', { min: 0, max: 100, step: 1, width: '54px', sliderWidth: '72px' });
    appendCompactSliderInput(relationThresholdRow, 'Ally', 'allyAffinityThreshold', { min: 0, max: 100, step: 1, width: '54px', sliderWidth: '72px' });
    appendCompactSliderInput(relationThresholdRow, 'Bond', 'bondedAffinityThreshold', { min: 0, max: 100, step: 1, width: '54px', sliderWidth: '72px' });
    relationThresholdRow.dataset.label = 'Tie Thresholds';
    tabPanels[1].appendChild(relationThresholdRow);

    const supportModelRow = document.createElement('div');
    supportModelRow.style.display = 'flex';
    supportModelRow.style.alignItems = 'center';
    supportModelRow.style.flexWrap = 'wrap';
    supportModelRow.style.gap = '8px';
    const supportModelLabel = document.createElement('span');
    supportModelLabel.textContent = 'Support Inputs:';
    supportModelLabel.style.width = '140px';
    supportModelRow.appendChild(supportModelLabel);
    appendCompactSliderInput(supportModelRow, 'Radius', 'nearbySupportRadius', { min: 1, max: 10, step: 1, width: '54px', sliderWidth: '72px' });
    appendCompactSliderInput(supportModelRow, 'Group+', 'supportGroupBonus', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(supportModelRow, 'Ally+', 'supportAllyPresenceBonus', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(supportModelRow, 'Comfort', 'supportComfortRecoveryRate', { min: 0, max: 8, step: 0.1, width: '64px', sliderWidth: '72px' });
    supportModelRow.dataset.label = 'Support Inputs';
    tabPanels[1].appendChild(supportModelRow);

    const supportDynamicsRow = document.createElement('div');
    supportDynamicsRow.style.display = 'flex';
    supportDynamicsRow.style.alignItems = 'center';
    supportDynamicsRow.style.flexWrap = 'wrap';
    supportDynamicsRow.style.gap = '8px';
    const supportDynamicsLabel = document.createElement('span');
    supportDynamicsLabel.textContent = 'Support Dynamics:';
    supportDynamicsLabel.style.width = '140px';
    supportDynamicsRow.appendChild(supportDynamicsLabel);
    appendCompactSliderInput(supportDynamicsRow, 'Decay', 'socialNeedDecayRate', { min: 0, max: 4, step: 0.1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(supportDynamicsRow, 'Group×', 'supportGroupComfortScale', { min: 0, max: 2, step: 0.05, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(supportDynamicsRow, 'NightA', 'supportNightSafetyAllyBonus', { min: 0, max: 6, step: 0.1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(supportDynamicsRow, 'NightB', 'supportNightSafetyBondedBonus', { min: 0, max: 8, step: 0.1, width: '64px', sliderWidth: '72px' });
    supportDynamicsRow.dataset.label = 'Support Dynamics';
    tabPanels[1].appendChild(supportDynamicsRow);

    const needsDynamicsRow = document.createElement('div');
    needsDynamicsRow.style.display = 'flex';
    needsDynamicsRow.style.alignItems = 'center';
    needsDynamicsRow.style.flexWrap = 'wrap';
    needsDynamicsRow.style.gap = '8px';
    const needsDynamicsLabel = document.createElement('span');
    needsDynamicsLabel.textContent = 'Needs Dynamics:';
    needsDynamicsLabel.style.width = '140px';
    needsDynamicsRow.appendChild(needsDynamicsLabel);
    appendCompactSliderInput(needsDynamicsRow, 'Hun', 'hungerDecayRate', { min: 0, max: 2, step: 0.05, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(needsDynamicsRow, 'FoodAt', 'foodSeekHungerThreshold', { min: 10, max: 80, step: 1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(needsDynamicsRow, 'FoodRt', 'foodTargetRetrySeconds', { min: 5, max: 90, step: 1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(needsDynamicsRow, 'WandE', 'wanderReserveEnergy', { min: 0, max: 30, step: 1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(needsDynamicsRow, 'MoveE', 'activeEnergyDrainRate', { min: 0, max: 5, step: 0.1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(needsDynamicsRow, 'NightS', 'unsafeNightSafetyDecayRate', { min: 0, max: 10, step: 0.1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(needsDynamicsRow, 'DayS', 'daytimeSafetyRecoveryRate', { min: 0, max: 30, step: 0.5, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(needsDynamicsRow, 'RestE', 'restEnergyRecoveryRate', { min: 0, max: 30, step: 0.5, width: '64px', sliderWidth: '72px' });
    needsDynamicsRow.dataset.label = 'Needs Dynamics';
    tabPanels[2].appendChild(needsDynamicsRow);

    const supportWeightsRow = document.createElement('div');
    supportWeightsRow.style.display = 'flex';
    supportWeightsRow.style.alignItems = 'center';
    supportWeightsRow.style.flexWrap = 'wrap';
    supportWeightsRow.style.gap = '8px';
    const supportWeightsLabel = document.createElement('span');
    supportWeightsLabel.textContent = 'Support Weights:';
    supportWeightsLabel.style.width = '140px';
    supportWeightsRow.appendChild(supportWeightsLabel);
    appendCompactSliderInput(supportWeightsRow, 'Bond', 'supportBondedWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(supportWeightsRow, 'Ally', 'supportAllyWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(supportWeightsRow, 'Near', 'supportNearbyWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(supportWeightsRow, 'Top', 'supportTopAffinityWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    supportWeightsRow.dataset.label = 'Support Weights';
    tabPanels[1].appendChild(supportWeightsRow);

    const socialDecisionRow = document.createElement('div');
    socialDecisionRow.style.display = 'flex';
    socialDecisionRow.style.alignItems = 'center';
    socialDecisionRow.style.flexWrap = 'wrap';
    socialDecisionRow.style.gap = '8px';
    const socialDecisionLabel = document.createElement('span');
    socialDecisionLabel.textContent = 'Decision Biases:';
    socialDecisionLabel.style.width = '140px';
    socialDecisionRow.appendChild(socialDecisionLabel);
    appendCompactSliderInput(socialDecisionRow, 'Exp', 'explorationBaseRate', { min: 0, max: 0.4, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialDecisionRow, 'ExpMin', 'explorationMinRate', { min: 0, max: 0.2, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialDecisionRow, 'ExpMax', 'explorationMaxRate', { min: 0, max: 0.5, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialDecisionRow, 'SocOff', 'lowPrioritySocialOffset', { min: 0, max: 100, step: 1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialDecisionRow, 'Seek', 'supportSeekingDrive', { min: 0, max: 0.6, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialDecisionRow, 'Trust+', 'trustedTieBonus', { min: 0, max: 40, step: 1, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialDecisionRow, 'Anchor', 'socialAnchorBias', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    socialDecisionRow.dataset.label = 'Decision Biases';
    tabPanels[1].appendChild(socialDecisionRow);

    const socialAdaptRow = document.createElement('div');
    socialAdaptRow.style.display = 'flex';
    socialAdaptRow.style.alignItems = 'center';
    socialAdaptRow.style.flexWrap = 'wrap';
    socialAdaptRow.style.gap = '8px';
    const socialAdaptLabel = document.createElement('span');
    socialAdaptLabel.textContent = 'Adapt Weights:';
    socialAdaptLabel.style.width = '140px';
    socialAdaptRow.appendChild(socialAdaptLabel);
    appendCompactSliderInput(socialAdaptRow, 'Exp+', 'explorationAdaptBoost', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialAdaptRow, 'ExpFor-', 'explorationForagePenalty', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialAdaptRow, 'ExpRes-', 'explorationRestPenalty', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialAdaptRow, 'Forage-', 'socialForagePenalty', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialAdaptRow, 'Rest-', 'socialRestPenalty', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(socialAdaptRow, 'Soc+', 'socialAdaptationBoost', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    socialAdaptRow.dataset.label = 'Adapt Weights';
    tabPanels[1].appendChild(socialAdaptRow);

    const reproductionModelRow = document.createElement('div');
    reproductionModelRow.style.display = 'flex';
    reproductionModelRow.style.alignItems = 'center';
    reproductionModelRow.style.flexWrap = 'wrap';
    reproductionModelRow.style.gap = '8px';
    const reproductionModelLabel = document.createElement('span');
    reproductionModelLabel.textContent = 'Birth Layers:';
    reproductionModelLabel.style.width = '140px';
    reproductionModelRow.appendChild(reproductionModelLabel);
    appendCompactSliderInput(reproductionModelRow, 'Gate', 'reproductionReadinessThreshold', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(reproductionModelRow, 'Threat+', 'reproductionAnxietyCohesionBonus', { min: 0, max: 0.4, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(reproductionModelRow, 'Press-', 'reproductionPressurePenalty', { min: 0, max: 0.6, step: 0.01, width: '64px', sliderWidth: '72px' });
    reproductionModelRow.dataset.label = 'Birth Layers';
    tabPanels[1].appendChild(reproductionModelRow);

    const districtPressureRow = document.createElement('div');
    districtPressureRow.style.display = 'flex';
    districtPressureRow.style.alignItems = 'center';
    districtPressureRow.style.flexWrap = 'wrap';
    districtPressureRow.style.gap = '8px';
    const districtPressureLabel = document.createElement('span');
    districtPressureLabel.textContent = 'District Pressure:';
    districtPressureLabel.style.width = '140px';
    districtPressureRow.appendChild(districtPressureLabel);
    appendCompactSliderInput(districtPressureRow, 'Food', 'socialPressureFoodWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtPressureRow, 'House', 'socialPressureHousingWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtPressureRow, 'Time', 'socialPressureTimeWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtPressureRow, 'Support', 'socialPressureSupportWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtPressureRow, 'Stable', 'socialPressureStabilityWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    districtPressureRow.dataset.label = 'District Pressure';
    tabPanels[2].appendChild(districtPressureRow);

    const districtOpportunityRow = document.createElement('div');
    districtOpportunityRow.style.display = 'flex';
    districtOpportunityRow.style.alignItems = 'center';
    districtOpportunityRow.style.flexWrap = 'wrap';
    districtOpportunityRow.style.gap = '8px';
    const districtOpportunityLabel = document.createElement('span');
    districtOpportunityLabel.textContent = 'District Opportunity:';
    districtOpportunityLabel.style.width = '140px';
    districtOpportunityRow.appendChild(districtOpportunityLabel);
    appendCompactSliderInput(districtOpportunityRow, 'Press', 'opportunityPressureWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtOpportunityRow, 'Support', 'opportunitySupportWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtOpportunityRow, 'Stable', 'opportunityStabilityWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtOpportunityRow, 'Conflict', 'opportunityConflictWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtOpportunityRow, 'Pop', 'opportunityPopulationWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    appendCompactSliderInput(districtOpportunityRow, 'Food', 'opportunityFoodWeight', { min: 0, max: 1, step: 0.01, width: '64px', sliderWidth: '72px' });
    districtOpportunityRow.dataset.label = 'District Opportunity';
    tabPanels[2].appendChild(districtOpportunityRow);

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
    digRow.dataset.label = 'Dig Cooldown';
    tabPanels[3].appendChild(digRow);

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

    reservationRow.dataset.label = 'Reservation TTL';
    tabPanels[3].appendChild(reservationRow);

    // --- Perception/Socialize Range Slider ---
    if (sidebarParams.perceptionRange === undefined) sidebarParams.perceptionRange = 3;
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
    perceptionRow.dataset.label = 'Perception Range';
    tabPanels[1].appendChild(perceptionRow);

    // --- 繁殖後の友好度リセット値スライダー ---
    if (sidebarParams.affinityResetAfterReproduce === undefined) sidebarParams.affinityResetAfterReproduce = 42;
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
    affinityResetRow.dataset.label = 'Affinity After Reproduce';
    tabPanels[1].appendChild(affinityResetRow);

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
    pairCooldownRow.dataset.label = 'Pair Cooldown';
    tabPanels[1].appendChild(pairCooldownRow);

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
    maxAffinityRow.dataset.label = 'Max Affinity';
    tabPanels[1].appendChild(maxAffinityRow);

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
    parentCooldownRow.dataset.label = 'Parent Cooldown Reproduction';
    tabPanels[1].appendChild(parentCooldownRow);

    // --- Trait Affinity Cap Reduction Slider ---
    // Controls how much personality distance lowers affinity ceiling.
    // 0 = traits have no effect; 1 = opposite-trait pairs can never exceed 0 affinity.
    if (sidebarParams.traitAffinityCapReduction === undefined) sidebarParams.traitAffinityCapReduction = 0.6;
    const traitCapRow = document.createElement('div');
    traitCapRow.style.display = 'flex';
    traitCapRow.style.alignItems = 'center';
    traitCapRow.style.gap = '10px';
    const traitCapLabel = document.createElement('span');
    traitCapLabel.textContent = '🧠 Ideology Gap Effect:';
    traitCapLabel.style.width = '140px';
    traitCapRow.appendChild(traitCapLabel);
    const traitCapInput = document.createElement('input');
    traitCapInput.type = 'range';
    traitCapInput.min = 0;
    traitCapInput.max = 1;
    traitCapInput.step = 0.05;
    traitCapInput.value = sidebarParams.traitAffinityCapReduction;
    traitCapInput.style.width = '120px';
    traitCapInput.disabled = paramDisabled;
    traitCapInput.addEventListener('input', e => {
        sidebarParams.traitAffinityCapReduction = parseFloat(e.target.value);
        traitCapNumber.value = e.target.value;
        window.traitAffinityCapReduction = parseFloat(e.target.value);
    });
    traitCapRow.appendChild(traitCapInput);
    const traitCapNumber = document.createElement('input');
    traitCapNumber.type = 'number';
    traitCapNumber.min = 0;
    traitCapNumber.max = 1;
    traitCapNumber.step = 0.05;
    traitCapNumber.value = sidebarParams.traitAffinityCapReduction;
    traitCapNumber.style.width = '56px';
    traitCapNumber.disabled = paramDisabled;
    traitCapNumber.addEventListener('input', e => {
        sidebarParams.traitAffinityCapReduction = parseFloat(e.target.value);
        traitCapInput.value = e.target.value;
        window.traitAffinityCapReduction = parseFloat(e.target.value);
    });
    traitCapRow.appendChild(traitCapNumber);
    traitCapRow.dataset.label = 'Ideology Gap Effect';
    tabPanels[1].appendChild(traitCapRow);

    // --- Affinity Floor Slider ---
    if (sidebarParams.affinityFloor === undefined) sidebarParams.affinityFloor = 5;
    const affinityFloorRow = document.createElement('div');
    affinityFloorRow.style.display = 'flex';
    affinityFloorRow.style.alignItems = 'center';
    affinityFloorRow.style.gap = '10px';
    const affinityFloorLabel = document.createElement('span');
    affinityFloorLabel.textContent = '💢 Affinity Floor:';
    affinityFloorLabel.style.width = '140px';
    affinityFloorRow.appendChild(affinityFloorLabel);
    const affinityFloorInput = document.createElement('input');
    affinityFloorInput.type = 'range'; affinityFloorInput.min = 0; affinityFloorInput.max = 30; affinityFloorInput.step = 1;
    affinityFloorInput.value = sidebarParams.affinityFloor; affinityFloorInput.style.width = '120px'; affinityFloorInput.disabled = paramDisabled;
    affinityFloorInput.addEventListener('input', e => { sidebarParams.affinityFloor = parseInt(e.target.value); affinityFloorNumber.value = e.target.value; window.affinityFloor = parseInt(e.target.value); });
    affinityFloorRow.appendChild(affinityFloorInput);
    const affinityFloorNumber = document.createElement('input');
    affinityFloorNumber.type = 'number'; affinityFloorNumber.min = 0; affinityFloorNumber.max = 30; affinityFloorNumber.step = 1;
    affinityFloorNumber.value = sidebarParams.affinityFloor; affinityFloorNumber.style.width = '56px'; affinityFloorNumber.disabled = paramDisabled;
    affinityFloorNumber.addEventListener('input', e => { sidebarParams.affinityFloor = parseInt(e.target.value); affinityFloorInput.value = e.target.value; window.affinityFloor = parseInt(e.target.value); });
    affinityFloorRow.appendChild(affinityFloorNumber);
    affinityFloorRow.dataset.label = 'Affinity Floor';
    tabPanels[1].appendChild(affinityFloorRow);

    // --- Min Reproduction Age Ratio Slider ---
    if (sidebarParams.minReproductionAgeRatio === undefined) sidebarParams.minReproductionAgeRatio = 0.18;
    const minAgeRow = document.createElement('div');
    minAgeRow.style.display = 'flex'; minAgeRow.style.alignItems = 'center'; minAgeRow.style.gap = '10px';
    const minAgeLabel = document.createElement('span');
    minAgeLabel.textContent = '👶 Min Repro Age:';
    minAgeLabel.style.width = '140px';
    minAgeRow.appendChild(minAgeLabel);
    const minAgeInput = document.createElement('input');
    minAgeInput.type = 'range'; minAgeInput.min = 0; minAgeInput.max = 0.5; minAgeInput.step = 0.05;
    minAgeInput.value = sidebarParams.minReproductionAgeRatio; minAgeInput.style.width = '120px'; minAgeInput.disabled = paramDisabled;
    minAgeInput.addEventListener('input', e => { sidebarParams.minReproductionAgeRatio = parseFloat(e.target.value); minAgeNumber.value = e.target.value; window.minReproductionAgeRatio = parseFloat(e.target.value); });
    minAgeRow.appendChild(minAgeInput);
    const minAgeNumber = document.createElement('input');
    minAgeNumber.type = 'number'; minAgeNumber.min = 0; minAgeNumber.max = 0.5; minAgeNumber.step = 0.05;
    minAgeNumber.value = sidebarParams.minReproductionAgeRatio; minAgeNumber.style.width = '56px'; minAgeNumber.disabled = paramDisabled;
    minAgeNumber.addEventListener('input', e => { sidebarParams.minReproductionAgeRatio = parseFloat(e.target.value); minAgeInput.value = e.target.value; window.minReproductionAgeRatio = parseFloat(e.target.value); });
    minAgeRow.appendChild(minAgeNumber);
    minAgeRow.dataset.label = 'Min Reproduction Age Ratio';
    tabPanels[1].appendChild(minAgeRow);

    // --- Reproduce Affinity Threshold ---
    const reproAffinRow = document.createElement('div');
    reproAffinRow.style.display = 'flex'; reproAffinRow.style.alignItems = 'center'; reproAffinRow.style.gap = '10px';
    const reproAffinLabel = document.createElement('span');
    reproAffinLabel.textContent = '💑 Repro Affinity Min:';
    reproAffinLabel.style.width = '140px';
    reproAffinRow.appendChild(reproAffinLabel);
    const reproAffinInput = document.createElement('input');
    reproAffinInput.type = 'range'; reproAffinInput.min = 20; reproAffinInput.max = 100; reproAffinInput.step = 1;
    reproAffinInput.value = sidebarParams.reproduceAffinityThreshold; reproAffinInput.style.width = '120px'; reproAffinInput.disabled = paramDisabled;
    reproAffinInput.addEventListener('input', e => { sidebarParams.reproduceAffinityThreshold = parseInt(e.target.value); reproAffinNumber.value = e.target.value; window.reproduceAffinityThreshold = parseInt(e.target.value); });
    reproAffinRow.appendChild(reproAffinInput);
    const reproAffinNumber = document.createElement('input');
    reproAffinNumber.type = 'number'; reproAffinNumber.min = 20; reproAffinNumber.max = 100; reproAffinNumber.step = 1;
    reproAffinNumber.value = sidebarParams.reproduceAffinityThreshold; reproAffinNumber.style.width = '56px'; reproAffinNumber.disabled = paramDisabled;
    reproAffinNumber.addEventListener('input', e => { sidebarParams.reproduceAffinityThreshold = parseInt(e.target.value); reproAffinInput.value = e.target.value; window.reproduceAffinityThreshold = parseInt(e.target.value); });
    reproAffinRow.appendChild(reproAffinNumber);
    reproAffinRow.dataset.label = 'Repro Affinity Min Threshold';
    tabPanels[1].appendChild(reproAffinRow);

    // --- Mutation Rate ---
    const mutRateRow = document.createElement('div');
    mutRateRow.style.display = 'flex'; mutRateRow.style.alignItems = 'center'; mutRateRow.style.gap = '10px';
    const mutRateLabel = document.createElement('span');
    mutRateLabel.textContent = '🧬 Mutation Rate:';
    mutRateLabel.style.width = '140px';
    mutRateRow.appendChild(mutRateLabel);
    const mutRateInput = document.createElement('input');
    mutRateInput.type = 'range'; mutRateInput.min = 0; mutRateInput.max = 0.5; mutRateInput.step = 0.01;
    mutRateInput.value = sidebarParams.mutationRate; mutRateInput.style.width = '120px'; mutRateInput.disabled = paramDisabled;
    mutRateInput.addEventListener('input', e => { sidebarParams.mutationRate = parseFloat(e.target.value); mutRateNumber.value = e.target.value; window.mutationRate = parseFloat(e.target.value); });
    mutRateRow.appendChild(mutRateInput);
    const mutRateNumber = document.createElement('input');
    mutRateNumber.type = 'number'; mutRateNumber.min = 0; mutRateNumber.max = 0.5; mutRateNumber.step = 0.01;
    mutRateNumber.value = sidebarParams.mutationRate; mutRateNumber.style.width = '56px'; mutRateNumber.disabled = paramDisabled;
    mutRateNumber.addEventListener('input', e => { sidebarParams.mutationRate = parseFloat(e.target.value); mutRateInput.value = e.target.value; window.mutationRate = parseFloat(e.target.value); });
    mutRateRow.appendChild(mutRateNumber);
    mutRateRow.dataset.label = 'Mutation Rate trait inheritance';
    tabPanels[1].appendChild(mutRateRow);

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
    autoRecoverRow.dataset.label = 'Auto Recover Stall';
    tabPanels[2].appendChild(autoRecoverRow);

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
    movementStabilityRow.dataset.label = 'Move Replan Stall Occupancy Lookahead';
    tabPanels[3].appendChild(movementStabilityRow);

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
    cooldownCeilRow.dataset.label = 'Max Action Cooldown';
    tabPanels[3].appendChild(cooldownCeilRow);

    const initialDistrictMode = [1, 4, 16].includes(Number(sidebarParams.districtMode)) ? Number(sidebarParams.districtMode) : 1;
    const getPopulationCapacityByDistrictMode = (mode) => {
        if (mode >= 16) return { recommended: 80, max: 120, label: 'high density' };
        if (mode >= 4) return { recommended: 48, max: 80, label: 'district scaling' };
        return { recommended: 20, max: 50, label: 'baseline' };
    };

    // キャラ数
    const charNumRow = document.createElement('div');
    charNumRow.style.display = 'flex';
    charNumRow.style.alignItems = 'center';
    charNumRow.style.gap = '10px';
    const charNumLabel = document.createElement('span');
    charNumLabel.textContent = 'Number of Characters:';
    charNumLabel.style.width = '140px';
    charNumRow.appendChild(charNumLabel);
    const charCapacity = getPopulationCapacityByDistrictMode(initialDistrictMode);
    const charNumInput = document.createElement('input');
    charNumInput.type = 'range';
    charNumInput.min = 5;
    charNumInput.max = charCapacity.max;
    charNumInput.value = Math.max(5, Math.min(charCapacity.max, Number(sidebarParams.charNum) || charCapacity.recommended));
    charNumInput.style.flex = '1';
    charNumInput.style.margin = '0 8px';
    charNumInput.id = 'charNumInput';
    charNumInput.name = 'charNumInput';
    charNumRow.appendChild(charNumInput);
    const charNumVal = document.createElement('input');
    charNumVal.type = 'number';
    charNumVal.min = 5;
    charNumVal.max = charCapacity.max;
    charNumVal.value = Math.max(5, Math.min(charCapacity.max, Number(sidebarParams.charNum) || charCapacity.recommended));
    charNumVal.style.width = '48px';
    charNumVal.id = 'charNumVal';
    charNumVal.name = 'charNumVal';
    charNumRow.appendChild(charNumVal);
    const populationHint = document.createElement('div');
    populationHint.style.fontSize = '0.76em';
    populationHint.style.color = '#64748b';
    populationHint.style.marginTop = '-4px';
    populationHint.style.marginLeft = '140px';

    const syncPopulationCapacityUI = (mode, { autoTune = false, previousMode = mode } = {}) => {
        const spec = getPopulationCapacityByDistrictMode(mode);
        const prevSpec = getPopulationCapacityByDistrictMode(previousMode);
        charNumInput.max = spec.max;
        charNumVal.max = spec.max;

        const runningCharacterCount = Array.isArray(window.characters)
            ? window.characters.filter(c => c && c.state !== 'dead').length
            : 0;
        const isSimulationActive = !!window.simulationRunning && runningCharacterCount > 0;
        const hasFinishedSnapshot = !window.simulationRunning && !!window.__simHasUserStarted && runningCharacterCount > 0;

        let nextVal = Math.max(5, Math.min(spec.max, Number(sidebarParams.charNum) || spec.recommended));
        if (autoTune && nextVal <= prevSpec.recommended) {
            nextVal = spec.recommended;
        }

        sidebarParams.charNum = nextVal;
        charNumInput.value = nextVal;
        charNumVal.value = nextVal;
        charNumInput.disabled = isSimulationActive;
        charNumVal.disabled = isSimulationActive;

        if (isSimulationActive) {
            populationHint.textContent = `Alive now: ${runningCharacterCount} · next start: ${nextVal} · recommended ${spec.recommended} for ${mode}-district mode · max ${spec.max}`;
        } else if (hasFinishedSnapshot) {
            populationHint.textContent = `Final alive: ${runningCharacterCount} · next start: ${nextVal} · recommended ${spec.recommended} for ${mode}-district mode · max ${spec.max}`;
        } else {
            populationHint.textContent = `Start with ${nextVal} · recommended ${spec.recommended} for ${mode}-district ${spec.label} mode · max ${spec.max}`;
        }
    };

    // 双方向同期＋sidebarParams更新
    charNumInput.oninput = () => {
        charNumVal.value = charNumInput.value;
        sidebarParams.charNum = parseInt(charNumInput.value);
        syncPopulationCapacityUI(Number(sidebarParams.districtMode) || 1);
        if (!window.simulationRunning && !window.__simHasUserStarted) {
            resampleIdleDistrictCounts();
        } else {
            window.renderCharacterList && window.renderCharacterList();
        }
    };
    charNumVal.oninput = () => {
        const maxAllowed = Number(charNumVal.max || charCapacity.max);
        const safeValue = Math.max(5, Math.min(maxAllowed, Number(charNumVal.value) || 5));
        charNumInput.value = safeValue;
        charNumVal.value = safeValue;
        sidebarParams.charNum = safeValue;
        syncPopulationCapacityUI(Number(sidebarParams.districtMode) || 1);
        if (!window.simulationRunning && !window.__simHasUserStarted) {
            resampleIdleDistrictCounts();
        } else {
            window.renderCharacterList && window.renderCharacterList();
        }
    };
    charNumRow.dataset.label = 'Number of Characters';
    tabPanels[0].appendChild(charNumRow);
    tabPanels[0].appendChild(populationHint);
    syncPopulationCapacityUI(initialDistrictMode);
    charNumInput.disabled = paramDisabled;
    charNumVal.disabled = paramDisabled;
    // Seed idle distribution on first render if not yet computed
    if (!window.simulationRunning && !window.__simHasUserStarted && !_idleDistrictCounts) {
        resampleIdleDistrictCounts();
    }

    // --- Initial Age Spread Slider ---
    if (sidebarParams.initialAgeMaxRatio === undefined) sidebarParams.initialAgeMaxRatio = 0.65;
    const ageSpreadRow = document.createElement('div');
    ageSpreadRow.style.display = 'flex';
    ageSpreadRow.style.alignItems = 'center';
    ageSpreadRow.style.gap = '10px';
    const ageSpreadLabel = document.createElement('span');
    ageSpreadLabel.textContent = '🎲 Initial Age Spread:';
    ageSpreadLabel.style.width = '140px';
    ageSpreadRow.appendChild(ageSpreadLabel);
    const ageSpreadInput = document.createElement('input');
    ageSpreadInput.type = 'range';
    ageSpreadInput.min = 0;
    ageSpreadInput.max = 1;
    ageSpreadInput.step = 0.05;
    ageSpreadInput.value = sidebarParams.initialAgeMaxRatio;
    ageSpreadInput.style.flex = '1';
    ageSpreadInput.style.margin = '0 8px';
    ageSpreadInput.id = 'ageSpreadInput';
    ageSpreadInput.name = 'ageSpreadInput';
    ageSpreadRow.appendChild(ageSpreadInput);
    const ageSpreadVal = document.createElement('input');
    ageSpreadVal.type = 'number';
    ageSpreadVal.min = 0;
    ageSpreadVal.max = 1;
    ageSpreadVal.step = 0.05;
    ageSpreadVal.value = sidebarParams.initialAgeMaxRatio;
    ageSpreadVal.style.width = '56px';
    ageSpreadVal.id = 'ageSpreadVal';
    ageSpreadVal.name = 'ageSpreadVal';
    ageSpreadRow.appendChild(ageSpreadVal);
    ageSpreadInput.oninput = () => {
        ageSpreadVal.value = ageSpreadInput.value;
        sidebarParams.initialAgeMaxRatio = parseFloat(ageSpreadInput.value);
        window.initialAgeMaxRatio = parseFloat(ageSpreadInput.value);
    };
    ageSpreadVal.oninput = () => {
        ageSpreadInput.value = ageSpreadVal.value;
        sidebarParams.initialAgeMaxRatio = parseFloat(ageSpreadVal.value);
        window.initialAgeMaxRatio = parseFloat(ageSpreadVal.value);
    };
    ageSpreadRow.dataset.label = 'Initial Age Spread';
    tabPanels[0].appendChild(ageSpreadRow);
    ageSpreadInput.disabled = paramDisabled;
    ageSpreadVal.disabled = paramDisabled;

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
    socialRow.dataset.label = 'Social Threshold';
    tabPanels[0].appendChild(socialRow);
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
    hungerEmergencyRow.dataset.label = 'Hunger Emergency Threshold';
    tabPanels[2].appendChild(hungerEmergencyRow);
    hungerEmergencyInput.disabled = paramDisabled;
    hungerEmergencyVal.disabled = paramDisabled;

    // --- Energy Emergency Threshold Slider ---
    if (sidebarParams.energyEmergencyThreshold === undefined) sidebarParams.energyEmergencyThreshold = 28;
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
    energyEmergencyInput.max = 40;
    energyEmergencyInput.step = 1;
    energyEmergencyInput.value = sidebarParams.energyEmergencyThreshold;
    energyEmergencyInput.style.flex = '2';
    energyEmergencyInput.id = 'energyEmergencyInput';
    energyEmergencyInput.name = 'energyEmergencyInput';
    const energyEmergencyVal = document.createElement('input');
    energyEmergencyVal.type = 'number';
    energyEmergencyVal.min = 0;
    energyEmergencyVal.max = 40;
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
    energyEmergencyRow.dataset.label = 'Energy Emergency Threshold';
    tabPanels[2].appendChild(energyEmergencyRow);
    energyEmergencyInput.disabled = paramDisabled;
    energyEmergencyVal.disabled = paramDisabled;

    // --- Character Lifespan Slider ---
    if (sidebarParams.characterLifespan === undefined) sidebarParams.characterLifespan = 240;
    const lifespanRow = document.createElement('div');
    lifespanRow.style.display = 'flex';
    lifespanRow.style.alignItems = 'center';
    lifespanRow.style.gap = '10px';
    const lifespanLabel = document.createElement('span');
    lifespanLabel.textContent = 'Character Lifespan (s):';
    lifespanLabel.style.flex = '1';
    const lifespanInput = document.createElement('input');
    lifespanInput.type = 'range';
    lifespanInput.min = 60;
    lifespanInput.max = 600;
    lifespanInput.step = 30;
    lifespanInput.value = sidebarParams.characterLifespan;
    lifespanInput.style.flex = '2';
    lifespanInput.id = 'lifespanInput';
    lifespanInput.name = 'lifespanInput';
    const lifespanVal = document.createElement('input');
    lifespanVal.type = 'number';
    lifespanVal.min = 60;
    lifespanVal.max = 600;
    lifespanVal.step = 30;
    lifespanVal.value = sidebarParams.characterLifespan;
    lifespanVal.style.width = '60px';
    lifespanVal.id = 'lifespanVal';
    lifespanVal.name = 'lifespanVal';
    lifespanRow.appendChild(lifespanLabel);
    lifespanRow.appendChild(lifespanInput);
    lifespanRow.appendChild(lifespanVal);
    lifespanInput.oninput = () => {
        lifespanVal.value = lifespanInput.value;
        sidebarParams.characterLifespan = parseInt(lifespanInput.value);
        window.characterLifespan = parseInt(lifespanInput.value);
    };
    lifespanVal.oninput = () => {
        lifespanInput.value = lifespanVal.value;
        sidebarParams.characterLifespan = parseInt(lifespanVal.value);
        window.characterLifespan = parseInt(lifespanVal.value);
    };
    lifespanRow.dataset.label = 'Character Lifespan';
    tabPanels[2].appendChild(lifespanRow);
    lifespanInput.disabled = paramDisabled;
    lifespanVal.disabled = paramDisabled;

    // --- Fruit Regen Interval Slider ---
    if (sidebarParams.fruitRegenIntervalSeconds === undefined) sidebarParams.fruitRegenIntervalSeconds = 60;
    const fruitRegenRow = document.createElement('div');
    fruitRegenRow.style.display = 'flex';
    fruitRegenRow.style.alignItems = 'center';
    fruitRegenRow.style.gap = '10px';
    const fruitRegenLabel = document.createElement('span');
    fruitRegenLabel.textContent = '🍎 Fruit Regen Interval (s):';
    fruitRegenLabel.style.flex = '1';
    const fruitRegenInput = document.createElement('input');
    fruitRegenInput.type = 'range';
    fruitRegenInput.min = 10;
    fruitRegenInput.max = 300;
    fruitRegenInput.step = 10;
    fruitRegenInput.value = sidebarParams.fruitRegenIntervalSeconds;
    fruitRegenInput.style.flex = '2';
    fruitRegenInput.id = 'fruitRegenInput';
    fruitRegenInput.name = 'fruitRegenInput';
    const fruitRegenVal = document.createElement('input');
    fruitRegenVal.type = 'number';
    fruitRegenVal.min = 10;
    fruitRegenVal.max = 300;
    fruitRegenVal.step = 10;
    fruitRegenVal.value = sidebarParams.fruitRegenIntervalSeconds;
    fruitRegenVal.style.width = '60px';
    fruitRegenVal.id = 'fruitRegenVal';
    fruitRegenVal.name = 'fruitRegenVal';
    fruitRegenRow.appendChild(fruitRegenLabel);
    fruitRegenRow.appendChild(fruitRegenInput);
    fruitRegenRow.appendChild(fruitRegenVal);
    fruitRegenInput.oninput = () => {
        fruitRegenVal.value = fruitRegenInput.value;
        sidebarParams.fruitRegenIntervalSeconds = parseInt(fruitRegenInput.value);
        window.fruitRegenIntervalSeconds = parseInt(fruitRegenInput.value);
    };
    fruitRegenVal.oninput = () => {
        fruitRegenInput.value = fruitRegenVal.value;
        sidebarParams.fruitRegenIntervalSeconds = parseInt(fruitRegenVal.value);
        window.fruitRegenIntervalSeconds = parseInt(fruitRegenVal.value);
    };
    fruitRegenRow.dataset.label = 'Fruit Regen Interval';
    tabPanels[2].appendChild(fruitRegenRow);
    fruitRegenInput.disabled = paramDisabled;
    fruitRegenVal.disabled = paramDisabled;

    // --- Season Cycle Length Slider ---
    if (sidebarParams.seasonCycleSeconds === undefined) sidebarParams.seasonCycleSeconds = 120;
    const seasonCycleRow = document.createElement('div');
    seasonCycleRow.style.display = 'flex';
    seasonCycleRow.style.alignItems = 'center';
    seasonCycleRow.style.gap = '10px';
    const seasonCycleLabel = document.createElement('span');
    seasonCycleLabel.textContent = '🌱 Season Cycle (s):';
    seasonCycleLabel.style.flex = '1';
    const seasonCycleInput = document.createElement('input');
    seasonCycleInput.type = 'range';
    seasonCycleInput.min = 30;
    seasonCycleInput.max = 600;
    seasonCycleInput.step = 10;
    seasonCycleInput.value = sidebarParams.seasonCycleSeconds;
    seasonCycleInput.style.flex = '2';
    const seasonCycleVal = document.createElement('input');
    seasonCycleVal.type = 'number';
    seasonCycleVal.min = 30;
    seasonCycleVal.max = 600;
    seasonCycleVal.step = 10;
    seasonCycleVal.value = sidebarParams.seasonCycleSeconds;
    seasonCycleVal.style.width = '60px';
    seasonCycleRow.appendChild(seasonCycleLabel);
    seasonCycleRow.appendChild(seasonCycleInput);
    seasonCycleRow.appendChild(seasonCycleVal);
    seasonCycleInput.addEventListener('input', e => {
        sidebarParams.seasonCycleSeconds = parseInt(e.target.value);
        seasonCycleVal.value = e.target.value;
        window.seasonCycleSeconds = parseInt(e.target.value);
    });
    seasonCycleVal.addEventListener('input', e => {
        sidebarParams.seasonCycleSeconds = parseInt(e.target.value);
        seasonCycleInput.value = e.target.value;
        window.seasonCycleSeconds = parseInt(e.target.value);
    });
    seasonCycleRow.dataset.label = 'Season Cycle Length';
    tabPanels[2].appendChild(seasonCycleRow);
    seasonCycleInput.disabled = paramDisabled;
    seasonCycleVal.disabled = paramDisabled;

    // --- Season Amplitude Slider ---
    if (sidebarParams.seasonAmplitude === undefined) sidebarParams.seasonAmplitude = 0.6;
    const seasonAmpRow = document.createElement('div');
    seasonAmpRow.style.display = 'flex';
    seasonAmpRow.style.alignItems = 'center';
    seasonAmpRow.style.gap = '10px';
    const seasonAmpLabel = document.createElement('span');
    seasonAmpLabel.textContent = '❄️ Season Amplitude:';
    seasonAmpLabel.style.flex = '1';
    const seasonAmpInput = document.createElement('input');
    seasonAmpInput.type = 'range';
    seasonAmpInput.min = 0;
    seasonAmpInput.max = 1;
    seasonAmpInput.step = 0.05;
    seasonAmpInput.value = sidebarParams.seasonAmplitude;
    seasonAmpInput.style.flex = '2';
    const seasonAmpVal = document.createElement('input');
    seasonAmpVal.type = 'number';
    seasonAmpVal.min = 0;
    seasonAmpVal.max = 1;
    seasonAmpVal.step = 0.05;
    seasonAmpVal.value = sidebarParams.seasonAmplitude;
    seasonAmpVal.style.width = '60px';
    seasonAmpRow.appendChild(seasonAmpLabel);
    seasonAmpRow.appendChild(seasonAmpInput);
    seasonAmpRow.appendChild(seasonAmpVal);
    seasonAmpInput.addEventListener('input', e => {
        sidebarParams.seasonAmplitude = parseFloat(e.target.value);
        seasonAmpVal.value = e.target.value;
        window.seasonAmplitude = parseFloat(e.target.value);
    });
    seasonAmpVal.addEventListener('input', e => {
        sidebarParams.seasonAmplitude = parseFloat(e.target.value);
        seasonAmpInput.value = e.target.value;
        window.seasonAmplitude = parseFloat(e.target.value);
    });
    seasonAmpRow.dataset.label = 'Season Amplitude';
    tabPanels[2].appendChild(seasonAmpRow);
    seasonAmpInput.disabled = paramDisabled;
    seasonAmpVal.disabled = paramDisabled;

    // --- Isolation Penalty Slider ---
    if (sidebarParams.isolationPenalty === undefined) sidebarParams.isolationPenalty = 0.4;
    const isolationRow = document.createElement('div');
    isolationRow.style.display = 'flex'; isolationRow.style.alignItems = 'center'; isolationRow.style.gap = '10px';
    const isolationLabel = document.createElement('span');
    isolationLabel.textContent = '👤 Isolation Penalty:';
    isolationLabel.style.flex = '1';
    isolationRow.appendChild(isolationLabel);
    const isolationInput = document.createElement('input');
    isolationInput.type = 'range'; isolationInput.min = 0; isolationInput.max = 2; isolationInput.step = 0.1;
    isolationInput.value = sidebarParams.isolationPenalty; isolationInput.style.flex = '2'; isolationInput.disabled = paramDisabled;
    isolationInput.addEventListener('input', e => { sidebarParams.isolationPenalty = parseFloat(e.target.value); isolationVal.value = e.target.value; window.isolationPenalty = parseFloat(e.target.value); });
    isolationRow.appendChild(isolationInput);
    const isolationVal = document.createElement('input');
    isolationVal.type = 'number'; isolationVal.min = 0; isolationVal.max = 2; isolationVal.step = 0.1;
    isolationVal.value = sidebarParams.isolationPenalty; isolationVal.style.width = '56px'; isolationVal.disabled = paramDisabled;
    isolationVal.addEventListener('input', e => { sidebarParams.isolationPenalty = parseFloat(e.target.value); isolationInput.value = e.target.value; window.isolationPenalty = parseFloat(e.target.value); });
    isolationRow.appendChild(isolationVal);
    isolationRow.dataset.label = 'Isolation Penalty';
    tabPanels[2].appendChild(isolationRow);

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
    homeReturnRow.dataset.label = 'Home Return Hunger Level';
    tabPanels[2].appendChild(homeReturnRow);
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
    homeBuildRow.dataset.label = 'Home Building Priority';
    tabPanels[2].appendChild(homeBuildRow);
    homeBuildInput.disabled = paramDisabled;
    homeBuildVal.disabled = paramDisabled;

    // --- Starvation Death Delay ---
    const starvRow = document.createElement('div');
    starvRow.style.display = 'flex'; starvRow.style.alignItems = 'center'; starvRow.style.gap = '10px';
    const starvLabel = document.createElement('span');
    starvLabel.textContent = '⏱ Starvation Timer (s):';
    starvLabel.style.width = '140px';
    starvRow.appendChild(starvLabel);
    const starvInput = document.createElement('input');
    starvInput.type = 'range'; starvInput.min = 3; starvInput.max = 30; starvInput.step = 1;
    starvInput.value = sidebarParams.starvationDeathDelaySeconds; starvInput.style.width = '120px'; starvInput.disabled = paramDisabled;
    starvInput.addEventListener('input', e => { sidebarParams.starvationDeathDelaySeconds = parseInt(e.target.value); starvNumber.value = e.target.value; window.starvationDeathDelaySeconds = parseInt(e.target.value); });
    starvRow.appendChild(starvInput);
    const starvNumber = document.createElement('input');
    starvNumber.type = 'number'; starvNumber.min = 3; starvNumber.max = 30; starvNumber.step = 1;
    starvNumber.value = sidebarParams.starvationDeathDelaySeconds; starvNumber.style.width = '56px'; starvNumber.disabled = paramDisabled;
    starvNumber.addEventListener('input', e => { sidebarParams.starvationDeathDelaySeconds = parseInt(e.target.value); starvInput.value = e.target.value; window.starvationDeathDelaySeconds = parseInt(e.target.value); });
    starvRow.appendChild(starvNumber);
    starvRow.dataset.label = 'Starvation Death Delay seconds';
    tabPanels[2].appendChild(starvRow);

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
    randomRow.dataset.label = 'Randomize Thresholds';
    tabPanels[0].appendChild(randomRow);
    randomCheck.disabled = paramDisabled;

    // District observation controls
    const districtMode = initialDistrictMode;
    sidebarParams.districtMode = districtMode;
    sidebarParams.activeDistrictIndex = Math.max(0, Math.min(districtMode - 1, Number(sidebarParams.activeDistrictIndex) || 0));
    window.districtMode = districtMode;
    window.activeDistrictIndex = sidebarParams.activeDistrictIndex;

    const districtModeRow = document.createElement('div');
    districtModeRow.style.display = 'flex';
    districtModeRow.style.alignItems = 'center';
    districtModeRow.style.gap = '10px';
    districtModeRow.style.flexWrap = 'wrap';
    const districtModeLabel = document.createElement('span');
    districtModeLabel.textContent = 'District Mode:';
    districtModeLabel.style.width = '140px';
    districtModeRow.appendChild(districtModeLabel);
    [1, 4, 16].forEach(mode => {
        const btn = document.createElement('button');
        btn.textContent = String(mode);
        btn.style.padding = '4px 10px';
        btn.style.borderRadius = '999px';
        btn.style.border = mode === districtMode ? '2px solid #2563eb' : '1px solid #cbd5e1';
        btn.style.background = mode === districtMode ? '#dbeafe' : '#f8fafc';
        btn.style.fontWeight = '700';
        btn.style.cursor = paramDisabled ? 'not-allowed' : 'pointer';
        btn.style.opacity = paramDisabled ? '0.55' : '1';
        btn.disabled = paramDisabled;
        btn.onclick = () => {
            if (paramDisabled) return;
            const previousMode = sidebarParams.districtMode || 1;
            sidebarParams.districtMode = mode;
            if ((sidebarParams.activeDistrictIndex || 0) >= mode) sidebarParams.activeDistrictIndex = 0;
            window.districtMode = mode;
            window.activeDistrictIndex = sidebarParams.activeDistrictIndex;
            syncPopulationCapacityUI(mode, { autoTune: true, previousMode });
            import('./world.js').then(worldMod => {
                worldMod.setDistrictMode?.(mode);
                worldMod.setActiveDistrict?.(sidebarParams.activeDistrictIndex || 0);
                renderCharacterDetail();
                if (!window.simulationRunning && !window.__simHasUserStarted) {
                    resampleIdleDistrictCounts();
                } else {
                    window.renderCharacterList && window.renderCharacterList();
                }
            });
        };
        districtModeRow.appendChild(btn);
    });
    districtModeRow.dataset.label = 'District Mode';
    tabPanels[0].appendChild(districtModeRow);

    const districtPanel = document.createElement('div');
    districtPanel.style.display = 'flex';
    districtPanel.style.flexDirection = 'column';
    districtPanel.style.gap = '8px';
    districtPanel.style.padding = '8px 10px';
    districtPanel.style.border = '1px solid #dbe4f0';
    districtPanel.style.borderRadius = '10px';
    districtPanel.style.background = '#f8fbff';

    const districtSummary = document.createElement('div');
    districtSummary.style.fontSize = '0.82em';
    districtSummary.style.color = '#334155';
    districtSummary.style.minHeight = '72px';
    districtSummary.style.display = 'grid';
    districtSummary.style.gridTemplateRows = 'auto auto';
    districtSummary.style.alignContent = 'start';
    districtSummary.style.rowGap = '4px';
    const idleDistrictPreview = !window.simulationRunning && !window.__simHasUserStarted;
    const districtData = (!idleDistrictPreview && typeof window.getDistrictObservationSummary === 'function') ? window.getDistrictObservationSummary() : [];
    // Use cached random-terrain counts in idle mode; null means resample in progress
    const idleScaledCounts = idleDistrictPreview ? (_idleDistrictCounts || []) : null;
    const activeDistrictData = districtData[sidebarParams.activeDistrictIndex] || null;
    const activeMigrationNet = Number(activeDistrictData?.migrationFlow?.net || 0);
    const activeFlowColor = activeMigrationNet > 0 ? '#15803d' : (activeMigrationNet < 0 ? '#b91c1c' : '#64748b');
    const activeFlowText = activeMigrationNet > 0 ? `+${activeMigrationNet}` : String(activeMigrationNet);
    const activeIdleCount = idleScaledCounts ? idleScaledCounts[sidebarParams.activeDistrictIndex || 0] : 0;
    districtSummary.innerHTML = (!idleDistrictPreview && activeDistrictData)
        ? `<div style="font-weight:700;color:#0f172a;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Watching D${activeDistrictData.index + 1} · pop ${activeDistrictData.population} · <span style="color:${activeFlowColor};">flow ${activeFlowText}</span></div>` +
          `<div style="color:#475569;line-height:1.25;font-size:0.95em;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:8px;row-gap:2px;">` +
            `<span>pressure ${Math.round((activeDistrictData.socialPressure || 0) * 100)}%</span>` +
            `<span>opportunity ${Math.round((activeDistrictData.opportunityScore || 0) * 100)}%</span>` +
            `<span>support ${Math.round((activeDistrictData.supportAccess || 0) * 100)}%</span>` +
            `<span>stability ${Math.round((activeDistrictData.relationshipStability || 0) * 100)}%</span>` +
            `<span style="grid-column:1 / -1;">move ${Number(activeDistrictData.migrationFlow?.in || 0)} in / ${Number(activeDistrictData.migrationFlow?.out || 0)} out</span>` +
          `</div>`
        : idleDistrictPreview
            ? `<div style="font-weight:700;color:#0f172a;line-height:1.2;">D${(sidebarParams.activeDistrictIndex || 0) + 1} · est. ~${activeIdleCount} · terrain-weighted · press Start</div><div></div>`
            : '<div style="font-weight:700;color:#0f172a;line-height:1.2;">Watching the full baseline district</div><div></div>';
    districtPanel.appendChild(districtSummary);

    const districtGrid = document.createElement('div');
    const districtSide = Math.max(1, Math.round(Math.sqrt(districtMode)));
    districtGrid.style.display = 'grid';
    districtGrid.style.gridTemplateColumns = `repeat(${districtSide}, minmax(0, 1fr))`;
    districtGrid.style.gap = '6px';

    for (let i = 0; i < districtMode; i++) {
        const btn = document.createElement('button');
        const summary = districtData[i];
        const idleCount = idleScaledCounts ? idleScaledCounts[i] : 0;
        btn.textContent = !idleDistrictPreview && summary ? `D${i + 1} · ${summary.population}` : `D${i + 1} · ~${idleCount}`;
        btn.style.padding = '6px 4px';
        btn.style.borderRadius = '8px';
        btn.style.fontWeight = '700';
        btn.style.fontSize = '0.78em';
        const pressure = Number(summary?.socialPressure || 0);
        const hue = Math.max(0, 120 - Math.round(pressure * 120));
        btn.style.border = i === sidebarParams.activeDistrictIndex ? `2px solid hsl(${hue}, 85%, 38%)` : '1px solid #cbd5e1';
        btn.style.background = i === sidebarParams.activeDistrictIndex ? `hsl(${hue}, 90%, 82%)` : `hsl(${hue}, 85%, 94%)`;
        btn.style.cursor = 'pointer';
        if (summary) {
            const flow = Number(summary.migrationFlow?.net || 0);
            const flowText = flow > 0 ? `+${flow}` : String(flow);
            btn.title = `pop ${summary.population} | pressure ${Math.round((summary.socialPressure || 0) * 100)}% | opportunity ${Math.round((summary.opportunityScore || 0) * 100)}% | support ${Math.round((summary.supportAccess || 0) * 100)}% | flow ${flowText} (${Number(summary.migrationFlow?.in || 0)} in / ${Number(summary.migrationFlow?.out || 0)} out)`;
        }
        btn.onclick = () => {
            sidebarParams.activeDistrictIndex = i;
            window.activeDistrictIndex = i;
            import('./world.js').then(worldMod => {
                worldMod.setActiveDistrict?.(i);
                renderCharacterDetail();
                window.renderCharacterList && window.renderCharacterList();
            });
        };
        districtGrid.appendChild(btn);
    }
    districtPanel.appendChild(districtGrid);
    districtPanel.dataset.label = 'Observed District';
    tabPanels[0].appendChild(districtPanel);

    // Start/Finish button (pinned at top)
    if (window.simulationRunning === undefined) window.simulationRunning = false;
    const controlGroup = document.createElement('div');
    controlGroup.style.display = 'flex';
    controlGroup.style.alignItems = 'center';
    controlGroup.style.gap = '8px';

    const toggleBtn = document.createElement('button');

    function updateToggleBtn() {
        if (window.__simStarting) {
            toggleBtn.textContent = 'Starting…';
            toggleBtn.style.background = 'linear-gradient(90deg,#dbeafe 10%,#fde68a 100%)';
            toggleBtn.disabled = true;
        } else if (window.simulationRunning) {
            toggleBtn.textContent = 'Finish';
            toggleBtn.style.background = 'linear-gradient(90deg,#fecaca 10%,#fdba74 100%)';
            toggleBtn.disabled = false;
        } else {
            toggleBtn.textContent = 'Start';
            toggleBtn.style.background = 'linear-gradient(90deg,#dff4ff 10%,#e9f7f1 100%)';
            toggleBtn.disabled = false;
        }
        syncPopulationCapacityUI(Number(sidebarParams.districtMode) || 1);
    }

    function finishSimulation() {
        window.simulationRunning = false;
        window.__simStarting = false;
        window.__simHasUserStarted = true;
        window.__simFinishedAt = Date.now();
        updateToggleBtn();
        window.renderCharacterList && window.renderCharacterList();
        renderCharacterDetail();
    }

    function startFreshSimulation() {
        const num = parseInt(sidebarParams.charNum);
        const socialTh = parseInt(sidebarParams.socialTh);
        const groupAffinityTh = parseInt(sidebarParams.groupAffinityTh);
        const useRandom = !!sidebarParams.useRandom;
        window.__simStarting = true;
        window.__simFinishedAt = null;
        updateToggleBtn();
        window.characters = [];
        window.groupAffinityThreshold = groupAffinityTh;

        import('./world.js').then(async (worldMod) => {
            try {
                if (typeof worldMod.removeAllCharacterObjects === 'function') {
                    worldMod.removeAllCharacterObjects();
                }
                if (typeof worldMod.setDistrictMode === 'function') {
                    worldMod.setDistrictMode(Number(sidebarParams.districtMode) || 1);
                    worldMod.setActiveDistrict(Number(sidebarParams.activeDistrictIndex) || 0);
                }
                if (typeof worldMod.resetNextCharacterId === 'function') worldMod.resetNextCharacterId();
                if (Array.isArray(worldMod.characters)) worldMod.characters.length = 0;
                const spawnBatchSize = Math.max(4, Math.min(12, Math.ceil(num / 5)));
                const spawnAll = async () => {
                    for (let i = 0; i < num; i++) {
                        const pos = worldMod.findValidSpawn();
                        if (pos) {
                            const char = worldMod.spawnCharacter(pos);
                            if (char) {
                                char.socialThreshold = useRandom ? Math.floor(Math.random() * 101) : socialTh;
                                char.needs = {
                                    hunger: 100,
                                    energy: 100,
                                    safety: 100,
                                    social: socialTh
                                };
                            }
                        }
                        if ((i + 1) % spawnBatchSize === 0) {
                            await new Promise(resolve => window.requestAnimationFrame(resolve));
                        }
                    }
                    window.characters = worldMod.characters;
                    window.groupAffinityThreshold = sidebarParams.groupAffinityTh;
                    window.initialAffinityMin = sidebarParams.initialAffinityMin;
                    window.initialAffinityMax = sidebarParams.initialAffinityMax;
                    window.kinshipAffinityBonus = sidebarParams.kinshipAffinityBonus;
                    window.affinityIncreaseRate = sidebarParams.affinityIncreaseRate;
                    window.socialThreshold = socialTh;
                    window.perceptionRange = sidebarParams.perceptionRange;
                    window.hungerEmergencyThreshold = sidebarParams.hungerEmergencyThreshold;
                    window.energyEmergencyThreshold = sidebarParams.energyEmergencyThreshold;
                    window.characterLifespan = sidebarParams.characterLifespan;
                    window.initialAgeMaxRatio = sidebarParams.initialAgeMaxRatio;
                    window.homeReturnHungerLevel = sidebarParams.homeReturnHungerLevel;
                    if (typeof window.applyInitialAgeSpread === 'function') {
                        window.applyInitialAgeSpread(window.characters);
                    }
                    if (typeof window.resetPopulationStats === 'function') {
                        window.resetPopulationStats(window.characters.length);
                    }
                    const charMod = await import('./character.js');
                    if (typeof charMod.Character?.initializeAllRelationships === 'function') {
                        charMod.Character.initializeAllRelationships(window.characters);
                    }
                    if (typeof charMod.Character?.detectGroupsAndElectLeaders === 'function') {
                        charMod.Character.detectGroupsAndElectLeaders(window.characters);
                    }
                    window.simulationRunning = true;
                    window.__simStarting = false;
                    window.__simHasUserStarted = true;
                    _idleDistrictCounts = null; // clear idle preview cache
                    updateToggleBtn();
                    window.renderCharacterList && window.renderCharacterList();
                    renderCharacterDetail();
                };
                await spawnAll();
            } catch (err) {
                console.error('[Simulation] start failed', err);
                window.__simStarting = false;
                updateToggleBtn();
                renderCharacterDetail();
            }
        });
    }

    toggleBtn.style.fontSize = '1.0em';
    toggleBtn.style.fontWeight = 'bold';
    toggleBtn.style.padding = '8px 18px';
    toggleBtn.style.borderRadius = '999px';
    toggleBtn.style.border = '1.5px solid #b7cbe6';
    toggleBtn.style.color = '#1f2f46';
    toggleBtn.style.boxShadow = '0 2px 10px rgba(31,47,70,0.12)';
    toggleBtn.style.cursor = 'pointer';

    updateToggleBtn();

    toggleBtn.onclick = () => {
        if (window.__simStarting) return;
        if (!window.simulationRunning) {
            startFreshSimulation();
        } else {
            finishSimulation();
        }
    };

    controlGroup.appendChild(toggleBtn);
    actionBar.appendChild(controlGroup);
    paramBox.insertBefore(actionBar, paramBox.firstChild);

    rightSidebar.appendChild(paramBox);
}

let leftSidebar = null;
let rightSidebar = null;
// サマリー表で開いている詳細キャラID
let openedCharId = undefined;

function closeOpenedCharacterDetail(root = leftSidebar) {
    openedCharId = null;
    updateSelectedCharacterMarker();
    if (!root) return;
    root.querySelectorAll('.character-summary-row').forEach(row => row.classList.remove('is-open'));
    root.querySelectorAll('.character-detail-row').forEach(row => row.style.display = 'none');
}

function ensureSelectedCharacterMarker() {
    if (typeof document === 'undefined' || !document.body) return null;
    let marker = window.__selectedCharacterMarker;
    if (marker && marker.parentNode) return marker;

    marker = document.createElement('div');
    marker.style.position = 'fixed';
    marker.style.left = '0px';
    marker.style.top = '0px';
    marker.style.zIndex = '1100';
    marker.style.pointerEvents = 'none';
    marker.style.opacity = '0';
    marker.style.transform = 'translate(-50%, -50%) scale(0.9)';
    marker.style.transition = 'opacity 0.15s ease, transform 0.15s ease, left 0.08s linear, top 0.08s linear';
    marker.style.display = 'flex';
    marker.style.flexDirection = 'column';
    marker.style.alignItems = 'center';
    marker.innerHTML =
        `<div style="padding:2px 7px;border-radius:999px;background:rgba(15,23,42,0.88);color:#f8fafc;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.18);">Tracking</div>` +
        `<div style="margin-top:2px;width:20px;height:20px;border:3px solid #f59e0b;border-radius:999px;background:rgba(251,191,36,0.14);box-shadow:0 0 0 2px rgba(255,255,255,0.85) inset, 0 0 10px rgba(245,158,11,0.35);"></div>`;
    document.body.appendChild(marker);
    window.__selectedCharacterMarker = marker;
    return marker;
}

function clearSelectedCharacterSceneHighlight() {
    const prev = window.__selectedSceneCharacter;
    if (!prev?.mesh) {
        window.__selectedSceneCharacter = null;
        return;
    }

    try {
        if (prev.mesh.userData?.__selectionBaseScale) {
            prev.mesh.scale.copy(prev.mesh.userData.__selectionBaseScale);
            delete prev.mesh.userData.__selectionBaseScale;
        }
        prev.mesh.traverse(node => {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach(mat => {
                if (!mat?.emissive || mat.userData?.__selectionPrevEmissive === undefined) return;
                mat.emissive.setHex(mat.userData.__selectionPrevEmissive);
                if (typeof mat.userData.__selectionPrevEmissiveIntensity === 'number' && 'emissiveIntensity' in mat) {
                    mat.emissiveIntensity = mat.userData.__selectionPrevEmissiveIntensity;
                }
                delete mat.userData.__selectionPrevEmissive;
                delete mat.userData.__selectionPrevEmissiveIntensity;
            });
        });
    } catch (e) {}

    window.__selectedSceneCharacter = null;
}

function applySelectedCharacterSceneHighlight(char) {
    if (!char?.mesh) {
        clearSelectedCharacterSceneHighlight();
        return;
    }
    if (String(window.__selectedSceneCharacter?.id) === String(char.id)) return;

    clearSelectedCharacterSceneHighlight();

    try {
        if (!char.mesh.userData) char.mesh.userData = {};
        char.mesh.userData.__selectionBaseScale = char.mesh.scale.clone();
        char.mesh.scale.multiplyScalar(1.14);
        char.mesh.traverse(node => {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach(mat => {
                if (!mat?.emissive) return;
                if (!mat.userData) mat.userData = {};
                if (mat.userData.__selectionPrevEmissive === undefined) {
                    mat.userData.__selectionPrevEmissive = mat.emissive.getHex();
                    mat.userData.__selectionPrevEmissiveIntensity = ('emissiveIntensity' in mat) ? Number(mat.emissiveIntensity || 1) : 1;
                }
                mat.emissive.setHex(0xf59e0b);
                if ('emissiveIntensity' in mat) mat.emissiveIntensity = Math.max(1.35, Number(mat.emissiveIntensity || 1));
            });
        });
    } catch (e) {}

    window.__selectedSceneCharacter = char;
}

function ensureRelationshipMarkerLayer() {
    if (typeof document === 'undefined' || !document.body) return null;
    let layer = window.__selectedRelationshipLayer;
    if (layer && layer.parentNode) return layer;

    layer = document.createElement('div');
    layer.style.position = 'fixed';
    layer.style.inset = '0';
    layer.style.zIndex = '1095';
    layer.style.pointerEvents = 'none';
    document.body.appendChild(layer);
    window.__selectedRelationshipLayer = layer;
    return layer;
}

function clearSelectedRelationshipMarkers() {
    const layer = ensureRelationshipMarkerLayer();
    if (layer) layer.innerHTML = '';
}

function getRelationshipBadgeMeta(relationshipClass) {
    if (relationshipClass === 'bonded') return { icon: '❤', bg: 'rgba(190,24,93,0.88)', border: '#f9a8d4', stroke: '#ec4899' };
    if (relationshipClass === 'ally') return { icon: '🤝', bg: 'rgba(30,64,175,0.88)', border: '#93c5fd', stroke: '#3b82f6' };
    if (relationshipClass === 'acquaintance') return { icon: '•', bg: 'rgba(8,145,178,0.82)', border: '#67e8f9', stroke: '#06b6d4' };
    return { icon: '•', bg: 'rgba(51,65,85,0.84)', border: '#cbd5e1', stroke: '#94a3b8' };
}

function describeRelationshipSnapshot(snapshot) {
    if (!snapshot || Number(snapshot.networkSize || 0) <= 0) {
        return {
            label: 'Isolated',
            blurb: 'No strong ties are visible yet.',
            bg: '#f8fafc',
            color: '#64748b'
        };
    }
    if (Number(snapshot.bondedCount || 0) >= 2 || ((snapshot.bondedCount || 0) >= 1 && (snapshot.allyCount || 0) >= 2)) {
        return {
            label: 'Social hub',
            blurb: 'Multiple strong ties anchor this character in the group.',
            bg: '#fdf2f8',
            color: '#be185d'
        };
    }
    if (Number(snapshot.nearbySupport || 0) >= 2) {
        return {
            label: 'Supported',
            blurb: 'Trusted allies are currently close enough to help.',
            bg: '#eff6ff',
            color: '#1d4ed8'
        };
    }
    if (Number(snapshot.bondedCount || 0) >= 1) {
        return {
            label: 'Bonded',
            blurb: 'A close relationship is shaping this character’s behavior.',
            bg: '#fdf2f8',
            color: '#be185d'
        };
    }
    return {
        label: 'Loose ties',
        blurb: 'They know others, but the network is still shallow.',
        bg: '#f8fafc',
        color: '#475569'
    };
}

function updateSelectedRelationshipMarkers(char, selectedPos = null) {
    const layer = ensureRelationshipMarkerLayer();
    if (!layer || !char || typeof char.getRelationshipSnapshot !== 'function') {
        clearSelectedRelationshipMarkers();
        return null;
    }

    const sourcePos = selectedPos || (typeof char.getScreenPosition === 'function' ? char.getScreenPosition() : null);
    if (!sourcePos) {
        clearSelectedRelationshipMarkers();
        return null;
    }

    const snapshot = char.getRelationshipSnapshot(4);
    layer.innerHTML = '';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(window.innerWidth || 0));
    svg.setAttribute('height', String(window.innerHeight || 0));
    svg.style.position = 'fixed';
    svg.style.inset = '0';
    svg.style.overflow = 'visible';
    layer.appendChild(svg);

    (snapshot?.ties || []).forEach(tie => {
        if (!tie?.other || typeof tie.other.getScreenPosition !== 'function') return;
        const pos = tie.other.getScreenPosition();
        if (!pos) return;
        const meta = getRelationshipBadgeMeta(tie.relationshipClass);

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', String(sourcePos.x));
        line.setAttribute('y1', String(sourcePos.y - 10));
        line.setAttribute('x2', String(pos.x));
        line.setAttribute('y2', String(pos.y - 6));
        line.setAttribute('stroke', meta.stroke);
        line.setAttribute('stroke-width', String((1.5 + Math.max(0, tie.affinity - 40) / 30).toFixed(2)));
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('opacity', String(Math.max(0.32, Math.min(0.9, tie.affinity / 100))));
        if (tie.relationshipClass === 'ally' || tie.relationshipClass === 'acquaintance') {
            line.setAttribute('stroke-dasharray', tie.relationshipClass === 'ally' ? '6 5' : '3 5');
        }
        svg.appendChild(line);

        const halo = document.createElementNS(svgNS, 'circle');
        halo.setAttribute('cx', String(pos.x));
        halo.setAttribute('cy', String(pos.y - 6));
        halo.setAttribute('r', String(tie.relationshipClass === 'bonded' ? 11 : 9));
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', meta.stroke);
        halo.setAttribute('stroke-width', '2');
        halo.setAttribute('opacity', '0.45');
        svg.appendChild(halo);

        const badge = document.createElement('div');
        badge.style.position = 'fixed';
        badge.style.left = `${pos.x}px`;
        badge.style.top = `${pos.y - 28}px`;
        badge.style.transform = 'translate(-50%, -50%)';
        badge.style.padding = '2px 7px';
        badge.style.borderRadius = '999px';
        badge.style.background = meta.bg;
        badge.style.border = `1px solid ${meta.border}`;
        badge.style.color = '#fff';
        badge.style.fontSize = '11px';
        badge.style.fontWeight = '700';
        badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
        badge.textContent = `${meta.icon} ${tie.other.id}`;
        badge.title = `${tie.relationshipClass} · affinity ${Math.round(tie.affinity)} · dist ${tie.distance}`;
        layer.appendChild(badge);
    });

    return snapshot;
}

function updateSelectedCharacterMarker() {
    const marker = ensureSelectedCharacterMarker();
    if (!marker) return;

    const selectedId = openedCharId != null ? String(openedCharId) : '';
    if (!selectedId || !Array.isArray(window.characters)) {
        clearSelectedCharacterSceneHighlight();
        clearSelectedRelationshipMarkers();
        marker.style.opacity = '0';
        marker.style.transform = 'translate(-50%, -50%) scale(0.9)';
        return;
    }

    const char = window.characters.find(c => String(c?.id) === selectedId && c?.state !== 'dead');
    if (!char || typeof char.getScreenPosition !== 'function') {
        clearSelectedCharacterSceneHighlight();
        clearSelectedRelationshipMarkers();
        marker.style.opacity = '0';
        marker.style.transform = 'translate(-50%, -50%) scale(0.9)';
        return;
    }

    applySelectedCharacterSceneHighlight(char);

    const screenPos = char.getScreenPosition();
    if (!screenPos) {
        clearSelectedRelationshipMarkers();
        marker.style.opacity = '0';
        marker.style.transform = 'translate(-50%, -50%) scale(0.9)';
        return;
    }

    const snapshot = updateSelectedRelationshipMarkers(char, screenPos) || (typeof char.getRelationshipSnapshot === 'function' ? char.getRelationshipSnapshot(4) : null);
    const socialDescriptor = describeRelationshipSnapshot(snapshot);

    marker.style.left = `${screenPos.x}px`;
    marker.style.top = `${screenPos.y - 34}px`;
    marker.style.opacity = '1';
    marker.style.transform = 'translate(-50%, -50%) scale(1)';
    const label = marker.firstElementChild;
    if (label) label.textContent = `ID ${selectedId} · ${socialDescriptor.label}`;
}

if (window.__selectedCharacterMarkerInterval) clearInterval(window.__selectedCharacterMarkerInterval);
window.__selectedCharacterMarkerInterval = setInterval(updateSelectedCharacterMarker, 120);

// Lightweight population pulse history for compact trend visualization.
if (!window.__populationPulseHistory) window.__populationPulseHistory = [];
if (!window.__populationMetricHistory) window.__populationMetricHistory = [];

function pushPopulationPulseSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const arr = window.__populationPulseHistory;
    const now = Number(snapshot.t || Date.now());
    const last = arr[arr.length - 1];
    // Prevent accidental duplicate sampling within the same frame/second.
    if (last && now - last.t < 800) return;
    arr.push({
        t: now,
        alive: Number(snapshot.alive || 0),
        totalBorn: Number(snapshot.totalBorn || 0),
        deaths: Number(snapshot.deaths || 0),
        avgEnergy: Number(snapshot.avgEnergy || 0)
    });
    if (arr.length > 180) arr.shift(); // Keep about 3 minutes at 1 Hz.
}

function pushPopulationMetricSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const arr = window.__populationMetricHistory;
    const now = Number(snapshot.t || Date.now());
    const last = arr[arr.length - 1];
    if (last && now - last.t < 800) return;
    arr.push({ ...snapshot, t: now });
    if (arr.length > 180) arr.shift();
}

function computePerMinuteDelta(history, key, windowMs = 60000) {
    if (!Array.isArray(history) || history.length < 2) return 0;
    const latest = history[history.length - 1];
    const targetTime = latest.t - windowMs;
    let base = history[0];
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].t <= targetTime) {
            base = history[i];
            break;
        }
    }
    const dtMs = Math.max(1, latest.t - base.t);
    const dv = Number(latest[key] || 0) - Number(base[key] || 0);
    return dv * (60000 / dtMs);
}

function createSparklineSVG(values, color, width = 86, height = 24) {
    if (!Array.isArray(values) || values.length === 0) {
        return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1e-6, max - min);
    const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
    const points = values.map((v, i) => {
        const x = 2 + i * step;
        const y = height - 2 - ((v - min) / span) * (height - 4);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return (
        `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
        `<rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="rgba(255,255,255,0.78)"></rect>` +
        `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>` +
        `</svg>`
    );
}

function createTrendChartSVG(values, color = '#2563eb', width = 460, height = 220) {
    if (!Array.isArray(values) || values.length === 0) {
        return `<div style="padding:24px;text-align:center;color:#94a3b8;">No metric history yet.</div>`;
    }
    const padL = 36, padR = 10, padT = 12, padB = 28;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1e-6, max - min);
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const step = values.length > 1 ? innerW / (values.length - 1) : 0;
    const points = values.map((v, i) => {
        const x = padL + i * step;
        const y = padT + innerH - ((v - min) / span) * innerH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    const gridYs = [0, 0.5, 1].map(r => {
        const y = padT + innerH * r;
        return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="rgba(148,163,184,0.35)" stroke-dasharray="3 4"></line>`;
    }).join('');
    return (
        `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
            `<rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#f8fbff"></rect>` +
            gridYs +
            `<line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="#cbd5e1"></line>` +
            `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="#cbd5e1"></line>` +
            `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>` +
            `<text x="8" y="${padT + 8}" fill="#64748b" font-size="11">${max.toFixed(1)}</text>` +
            `<text x="8" y="${height - padB + 4}" fill="#64748b" font-size="11">${min.toFixed(1)}</text>` +
            `<text x="${padL}" y="${height - 8}" fill="#94a3b8" font-size="11">3m ago</text>` +
            `<text x="${width / 2 - 16}" y="${height - 8}" fill="#94a3b8" font-size="11">90s</text>` +
            `<text x="${width - 34}" y="${height - 8}" fill="#94a3b8" font-size="11">now</text>` +
        `</svg>`
    );
}

function ensureMetricDialog() {
    let dlg = document.getElementById('population-metric-dialog');
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.id = 'population-metric-dialog';
    dlg.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,0.45);z-index:40;padding:20px;';
    dlg.innerHTML =
        `<div id="population-metric-panel" style="width:min(880px,94vw);max-height:84vh;overflow:auto;background:#fff;border:1px solid #dbeafe;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,0.25);padding:14px;">` +
            `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">` +
                `<div id="population-metric-title" style="font-weight:800;color:#1e3a8a;font-size:1.02em;">Metric trend</div>` +
                `<span style="flex:1;"></span>` +
                `<button type="button" id="population-metric-close" style="border:none;background:#eff6ff;color:#1d4ed8;border-radius:8px;padding:6px 10px;cursor:pointer;font-weight:700;">Close</button>` +
            `</div>` +
            `<div id="population-metric-meta" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"></div>` +
            `<div id="population-metric-chart"></div>` +
        `</div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.style.display = 'none';
    });
    dlg.querySelector('#population-metric-close').addEventListener('click', () => {
        dlg.style.display = 'none';
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dlg.style.display !== 'none') dlg.style.display = 'none';
    });
    return dlg;
}

function openPopulationMetricDialog(metricOrGroup, metricLabel, color = '#2563eb') {
    const dlg = ensureMetricDialog();
    const history = Array.isArray(window.__populationMetricHistory) ? window.__populationMetricHistory : [];

    if (metricOrGroup && Array.isArray(metricOrGroup.series)) {
        dlg.querySelector('#population-metric-title').textContent = `${metricOrGroup.title} trends`;
        dlg.querySelector('#population-metric-meta').innerHTML = [
            ['Window', `${history.length}s`],
            ['Series', metricOrGroup.series.length],
            ['Updated', history.length ? 'live' : 'waiting']
        ].map(([k, v]) => `<div style="background:#f8fbff;border:1px solid #dbeafe;border-radius:10px;padding:6px 10px;"><div style="font-size:0.75em;color:#64748b;">${k}</div><div style="font-weight:800;color:#0f172a;">${v}</div></div>`).join('');
        dlg.querySelector('#population-metric-chart').innerHTML =
            `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">` +
            metricOrGroup.series.map(s => {
                const values = history.map(h => Number(h[s.key] || 0));
                const latest = values.length ? values[values.length - 1] : 0;
                const delta = values.length >= 2 ? values[values.length - 1] - values[0] : 0;
                return `<div style="border:1px solid #dbeafe;border-radius:12px;padding:8px;background:#ffffff;">` +
                    `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:6px;">` +
                        `<span style="font-weight:700;color:#334155;">${s.label}</span>` +
                        `<span style="font-size:0.82em;color:${s.color};font-weight:700;">${latest.toFixed(1)} ${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'}</span>` +
                    `</div>` +
                    createTrendChartSVG(values, s.color, 260, 120) +
                `</div>`;
            }).join('') +
            `</div>`;
        dlg.style.display = 'flex';
        return;
    }

    const metricKey = metricOrGroup;
    const values = history.map(h => Number(h[metricKey] || 0));
    const latest = values.length ? values[values.length - 1] : 0;
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const delta = values.length >= 2 ? (values[values.length - 1] - values[0]) : 0;
    dlg.querySelector('#population-metric-title').textContent = `${metricLabel} trend`;
    dlg.querySelector('#population-metric-meta').innerHTML = [
        ['Current', latest],
        ['Min', min],
        ['Max', max],
        ['Δ 3m', delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)]
    ].map(([k, v]) => `<div style="background:#f8fbff;border:1px solid #dbeafe;border-radius:10px;padding:6px 10px;"><div style="font-size:0.75em;color:#64748b;">${k}</div><div style="font-weight:800;color:#0f172a;">${typeof v === 'number' ? v.toFixed(1) : v}</div></div>`).join('');
    dlg.querySelector('#population-metric-chart').innerHTML = createTrendChartSVG(values, color);
    dlg.style.display = 'flex';
}

// --- Society Phase derivation ---
function getSocietyPhase(pop, netRate, starving, conflictPairs, initialPop, elapsedSec) {
    if (pop === 0) return { phase: 'Extinct',    icon: '💀', color: '#7f1d1d', bg: '#fef2f2' };
    if (pop <= 2)  return { phase: 'Last Stand', icon: '🕯️', color: '#9a1234', bg: '#fff1f2' };
    const starvRatio = starving / pop;
    const conflRatio = conflictPairs / Math.max(1, pop);
    if (pop <= 4 && netRate < -0.5)  return { phase: 'Collapse',     icon: '📉', color: '#b91c1c', bg: '#fef2f2' };
    if (starvRatio > 0.4)            return { phase: 'Famine',       icon: '☠️', color: '#92400e', bg: '#fffbeb' };
    if (conflRatio > 0.3)            return { phase: 'Conflict',     icon: '⚔️', color: '#c2410c', bg: '#fff7ed' };
    if (netRate < -0.3 && pop < initialPop * 0.8) return { phase: 'Decline',  icon: '🌑', color: '#475569', bg: '#f8fafc' };
    if (netRate > 0.5 && pop > initialPop * 1.3)  return { phase: 'Flourishing', icon: '🌟', color: '#15803d', bg: '#f0fdf4' };
    if (netRate > 0.15) return { phase: 'Growth',   icon: '📈', color: '#1d4ed8', bg: '#eff6ff' };
    if (elapsedSec < 120) return { phase: 'Founding', icon: '🌱', color: '#7c3aed', bg: '#faf5ff' };
    return { phase: 'Stable', icon: '🏘️', color: '#1e40af', bg: '#f0f9ff' };
}

function createPopulationDetailCard(title, icon, rows, groupKey = null) {
    const trigger = groupKey
        ? `<button type="button" class="population-group-trigger" data-group-key="${groupKey}" style="margin-left:auto;border:none;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:3px 8px;cursor:pointer;font-size:0.78em;font-weight:700;">Trends ↗</button>`
        : '';
    return (
        `<section class="population-detail-card">` +
            `<div class="population-detail-card-header" style="display:flex;align-items:center;gap:6px;">` +
                `<span class="population-detail-card-icon">${icon}</span>` +
                `<span class="population-detail-card-title">${title}</span>` +
                trigger +
            `</div>` +
            `<div class="population-detail-card-body">` +
                rows.map(row => row.html || (
                    `<div class="population-detail-row">` +
                        `<span class="population-detail-label">${row.label}</span>` +
                        `<span class="population-detail-value">${row.value}</span>` +
                    `</div>`
                )).join('') +
            `</div>` +
        `</section>`
    );
}

function createPopulationNeedRow(label, value, color) {
    const numericValue = Math.max(0, Math.min(100, Number(value) || 0));
    const body =
        `<div class="population-need-top">` +
            `<span class="population-detail-label">${label}</span>` +
            `<span style="display:flex;align-items:center;gap:6px;"><span class="population-detail-value">${Math.round(numericValue)}</span></span>` +
        `</div>` +
        `<div class="population-need-bar-track">` +
            `<div class="population-need-bar-fill" style="width:${numericValue}%;background:${color};"></div>` +
        `</div>`;
    return {
        html: `<div class="population-need-row">${body}</div>`
    };
}

function computeSocietySocialMetrics(alive = []) {
    const living = Array.isArray(alive) ? alive.filter(c => c && c.state !== 'dead') : [];
    if (!living.length) {
        return {
            avgSupportPct: 0,
            bondedChars: 0,
            bondedRatePct: 0,
            allyChars: 0,
            alliesRatePct: 0,
            nearbySupportChars: 0,
            nearbyRatePct: 0
        };
    }

    const snapshots = living.map(char => {
        if (typeof char?.getRelationshipSnapshot !== 'function') return null;
        try {
            return char.getRelationshipSnapshot(6);
        } catch (e) {
            return null;
        }
    }).filter(Boolean);

    if (!snapshots.length) {
        return {
            avgSupportPct: 0,
            bondedChars: 0,
            bondedRatePct: 0,
            allyChars: 0,
            alliesRatePct: 0,
            nearbySupportChars: 0,
            nearbyRatePct: 0
        };
    }

    const count = snapshots.length;
    const avgSupportPct = (snapshots.reduce((sum, snapshot) => sum + Number(snapshot.supportScore || 0), 0) / count) * 100;
    const bondedChars = snapshots.filter(snapshot => Number(snapshot.bondedCount || 0) > 0).length;
    const allyChars = snapshots.filter(snapshot => Number(snapshot.allyCount || 0) > 0).length;
    const nearbySupportChars = snapshots.filter(snapshot => Number(snapshot.nearbySupport || 0) > 0).length;

    return {
        avgSupportPct: Number(avgSupportPct.toFixed(1)),
        bondedChars,
        bondedRatePct: Number(((bondedChars / count) * 100).toFixed(1)),
        allyChars,
        alliesRatePct: Number(((allyChars / count) * 100).toFixed(1)),
        nearbySupportChars,
        nearbyRatePct: Number(((nearbySupportChars / count) * 100).toFixed(1))
    };
}

function createPopulationDetailsHTML(metrics) {
    window.__populationMetricGroups = {
        population: {
            title: 'Population mix',
            series: [
                { key: 'alive', label: 'Alive', color: '#2563eb' },
                { key: 'childCount', label: 'Child', color: '#7c3aed' },
                { key: 'youngCount', label: 'Young', color: '#0ea5e9' },
                { key: 'adultCount', label: 'Adult', color: '#16a34a' },
                { key: 'elderCount', label: 'Elder', color: '#f59e0b' },
                { key: 'dead', label: 'Dead', color: '#dc2626' }
            ]
        },
        lifecycle: {
            title: 'Lifecycle',
            series: [
                { key: 'avgAge', label: 'Avg age', color: '#0f766e' },
                { key: 'maxAge', label: 'Max age', color: '#334155' },
                { key: 'starvingNow', label: 'Starving now', color: '#f97316' },
                { key: 'oldAgeDeaths', label: 'Old age', color: '#475569' },
                { key: 'starvationDeaths', label: 'Starvation deaths', color: '#b45309' }
            ]
        },
        generation: {
            title: 'Generation',
            series: [
                { key: 'maxGen', label: 'Max gen', color: '#16a34a' },
                { key: 'avgGen', label: 'Avg gen', color: '#22c55e' }
            ]
        },
        traits: {
            title: 'Traits',
            series: [
                { key: 'avgBrav', label: 'Bravery', color: '#f59e0b' },
                { key: 'avgDili', label: 'Diligence', color: '#f97316' },
                { key: 'avgSoci', label: 'Sociality', color: '#a855f7' },
                { key: 'avgCuri', label: 'Curiosity', color: '#3b82f6' },
                { key: 'avgReso', label: 'Resourcefulness', color: '#14b8a6' },
                { key: 'avgResi', label: 'Resilience', color: '#22c55e' }
            ]
        },
        needs: {
            title: 'Needs',
            series: [
                { key: 'avgHun', label: 'Hunger', color: '#f59e0b' },
                { key: 'avgEng', label: 'Energy', color: '#3b82f6' },
                { key: 'avgSaf', label: 'Safety', color: '#22c55e' },
                { key: 'avgSoc', label: 'Social', color: '#a855f7' }
            ]
        },
        social: {
            title: 'Social ties',
            series: [
                { key: 'avgSupportPct', label: 'Support %', color: '#7c3aed' },
                { key: 'bondedRatePct', label: 'Bonded %', color: '#db2777' },
                { key: 'alliesRatePct', label: 'Allies %', color: '#2563eb' },
                { key: 'nearbyRatePct', label: 'Nearby %', color: '#0f766e' }
            ]
        }
    };
    return (
        `<div class="population-detail-grid">` +
            createPopulationDetailCard('Population', '👥', [
                { label: 'Alive', value: metrics.alive },
                { label: 'Child', value: metrics.childCount },
                { label: 'Young', value: metrics.youngCount },
                { label: 'Adult', value: metrics.adultCount },
                { label: 'Elder', value: metrics.elderCount },
                { label: 'Dead', value: metrics.dead }
            ], 'population') +
            createPopulationDetailCard('Lifecycle', '⏳', [
                { label: 'Avg age', value: `${metrics.avgAge}s` },
                { label: 'Max age', value: `${metrics.maxAge}s` },
                { label: 'Starving now', value: metrics.starvingNow },
                { label: 'Old age', value: metrics.oldAgeDeaths },
                { label: 'Starvation deaths', value: metrics.starvationDeaths }
            ], 'lifecycle') +
            createPopulationDetailCard('Generation', '🌱', [
                { label: 'Max gen', value: metrics.maxGen },
                { label: 'Avg gen', value: metrics.avgGen }
            ], 'generation') +
            createPopulationDetailCard('Traits', '🧠', [
                { label: 'Bravery',         value: metrics.avgBrav },
                { label: 'Diligence',       value: metrics.avgDili },
                { label: 'Sociality',       value: metrics.avgSoci },
                { label: 'Curiosity',       value: metrics.avgCuri },
                { label: 'Resourcefulness', value: metrics.avgReso },
                { label: 'Resilience',      value: metrics.avgResi }
            ], 'traits') +
            createPopulationDetailCard('Needs', '⚡', [
                createPopulationNeedRow('Hunger', metrics.avgHun, 'linear-gradient(90deg, #f59e0b 0%, #f97316 100%)'),
                createPopulationNeedRow('Energy', metrics.avgEng, 'linear-gradient(90deg, #3b82f6 0%, #06b6d4 100%)'),
                createPopulationNeedRow('Safety', metrics.avgSaf, 'linear-gradient(90deg, #22c55e 0%, #10b981 100%)'),
                createPopulationNeedRow('Social', metrics.avgSoc, 'linear-gradient(90deg, #a855f7 0%, #ec4899 100%)')
            ], 'needs') +
            createPopulationDetailCard('Social ties', '🤝', [
                { label: 'Support', value: `${Number(metrics.avgSupportPct || 0).toFixed(1)}%` },
                { label: 'Bonded', value: `${metrics.bondedChars} (${Number(metrics.bondedRatePct || 0).toFixed(1)}%)` },
                { label: 'Allies', value: `${metrics.allyChars} (${Number(metrics.alliesRatePct || 0).toFixed(1)}%)` },
                { label: 'Nearby', value: `${metrics.nearbySupportChars} (${Number(metrics.nearbyRatePct || 0).toFixed(1)}%)` }
            ], 'social') +
        `</div>`
    );
}

// Event type → left-border color
const _etlKindColor = {
    birth:    '#4ade80',
    death:    '#f87171',
    famine:   '#ef4444',
    recovery: '#86efac',
    conflict: '#fb923c',
    peace:    '#6ee7b7',
    season:   '#fbbf24',
    new_gen:     '#c084fc',
    gen_summary: '#a78bfa',
    peak:     '#34d399',
    warning:  '#facc15',
    start:    '#60a5fa',
    event:    '#94a3b8'
};

function createTimelineHandleHTML(ev) {
    const dot = ev.kind === 'birth'
        ? `<span style="color:#4ade80;font-size:1.1em;line-height:1;">●</span>&nbsp;`
        : ev.kind === 'death'
        ? `<span style="color:#f87171;font-size:1.1em;line-height:1;">●</span>&nbsp;`
        : `<span>${ev.icon}</span>&thinsp;`;
    return dot + `<span style="font-size:0.9em;">${ev.text}</span>`;
}

function createTimelineEventHTML(ev) {
    const borderColor = _etlKindColor[ev.kind] || '#64748b';
    const timeStr = _etlFormatTime(ev.t);
    return `<div style="display:flex;align-items:flex-start;gap:7px;padding:4px 6px 4px 8px;` +
        `border-left:3px solid ${borderColor};background:rgba(255,255,255,0.04);border-radius:0 4px 4px 0;margin-bottom:2px;">` +
        `<span style="font-size:1.0em;line-height:1.6;flex-shrink:0;">${ev.icon}</span>` +
        `<div style="flex:1;min-width:0;">` +
            `<div style="color:#e2e8f0;font-size:0.88em;">${ev.text}</div>` +
            `<div style="color:#64748b;font-size:0.76em;">${timeStr}</div>` +
        `</div>` +
    `</div>`;
}

// --- Unified Event Timeline ---
if (!window.__eventLog) window.__eventLog = [];
let _lastSeenBirthT = 0;
let _lastSeenDeathT = 0;
let _drawerExpanded = false;

function syncLifecycleEventsFromStats() {
    const stats = (typeof window.getPopulationStats === 'function') ? window.getPopulationStats() : null;
    if (!stats || !Array.isArray(window.__eventLog)) return;
    const lb = stats.latestBirth;
    if (lb && lb.t && lb.t > _lastSeenBirthT) {
        _lastSeenBirthT = lb.t;
        const id = lb.childId !== undefined ? `#${lb.childId}` : '';
        const gen = lb.generation !== undefined ? ` (G${lb.generation})` : '';
        const pText = (lb.parentIds && lb.parentIds.length >= 2)
            ? ` — #${lb.parentIds[0]} × #${lb.parentIds[1]}` : '';
        const alreadyLogged = window.__eventLog.some(ev => ev && ev.kind === 'birth' && ev.t === lb.t);
        if (!alreadyLogged) {
            window.__eventLog.unshift({ t: lb.t, icon: '👶', text: `Born ${id}${gen}${pText}`, kind: 'birth' });
            if (window.__eventLog.length > 60) window.__eventLog.pop();
        }
    }
    const ld = stats.latestDeath;
    if (ld && ld.t && ld.t > _lastSeenDeathT) {
        _lastSeenDeathT = ld.t;
        const id = ld.id !== undefined ? `#${ld.id}` : '';
        const gen = ld.generation !== undefined ? ` G${ld.generation}` : '';
        const age = ld.age !== undefined ? `, ${Math.round(ld.age)}s` : '';
        const cause = ld.cause ? ` — ${ld.cause.replace(/_/g, ' ')}` : '';
        const alreadyLogged = window.__eventLog.some(ev => ev && ev.kind === 'death' && ev.t === ld.t);
        if (!alreadyLogged) {
            window.__eventLog.unshift({ t: ld.t, icon: '💀', text: `Died ${id}${gen}${age}${cause}`, kind: 'death' });
            if (window.__eventLog.length > 60) window.__eventLog.pop();
        }
    }
}

function _etlFormatTime(t) {
    const d = new Date(t);
    return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function initEventTimelineDrawer() {
    if (document.getElementById('event-timeline-drawer')) return;
    const drawer = document.createElement('div');
    drawer.id = 'event-timeline-drawer';
    drawer.style.cssText = [
        'position:fixed',
        'bottom:0',
        'left:50%',
        'transform:translateX(-50%)',
        'width:min(780px,80vw)',
        'z-index:15',
        'border-radius:12px 12px 0 0',
        'overflow:hidden',
        'box-shadow:0 -4px 20px rgba(0,0,0,0.32)',
        'font-family:Inter,sans-serif',
        'font-size:0.82em',
        'pointer-events:auto'
    ].join(';');
    drawer.innerHTML =
        `<div id="etl-handle" style="display:flex;align-items:center;gap:8px;padding:6px 14px;` +
        `background:linear-gradient(90deg,#1e3a5f 0%,#1a2e4a 100%);color:#c8dcf0;cursor:pointer;` +
        `height:36px;box-sizing:border-box;user-select:none;">` +
            `<span style="font-size:0.94em;font-weight:700;letter-spacing:0.02em;white-space:nowrap;">📋 Timeline</span>` +
            `<span id="etl-counts" style="font-size:0.82em;font-weight:600;background:rgba(255,255,255,0.1);border-radius:4px;padding:1px 5px;white-space:nowrap;"></span>` +
            `<span id="etl-latest" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;` +
            `font-size:0.88em;color:#a8c4df;padding-left:8px;"></span>` +
            `<span id="etl-toggle-icon" style="font-size:0.88em;transition:transform 200ms;">▲</span>` +
        `</div>` +
        `<div id="etl-body" style="display:none;background:rgba(14,24,42,0.96);` +
        `backdrop-filter:blur(6px);max-height:200px;overflow-y:auto;padding:6px 8px;">` +
            `<div id="etl-list" style="display:flex;flex-direction:column;gap:2px;"></div>` +
        `</div>`;
    document.body.appendChild(drawer);
    document.getElementById('etl-handle').addEventListener('click', () => {
        _drawerExpanded = !_drawerExpanded;
        const body = document.getElementById('etl-body');
        const icon = document.getElementById('etl-toggle-icon');
        if (body) body.style.display = _drawerExpanded ? 'block' : 'none';
        if (icon) icon.style.transform = _drawerExpanded ? 'rotate(180deg)' : '';
        renderEventTimeline();
    });
}

function renderEventTimeline() {
    syncLifecycleEventsFromStats();
    const events = Array.isArray(window.__eventLog) ? window.__eventLog.slice(0, 50) : [];

    const latestEl = document.getElementById('etl-latest');
    const listEl = document.getElementById('etl-list');
    const countsEl = document.getElementById('etl-counts');
    if (!latestEl) return;

    // Update birth/death count badge from population stats
    if (countsEl) {
        const stats = typeof window.getPopulationStats === 'function' ? window.getPopulationStats() : null;
        const births = stats ? stats.births : 0;
        const deaths = stats ? stats.deaths : 0;
        countsEl.innerHTML = `<span style="color:#4ade80;">↑${births}</span>&thinsp;<span style="color:#f87171;">↓${deaths}</span>`;
    }

    if (events.length === 0) {
        latestEl.textContent = 'Waiting for first event…';
        if (listEl) listEl.innerHTML = `<div style="padding:16px;color:#64748b;text-align:center;font-style:italic;">The colony hasn't started yet.</div>`;
        return;
    }
    latestEl.innerHTML = createTimelineHandleHTML(events[0]);
    if (_drawerExpanded && listEl) {
        listEl.innerHTML = events.map(createTimelineEventHTML).join('');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    leftSidebar = document.getElementById('sidebar-left');
    rightSidebar = document.getElementById('sidebar-right');
    // サイドバーのUIをゲーム画面に溶け込むよう調整（幅を拡張）
    if (leftSidebar) {
        leftSidebar.style.width = 'min(440px, 34vw)';
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
    initEventTimelineDrawer();
});
console.log('[sidebar.js] loaded');
// グローバルから呼び出せるように
window.renderCharacterList = renderCharacterList;
window.renderCharacterDetail = renderCharacterDetail;
window.selectCharacterById = function selectCharacterById(id, options = {}) {
    if (id === undefined || id === null) return;
    openedCharId = String(id);
    if (typeof window.renderCharacterList === 'function') window.renderCharacterList();
    if (typeof updateSelectedCharacterMarker === 'function') updateSelectedCharacterMarker();
    if (!options.skipCameraFocus && typeof window.focusCharacterInView === 'function') {
        window.focusCharacterInView(id);
    }

    if (!options.silentScroll) {
        requestAnimationFrame(() => {
            const rows = leftSidebar?.querySelectorAll?.('.character-summary-row') || [];
            rows.forEach(row => {
                const rowId = row.children?.[0]?.textContent;
                if (String(rowId) === String(id)) {
                    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            });
        });
    }
};

function renderCharacterList() {
    // console.log('[sidebar.js] window.characters:', window.characters); // ←デバッグ用ログを一時停止
    if (!leftSidebar) return;
    // If the user is currently editing an input inside the right sidebar,
    // avoid re-rendering the character list which may toggle detail panels
    // and steal focus from the input.
    try {
        const active = document.activeElement;
        if (window.simulationRunning && active && rightSidebar && rightSidebar.contains(active) &&
            (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
            return; // avoid stealing focus only while the sim is actively running
        }
    } catch (e) {}
    const chars = Array.isArray(window.characters) ? window.characters : [];
    const districtMode = Number(window.sidebarParams?.districtMode || window.districtMode || 1);
    const activeDistrictIndex = Number(window.sidebarParams?.activeDistrictIndex ?? window.activeDistrictIndex ?? 0);
    const isDistrictFiltered = districtMode > 1 && typeof window.getDistrictRuntime === 'function';
    const visibleChars = isDistrictFiltered
        ? chars.filter(char => {
            if (!char?.gridPos) return false;
            const runtime = window.getDistrictRuntime(char.gridPos);
            return Number(runtime?.index ?? char.districtIndex ?? 0) === activeDistrictIndex;
        })
        : chars;
    const popStats = (typeof window.getPopulationStats === 'function') ? window.getPopulationStats() : null;
    const hasPopulationHistory = !!(popStats && (
        Number(popStats.initialPopulation || 0) > 0 ||
        Number(popStats.births || 0) > 0 ||
        Number(popStats.deaths || 0) > 0
    ));
    const hasUserStarted = !!window.__simHasUserStarted;
    const districtSpec = districtMode >= 16
        ? { recommended: 80, max: 120 }
        : districtMode >= 4
            ? { recommended: 48, max: 80 }
            : { recommended: 20, max: 50 };
    const configuredPopulation = Math.max(
        5,
        Math.min(districtSpec.max, Number(window.sidebarParams?.charNum) || districtSpec.recommended)
    );
    const idlePreviewMode = !window.simulationRunning && !hasUserStarted;
    // 詳細カードが残っている場合は消去し、タイトルのみ表示
    leftSidebar.innerHTML = '';
    // タイトルを追加
    const listHeader = document.createElement('div');
    listHeader.className = 'character-list-header';
    const isFinishedSnapshot = !window.simulationRunning && hasUserStarted;
    const contextLabel = idlePreviewMode
        ? `Configure on the right · press Start · pop ${configuredPopulation} · D${districtMode}`
        : isFinishedSnapshot
            ? (isDistrictFiltered
                ? `Final snapshot · D${activeDistrictIndex + 1} from the last run · next start ${configuredPopulation}`
                : `Final snapshot · results from the last run · next start ${configuredPopulation}`)
            : (isDistrictFiltered
                ? `Showing D${activeDistrictIndex + 1} characters only · global metrics stay above`
                : 'Showing the whole society · baseline overview');
    listHeader.innerHTML =
        `<div>` +
            `<div class="character-list-kicker">Observation</div>` +
            `<h3 class="character-list-title">Society Overview</h3>` +
            `<div style="margin-top:2px;font-size:0.8em;color:#64748b;font-weight:600;">${contextLabel}</div>` +
        `</div>`;
    leftSidebar.appendChild(listHeader);

    // --- 母集団統計パネル ---
    if (chars.length > 0 || hasPopulationHistory || idlePreviewMode) {
        const alive = chars.filter(c => c.state !== 'dead');
        const dead = popStats ? Number(popStats.deaths || 0) : (chars.length - alive.length);
        const totalBorn = popStats
            ? Number(popStats.initialPopulation || 0) + Number(popStats.births || 0)
            : chars.length;
        const getLifeStage = (c) => c.getLifeStage ? c.getLifeStage() : (c.isChild ? 'child' : 'adult');
        const childCount = alive.filter(c => getLifeStage(c) === 'child').length;
        const youngCount = alive.filter(c => getLifeStage(c) === 'young').length;
        const adultCount = alive.filter(c => getLifeStage(c) === 'adult').length;
        const elderCount = alive.filter(c => getLifeStage(c) === 'elder').length;
        const maxGen   = chars.reduce((m, c) => Math.max(m, c.generation || 0), 0);
        const avgGen   = alive.length ? (alive.reduce((s, c) => s + (c.generation || 0), 0) / alive.length).toFixed(1) : '—';
        const avgAge   = alive.length ? (alive.reduce((s, c) => s + (c.age || 0), 0) / alive.length).toFixed(1) : '—';
        const maxAge   = alive.length ? Math.max(...alive.map(c => Number(c.age || 0))).toFixed(1) : '—';
        const deathsByCause = popStats?.deathsByCause || {};
        const starvationDeaths = Number(deathsByCause.starvation || 0) + Number(deathsByCause.starved || 0);
        const oldAgeDeaths = Number(deathsByCause.old_age || 0) + Number(deathsByCause.oldage || 0) + Number(deathsByCause.oldAge || 0) + Number(deathsByCause['old age'] || 0);
        const unknownDeaths = Number(deathsByCause.unknown || 0);
        const starvingNow = alive.filter(c => (c._starvationTimer || 0) > 0).length;
        const avgBrav  = alive.length ? (alive.reduce((s, c) => s + (c.personality?.bravery         || 0), 0) / alive.length).toFixed(2) : '—';
        const avgDili  = alive.length ? (alive.reduce((s, c) => s + (c.personality?.diligence        || 0), 0) / alive.length).toFixed(2) : '—';
        const avgSoci  = alive.length ? (alive.reduce((s, c) => s + (c.personality?.sociality        || 0), 0) / alive.length).toFixed(2) : '—';
        const avgCuri  = alive.length ? (alive.reduce((s, c) => s + (c.personality?.curiosity        || 0), 0) / alive.length).toFixed(2) : '—';
        const avgReso  = alive.length ? (alive.reduce((s, c) => s + (c.personality?.resourcefulness  || 0), 0) / alive.length).toFixed(2) : '—';
        const avgResi  = alive.length ? (alive.reduce((s, c) => s + (c.personality?.resilience       || 0), 0) / alive.length).toFixed(2) : '—';
        const avgHun   = alive.length ? (alive.reduce((s, c) => s + (c.needs?.hunger  || 0), 0) / alive.length).toFixed(0) : '—';
        const avgEng   = alive.length ? (alive.reduce((s, c) => s + (c.needs?.energy  || 0), 0) / alive.length).toFixed(0) : '—';
        const avgSaf   = alive.length ? (alive.reduce((s, c) => s + (c.needs?.safety  || 0), 0) / alive.length).toFixed(0) : '—';
        const avgSoc   = alive.length ? (alive.reduce((s, c) => s + (c.needs?.social  || 0), 0) / alive.length).toFixed(0) : '—';
        const socialMetrics = computeSocietySocialMetrics(alive);
        const criticalEnergyCount = alive.filter(c => Number(c.needs?.energy || 0) < 20).length;
        const criticalHungerCount = alive.filter(c => Number(c.needs?.hunger || 0) < 20).length;

        if (!idlePreviewMode) pushPopulationPulseSnapshot({
            t: Date.now(),
            alive: alive.length,
            totalBorn,
            deaths: dead,
            avgEnergy: Number(avgEng) || 0
        });
        if (!idlePreviewMode) pushPopulationMetricSnapshot({
            t: Date.now(),
            alive: alive.length,
            totalBorn,
            dead,
            childCount,
            youngCount,
            adultCount,
            elderCount,
            avgAge: Number(avgAge) || 0,
            maxAge: Number(maxAge) || 0,
            starvingNow,
            starvationDeaths,
            oldAgeDeaths,
            maxGen,
            avgGen: Number(avgGen) || 0,
            avgBrav: Number(avgBrav) || 0,
            avgDili: Number(avgDili) || 0,
            avgSoci: Number(avgSoci) || 0,
            avgCuri: Number(avgCuri) || 0,
            avgReso: Number(avgReso) || 0,
            avgResi: Number(avgResi) || 0,
            avgHun: Number(avgHun) || 0,
            avgEng: Number(avgEng) || 0,
            avgSaf: Number(avgSaf) || 0,
            avgSoc: Number(avgSoc) || 0,
            avgSupportPct: Number(socialMetrics.avgSupportPct || 0),
            bondedChars: Number(socialMetrics.bondedChars || 0),
            bondedRatePct: Number(socialMetrics.bondedRatePct || 0),
            allyChars: Number(socialMetrics.allyChars || 0),
            alliesRatePct: Number(socialMetrics.alliesRatePct || 0),
            nearbySupportChars: Number(socialMetrics.nearbySupportChars || 0),
            nearbyRatePct: Number(socialMetrics.nearbyRatePct || 0)
        });
        const pulseHistory = window.__populationPulseHistory || [];
        const birthRate = computePerMinuteDelta(pulseHistory, 'totalBorn', 60000);
        const deathRate = computePerMinuteDelta(pulseHistory, 'deaths', 60000);
        const netRate = birthRate - deathRate;
        const aliveSeries = pulseHistory.slice(-40).map(p => p.alive);
        const netSeries = pulseHistory.slice(-40).map((p, idx, arr) => {
            if (idx === 0) return 0;
            const prev = arr[Math.max(0, idx - 1)];
            const dt = Math.max(1, p.t - prev.t);
            return ((p.totalBorn - prev.totalBorn) - (p.deaths - prev.deaths)) * (60000 / dt);
        });
        const energySeries = pulseHistory.slice(-40).map(p => p.avgEnergy);

        if (window.sidebarParams?.populationMetricsExpanded === undefined) {
            window.sidebarParams.populationMetricsExpanded = false;
        }

        const sparkAlive = createSparklineSVG(aliveSeries, '#2563eb');
        const sparkNet = createSparklineSVG(netSeries, netRate >= 0 ? '#16a34a' : '#dc2626');
        const sparkEnergy = createSparklineSVG(energySeries, '#f59e0b');

        // --- Society Phase ---
        const _starving = starvingNow;
        const _conflictPairs = Math.round(alive.filter(c => c._nearEnemy).length / 2);
        const _initialPop = window.__simPopulationStats?.initialPopulation || alive.length;
        const _elapsedSec = window.__simPopulationStats ? (Date.now() - window.__simPopulationStats.startedAt) / 1000 : 0;
        const phase = getSocietyPhase(alive.length, netRate, _starving, _conflictPairs, _initialPop, _elapsedSec);

        // --- Phase history trail (tracks transitions across renders) ---
        if (!Array.isArray(window.__phaseHistory)) window.__phaseHistory = [];
        const _lastPhaseEntry = window.__phaseHistory[window.__phaseHistory.length - 1];
        if (!_lastPhaseEntry || _lastPhaseEntry.phase !== phase.phase) {
            window.__phaseHistory.push({ phase: phase.phase, icon: phase.icon, color: phase.color, t: Date.now() });
            if (window.__phaseHistory.length > 6) window.__phaseHistory.shift(); // keep last 6
        }
        // Also reset on sim restart
        if (window.__simPopulationStats && window.__phaseHistory[0]?.t < window.__simPopulationStats.startedAt) {
            window.__phaseHistory = [{ phase: phase.phase, icon: phase.icon, color: phase.color, t: Date.now() }];
        }
        // Build trail HTML: show up to 4 distinct preceding phases (oldest → newest → current)
        const _trailEntries = window.__phaseHistory.slice(-4);
        const phaseTrailHTML = _trailEntries.length > 1
            ? `<div style="display:flex;align-items:center;gap:2px;flex-wrap:wrap;margin-top:3px;opacity:0.7;font-size:0.78em;">` +
              _trailEntries.map((e, i) => {
                  const isCurrent = i === _trailEntries.length - 1;
                  const phaseSec = i < _trailEntries.length - 1
                      ? Math.round((_trailEntries[i + 1].t - e.t) / 1000) : null;
                  return (i > 0 ? `<span style="color:#cbd5e1;">›</span>` : '') +
                      `<span style="color:${e.color};font-weight:${isCurrent?'700':'400'};" title="${e.phase}${phaseSec?` (${phaseSec}s)`:''}">${e.icon}</span>` +
                      (!isCurrent && phaseSec !== null && phaseSec > 0 ? `<span style="color:#94a3b8;font-size:0.85em;">${phaseSec}s</span>` : '');
              }).join('') +
              `</div>`
            : '';

        // --- Activity snapshot (what chars are doing right now) ---
        const actEat    = alive.filter(c => c.action?.type === 'EAT').length;
        const actSocial = alive.filter(c => c.action?.type === 'SOCIALIZE').length;
        const actRest   = alive.filter(c => c.state === 'resting').length;
        const actBuild  = alive.filter(c => c.state === 'working').length;
        const actMove   = alive.filter(c => c.state === 'moving' && c.action?.type !== 'EAT' && c.action?.type !== 'SOCIALIZE').length;
        const actIdle   = Math.max(0, alive.length - actEat - actSocial - actRest - actBuild - actMove);
        const actTotal  = Math.max(1, alive.length);
        function actBar(label, icon, count, color) {
            const pct = Math.round((count / actTotal) * 100);
            return `<div style="display:flex;align-items:center;gap:5px;min-width:0;">` +
                `<span style="font-size:0.82em;min-width:14px;text-align:center;">${icon}</span>` +
                `<div style="flex:1;background:#e2e8f0;border-radius:3px;height:6px;overflow:hidden;">` +
                    `<div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width 0.4s;"></div>` +
                `</div>` +
                `<span style="color:#64748b;font-size:0.8em;min-width:22px;text-align:right;">${count}</span>` +
            `</div>`;
        }
        const activityHTML = alive.length > 0 ? (
            `<div style="margin-top:7px;display:flex;flex-direction:column;gap:3px;background:#ffffffbb;border:1px solid #dfe8f7;border-radius:8px;padding:5px 7px;">` +
                actBar('Eat',      '🍎', actEat,    '#16a34a') +
                actBar('Social',   '💬', actSocial, '#7c3aed') +
                actBar('Build',    '🔨', actBuild,  '#0891b2') +
                actBar('Rest',     '💤', actRest,   '#3b82f6') +
                actBar('Moving',   '🚶', actMove,   '#f59e0b') +
                actBar('Idle',     '⏸', actIdle,   '#94a3b8') +
            `</div>`
        ) : '';

        // --- Society Chronicle ---
        const _chronicle = Array.isArray(window.__societyChronicle) ? window.__societyChronicle : [];
        const _simStart = window.__simPopulationStats?.startedAt || Date.now();
        const chronicleHTML = _chronicle.length > 0 ? (() => {
            const entries = _chronicle.slice(-10).reverse();
            const rows = entries.map(e => {
                const ageSec = Math.round((e.t - _simStart) / 1000);
                const timeLabel = ageSec >= 60 ? `${Math.floor(ageSec/60)}m${ageSec%60}s` : `${ageSec}s`;
                return `<div style="display:flex;align-items:baseline;gap:5px;padding:2px 0;border-bottom:1px solid #f0f4fa;">` +
                    `<span style="font-size:0.9em;min-width:14px;">${e.icon}</span>` +
                    `<span style="flex:1;color:#334155;font-size:0.82em;">${e.text}</span>` +
                    `<span style="color:#94a3b8;font-size:0.78em;white-space:nowrap;">t=${timeLabel}</span>` +
                `</div>`;
            }).join('');
            const _chronicleOpen = !!window.sidebarParams?.chronicleExpanded;
            return `<details style="margin-top:7px;" ${_chronicleOpen ? 'open' : ''} data-chronicle-details>` +
                `<summary style="cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;background:#ffffffcc;border:1px solid #d7e4f5;font-weight:600;font-size:0.88em;color:#334155;">` +
                    `<span>${_chronicleOpen ? '▾' : '▸'}</span><span>Chronicle</span><span style="font-size:0.82em;color:#94a3b8;font-weight:400;">${_chronicle.length} events</span>` +
                `</summary>` +
                `<div style="margin-top:5px;max-height:160px;overflow-y:auto;">${rows}</div>` +
            `</details>`;
        })() : '';

        const detailsExpanded = !!window.sidebarParams.populationMetricsExpanded;
        const detailsChevron = detailsExpanded ? '▾' : '▸';
        const detailsHTML = createPopulationDetailsHTML({
            totalBorn,
            alive: alive.length,
            dead,
            childCount,
            youngCount,
            adultCount,
            elderCount,
            avgAge,
            maxAge,
            starvingNow,
            starvationDeaths,
            oldAgeDeaths,
            unknownDeaths,
            maxGen,
            avgGen,
            avgBrav,
            avgDili,
            avgSoci,
            avgCuri,
            avgReso,
            avgResi,
            avgHun,
            avgEng,
            avgSaf,
            avgSoc,
            avgSupportPct: socialMetrics.avgSupportPct,
            bondedChars: socialMetrics.bondedChars,
            bondedRatePct: socialMetrics.bondedRatePct,
            allyChars: socialMetrics.allyChars,
            alliesRatePct: socialMetrics.alliesRatePct,
            nearbySupportChars: socialMetrics.nearbySupportChars,
            nearbyRatePct: socialMetrics.nearbyRatePct
        });

        const statsDiv = document.createElement('div');
        statsDiv.style.cssText = 'background:linear-gradient(140deg,#ffffff 0%,#eef5ff 100%);border:1px solid #d7e4f5;border-radius:10px;padding:8px 10px;margin-bottom:10px;font-size:0.82em;color:#2b3340;box-shadow:0 2px 8px rgba(0,0,0,0.06);';
        const extinctionNotice = alive.length === 0 && !idlePreviewMode
            ? `<div style="margin:6px 0 8px 0;padding:6px 8px;border-radius:8px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;font-weight:600;">Population extinct — metrics preserved for inspection.</div>`
            : '';

        // --- Season indicator ---
        const si = window.currentSeasonInfo;
        const seasonHTML = si ? (() => {
            const pct = Math.round(si.multiplier * 100);
            // Progress bar: phase within the cycle (0–1)
            const phasePct = Math.round(si.phase * 100);
            // Color: summer=green, winter=blue, spring/autumn=amber
            const barColor = si.name === 'Summer' ? '#16a34a'
                : si.name === 'Winter' ? '#3b82f6'
                : si.name === 'Spring' ? '#f59e0b' : '#ea580c';
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;background:#ffffffbb;border:1px solid #dfe8f7;border-radius:8px;padding:5px 8px;">` +
                `<span style="font-size:1.1em;">${si.icon}</span>` +
                `<div style="flex:1;min-width:0;">` +
                    `<div style="display:flex;justify-content:space-between;align-items:baseline;">` +
                        `<span style="font-weight:600;color:#334155;">${si.name}</span>` +
                        `<span style="font-size:0.85em;color:#64748b;">food ×${si.multiplier.toFixed(2)}</span>` +
                    `</div>` +
                    `<div style="margin-top:3px;height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden;">` +
                        `<div style="height:100%;width:${phasePct}%;background:${barColor};border-radius:3px;transition:width 0.5s;"></div>` +
                    `</div>` +
                `</div>` +
            `</div>`;
        })() : '';

        const _currentPhaseSec = _lastPhaseEntry ? Math.round((Date.now() - _lastPhaseEntry.t) / 1000) : 0;
        statsDiv.innerHTML =
            seasonHTML +
            extinctionNotice +
            `<div style="margin-bottom:6px;padding:4px 8px;border-radius:8px;background:${phase.bg};border:1px solid ${phase.color}33;">` +
                `<div style="display:flex;align-items:center;gap:6px;">` +
                    `<span style="font-size:1.05em;">${phase.icon}</span>` +
                    `<span style="font-weight:700;color:${phase.color};font-size:0.88em;letter-spacing:0.03em;">${phase.phase}</span>` +
                    `<span style="flex:1;"></span>` +
                    `<span style="font-size:0.78em;color:#94a3b8;">${_currentPhaseSec}s | ${Math.round(_elapsedSec)}s</span>` +
                `</div>` +
                phaseTrailHTML +
            `</div>` +
            `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">` +
                `<b style="font-size:1.0em;">Population Pulse</b>` +
                `<span style="font-size:0.9em;color:#55657a;">1m window</span>` +
            `</div>` +
            `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:6px;">` +
                `<div style="background:#ffffffbb;border:1px solid #dfe8f7;border-radius:8px;padding:5px 6px;">` +
                    `<div style="color:#5a6a80;font-size:0.85em;">${idlePreviewMode ? 'Start' : 'Alive'}</div>` +
                    `<div style="font-weight:700;font-size:1.1em;color:#1d4ed8;line-height:1.2;">${idlePreviewMode ? configuredPopulation : alive.length}</div>` +
                `</div>` +
                `<div style="background:#ffffffbb;border:1px solid #dfe8f7;border-radius:8px;padding:5px 6px;">` +
                    `<div style="color:#5a6a80;font-size:0.85em;">Net/min</div>` +
                    `<div style="font-weight:700;font-size:1.1em;line-height:1.2;color:${netRate >= 0 ? '#15803d' : '#b91c1c'};">${netRate >= 0 ? '+' : ''}${netRate.toFixed(2)}</div>` +
                `</div>` +
                `<div style="background:#ffffffbb;border:1px solid #dfe8f7;border-radius:8px;padding:5px 6px;">` +
                    `<div style="color:#5a6a80;font-size:0.85em;">Risk (H/E)</div>` +
                    `<div style="font-weight:700;font-size:1.1em;color:#b45309;line-height:1.2;">${criticalHungerCount}/${criticalEnergyCount}</div>` +
                `</div>` +
            `</div>` +
            activityHTML +
            `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:7px;">` +
                `<div title="Alive trend" style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:0.78em;color:#5a6a80;">Alive</span>${sparkAlive}</div>` +
                `<div title="Net growth trend" style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:0.78em;color:#5a6a80;">Net</span>${sparkNet}</div>` +
                `<div title="Average energy trend" style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:0.78em;color:#5a6a80;">Energy</span>${sparkEnergy}</div>` +
            `</div>` +
            chronicleHTML +
            `<details ${detailsExpanded ? 'open' : ''} data-population-metrics-details style="margin-top:8px;">` +
                `<summary style="cursor:pointer;color:#334155;list-style:none;display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:#ffffffcc;border:1px solid #d7e4f5;font-weight:600;">` +
                    `<span style="font-size:0.92em;color:#64748b;">${detailsChevron}</span>` +
                    `<span>Detailed metrics</span>` +
                `</summary>` +
                `<div class="population-detail-wrap">${detailsHTML}</div>` +
            `</details>`;
        const metricsDetails = statsDiv.querySelector('[data-population-metrics-details]');
        if (metricsDetails) {
            metricsDetails.addEventListener('toggle', () => {
                if (!window.sidebarParams) window.sidebarParams = {};
                window.sidebarParams.populationMetricsExpanded = metricsDetails.open;
            });
        }
        const chronicleDetails = statsDiv.querySelector('[data-chronicle-details]');
        if (chronicleDetails) {
            chronicleDetails.addEventListener('toggle', () => {
                if (!window.sidebarParams) window.sidebarParams = {};
                window.sidebarParams.chronicleExpanded = chronicleDetails.open;
            });
        }
        statsDiv.querySelectorAll('.population-group-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const group = window.__populationMetricGroups?.[btn.dataset.groupKey];
                if (group) openPopulationMetricDialog(group);
            });
        });
        leftSidebar.appendChild(statsDiv);
    }

    // --- 全体サマリー表（アコーディオン型詳細展開付き） ---
    if (openedCharId && !visibleChars.some(char => String(char.id) === String(openedCharId))) {
        openedCharId = null;
        updateSelectedCharacterMarker();
    }

    if (visibleChars.length > 0) {
        const tableShell = document.createElement('div');
        tableShell.className = 'character-table-shell';
        const summaryTable = document.createElement('table');
        summaryTable.className = 'character-summary-table';
        const showAreaColumn = false;
        // ヘッダー（日本語で分かりやすく＆見やすいスタイル）
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        const headerLabels = [
            'ID',
            'Grp',
            ...(showAreaColumn ? ['Area'] : []),
            'Status',
            'Mood',
            'Hun',
            'Eng',
            'Saf',
            'Soc',
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
        visibleChars.forEach(char => {
            const tr = document.createElement('tr');
            tr.className = 'character-summary-row';
            if (String(openedCharId) === String(char.id)) tr.classList.add('is-open');
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
            detailTd.colSpan = showAreaColumn ? 10 : 9;
            detailTd.style.padding = '0';
            detailTd.style.background = 'transparent';
            const detailCard = createCharacterDetailCard(char);
            detailCard.title = 'Tap to close';
            detailCard.addEventListener('click', (e) => {
                if (String(openedCharId) === String(char.id)) {
                    closeOpenedCharacterDetail(leftSidebar);
                }
                e.stopPropagation();
            });
            detailTd.appendChild(detailCard);
            detailTr.appendChild(detailTd);

            tr.onclick = (e) => {
                // すでに開いている詳細パネルを再度クリックした場合は閉じる
                if (String(openedCharId) === String(char.id)) {
                    closeOpenedCharacterDetail(leftSidebar);
                    e.stopPropagation();
                    return;
                }
                // すでに開いている詳細を全て閉じる
                tbody.querySelectorAll('.character-summary-row').forEach(row => row.classList.remove('is-open'));
                tbody.querySelectorAll('.character-detail-row').forEach(row => row.style.display = 'none');
                // クリックしたキャラの詳細だけ開く
                openedCharId = String(char.id);
                tr.classList.add('is-open');
                detailTr.style.display = '';
                updateSelectedCharacterMarker();
                if (typeof window.focusCharacterInView === 'function') {
                    window.focusCharacterInView(char.id, { durationMs: 260 });
                }
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
            if (showAreaColumn) {
                const tdArea = document.createElement('td');
                const runtime = (typeof window.getDistrictRuntime === 'function')
                    ? window.getDistrictRuntime(char.gridPos)
                    : null;
                const districtIndex = runtime?.index ?? char.districtIndex ?? 0;
                const districtLabel = `D${Number(districtIndex) + 1}`;
                tdArea.textContent = districtLabel;
                tdArea.title = runtime
                    ? `Area: ${districtLabel}${runtime.isActive ? ' · observed' : ''}`
                    : `Area: ${districtLabel}`;
                tdArea.style.fontWeight = runtime?.isActive ? '700' : '600';
                tdArea.style.color = runtime?.isActive ? '#b45309' : '#475569';
                tr.appendChild(tdArea);
            }
            // Status: activity / urgency signals, distinct from emotional mood.
            const tdIcons = document.createElement('td');
            const status = getStatusDisplay(char);
            tdIcons.textContent = status.text;
            tdIcons.title = `Status: ${status.title}`;
            tr.appendChild(tdIcons);
            // 気分（moodアイコンのみ）
            const tdMood = document.createElement('td');
            tdMood.className = 'mood-td';
            const mood = getMoodDisplay(char.mood);
            tdMood.textContent = mood.icon;
            tdMood.title = `Mood: ${mood.text}`;
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
            // 移動距離
            const tdMove = document.createElement('td');
            tdMove.textContent = (typeof char.moveDistance === 'number') ? char.moveDistance : '-';
            tr.appendChild(tdMove);
            tbody.appendChild(tr);
            tbody.appendChild(detailTr);
        });
        summaryTable.appendChild(tbody);
        tableShell.appendChild(summaryTable);
        leftSidebar.appendChild(tableShell);

        // サイドバー余白クリックで詳細全閉じ
        leftSidebar.onclick = function(ev) {
            // サマリー表のtr, td, 詳細カード以外をクリックした場合のみ全閉じ
            let node = ev.target;
            while (node) {
                if (node.tagName === 'TR' || node.tagName === 'TD' || node.classList.contains('character-detail-card')) return;
                node = node.parentElement;
            }
            // 全ての詳細パネルを閉じる
            closeOpenedCharacterDetail(leftSidebar);
        };
    } else if (isDistrictFiltered && chars.length > 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'character-table-shell';
        emptyState.style.padding = '10px 12px';
        emptyState.style.marginTop = '8px';
        emptyState.style.color = '#64748b';
        emptyState.style.fontSize = '0.9em';
        emptyState.textContent = `No characters are currently visible in D${activeDistrictIndex + 1}. Global society metrics remain above.`;
        leftSidebar.appendChild(emptyState);
    } else if (hasPopulationHistory) {
        const emptyState = document.createElement('div');
        emptyState.className = 'character-table-shell';
        emptyState.style.padding = '10px 12px';
        emptyState.style.marginTop = '8px';
        emptyState.style.color = '#64748b';
        emptyState.style.fontSize = '0.9em';
        emptyState.textContent = 'No active character cards remain, but the society metrics above are preserved.';
        leftSidebar.appendChild(emptyState);
    }
    updateSelectedCharacterMarker();
    renderEventTimeline();
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
    const mood = getMoodDisplay(char.mood);
    moodSpan.className = 'mood-badge ' + mood.className;
    moodSpan.textContent = mood.icon;
    moodSpan.style.marginTop = '6px';
    header.appendChild(moodSpan);
    card.appendChild(header);

    // --- プロフィール欄（id, group, role, personality） ---
    const profileBox = document.createElement('div');
    profileBox.className = 'profile-box';
    profileBox.style.marginBottom = '10px';
    // personality traits (all 6)
    const p = char.personality || {};
    const m = char.morphology || {};
    const fmt = v => (v !== undefined ? Number(v).toFixed(2) : '-');
    // group/role
    const groupStr = char.groupId ? `Group: <b>${char.groupId}</b>` : 'Group: <b>Unassigned</b>';
    const roleStr = char.role === 'leader' ? 'Leader' : char.role === 'worker' ? 'Worker' : 'Member';
    // id
    const idStr = `ID: <b>${char.id}</b>`;
    // プロフィールHTML
    profileBox.innerHTML = `<b>Profile</b><br>` +
        `${idStr}<br>${groupStr} / Role: <b>${roleStr}</b><br>` +
        `<span title="Risk tolerance">⚔️ ${fmt(p.bravery)}</span> ` +
        `<span title="Work rate">🔨 ${fmt(p.diligence)}</span> ` +
        `<span title="Social drive">💬 ${fmt(p.sociality)}</span><br>` +
        `<span title="Exploration drive">🔭 ${fmt(p.curiosity)}</span> ` +
        `<span title="Proactive foraging">🌾 ${fmt(p.resourcefulness)}</span> ` +
        `<span title="Energy stress tolerance">💪 ${fmt(p.resilience)}</span><br>` +
        `<span title="Torso height">🧱 ${fmt(m.bodyHeight)}</span> ` +
        `<span title="Head size">🗿 ${fmt(m.headHeight)}</span> ` +
        `<span title="Arm loop size">🌀 ${fmt(m.armLoopRadius)}</span>`;
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
    // Relationship network summary and strongest ties.
    const networkSnapshot = typeof char.getRelationshipSnapshot === 'function' ? char.getRelationshipSnapshot(6) : null;
    const relBox = document.createElement('div');
    relBox.style.marginBottom = '10px';
    relBox.style.padding = '8px 10px';
    relBox.style.border = '1px solid #e2e8f0';
    relBox.style.borderRadius = '10px';
    relBox.style.background = '#fafcff';
    const socialDescriptor = describeRelationshipSnapshot(networkSnapshot);
    relBox.innerHTML =
        `<div style="font-weight:700;color:#0f172a;margin-bottom:6px;">Relationship Network</div>` +
        `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;">` +
            `<span style="padding:2px 8px;border-radius:999px;background:${socialDescriptor.bg};color:${socialDescriptor.color};font-size:0.82em;font-weight:800;white-space:nowrap;">${socialDescriptor.label}</span>` +
            `<span style="font-size:0.82em;color:#475569;line-height:1.35;">${socialDescriptor.blurb}</span>` +
        `</div>` +
        `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">` +
            `<span style="padding:2px 8px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:0.82em;font-weight:700;">support ${Math.round((networkSnapshot?.supportScore || 0) * 100)}%</span>` +
            `<span style="padding:2px 8px;border-radius:999px;background:#fdf2f8;color:#be185d;font-size:0.82em;font-weight:700;">bonded ${Number(networkSnapshot?.bondedCount || 0)}</span>` +
            `<span style="padding:2px 8px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:0.82em;font-weight:700;">allies ${Number(networkSnapshot?.allyCount || 0)}</span>` +
            `<span style="padding:2px 8px;border-radius:999px;background:#f8fafc;color:#475569;font-size:0.82em;font-weight:700;">nearby ${Number(networkSnapshot?.nearbySupport || 0)}</span>` +
        `</div>`;

    if (networkSnapshot?.ties?.length) {
        networkSnapshot.ties.forEach(tie => {
            const row = document.createElement('div');
            row.style.display = 'grid';
            row.style.gridTemplateColumns = 'auto 1fr auto';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.marginTop = '5px';

            const meta = getRelationshipBadgeMeta(tie.relationshipClass);
            const left = document.createElement('div');
            left.style.minWidth = '42px';
            left.style.fontWeight = '700';
            left.style.color = '#0f172a';
            left.textContent = `${meta.icon} ${tie.other.id}`;
            row.appendChild(left);

            const barWrap = document.createElement('div');
            barWrap.innerHTML =
                `<div style="height:7px;border-radius:999px;background:#e2e8f0;overflow:hidden;">` +
                    `<div style="width:${Math.max(0, Math.min(100, tie.affinity))}%;height:100%;background:${meta.bg};"></div>` +
                `</div>` +
                `<div style="margin-top:2px;font-size:0.78em;color:#64748b;">${tie.relationshipClass}${tie.inSameGroup ? ' · same group' : ''}${tie.isNearbySupport ? ' · nearby' : ''}</div>`;
            row.appendChild(barWrap);

            const right = document.createElement('div');
            right.style.fontSize = '0.82em';
            right.style.fontWeight = '700';
            right.style.color = '#334155';
            right.textContent = `${Math.round(tie.affinity)}`;
            row.appendChild(right);
            relBox.appendChild(row);
        });

        const hint = document.createElement('div');
        hint.style.marginTop = '8px';
        hint.style.fontSize = '0.78em';
        hint.style.color = '#64748b';
        hint.textContent = 'Top ties are linked with live lines and badges in the scene while this character is selected.';
        relBox.appendChild(hint);
    } else {
        const empty = document.createElement('div');
        empty.style.fontSize = '0.84em';
        empty.style.color = '#64748b';
        empty.textContent = 'No meaningful social ties yet.';
        relBox.appendChild(empty);
    }
    card.appendChild(relBox);
    return card;
}

    // サイドバー初回描画時に右も必ず表示
    if (typeof renderCharacterDetail === 'function') {
        renderCharacterDetail();
    }
}
