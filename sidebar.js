// 右サイドバー：選択キャラ詳細
function renderCharacterDetail() {
    if (!rightSidebar || !selectedCharId || !window.characters) return;
    const char = window.characters.find(c => c.id === selectedCharId);
    if (!char) return;
    rightSidebar.innerHTML = '';

    // グループ色取得
    let groupColor = '#bbb';
    if (char.groupId && typeof groupColorMap === 'object' && groupColorMap[char.groupId]) {
        groupColor = groupColorMap[char.groupId];
    }

    // 上部：大きなアイコン＋名前＋グループ色＋役割
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '14px';
    header.style.marginBottom = '12px';
    // アイコン
    const bigIcon = document.createElement('span');
    let icons = [];
    if (char.role === 'leader') icons.push('👑');
    if (char.state === 'dead') icons.push('💀');
    else if (char.state === 'resting') icons.push('🛏️');
    else if (char.state === 'socializing') icons.push('💬');
    if (char.needs && char.needs.hunger < 30) icons.push('🍎');
    if (char.needs && char.needs.energy < 30) icons.push('💤');
    if (char.needs && char.needs.social < 30) icons.push('👥');
    if (char.state === 'moving') icons.push('🚶');
    bigIcon.textContent = icons[0] || (char.role === 'worker' ? '🧑‍🌾' : '🙂');
    bigIcon.style.fontSize = '2.2em';
    bigIcon.style.border = `4px solid ${groupColor}`;
    bigIcon.style.borderRadius = '50%';
    bigIcon.style.padding = '8px';
    header.appendChild(bigIcon);
    // 名前・役割
    const nameBox = document.createElement('div');
    nameBox.innerHTML = `<div style="font-size:1.3em;font-weight:bold;color:#222;">${char.id}</div>` +
        `<div style="color:${groupColor};font-size:1em;">グループ${char.groupId ?? '未所属'}</div>` +
        `<div style="font-size:1em;color:#666;">${char.role === 'leader' ? 'リーダー' : char.role === 'worker' ? '労働者' : '一般'}</div>`;
    header.appendChild(nameBox);
    rightSidebar.appendChild(header);

    // ステータスバー
    if (char.needs) {
        const statusBox = document.createElement('div');
        statusBox.style.marginBottom = '10px';
        const statusList = [
            { key: 'hunger', label: '空腹', color: '#e57373' },
            { key: 'energy', label: 'エネルギー', color: '#ffd54f' },
            { key: 'safety', label: '安全', color: '#64b5f6' },
            { key: 'social', label: '社交', color: '#81c784' }
        ];
        statusList.forEach(st => {
            if (typeof char.needs[st.key] === 'number') {
                const barWrap = document.createElement('div');
                barWrap.style.display = 'flex';
                barWrap.style.alignItems = 'center';
                barWrap.style.gap = '6px';
                barWrap.style.marginBottom = '2px';
                const label = document.createElement('span');
                label.textContent = st.label;
                label.style.width = '48px';
                label.style.fontSize = '0.98em';
                const barBg = document.createElement('div');
                barBg.style.background = '#eee';
                barBg.style.width = '110px';
                barBg.style.height = '13px';
                barBg.style.borderRadius = '7px';
                barBg.style.overflow = 'hidden';
                const bar = document.createElement('div');
                bar.style.background = st.color;
                bar.style.height = '100%';
                bar.style.width = Math.max(0, Math.min(100, char.needs[st.key])) + '%';
                barBg.appendChild(bar);
                barWrap.appendChild(label);
                barWrap.appendChild(barBg);
                const val = document.createElement('span');
                val.textContent = char.needs[st.key];
                val.style.fontSize = '0.95em';
                val.style.color = '#444';
                barWrap.appendChild(val);
                statusBox.appendChild(barWrap);
            }
        });
        rightSidebar.appendChild(statusBox);
    }

    // 所持アイテム・土地数・行動・履歴
    const infoBox = document.createElement('div');
    infoBox.style.marginBottom = '10px';
    // 所持アイテム
    if (char.items && Array.isArray(char.items) && char.items.length > 0) {
        const itemDiv = document.createElement('div');
        itemDiv.innerHTML = `<b>所持アイテム:</b> ${char.items.join(', ')}`;
        infoBox.appendChild(itemDiv);
    }
    // 所有土地数
    if (typeof char.landCount === 'number') {
        const landDiv = document.createElement('div');
        landDiv.innerHTML = `<b>所有土地:</b> ${char.landCount}区画`;
        infoBox.appendChild(landDiv);
    }
    // 現在の行動
    if (char.currentAction) {
        const actDiv = document.createElement('div');
        actDiv.innerHTML = `<b>現在の行動:</b> ${char.currentAction}`;
        infoBox.appendChild(actDiv);
    }
    // 行動履歴
    if (char.actionHistory && Array.isArray(char.actionHistory) && char.actionHistory.length > 0) {
        const histDiv = document.createElement('div');
        histDiv.innerHTML = `<b>行動履歴:</b> ${char.actionHistory.slice(-5).reverse().join(' → ')}`;
        infoBox.appendChild(histDiv);
    }
    rightSidebar.appendChild(infoBox);

    // 関係性リスト
    if (char.relationships && Array.isArray(char.relationships) && window.characters) {
        const relBox = document.createElement('div');
        relBox.innerHTML = '<b>関係性リスト</b>';
        relBox.style.marginBottom = '10px';
        char.relationships.forEach((val, idx) => {
            const relChar = window.characters[idx];
            if (!relChar || relChar.id === char.id) return;
            const relRow = document.createElement('div');
            relRow.style.display = 'flex';
            relRow.style.alignItems = 'center';
            relRow.style.gap = '6px';
            // 顔アイコン
            const relIcon = document.createElement('span');
            relIcon.textContent = relChar.role === 'leader' ? '👑' : relChar.role === 'worker' ? '🧑‍🌾' : '🙂';
            relIcon.style.fontSize = '1.1em';
            relRow.appendChild(relIcon);
            // 名前
            const relName = document.createElement('span');
            relName.textContent = relChar.id;
            relName.style.color = '#222';
            relName.style.fontSize = '1em';
            relRow.appendChild(relName);
            // バー
            const relBarBg = document.createElement('div');
            relBarBg.style.background = '#eee';
            relBarBg.style.width = '70px';
            relBarBg.style.height = '10px';
            relBarBg.style.borderRadius = '5px';
            relBarBg.style.overflow = 'hidden';
            const relBar = document.createElement('div');
            relBar.style.background = '#81c784';
            relBar.style.height = '100%';
            relBar.style.width = Math.max(0, Math.min(100, val)) + '%';
            relBarBg.appendChild(relBar);
            relRow.appendChild(relBarBg);
            // 数値
            const relVal = document.createElement('span');
            relVal.textContent = val;
            relVal.style.fontSize = '0.95em';
            relVal.style.color = '#444';
            relRow.appendChild(relVal);
            relBox.appendChild(relRow);
        });
        rightSidebar.appendChild(relBox);
    }

    // ピン留めボタン
    const pinBox = document.createElement('div');
    pinBox.style.marginTop = '10px';
    const pinBtn = document.createElement('button');
    pinBtn.textContent = '★ お気に入り/注目';
    pinBtn.style.fontSize = '1em';
    pinBtn.style.padding = '4px 12px';
    pinBtn.style.borderRadius = '6px';
    pinBtn.style.border = '1px solid #aaa';
    pinBtn.style.background = '#fffbe7';
    pinBtn.style.cursor = 'pointer';
    pinBtn.onclick = () => {
        alert('ピン留め機能は今後実装予定です');
    };
    pinBox.appendChild(pinBtn);
    rightSidebar.appendChild(pinBox);
}

let selectedCharId = null;
let leftSidebar = null;
let rightSidebar = null;
// グループ色マップをグローバル化
let groupColorMap = {};

document.addEventListener('DOMContentLoaded', () => {
    leftSidebar = document.getElementById('sidebar-left');
    rightSidebar = document.getElementById('sidebar-right');
    // window.charactersがセットされていれば描画、なければ何もしない
    if (window.characters && Array.isArray(window.characters) && window.characters.length > 0) {
        renderCharacterList();
    }
});
console.log('[sidebar.js] loaded');
// グローバルから呼び出せるように
window.renderCharacterList = renderCharacterList;
window.renderCharacterDetail = renderCharacterDetail;

function renderCharacterList() {
    console.log('[sidebar.js] window.characters:', window.characters);
    if (!leftSidebar) return;
    if (!window.characters || !Array.isArray(window.characters) || window.characters.length === 0) {
        // window.charactersが未セットなら何も表示しない
        leftSidebar.innerHTML = '';
        rightSidebar && (rightSidebar.innerHTML = '');
        return;
    }

    leftSidebar.innerHTML = '<h3 style="color:#222;margin-bottom:8px;">キャラクター一覧</h3>';

    // 初期選択キャラが未設定なら自動で最初のキャラを選択
    if (!selectedCharId && window.characters.length > 0) {
        selectedCharId = window.characters[0].id;
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
            li.appendChild(badge);
            // ナンバリング
            const numSpan = document.createElement('span');
            numSpan.textContent = `${idx + 1}.`;
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
    // 未所属キャラ
    if (ungrouped.length > 0) {
        const groupBlock = document.createElement('div');
        groupBlock.className = 'group-block group-block-ungrouped';
        const groupTitle = document.createElement('div');
        groupTitle.className = 'group-title';
        groupTitle.style.fontWeight = 'bold';
        groupTitle.style.marginBottom = '8px';
        groupTitle.style.fontSize = '1.1em';
        groupTitle.style.color = '#444'; // 明示的な色指定
        groupTitle.textContent = `未所属（${ungrouped.length}人）`;
        groupBlock.appendChild(groupTitle);
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        ungrouped.forEach((char, idx) => {
            const li = document.createElement('li');
            li.className = 'char-list-item';
            li.style.borderLeft = '5px solid #bbb';
            li.style.display = 'flex';
            li.style.alignItems = 'center';
            li.style.gap = '6px';
            const badge = document.createElement('span');
            badge.className = 'char-badge';
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
            li.appendChild(badge);
            // ナンバリング
            const numSpan = document.createElement('span');
            numSpan.textContent = `${idx + 1}.`;
            numSpan.style.color = '#888';
            numSpan.style.fontWeight = 'bold';
            numSpan.style.fontSize = '1.05em';
            li.appendChild(numSpan);
            // キャラ名（id）: idが数字のみの場合は表示しない
            if (!/^\d+$/.test(String(char.id))) {
                const nameSpan = document.createElement('span');
                nameSpan.textContent = char.id;
                nameSpan.style.color = '#222';
                nameSpan.style.fontWeight = char.role === 'leader' ? 'bold' : 'normal';
                nameSpan.style.fontSize = '1.05em';
                // 労働者の文字色を黒系に強制
                if (char.role === 'worker') nameSpan.style.color = '#222';
                li.appendChild(nameSpan);
            }
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
    }
}
