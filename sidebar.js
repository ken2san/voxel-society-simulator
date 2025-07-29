
let selectedCharId = null;
let leftSidebar = null;
let rightSidebar = null;

document.addEventListener('DOMContentLoaded', () => {
    leftSidebar = document.getElementById('sidebar-left');
    rightSidebar = document.getElementById('sidebar-right');
    renderCharacterList();
});
console.log('[sidebar.js] loaded');

function renderCharacterList() {
    if (!leftSidebar) return;
    if (!window.characters) {
        leftSidebar.innerHTML = '<h3 style="color:#222;margin-bottom:8px;">テスト用ダミーリスト</h3>';
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        ul.style.color = '#222';
        for (let i = 1; i <= 3; i++) {
            const li = document.createElement('li');
            li.className = 'char-list-item';
            const badge = document.createElement('span');
            badge.className = 'char-badge';
            badge.textContent = '😀';
            li.appendChild(badge);
            const nameSpan = document.createElement('span');
            nameSpan.textContent = `ダミーキャラ${i}`;
            nameSpan.style.color = '#222';
            nameSpan.style.fontWeight = 'bold';
            li.appendChild(nameSpan);
            ul.appendChild(li);
        }
        leftSidebar.appendChild(ul);
        return;
    }

    leftSidebar.innerHTML = '<h3 style="color:#222;margin-bottom:8px;">キャラクター一覧</h3>';

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
    // グループ色（グループIDごとに色を割り当て）
    const groupColors = [
        '#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#4db6ac', '#ffb74d', '#90a4ae', '#f06292', '#a1887f'
    ];
    const groupIdList = Object.keys(groupMap).sort();
    let groupColorMap = {};
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
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        chars.forEach(char => {
            const li = document.createElement('li');
            li.className = 'char-list-item';
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
            const nameSpan = document.createElement('span');
            nameSpan.textContent = char.id;
            nameSpan.style.color = '#222';
            nameSpan.style.fontWeight = char.role === 'leader' ? 'bold' : 'normal';
            nameSpan.style.fontSize = '1.05em';
            li.appendChild(nameSpan);
            ul.appendChild(li);
            li.onclick = () => {
                selectedCharId = char.id;
                renderCharacterDetail();
            };
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
        groupTitle.textContent = `未所属（${ungrouped.length}人）`;
        groupBlock.appendChild(groupTitle);
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        ungrouped.forEach(char => {
            const li = document.createElement('li');
            li.className = 'char-list-item';
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
            const nameSpan = document.createElement('span');
            nameSpan.textContent = char.id;
            nameSpan.style.color = '#222';
            nameSpan.style.fontWeight = char.role === 'leader' ? 'bold' : 'normal';
            nameSpan.style.fontSize = '1.05em';
            li.appendChild(nameSpan);
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
