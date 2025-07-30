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
// 右サイドバー：選択キャラ詳細
function renderCharacterDetail() {
    if (!rightSidebar) return;
    // ダミー表示テスト: 条件を満たさない場合はダミーを表示
    if (selectedCharId === null || selectedCharId === undefined || !window.characters) {
        rightSidebar.innerHTML = '<div style="padding:24px;color:#888;font-size:1.2em;">[Dummy] No character selected.<br>右サイドバーのテスト表示</div>';
        return;
    }
    const char = window.characters.find(c => c.id == selectedCharId);
    if (!char) {
        rightSidebar.innerHTML = '<div style="padding:24px;color:#888;font-size:1.2em;">[Dummy] Character not found.<br>右サイドバーのテスト表示</div>';
        return;
    }
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
                label.style.width = '80px'; // さらに幅を広げて折り返し防止
                label.style.fontSize = '0.98em';
                label.style.color = '#444';
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
                val.textContent = Math.round(char.needs[st.key]);
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

let selectedCharId = undefined;
let leftSidebar = null;
let rightSidebar = null;
// グループ色マップをグローバル化
let groupColorMap = {};
// サマリー表で開いている詳細キャラID
let openedCharId = undefined;

document.addEventListener('DOMContentLoaded', () => {
    leftSidebar = document.getElementById('sidebar-left');
    // 右サイドバーのDOMが残っていれば消去
    const rightSidebarElem = document.getElementById('sidebar-right');
    if (rightSidebarElem) rightSidebarElem.remove();
    // leftSidebarの子要素で詳細カードっぽいものがあれば消去
    if (leftSidebar) {
        // 例: .character-detail-row など詳細カード用クラスを全て消す
        const detailRows = leftSidebar.querySelectorAll('.character-detail-row');
        detailRows.forEach(el => el.remove());
    }
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
        // ヘッダー
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        ['ID','顔','mood','空腹','エネ','安全','社交'].forEach(txt => {
            const th = document.createElement('th');
            th.textContent = txt;
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
            detailTd.colSpan = 7;
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
            // 顔
            const tdFace = document.createElement('td');
            let icon = '';
            if (char.role === 'leader') icon = '👑';
            else if (char.state === 'dead') icon = '💀';
            else if (char.state === 'resting') icon = '🛏️';
            else if (char.state === 'socializing') icon = '💬';
            else if (char.needs && char.needs.hunger < 30) icon = '🍎';
            else if (char.needs && char.needs.energy < 30) icon = '💤';
            else if (char.needs && char.needs.social < 30) icon = '👥';
            else if (char.state === 'moving') icon = '🚶';
            else icon = char.role === 'worker' ? '🧑‍🌾' : '🙂';
            tdFace.textContent = icon;
            tr.appendChild(tdFace);
            // mood
            const tdMood = document.createElement('td');
            tdMood.className = 'mood-td';
            const moodSpan = document.createElement('span');
            let moodIcon = '', moodClass = 'mood-neutral', moodText = '';
            switch (char.mood) {
                case 'happy':
                    moodIcon = '😄'; moodClass = 'mood-happy'; moodText = 'happy'; break;
                case 'tired':
                    moodIcon = '😪'; moodClass = 'mood-tired'; moodText = 'tired'; break;
                case 'lonely':
                    moodIcon = '😢'; moodClass = 'mood-lonely'; moodText = 'lonely'; break;
                case 'active':
                    moodIcon = '🚶'; moodClass = 'mood-active'; moodText = 'active'; break;
                case 'angry':
                    moodIcon = '😠'; moodClass = 'mood-angry'; moodText = 'angry'; break;
                case 'sad':
                    moodIcon = '😔'; moodClass = 'mood-sad'; moodText = 'sad'; break;
                default:
                    moodIcon = '🙂'; moodClass = 'mood-neutral'; moodText = 'neutral';
            }
            moodSpan.className = 'mood-badge ' + moodClass;
            moodSpan.textContent = `${moodIcon} ${moodText}`;
            tdMood.appendChild(moodSpan);
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
    // 上部: 顔＋ID＋グループ
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '16px';
    header.style.marginBottom = '10px';
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
    bigIcon.style.fontSize = '2.1em';
    bigIcon.style.border = '3px solid #bbb';
    bigIcon.style.borderRadius = '50%';
    bigIcon.style.padding = '7px';
    header.appendChild(bigIcon);
    const nameBox = document.createElement('div');
    nameBox.innerHTML = `<div style=\"font-size:1.15em;font-weight:bold;color:#222;\">${char.id}</div>` +
        `<div style=\"color:#888;font-size:0.98em;\">グループ${char.groupId ?? '未所属'}</div>` +
        `<div style=\"font-size:0.98em;color:#666;\">${char.role === 'leader' ? 'リーダー' : char.role === 'worker' ? '労働者' : '一般'}</div>`;
    // moodバッジ
    const moodSpan = document.createElement('span');
    let moodIcon = '', moodClass = 'mood-neutral', moodText = '';
    switch (char.mood) {
        case 'happy':
            moodIcon = '😄'; moodClass = 'mood-happy'; moodText = 'happy'; break;
        case 'tired':
            moodIcon = '😪'; moodClass = 'mood-tired'; moodText = 'tired'; break;
        case 'lonely':
            moodIcon = '😢'; moodClass = 'mood-lonely'; moodText = 'lonely'; break;
        case 'active':
            moodIcon = '🚶'; moodClass = 'mood-active'; moodText = 'active'; break;
        case 'angry':
            moodIcon = '😠'; moodClass = 'mood-angry'; moodText = 'angry'; break;
        case 'sad':
            moodIcon = '😔'; moodClass = 'mood-sad'; moodText = 'sad'; break;
        default:
            moodIcon = '🙂'; moodClass = 'mood-neutral'; moodText = '';
    }
    moodSpan.className = 'mood-badge ' + moodClass;
    moodSpan.textContent = moodClass === 'mood-neutral' ? moodIcon : `${moodIcon} ${moodText}`;
    moodSpan.style.marginLeft = '2px';
    nameBox.appendChild(moodSpan);
    header.appendChild(nameBox);
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
    // 移動ブロック距離
    let moveDistance = '-';
    if (typeof char.moveDistance === 'number') moveDistance = char.moveDistance;
    const moveDiv = document.createElement('div');
    moveDiv.innerHTML = `<b>移動距離（合計）:</b> ${moveDistance}`;
    infoBox.appendChild(moveDiv);
    // 現在の行動
    if (char.currentAction) {
        const actDiv = document.createElement('div');
        actDiv.innerHTML = `<b>現在の行動:</b> ${char.currentAction}`;
        infoBox.appendChild(actDiv);
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
