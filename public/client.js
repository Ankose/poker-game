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

// NEW: Timer, Away, Showdown elements
const timerDisplay = document.getElementById('timerDisplay');
const timerSeconds = document.getElementById('timerSeconds');
const timerCircle = document.getElementById('timerCircle');
const timerPlayerName = document.getElementById('timerPlayerName');
const awayBtn = document.getElementById('awayBtn');
const showdownModal = document.getElementById('showdownModal');
const showdownPlayers = document.getElementById('showdownPlayers');
const closeShowdown = document.getElementById('closeShowdown');

let mySocketId = null;
let currentRoom = '';
let gameState = null;
let myPlayerName = '';
let reconnectAttempted = false;
let myHandDescription = '';
let timerInterval = null; // NEW
let timerStartTime = null; // NEW
let isAway = false; // NEW

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
    addChat({
        type: 'system',
        text: '⚠️ Connection lost. Reconnecting...'
    });
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    addChat({
        type: 'system',
        text: '❌ Connection error. Retrying...'
    });
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    addChat({
        type: 'system',
        text: '✓ Reconnected to server'
    });
});

// Join Game
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
        alert('Please enter your name');
        playerNameInput.focus();
        return;
    }

    if (name.length < 2 || name.length > 20) {
        alert('Name must be 2-20 characters');
        playerNameInput.focus();
        return;
    }

    // Creating new room - no check needed
    if (!room) {
        myPlayerName = name;
        console.log('Joining game:', { name, room: 'new room' });
        socket.emit('joinGame', { playerName: name, roomId: room });
        return;
    }

    // Check if already in this room from this browser
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
        
        alert('⚠️ This browser is already in room ' + room + ' as "' + existingName + '"\n\nYou cannot join the same room multiple times from the same device.\n\nTo play with multiple accounts, use a different browser or device.');
        roomCodeInput.value = '';
        roomCodeInput.focus();
        return;
    }

    myPlayerName = name;
    console.log('Joining game:', { name, room: room || 'new room' });
    socket.emit('joinGame', { playerName: name, roomId: room });
}

// Game Controls
startBtn.addEventListener('click', () => {
    console.log('Starting game...');
    socket.emit('startGame');
});

nextBtn.addEventListener('click', () => {
    console.log('Starting next hand...');
    socket.emit('nextHand');
});

// NEW: Away Button
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

// NEW: Close Showdown
closeShowdown.addEventListener('click', () => {
    showdownModal.classList.add('hidden');
});

// Action Buttons
document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        let amount = 0;

        if (action === 'raise') {
            amount = parseInt(raiseAmount.value) || 0;
            const minRaise = gameState?.minRaise || 20;

            if (amount < minRaise) {
                alert('Minimum raise is $' + minRaise);
                raiseAmount.focus();
                raiseAmount.select();
                return;
            }

            const me = gameState?.players.find(p => p.id === mySocketId);
            if (me && amount > me.chips) {
                alert('You only have $' + me.chips + ' chips');
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

// Chat
sendChat.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const msg = chatInput.value.trim();
    if (!msg) return;

    if (msg.length > 200) {
        alert('Message too long (max 200 characters)');
        return;
    }

    socket.emit('chatMessage', msg);
    chatInput.value = '';
    chatInput.focus();
}

// Copy Room Code
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

// NEW: Timer Functions
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

    // Update circle (circumference = 2 * π * 45 = 282.74)
    const progress = remaining / 60;
    const dashOffset = 283 * (1 - progress);
    timerCircle.style.strokeDashoffset = dashOffset;

    // Color based on time
    if (remaining > 40) {
        timerCircle.style.stroke = '#10b981'; // Green
    } else if (remaining > 20) {
        timerCircle.style.stroke = '#f59e0b'; // Orange
    } else {
        timerCircle.style.stroke = '#ef4444'; // Red
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

// NEW: Show Showdown Modal
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

    // Auto-close after 12 seconds
    setTimeout(() => {
        showdownModal.classList.add('hidden');
    }, 12000);
}

// Socket Events
socket.on('roomAssigned', (room) => {
    currentRoom = room;
    roomDisplay.textContent = 'Room: ' + room;

    console.log('Room assigned:', room);

    loginScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

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
    gameState = state;
    console.log('Game state updated:', {
        players: state.players.length,
        waiting: state.waitingPlayers.length,
        pot: state.pot,
        handInProgress: state.handInProgress
    });

    // NEW: Show showdown if available
    if (!state.handInProgress && state.showdownCards && state.showdownCards.length > 0) {
        console.log('Showdown data received:', state.showdownCards);
        showShowdown(state.showdownCards);
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
    alert('Error: ' + msg);
});

// Update Game UI
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

        // NEW: Away status styling
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

        // Add hand description if available
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

    // NEW: Timer control
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

// Keyboard shortcuts
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
