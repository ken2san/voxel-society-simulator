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
    // --- 右サイドバー：AIパラメータ調整UI ---
    rightSidebar.innerHTML = '';
    const paramBox = document.createElement('div');
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
    charNumInput.value = 10;
    charNumInput.style.flex = '1';
    charNumInput.style.margin = '0 8px';
    charNumRow.appendChild(charNumInput);
    const charNumVal = document.createElement('input');
    charNumVal.type = 'number';
    charNumVal.min = 5;
    charNumVal.max = 50;
    charNumVal.value = 10;
    charNumVal.style.width = '48px';
    charNumRow.appendChild(charNumVal);
    // 双方向同期
    charNumInput.oninput = () => { charNumVal.value = charNumInput.value; };
    charNumVal.oninput = () => { charNumInput.value = charNumVal.value; };
    paramBox.appendChild(charNumRow);

    // シミュレーション中はパラメータ欄をdisabledに
    const paramDisabled = !!window.simulationRunning && window.characters && window.characters.length > 0;
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
    socialInput.value = 30;
    socialInput.style.flex = '1';
    socialInput.style.margin = '0 8px';
    socialRow.appendChild(socialInput);
    const socialVal = document.createElement('input');
    socialVal.type = 'number';
    socialVal.min = 0;
    socialVal.max = 100;
    socialVal.value = 30;
    socialVal.style.width = '48px';
    socialRow.appendChild(socialVal);
    // 双方向同期
    socialInput.oninput = () => { socialVal.value = socialInput.value; };
    socialVal.oninput = () => { socialInput.value = socialVal.value; };
    paramBox.appendChild(socialRow);
    socialInput.disabled = paramDisabled;
    socialVal.disabled = paramDisabled;

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
    randomCheck.checked = false;
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
            // Start: パラメータでキャラ配列を再生成（リセット）
            const num = parseInt(charNumInput.value);
            const socialTh = parseInt(socialInput.value);
            const useRandom = randomCheck.checked;
            // 既存キャラ・IDリセット
            window.characters = [];
            // world.jsのnextCharacterIdもリセット（必要なら）
            if (window.nextCharacterId !== undefined) window.nextCharacterId = 0;
            // 既存キャラの3Dオブジェクトも消去（sceneから）
            if (window.scene && window.scene.children) {
                window.scene.children = window.scene.children.filter(obj => !(obj && obj.type === 'Group' && obj.name && obj.name.startsWith('Character')));
            }
            // キャラ生成はspawnCharacterを使う
            import('./world.js').then(worldMod => {
                const spawnAll = async () => {
                    for (let i = 0; i < num; i++) {
                        const pos = worldMod.findValidSpawn();
                        if (pos) {
                            const char = await worldMod.spawnCharacter(pos);
                            if (char) {
                                char.socialThreshold = useRandom ? Math.floor(Math.random()*101) : socialTh;
                            }
                        }
                    }
                    // world.jsのcharacters配列をwindow.charactersに同期
                    window.characters = worldMod.characters;
                    selectedCharId = window.characters[0]?.id;
                    window.simulationRunning = true;
                    window.renderCharacterList && window.renderCharacterList();
                    renderCharacterDetail(); // UIを再描画してdisabled状態を反映
                };
                spawnAll();
            });
        } else {
            // Pause: 一時停止
            window.simulationRunning = false;
            renderCharacterDetail(); // UIを再描画してdisabled状態を反映
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
    console.log('[sidebar.js] window.characters:', window.characters);
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
            detailTd.colSpan = 9;
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
            // 状態アイコン（state/needsのみ、気分は含めない）
            const tdIcons = document.createElement('td');
            let stateIcons = [];
            if (char.role === 'leader') stateIcons.push('👑');
            if (char.state === 'dead') stateIcons.push('💀');
            else if (char.state === 'resting') stateIcons.push('🛏️');
            else if (char.state === 'socializing') stateIcons.push('💬');
            else if (char.state === 'moving') stateIcons.push('🚶');
            // COLLECT_FOOD中は必ず🍎を表示
            if (char.currentAction === 'COLLECT_FOOD' && !stateIcons.includes('🍎')) stateIcons.push('🍎');
            else if (char.needs && char.needs.hunger < 30 && !stateIcons.includes('🍎')) stateIcons.push('🍎');
            if (char.needs && char.needs.energy < 30) stateIcons.push('💤');
            if (char.needs && char.needs.social < 30) stateIcons.push('👥');
            if (stateIcons.length === 0) stateIcons.push(char.role === 'worker' ? '🧑‍🌾' : '🙂');
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

    // グループごとに分類
    const groupMap = {};
    const ungrouped = [];
    window.characters.forEach(char => {
        if (char.groupId) {
            if (!groupMap[char.groupId]) groupMap[char.groupId] = [];
            groupMap[char.groupId].push(char);
        } else {
            ungrouped.push(char);
        }
    });

    // サイドバー初回描画時に右も必ず表示
    if (typeof renderCharacterDetail === 'function') {
        renderCharacterDetail();
    }
    // グループ色（グループIDごとに色を割り当て）
    const groupColors = [
        '#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#4db6ac', '#ffb74d', '#90a4ae', '#f06292', '#a1887f'
    ];
    const groupIdList = Object.keys(groupMap).sort();
    groupColorMap = {};
    groupIdList.forEach((gid, idx) => {
        groupColorMap[gid] = groupColors[idx % groupColors.length];
    });
    // グループごとに表示
    groupIdList.forEach(gid => {
        const chars = groupMap[gid].slice();
        chars.sort((a, b) => (b.role === 'leader') - (a.role === 'leader'));
        const groupBlock = document.createElement('div');
        groupBlock.className = 'group-block';
        groupBlock.style.borderLeft = `8px solid ${groupColorMap[gid]}`;
        const groupTitle = document.createElement('div');
        groupTitle.className = 'group-title';
        groupTitle.style.fontWeight = 'bold';
        groupTitle.style.marginBottom = '8px';
        groupTitle.style.fontSize = '1.1em';
        groupTitle.textContent = `グループ${gid}（${chars.length}人）`;
        groupBlock.appendChild(groupTitle);

        // 追加: リーダー名・平均親密度
        const leader = chars.find(c => c.role === 'leader');
        if (leader) {
            const leaderInfo = document.createElement('div');
            leaderInfo.style.fontSize = '0.95em';
            leaderInfo.style.marginBottom = '2px';
            leaderInfo.innerHTML = `<span style="color:#333;">👑 Leader:</span> <b>${leader.id}</b>`;
            groupBlock.appendChild(leaderInfo);
        }
        // 平均親密度（全員分のrelationships合計/人数）
        let affinitySum = 0, affinityCount = 0;
        chars.forEach(c => {
            if (c.relationships && typeof c.relationships.forEach === 'function') {
                c.relationships.forEach(val => { affinitySum += val; affinityCount++; });
            }
        });
        if (affinityCount > 0) {
            const avgAffinity = Math.round(affinitySum / affinityCount);
            const affinityInfo = document.createElement('div');
            affinityInfo.style.fontSize = '0.92em';
            affinityInfo.style.marginBottom = '4px';
            affinityInfo.innerHTML = `<span style="color:#666;">Avg Affinity:</span> <b>${avgAffinity}</b>`;
            groupBlock.appendChild(affinityInfo);
        }

        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        chars.forEach((char, idx) => {
            const li = document.createElement('li');
            li.className = 'char-list-item';
            // グループ色の枠
            li.style.borderLeft = `5px solid ${groupColorMap[gid]}`;
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.style.gap = '6px';
            const badge = document.createElement('span');
            badge.className = 'char-badge';
            badge.style.border = `3px solid ${groupColorMap[gid]}`;
            let icons = [];
            if (char.role === 'leader') icons.push('👑');
            if (char.state === 'dead') icons.push('💀');
            else if (char.state === 'resting') icons.push('🛏️');
            else if (char.state === 'socializing') icons.push('💬');
            if (char.needs && char.needs.hunger < 30) icons.push('🍎');
            if (char.needs && char.needs.energy < 30) icons.push('💤');
            if (char.needs && char.needs.social < 30) icons.push('👥');
            if (char.state === 'moving') icons.push('🚶');
            badge.textContent = icons.slice(0,2).join('');
            if (icons.length === 0) badge.textContent = char.role === 'worker' ? '🧑‍🌾' : '🙂';
            // 全アイコンをツールチップで表示
            if (icons.length > 0) {
                badge.title = icons.join(' ');
            } else {
                badge.title = '';
            }
            li.appendChild(badge);
            // idをそのまま表示
            const numSpan = document.createElement('span');
            numSpan.textContent = `${char.id}`;
            numSpan.style.color = '#888';
            numSpan.style.fontWeight = 'bold';
            numSpan.style.fontSize = '1.05em';
            li.appendChild(numSpan);
            // キャラ名（id）
            const nameSpan = document.createElement('span');
            nameSpan.textContent = char.id;
            nameSpan.style.color = '#222';
            nameSpan.style.fontWeight = char.role === 'leader' ? 'bold' : 'normal';
            nameSpan.style.fontSize = '1.05em';
            // 労働者の文字色を黒系に強制
            if (char.role === 'worker') nameSpan.style.color = '#222';
            li.appendChild(nameSpan);
            // 状態テキスト
            const stateSpan = document.createElement('span');
            stateSpan.style.fontSize = '0.95em';
            stateSpan.style.marginLeft = '4px';
            let stateText = '';
            if (char.state === 'dead') stateText = '死亡';
            else if (char.role === 'leader') stateText = 'リーダー';
            else if (char.role === 'worker') stateText = '労働者';
            else stateText = '生存';
            if (char.state === 'resting') stateText += '・休憩中';
            if (char.state === 'socializing') stateText += '・交流中';
            if (char.state === 'moving') stateText += '・移動中';
            stateSpan.textContent = stateText;
            // 労働者の文字色を黒系に強制
            if (char.role === 'worker') stateSpan.style.color = '#222';
            li.appendChild(stateSpan);
            li.onclick = () => {
                selectedCharId = char.id;
                renderCharacterDetail();
            };
            ul.appendChild(li);
        });
        groupBlock.appendChild(ul);
        leftSidebar.appendChild(groupBlock);
    });
    // 未所属キャラのリスト表示は不要なので何も出さない
}
