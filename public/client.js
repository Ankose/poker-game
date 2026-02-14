const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
    timeout: 20000
});

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const nextBtn = document.getElementById('nextBtn');
const roomDisplay = document.getElementById('roomDisplay');
const roomInfo = document.getElementById('roomInfo');
const topPot = document.getElementById('topPot');
const topPlayerCount = document.getElementById('topPlayerCount');
const potAmount = document.getElementById('potAmount');
const gameStatus = document.getElementById('gameStatus');
const communityCards = document.getElementById('communityCards');
const playerSeats = document.getElementById('playerSeats');
const yourCards = document.getElementById('yourCards');
const yourStatus = document.getElementById('yourStatus');
const actionButtons = document.getElementById('actionButtons');
const raiseAmount = document.getElementById('raiseAmount');
const callAmount = document.getElementById('callAmount');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChat = document.getElementById('sendChat');
const waitingList = document.getElementById('waitingList');
const waitingPlayers = document.getElementById('waitingPlayers');
const timerDisplay = document.getElementById('timerDisplay');
const timerSeconds = document.getElementById('timerSeconds');
const timerCircle = document.getElementById('timerCircle');
const timerPlayerName = document.getElementById('timerPlayerName');
const awayBtn = document.getElementById('awayBtn');
const showdownModal = document.getElementById('showdownModal');
const showdownPlayers = document.getElementById('showdownPlayers');
const closeShowdown = document.getElementById('closeShowdown');
const exitBtn = document.getElementById('exitBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettings = document.getElementById('closeSettings');
const rebuyBtn = document.getElementById('rebuyBtn');
const historySidebar = document.getElementById('historySidebar');
const historyBtn = document.getElementById('historyBtn');
const closeHistory = document.getElementById('closeHistory');
const clearHistory = document.getElementById('clearHistory');

let mySocketId = null;
let currentRoom = '';
let gameState = null;
let myPlayerName = '';
let reconnectAttempted = false;
let myHandDescription = '';
let timerInterval = null;
let timerStartTime = null;
let isAway = false;

// ========== BROWSER LOCK FUNCTIONS ==========

function getStorageKey(roomId) {
    return 'poker_room_' + roomId;
}

function isAlreadyInRoom(roomId) {
    const key = getStorageKey(roomId);
    const data = localStorage.getItem(key);

    if (!data) return false;

    try {
        const parsed = JSON.parse(data);
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        if (parsed.timestamp < twoHoursAgo) {
            localStorage.removeItem(key);
            return false;
        }
        return parsed.joined === true;
    } catch (e) {
        return false;
    }
}

function markRoomJoined(roomId) {
    const key = getStorageKey(roomId);
    localStorage.setItem(key, JSON.stringify({
        joined: true,
        timestamp: Date.now(),
        playerName: myPlayerName
    }));
    console.log('🔒 Browser locked to room:', roomId);
}

function clearRoomJoin(roomId) {
    const key = getStorageKey(roomId);
    localStorage.removeItem(key);
    console.log('🔓 Browser lock cleared for room:', roomId);
}

// ========== END BROWSER LOCK FUNCTIONS ==========

// ========== TOAST NOTIFICATION SYSTEM ==========

const toastQueue = [];
let activeToasts = 0;
const MAX_TOASTS = 3;

function showToast(type, title, message, duration = 4000) {
    const toast = {
        type,
        title,
        message,
        duration
    };

    toastQueue.push(toast);
    processToastQueue();
}

function processToastQueue() {
    if (activeToasts >= MAX_TOASTS || toastQueue.length === 0) return;

    const toast = toastQueue.shift();
    createToast(toast);
}

function createToast({ type, title, message, duration }) {
    activeToasts++;

    const container = document.getElementById('toastContainer');
    const toastEl = document.createElement('div');
    toastEl.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };

    toastEl.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" aria-label="Close">✕</button>
    `;

    container.appendChild(toastEl);

    const closeBtn = toastEl.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toastEl));

    const timeoutId = setTimeout(() => removeToast(toastEl), duration);

    toastEl.addEventListener('mouseenter', () => {
        clearTimeout(timeoutId);
        toastEl.style.animationPlayState = 'paused';
    });

    toastEl.addEventListener('mouseleave', () => {
        setTimeout(() => removeToast(toastEl), 1000);
    });
}

function removeToast(toastEl) {
    if (toastEl.classList.contains('removing')) return;

    toastEl.classList.add('removing');

    setTimeout(() => {
        toastEl.remove();
        activeToasts--;
        processToastQueue();
    }, 300);
}

function toastSuccess(message) {
    showToast('success', 'Success', message);
}

function toastError(message) {
    showToast('error', 'Error', message);
}

function toastInfo(message) {
    showToast('info', 'Info', message);
}

function toastWarning(message) {
    showToast('warning', 'Warning', message);
}

// ========== END TOAST SYSTEM ==========

// ========== SETTINGS PANEL SYSTEM ==========

settingsBtn.addEventListener('click', () => {
    openSettingsPanel();
});

closeSettings.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
    }
});

function openSettingsPanel() {
    const room = gameState;
    if (!room) return;

    if (room.settings) {
        document.getElementById('startingChips').value = room.settings.startingChips || 1000;
        document.getElementById('smallBlind').value = room.settings.smallBlind || 10;
        document.getElementById('bigBlind').value = room.settings.bigBlind || 20;
        document.getElementById('turnTimer').value = room.settings.turnTimer || 60;
        document.getElementById('rebuyEnabled').checked = room.settings.rebuyEnabled || false;
        document.getElementById('rebuyAmount').value = room.settings.rebuyAmount || 1000;
    }

    const gameSettingsInputs = ['startingChips', 'smallBlind', 'bigBlind', 'turnTimer'];
    gameSettingsInputs.forEach(id => {
        const input = document.getElementById(id);
        input.disabled = room.handInProgress;
    });

    updatePlayerManagementList();
    updateRebuyRequestsList();

    settingsModal.classList.remove('hidden');
}

function updatePlayerManagementList() {
    const list = document.getElementById('playerManagementList');
    list.innerHTML = '';

    if (!gameState || !gameState.players) return;

    gameState.players.forEach(player => {
        const item = document.createElement('div');
        item.className = 'player-management-item';

        const isMe = player.id === mySocketId;

        item.innerHTML = `
            <div class="player-management-info">
                <div class="player-management-name">${escapeHtml(player.name)}${isMe ? ' (You)' : ''}</div>
                <div class="player-management-chips">💰 $${player.chips}</div>
            </div>
            <div class="player-management-actions">
                ${!isMe ? `
                    <button class="btn-small btn-give" data-player-id="${player.id}">Give Chips</button>
                    <button class="btn-small btn-kick" data-player-id="${player.id}">Kick</button>
                ` : ''}
            </div>
        `;

        list.appendChild(item);
    });

    list.querySelectorAll('.btn-give').forEach(btn => {
        btn.addEventListener('click', () => {
            const playerId = btn.dataset.playerId;
            const amount = parseInt(document.getElementById('giveChipsAmount').value);

            if (!amount || amount < 1) {
                toastError('Please enter a valid chip amount');
                return;
            }

            socket.emit('giveChips', { playerId, amount });
            toastSuccess('Chips sent to player');
        });
    });

    list.querySelectorAll('.btn-kick').forEach(btn => {
        btn.addEventListener('click', () => {
            const playerId = btn.dataset.playerId;
            const playerName = gameState.players.find(p => p.id === playerId)?.name;

            if (confirm(`Are you sure you want to kick ${playerName}?`)) {
                socket.emit('kickPlayer', playerId);
                toastInfo(`${playerName} was kicked`);
            }
        });
    });
}

function updateRebuyRequestsList() {
    const section = document.getElementById('rebuyRequestsSection');
    const list = document.getElementById('rebuyRequestsList');

    if (!gameState || !gameState.rebuyRequests || gameState.rebuyRequests.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    list.innerHTML = '';

    gameState.rebuyRequests.forEach(request => {
        const item = document.createElement('div');
        item.className = 'rebuy-request-item';

        item.innerHTML = `
            <div>
                <strong>${escapeHtml(request.playerName)}</strong> wants to rebuy
            </div>
            <div class="player-management-actions">
                <button class="btn-small btn-give" data-player-id="${request.playerId}">Approve</button>
                <button class="btn-small btn-kick" data-player-id="${request.playerId}">Deny</button>
            </div>
        `;

        list.appendChild(item);
    });

    list.querySelectorAll('.btn-give').forEach(btn => {
        btn.addEventListener('click', () => {
            const playerId = btn.dataset.playerId;
            socket.emit('handleRebuy', { playerId, approved: true });
            toastSuccess('Rebuy approved');
        });
    });

    list.querySelectorAll('.btn-kick').forEach(btn => {
        btn.addEventListener('click', () => {
            const playerId = btn.dataset.playerId;
            socket.emit('handleRebuy', { playerId, approved: false });
            toastInfo('Rebuy denied');
        });
    });
}

document.getElementById('saveSettings').addEventListener('click', () => {
    const newSettings = {
        startingChips: parseInt(document.getElementById('startingChips').value),
        smallBlind: parseInt(document.getElementById('smallBlind').value),
        bigBlind: parseInt(document.getElementById('bigBlind').value),
        turnTimer: parseInt(document.getElementById('turnTimer').value),
        rebuyEnabled: document.getElementById('rebuyEnabled').checked,
        rebuyAmount: parseInt(document.getElementById('rebuyAmount').value)
    };

    if (newSettings.bigBlind <= newSettings.smallBlind) {
        toastError('Big blind must be greater than small blind');
        return;
    }

    socket.emit('updateSettings', newSettings);
    settingsModal.classList.add('hidden');
});

rebuyBtn.addEventListener('click', () => {
    if (confirm('Request a rebuy from the host?')) {
        socket.emit('requestRebuy');
        rebuyBtn.classList.add('hidden');
        toastInfo('Rebuy requested. Waiting for host approval...');
    }
});

// ========== END SETTINGS SYSTEM ==========

// ========== HAND HISTORY SIDEBAR ==========

historyBtn.addEventListener('click', () => {
    historySidebar.classList.toggle('hidden');
    updateHistoryDisplay();
});

closeHistory.addEventListener('click', () => {
    historySidebar.classList.add('hidden');
});

clearHistory.addEventListener('click', () => {
    if (confirm('Clear all hand history?')) {
        document.getElementById('historyContent').innerHTML = 
            '<p class="history-empty">No hands played yet</p>';
    }
});

function updateHistoryDisplay() {
    const content = document.getElementById('historyContent');

    if (!gameState || !gameState.handHistory || gameState.handHistory.length === 0) {
        content.innerHTML = '<p class="history-empty">No hands played yet</p>';
        return;
    }

    content.innerHTML = '';

    gameState.handHistory.forEach(hand => {
        const handEl = createHandElement(hand);
        content.appendChild(handEl);
    });
}

function createHandElement(hand) {
    const div = document.createElement('div');
    div.className = 'history-hand';

    const winners = hand.winners || [];
    const winnerText = winners.length === 1 
        ? `${winners[0].playerName} won $${winners[0].amount}`
        : `Split pot: $${hand.pot}`;

    const handRank = winners[0]?.handRank || 'Unknown';

    div.innerHTML = `
        <div class="history-hand-header">
            <div>
                <div class="history-hand-title">Hand #${hand.handNumber}</div>
                <div class="history-hand-subtitle">${winnerText}</div>
            </div>
            <div class="history-expand-icon">▼</div>
        </div>
        <div class="history-hand-details">
            <div class="history-hand-body">
                <div class="history-section">
                    <div class="history-section-title">Community Cards</div>
                    <div class="history-community-cards">
                        ${hand.communityCards.map(card => createHistoryCard(card)).join('')}
                    </div>
                </div>

                <div class="history-section">
                    <div class="history-section-title">Winner${winners.length > 1 ? 's' : ''}</div>
                    ${winners.map(winner => `
                        <div class="history-player">
                            <div class="history-player-name winner">
                                ✅ ${escapeHtml(winner.playerName)} - $${winner.amount}
                            </div>
                            <div class="history-player-hand">${escapeHtml(winner.handRank)}</div>
                            <div class="history-player-cards">
                                ${winner.cards.map(card => createHistoryCard(card)).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="history-section">
                    <div class="history-section-title">All Players</div>
                    ${hand.players.map(player => `
                        <div class="history-player">
                            <div class="history-player-name">
                                ${escapeHtml(player.playerName)}
                            </div>
                            ${player.folded ? 
                                '<div class="history-player-info">Folded</div>' :
                                `<div class="history-player-cards">
                                    ${player.cards.map(card => createHistoryCard(card)).join('')}
                                </div>
                                <div class="history-player-info">Final chips: $${player.finalChips}</div>`
                            }
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    const header = div.querySelector('.history-hand-header');
    header.addEventListener('click', () => {
        div.classList.toggle('expanded');
    });

    return div;
}

function createHistoryCard(card) {
    const isRed = card.suit === '♥' || card.suit === '♦';
    return `
        <div class="history-card ${isRed ? 'red' : 'black'}">
            <div class="history-card-rank">${escapeHtml(card.rank)}</div>
            <div class="history-card-suit">${card.suit}</div>
        </div>
    `;
}

// ========== END HISTORY SYSTEM ==========

// ========== SOCKET CONNECTION HANDLERS ==========

socket.on('connect', () => {
    mySocketId = socket.id;
    console.log('Connected to server:', mySocketId);

    if (reconnectAttempted && currentRoom && myPlayerName) {
        console.log('Attempting to rejoin room:', currentRoom);
        socket.emit('joinGame', { playerName: myPlayerName, roomId: currentRoom });
        reconnectAttempted = false;
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    reconnectAttempted = true;
    toastWarning('Connection lost. Reconnecting...');
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    toastError('Connection error. Retrying...');
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    toastSuccess('Reconnected to server');
});

// ========== JOIN GAME ==========

joinBtn.addEventListener('click', handleJoin);
playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoin();
});
roomCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoin();
});

function handleJoin() {
    const name = playerNameInput.value.trim();
    let room = roomCodeInput.value.trim().toUpperCase();

    if (!name) {
        toastError('Please enter your name');
        playerNameInput.focus();
        return;
    }

    if (name.length < 2 || name.length > 20) {
        toastError('Name must be 2-20 characters');
        playerNameInput.focus();
        return;
    }

    if (!room) {
        myPlayerName = name;
        console.log('Joining game:', { name, room: 'new room' });
        socket.emit('joinGame', { playerName: name, roomId: room });
        return;
    }

    if (isAlreadyInRoom(room)) {
        const key = getStorageKey(room);
        const data = localStorage.getItem(key);
        let existingName = 'a player';

        try {
            const parsed = JSON.parse(data);
            if (parsed.playerName) {
                existingName = parsed.playerName;
            }
        } catch (e) {}

        toastError('You are already in room ' + room + ' as "' + existingName + '"');
        roomCodeInput.value = '';
        roomCodeInput.focus();
        return;
    }

    myPlayerName = name;
    console.log('Joining game:', { name, room: room || 'new room' });
    socket.emit('joinGame', { playerName: name, roomId: room });
}

// ========== GAME CONTROLS ==========

startBtn.addEventListener('click', () => {
    console.log('Starting game...');
    socket.emit('startGame');
});

nextBtn.addEventListener('click', () => {
    console.log('Starting next hand...');
    socket.emit('nextHand');
});

awayBtn.addEventListener('click', () => {
    isAway = !isAway;
    socket.emit('toggleAway');

    if (isAway) {
        awayBtn.classList.add('active');
        awayBtn.querySelector('.away-text').textContent = 'Back';
    } else {
        awayBtn.classList.remove('active');
        awayBtn.querySelector('.away-text').textContent = 'Away';
    }

    console.log('Away status toggled:', isAway);
});

exitBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this game?\n\nYou will be removed from the room.')) {
        console.log('Exiting game...');

        if (currentRoom) {
            clearRoomJoin(currentRoom);
        }

        socket.disconnect();

        currentRoom = '';
        myPlayerName = '';
        gameState = null;

        gameScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');

        playerNameInput.value = '';
        roomCodeInput.value = '';
        playerNameInput.focus();

        setTimeout(() => {
            socket.connect();
        }, 500);

        toastSuccess('Left game successfully');
        console.log('✅ Exited game successfully');
    }
});

closeShowdown.addEventListener('click', () => {
    showdownModal.classList.add('hidden');
});

// ========== ACTION BUTTONS ==========

document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        let amount = 0;

        if (action === 'raise') {
            amount = parseInt(raiseAmount.value) || 0;
            const minRaise = gameState?.minRaise || 20;

            if (amount < minRaise) {
                toastError('Minimum raise is $' + minRaise);
                raiseAmount.focus();
                raiseAmount.select();
                return;
            }

            const me = gameState?.players.find(p => p.id === mySocketId);
            if (me && amount > me.chips) {
                toastError('You only have $' + me.chips + ' chips');
                raiseAmount.value = me.chips;
                raiseAmount.focus();
                raiseAmount.select();
                return;
            }
        }

        console.log('Player action:', action, amount);
        socket.emit('playerAction', { action, amount });
    });
});

// ========== CHAT ==========

sendChat.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const msg = chatInput.value.trim();
    if (!msg) return;

    if (msg.length > 200) {
        toastError('Message too long (max 200 characters)');
        return;
    }

    socket.emit('chatMessage', msg);
    chatInput.value = '';
    chatInput.focus();
}

// ========== COPY ROOM CODE ==========

roomInfo.addEventListener('click', () => {
    if (!currentRoom) return;

    navigator.clipboard.writeText(currentRoom).then(() => {
        const original = roomDisplay.textContent;
        roomDisplay.textContent = '✓ Copied!';
        setTimeout(() => {
            roomDisplay.textContent = original;
        }, 2000);
    }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = currentRoom;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);

        const original = roomDisplay.textContent;
        roomDisplay.textContent = '✓ Copied!';
        setTimeout(() => {
            roomDisplay.textContent = original;
        }, 2000);
    });
});

// ========== TIMER FUNCTIONS ==========

function startTimer(playerName) {
    stopTimer();

    timerStartTime = Date.now();
    timerPlayerName.textContent = playerName;
    timerDisplay.classList.remove('hidden');

    updateTimerDisplay();

    timerInterval = setInterval(() => {
        updateTimerDisplay();
    }, 100);
}

function updateTimerDisplay() {
    const elapsed = Date.now() - timerStartTime;
    const remaining = Math.max(0, 60 - Math.floor(elapsed / 1000));

    timerSeconds.textContent = remaining;

    const progress = remaining / 60;
    const dashOffset = 283 * (1 - progress);
    timerCircle.style.strokeDashoffset = dashOffset;

    if (remaining > 40) {
        timerCircle.style.stroke = '#10b981';
    } else if (remaining > 20) {
        timerCircle.style.stroke = '#f59e0b';
    } else {
        timerCircle.style.stroke = '#ef4444';
    }

    if (remaining === 0) {
        stopTimer();
    }
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    timerDisplay.classList.add('hidden');
}

// ========== SHOWDOWN MODAL ==========

function showShowdown(players) {
    showdownPlayers.innerHTML = '';

    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'showdown-player';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'showdown-player-name';
        nameDiv.textContent = player.name;

        const handDiv = document.createElement('div');
        handDiv.className = 'showdown-player-hand';
        handDiv.textContent = player.hand || '';

        const cardsDiv = document.createElement('div');
        cardsDiv.className = 'showdown-player-cards';

        if (player.cards && player.cards.length > 0) {
            player.cards.forEach(card => {
                const cardEl = createCard(card);
                cardsDiv.appendChild(cardEl);
            });
        }

        div.appendChild(nameDiv);
        if (player.hand) {
            div.appendChild(handDiv);
        }
        div.appendChild(cardsDiv);

        showdownPlayers.appendChild(div);
    });

    showdownModal.classList.remove('hidden');

    setTimeout(() => {
        showdownModal.classList.add('hidden');
    }, 12000);
}

// ========== SOCKET EVENT HANDLERS ==========

socket.on('roomAssigned', (room) => {
    currentRoom = room;
    roomDisplay.textContent = 'Room: ' + room;

    console.log('Room assigned:', room);
    markRoomJoined(room);

    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    toastSuccess('Joined room ' + room);

    addChat({
        type: 'system',
        text: '🎮 Joined room: ' + room
    });

    addChat({
        type: 'system',
        text: '💡 Share this code with friends to play together!'
    });
});

socket.on('gameState', (state) => {
    const previousState = gameState;
    gameState = state;

    console.log('Game state updated:', {
        players: state.players.length,
        waiting: state.waitingPlayers.length,
        pot: state.pot,
        handInProgress: state.handInProgress
    });

    // Show showdown if available
    if (!state.handInProgress && state.showdownCards && state.showdownCards.length > 0) {
        console.log('Showdown data received:', state.showdownCards);
        showShowdown(state.showdownCards);
    }

    // Update history sidebar if open
    if (!historySidebar.classList.contains('hidden')) {
        updateHistoryDisplay();
    }

    updateGame(state);
});

socket.on('privateState', (state) => {
    console.log('Private state received:', state.cards.length, 'cards');
    if (state.handDescription) {
        console.log('Your hand:', state.handDescription);
        myHandDescription = state.handDescription;
    } else {
        myHandDescription = '';
    }
    updateCards(state.cards);
});

socket.on('chatMessage', (msg) => {
    addChat(msg);
});

socket.on('error', (msg) => {
    console.error('Server error:', msg);
    toastError(msg);
});

socket.on('settingsUpdated', (settings) => {
    toastSuccess('Game settings updated');
    console.log('Settings updated:', settings);
});

socket.on('rebuyRequest', ({ playerId, playerName }) => {
    toastInfo(playerName + ' requested a rebuy');

    if (!settingsModal.classList.contains('hidden')) {
        updateRebuyRequestsList();
    }
});

socket.on('kicked', (reason) => {
    toastError(reason);

    if (currentRoom) {
        clearRoomJoin(currentRoom);
    }

    setTimeout(() => {
        window.location.reload();
    }, 2000);
});

// ========== UPDATE GAME UI ==========

function updateGame(state) {
    topPot.textContent = '$' + state.pot;
    topPlayerCount.textContent = state.players.length;

    potAmount.textContent = '$' + state.pot;
    gameStatus.textContent = state.lastAction || 'Waiting...';

    // Community cards
    communityCards.innerHTML = '';
    if (state.communityCards && state.communityCards.length > 0) {
        state.communityCards.forEach(card => {
            communityCards.appendChild(createCard(card));
        });
    }

    // Players
    playerSeats.innerHTML = '';
    state.players.forEach((player, idx) => {
        const seat = document.createElement('div');
        seat.className = 'player-seat';

        const card = document.createElement('div');
        card.className = 'player-card';

        if (idx === state.currentPlayerIndex && state.handInProgress) {
            card.classList.add('active');
        }

        if (idx === state.dealerIndex) {
            card.classList.add('dealer');
        }

        if (player.folded) {
            card.classList.add('folded');
        }

        if (player.isAway) {
            card.classList.add('away');
        }

        const isYou = player.id === mySocketId;
        let statusHTML = '';

        if (player.isAway) {
            statusHTML = '<div class="player-status away-status">AWAY</div>';
        } else if (player.folded) {
            statusHTML = '<div class="player-status">FOLDED</div>';
        } else if (player.allIn) {
            statusHTML = '<div class="player-status">ALL-IN</div>';
        }

        card.innerHTML = `
            <div class="player-name">${escapeHtml(player.name)}${isYou ? ' (You)' : ''}</div>
            <div class="player-chips">💰 $${player.chips}</div>
            ${player.bet > 0 ? '<div class="player-bet">Bet: $' + player.bet + '</div>' : ''}
            ${statusHTML}
        `;

        seat.appendChild(card);
        playerSeats.appendChild(seat);
    });

    // Waiting players
    if (state.waitingPlayers && state.waitingPlayers.length > 0) {
        waitingList.classList.remove('hidden');
        waitingPlayers.innerHTML = '';
        state.waitingPlayers.forEach(p => {
            const div = document.createElement('div');
            div.className = 'waiting-player';
            div.textContent = p.name + (p.id === mySocketId ? ' (You)' : '');
            waitingPlayers.appendChild(div);
        });
    } else {
        waitingList.classList.add('hidden');
    }

    // Your status
    const me = state.players.find(p => p.id === mySocketId);
    if (me) {
        let statusText = '';

        if (me.isAway) {
            statusText = 'You are away';
        } else if (me.folded) {
            statusText = 'You folded';
        } else if (me.allIn) {
            statusText = 'ALL-IN';
        } else if (state.handInProgress) {
            statusText = '$' + me.chips;
        }

        if (myHandDescription && state.communityCards.length >= 3 && !me.folded && !me.isAway) {
            statusText = myHandDescription + (statusText ? ' | ' + statusText : '');
        }

        yourStatus.textContent = statusText;
    } else {
        yourStatus.textContent = 'Waiting to join...';
    }

    // Action buttons
    const myTurn = state.players[state.currentPlayerIndex]?.id === mySocketId;
    if (myTurn && state.handInProgress && me && !me.folded && !me.allIn && !me.isAway) {
        actionButtons.classList.remove('hidden');
        updateActions(state, me);
    } else {
        actionButtons.classList.add('hidden');
    }

    // Timer control
    if (state.handInProgress && state.currentPlayerIndex >= 0) {
        const currentPlayer = state.players[state.currentPlayerIndex];
        if (currentPlayer && !currentPlayer.folded && !currentPlayer.allIn && !currentPlayer.isAway) {
            startTimer(currentPlayer.name);
        } else {
            stopTimer();
        }
    } else {
        stopTimer();
    }

    // Control buttons (host only)
    const isHost = mySocketId === state.hostId;

    if (isHost) {
        settingsBtn.classList.remove('hidden');
    } else {
        settingsBtn.classList.add('hidden');
    }

    if (me && me.chips === 0 && state.settings?.rebuyEnabled) {
        rebuyBtn.classList.remove('hidden');
    } else {
        rebuyBtn.classList.add('hidden');
    }

    if (isHost) {
        if (!state.handInProgress && state.players.length >= 2) {
            startBtn.classList.remove('hidden');
            nextBtn.classList.remove('hidden');
        } else {
            startBtn.classList.add('hidden');
            nextBtn.classList.add('hidden');
        }
    } else {
        startBtn.classList.add('hidden');
        nextBtn.classList.add('hidden');
    }
}

function updateActions(state, me) {
    const checkBtn = document.querySelector('.check-btn');
    const callBtn = document.querySelector('.call-btn');
    const callAmt = state.currentBet - me.bet;

    if (callAmt > 0) {
        callBtn.style.display = 'flex';
        checkBtn.style.display = 'none';
        callAmount.textContent = '$' + callAmt;
    } else {
        callBtn.style.display = 'none';
        checkBtn.style.display = 'flex';
    }

    const minRaise = state.minRaise || 20;
    raiseAmount.min = minRaise;
    raiseAmount.max = me.chips;
    raiseAmount.value = Math.min(minRaise * 2, me.chips);
    raiseAmount.step = 10;
}

function updateCards(cards) {
    yourCards.innerHTML = '';
    if (cards && cards.length > 0) {
        cards.forEach(card => {
            yourCards.appendChild(createCard(card));
        });
    }
}

function createCard(card) {
    const div = document.createElement('div');
    const isRed = card.suit === '♥' || card.suit === '♦';
    div.className = 'card ' + (isRed ? 'red' : 'black');
    div.innerHTML = `
        <div class="card-rank">${escapeHtml(card.rank)}</div>
        <div class="card-suit">${card.suit}</div>
    `;
    return div;
}

function addChat(msg) {
    const div = document.createElement('div');
    div.className = 'chat-message ' + msg.type;

    if (msg.type === 'system') {
        div.textContent = msg.text;
    } else {
        const sender = document.createElement('span');
        sender.className = 'chat-sender';
        sender.textContent = msg.name + ':';

        const text = document.createTextNode(' ' + msg.text);

        div.appendChild(sender);
        div.appendChild(text);
    }

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    while (chatMessages.children.length > 100) {
        chatMessages.removeChild(chatMessages.firstChild);
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// ========== KEYBOARD SHORTCUTS ==========

document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA') {
        return;
    }

    if (!actionButtons.classList.contains('hidden')) {
        const key = e.key.toLowerCase();

        if (key === 'f') {
            e.preventDefault();
            document.querySelector('.fold-btn')?.click();
        } else if (key === 'c') {
            e.preventDefault();
            const check = document.querySelector('.check-btn');
            const call = document.querySelector('.call-btn');
            if (check && check.style.display !== 'none') {
                check.click();
            } else if (call && call.style.display !== 'none') {
                call.click();
            }
        } else if (key === 'r') {
            e.preventDefault();
            raiseAmount.focus();
            raiseAmount.select();
        }
    }
});

playerNameInput.focus();

console.log('🎰 Poker client initialized');
console.log('📡 Socket.IO configured with reconnection');
console.log('🃏 Hand evaluation enabled');
console.log('⏱️  60-second timer enabled');
console.log('🎴 Showdown display enabled');
console.log('🚶 Away mode enabled');
console.log('🔒 Browser lock enabled - one seat per device per room');
console.log('🎨 Toast notifications enabled');
console.log('⚙️  Settings panel enabled');
console.log('📜 Hand history enabled');
