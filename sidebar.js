// needs/moodだけ個別に更新する関数
// --- キャラごとにmood/needs履歴を記録する ---
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
        // 直前と何か変化があった場合のみpush
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
    // サマリー表のtbody内の各trを走査し、needsとmoodだけ更新
    const table = document.querySelector('.character-summary-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    // キャラごとに2行（サマリー行＋詳細行）なので偶数行のみ処理
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
        // needs（hunger, energy, safety, social）
        const needKeys = ['hunger','energy','safety','social'];
        for (let j = 0; j < needKeys.length; j++) {
            const td = tr.children[3 + j];
            if (td && char.needs && typeof char.needs[needKeys[j]] === 'number') {
                td.textContent = Math.round(char.needs[needKeys[j]]);
            }
        }
    }
}

// openedCharIdの有無だけで自動更新を制御
if (window.__sidebarNeedsInterval) clearInterval(window.__sidebarNeedsInterval);
window.__sidebarNeedsInterval = setInterval(() => {
    // 詳細パネル開いている間は一切更新しない
    if (openedCharId) return;
    // サマリー表全体を再描画
    window.renderCharacterList && window.renderCharacterList();
}, 1000);

// グローバル登録
window.renderCharacterNeeds = renderCharacterNeeds;
// 初期状態で自動スタートしないように明示的に初期化
window.characters = undefined;
window.simulationRunning = false;
// 右サイドバー：選択キャラ詳細
function renderCharacterDetail() {
    if (!rightSidebar) return;
    // --- sidebarParamsで値を保持 ---
    if (!window.sidebarParams) {
        window.sidebarParams = {
            charNum: 10,
            socialTh: 30,
            groupAffinityTh: 50,
            useRandom: false
        };
    }
    const sidebarParams = window.sidebarParams;
    // シミュレーション中はパラメータ欄をdisabledに（1回だけ定義）
    const paramDisabled = !!window.simulationRunning && window.characters && window.characters.length > 0;
    // グローバルにも反映
    window.groupAffinityThreshold = sidebarParams.groupAffinityTh;
    window.socialThreshold = sidebarParams.socialTh; // ← 初期化時にも設定
    // Emergency threshold parameters
    if (sidebarParams.hungerEmergencyThreshold === undefined) sidebarParams.hungerEmergencyThreshold = 5;
    if (sidebarParams.energyEmergencyThreshold === undefined) sidebarParams.energyEmergencyThreshold = 1;
    if (sidebarParams.homeReturnHungerLevel === undefined) sidebarParams.homeReturnHungerLevel = 90;
    window.hungerEmergencyThreshold = sidebarParams.hungerEmergencyThreshold;
    window.energyEmergencyThreshold = sidebarParams.energyEmergencyThreshold;
    window.homeReturnHungerLevel = sidebarParams.homeReturnHungerLevel;
    // 新パラメータ: 初期affinity値と上昇速度
    if (sidebarParams.initialAffinityMin === undefined) sidebarParams.initialAffinityMin = 20;
    if (sidebarParams.initialAffinityMax === undefined) sidebarParams.initialAffinityMax = 40;
    if (sidebarParams.affinityIncreaseRate === undefined) sidebarParams.affinityIncreaseRate = 10;
    window.initialAffinityMin = sidebarParams.initialAffinityMin;
    window.initialAffinityMax = sidebarParams.initialAffinityMax;
    window.affinityIncreaseRate = sidebarParams.affinityIncreaseRate;
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
    groupThRow.appendChild(groupThInput);
    const groupThVal = document.createElement('input');
    groupThVal.type = 'number';
    groupThVal.min = 0;
    groupThVal.max = 100;
    groupThVal.value = sidebarParams.groupAffinityTh;
    groupThVal.style.width = '48px';
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
    affinityRateNumber.addEventListener('input', e => {
        sidebarParams.affinityIncreaseRate = Number(e.target.value);
        affinityRateInput.value = e.target.value;
        window.affinityIncreaseRate = Number(e.target.value);
    });
    affinityRateRow.appendChild(affinityRateNumber);
    paramBox.appendChild(affinityRateRow);

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
    perceptionNumber.addEventListener('input', e => {
        sidebarParams.perceptionRange = Number(e.target.value);
        perceptionInput.value = e.target.value;
        window.perceptionRange = Number(e.target.value);
    });
    perceptionRow.appendChild(perceptionNumber);
    paramBox.appendChild(perceptionRow);

    // --- 繁殖後の友好度リセット値スライダー ---
    if (sidebarParams.affinityResetAfterReproduce === undefined) sidebarParams.affinityResetAfterReproduce = 10;
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
    affinityResetNumber.addEventListener('input', e => {
        sidebarParams.affinityResetAfterReproduce = Number(e.target.value);
        affinityResetInput.value = e.target.value;
        window.affinityResetAfterReproduce = Number(e.target.value);
    });
    affinityResetRow.appendChild(affinityResetNumber);
    paramBox.appendChild(affinityResetRow);

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
    charNumRow.appendChild(charNumInput);
    const charNumVal = document.createElement('input');
    charNumVal.type = 'number';
    charNumVal.min = 5;
    charNumVal.max = 50;
    charNumVal.value = sidebarParams.charNum;
    charNumVal.style.width = '48px';
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
    socialRow.appendChild(socialInput);
    const socialVal = document.createElement('input');
    socialVal.type = 'number';
    socialVal.min = 0;
    socialVal.max = 100;
    socialVal.value = sidebarParams.socialTh;
    socialVal.style.width = '48px';
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
    const hungerEmergencyVal = document.createElement('input');
    hungerEmergencyVal.type = 'number';
    hungerEmergencyVal.min = 0;
    hungerEmergencyVal.max = 20;
    hungerEmergencyVal.step = 1;
    hungerEmergencyVal.value = sidebarParams.hungerEmergencyThreshold;
    hungerEmergencyVal.style.width = '60px';
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
    if (sidebarParams.energyEmergencyThreshold === undefined) sidebarParams.energyEmergencyThreshold = 1;
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
    const energyEmergencyVal = document.createElement('input');
    energyEmergencyVal.type = 'number';
    energyEmergencyVal.min = 0;
    energyEmergencyVal.max = 20;
    energyEmergencyVal.step = 1;
    energyEmergencyVal.value = sidebarParams.energyEmergencyThreshold;
    energyEmergencyVal.style.width = '60px';
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
    const homeReturnVal = document.createElement('input');
    homeReturnVal.type = 'number';
    homeReturnVal.min = 70;
    homeReturnVal.max = 100;
    homeReturnVal.step = 1;
    homeReturnVal.value = sidebarParams.homeReturnHungerLevel;
    homeReturnVal.style.width = '60px';
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
    randomCheck.oninput = () => {
        sidebarParams.useRandom = randomCheck.checked;
    };
    randomRow.appendChild(randomCheck);
    paramBox.appendChild(randomRow);
    randomCheck.disabled = paramDisabled;

    // スタート／一時停止トグルボタン
    if (window.simulationRunning === undefined) window.simulationRunning = false;
    const toggleBtn = document.createElement('button');
    function updateToggleBtn() {
        if (!window.characters || window.characters.length === 0) {
            toggleBtn.textContent = 'Start';
            toggleBtn.style.background = 'linear-gradient(90deg,#e3f0ff 60%,#f8f4fa 100%)';
        } else if (window.simulationRunning) {
            toggleBtn.textContent = 'Pause';
            toggleBtn.style.background = 'linear-gradient(90deg,#ffe082 60%,#f8f4fa 100%)';
        } else {
            toggleBtn.textContent = 'Start';
            toggleBtn.style.background = 'linear-gradient(90deg,#b2ff59 60%,#f8f4fa 100%)';
        }
    }
    toggleBtn.style.fontSize = '1.1em';
    toggleBtn.style.fontWeight = 'bold';
    toggleBtn.style.padding = '8px 24px';
    toggleBtn.style.borderRadius = '8px';
    toggleBtn.style.border = '1.5px solid #b0c8e0';
    toggleBtn.style.color = '#333';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.marginTop = '8px';
    updateToggleBtn();
    toggleBtn.onclick = () => {
        if (!window.simulationRunning) {
            // Start: sidebarParamsの値でキャラ配列を再生成（リセット）
            const num = parseInt(sidebarParams.charNum);
            const socialTh = parseInt(sidebarParams.socialTh);
            const groupAffinityTh = parseInt(sidebarParams.groupAffinityTh);
            const useRandom = !!sidebarParams.useRandom;
            // 既存キャラ・IDリセット
            window.characters = [];
            if (window.nextCharacterId !== undefined) window.nextCharacterId = 0;
            // グループしきい値をグローバルに反映
            window.groupAffinityThreshold = groupAffinityTh;
            // world.jsのremoveAllCharacterObjectsを呼び出し
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
                    // --- グループ初期化前にパラメータをwindowに反映 ---
                    window.groupAffinityThreshold = sidebarParams.groupAffinityTh;
                    window.initialAffinityMin = sidebarParams.initialAffinityMin;
                    window.initialAffinityMax = sidebarParams.initialAffinityMax;
                    window.affinityIncreaseRate = sidebarParams.affinityIncreaseRate;
                    window.socialThreshold = socialTh; // ← これが不足していました！
                    window.perceptionRange = sidebarParams.perceptionRange;
                    window.hungerEmergencyThreshold = sidebarParams.hungerEmergencyThreshold;
                    window.energyEmergencyThreshold = sidebarParams.energyEmergencyThreshold;
                    window.homeReturnHungerLevel = sidebarParams.homeReturnHungerLevel;
                    // --- ここでグループ初期化 ---
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
    paramBox.appendChild(toggleBtn);

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
    // キャラが未生成なら何も表示しない
    if (!window.characters || !Array.isArray(window.characters) || window.characters.length === 0) {
        leftSidebar.innerHTML = '';
        return;
    }
    // 詳細カードが残っている場合は消去し、タイトルのみ表示
    leftSidebar.innerHTML = '';
    // タイトルを追加
    const title = document.createElement('h3');
    title.textContent = 'キャラクター一覧';
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
            'グル',
            '状態',
            '気分',
            '空腹',
            'エネ',
            '安全',
            '社交',
            '行動',
            '移動'
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
                    leaderMark.title = 'リーダー';
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
    groupBox.textContent = `グループ${char.groupId ?? '未所属'}`;
    groupBox.style.color = '#888';
    groupBox.style.fontSize = '0.98em';
    topRow.appendChild(groupBox);
    // 役割
    const roleBox = document.createElement('div');
    roleBox.textContent = char.role === 'leader' ? 'リーダー' : char.role === 'worker' ? '労働者' : '一般';
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
    const groupStr = char.groupId ? `グループ: <b>${char.groupId}</b>` : 'グループ: <b>未所属</b>';
    const roleStr = char.role === 'leader' ? 'リーダー' : char.role === 'worker' ? '労働者' : '一般';
    // id
    const idStr = `ID: <b>${char.id}</b>`;
    // プロフィールHTML（年齢・性格・特技は表示しない）
    profileBox.innerHTML = `<b>プロフィール</b><br>` +
        `${idStr}<br>${groupStr} ／ 役割: <b>${roleStr}</b><br>` +
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
        title.textContent = '状態推移グラフ（最新10件）';
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
            histDiv.appendChild(document.createTextNode('グラフ表示には2件以上の履歴が必要です。'));
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
        itemDiv.innerHTML = `<b>所持アイテム:</b> ${char.items.join(', ')}`;
        infoBox.appendChild(itemDiv);
    }
    // 所有土地数
    let landCount = '-';
    if (typeof char.landCount === 'number') landCount = char.landCount;
    else if (char.ownedLand && typeof char.ownedLand.size === 'number') landCount = char.ownedLand.size;
    const landDiv = document.createElement('div');
    landDiv.innerHTML = `<b>所有土地:</b> ${landCount}区画`;
    infoBox.appendChild(landDiv);
    // 子供数
    let childCount = '-';
    if (typeof char.childCount === 'number') childCount = char.childCount;
    else if (Array.isArray(char.children)) childCount = char.children.length;
    const childDiv = document.createElement('div');
    childDiv.innerHTML = `<b>子供数:</b> ${childCount}`;
    infoBox.appendChild(childDiv);
    // 穴を掘った回数
    let digCount = '-';
    if (typeof char.digCount === 'number') digCount = char.digCount;
    const digDiv = document.createElement('div');
    digDiv.innerHTML = `<b>穴を掘った回数:</b> ${digCount}`;
    infoBox.appendChild(digDiv);
    // 建物を建てた回数
    let buildCount = '-';
    if (typeof char.buildCount === 'number') buildCount = char.buildCount;
    const buildDiv = document.createElement('div');
    buildDiv.innerHTML = `<b>建物を建てた回数:</b> ${buildCount}`;
    infoBox.appendChild(buildDiv);
    // 食事の回数
    let eatCount = '-';
    if (typeof char.eatCount === 'number') eatCount = char.eatCount;
    const eatDiv = document.createElement('div');
    eatDiv.innerHTML = `<b>食事の回数:</b> ${eatCount}`;
    infoBox.appendChild(eatDiv);
    // 現在のstateのみは残し、移動距離・現在の行動は詳細カードから削除
    if (char.state) {
        const stateDiv = document.createElement('div');
        stateDiv.innerHTML = `<b>現在の状態(state):</b> <span style="font-family:monospace;">${char.state}</span>`;
        infoBox.appendChild(stateDiv);
    }
    card.appendChild(infoBox);
    // 関係性リスト
    if (char.relationships && Array.isArray(char.relationships) && window.characters) {
        const relBox = document.createElement('div');
        relBox.innerHTML = '<b>関係性リスト</b>';
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
