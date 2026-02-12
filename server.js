const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});
const os = require('os');

app.use(express.static('public'));

const games = new Map();
const playerRooms = new Map();

function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const VALUE_NAMES = {
    14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack',
    10: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven',
    6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Two'
};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ========== HAND EVALUATION ==========

function get5CardCombos(cards) {
    if (cards.length < 5) return [];
    if (cards.length === 5) return [cards];

    const combos = [];

    function combine(start, chosen) {
        if (chosen.length === 5) {
            combos.push([...chosen]);
            return;
        }

        for (let i = start; i < cards.length; i++) {
            chosen.push(cards[i]);
            combine(i + 1, chosen);
            chosen.pop();
        }
    }

    combine(0, []);
    return combos;
}

function checkStraight(sorted) {
    let isStraight = true;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].value - sorted[i + 1].value !== 1) {
            isStraight = false;
            break;
        }
    }

    if (isStraight) return true;

    // Check A-2-3-4-5 (wheel)
    if (sorted[0].value === 14 && sorted[1].value === 5 && 
        sorted[2].value === 4 && sorted[3].value === 3 && sorted[4].value === 2) {
        return true;
    }

    return false;
}

function checkHand(cards) {
    const sorted = [...cards].sort((a, b) => b.value - a.value);

    const isFlush = cards.every(c => c.suit === cards[0].suit);
    const isStraight = checkStraight(sorted);

    const rankCounts = {};
    cards.forEach(c => {
        rankCounts[c.value] = (rankCounts[c.value] || 0) + 1;
    });

    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const values = Object.keys(rankCounts).map(Number).sort((a, b) => b - a);

    // Royal Flush
    if (isFlush && isStraight && sorted[0].value === 14) {
        return {
            rank: 10,
            name: 'Royal Flush',
            values: [14, 13, 12, 11, 10],
            cards: sorted
        };
    }

    // Straight Flush
    if (isFlush && isStraight) {
        return {
            rank: 9,
            name: 'Straight Flush',
            values: sorted.map(c => c.value),
            cards: sorted
        };
    }

    // Four of a Kind
    if (counts[0] === 4) {
        const quadValue = values.find(v => rankCounts[v] === 4);
        const kicker = values.find(v => rankCounts[v] === 1);
        return {
            rank: 8,
            name: 'Four of a Kind',
            values: [quadValue, quadValue, quadValue, quadValue, kicker],
            cards: sorted
        };
    }

    // Full House
    if (counts[0] === 3 && counts[1] === 2) {
        const tripValue = values.find(v => rankCounts[v] === 3);
        const pairValue = values.find(v => rankCounts[v] === 2);
        return {
            rank: 7,
            name: 'Full House',
            values: [tripValue, tripValue, tripValue, pairValue, pairValue],
            cards: sorted
        };
    }

    // Flush
    if (isFlush) {
        return {
            rank: 6,
            name: 'Flush',
            values: sorted.map(c => c.value),
            cards: sorted
        };
    }

    // Straight
    if (isStraight) {
        return {
            rank: 5,
            name: 'Straight',
            values: sorted.map(c => c.value),
            cards: sorted
        };
    }

    // Three of a Kind
    if (counts[0] === 3) {
        const tripValue = values.find(v => rankCounts[v] === 3);
        const kickers = values.filter(v => rankCounts[v] === 1);
        return {
            rank: 4,
            name: 'Three of a Kind',
            values: [tripValue, tripValue, tripValue, ...kickers],
            cards: sorted
        };
    }

    // Two Pair
    if (counts[0] === 2 && counts[1] === 2) {
        const pairs = values.filter(v => rankCounts[v] === 2).sort((a, b) => b - a);
        const kicker = values.find(v => rankCounts[v] === 1);
        return {
            rank: 3,
            name: 'Two Pair',
            values: [pairs[0], pairs[0], pairs[1], pairs[1], kicker],
            cards: sorted
        };
    }

    // One Pair
    if (counts[0] === 2) {
        const pairValue = values.find(v => rankCounts[v] === 2);
        const kickers = values.filter(v => rankCounts[v] === 1);
        return {
            rank: 2,
            name: 'One Pair',
            values: [pairValue, pairValue, ...kickers],
            cards: sorted
        };
    }

    // High Card
    return {
        rank: 1,
        name: 'High Card',
        values: sorted.map(c => c.value),
        cards: sorted
    };
}

function evaluateHand(playerCards, communityCards) {
    const allCards = [...playerCards, ...communityCards];

    if (allCards.length < 5) {
        return { rank: 0, name: 'No hand', values: [], cards: [] };
    }

    const combinations = get5CardCombos(allCards);
    let bestHand = null;

    for (const combo of combinations) {
        const hand = checkHand(combo);
        if (!bestHand || compareHands(hand, bestHand) > 0) {
            bestHand = hand;
        }
    }

    return bestHand;
}

function compareHands(hand1, hand2) {
    if (hand1.rank !== hand2.rank) {
        return hand1.rank - hand2.rank;
    }

    for (let i = 0; i < hand1.values.length && i < hand2.values.length; i++) {
        if (hand1.values[i] !== hand2.values[i]) {
            return hand1.values[i] - hand2.values[i];
        }
    }

    return 0;
}

function getHandDescription(hand) {
    if (!hand || hand.rank === 0) return 'No hand';

    switch (hand.rank) {
        case 10:
            return 'Royal Flush!';
        case 9:
            return 'Straight Flush, ' + VALUE_NAMES[hand.values[0]] + ' high';
        case 8:
            return 'Four ' + VALUE_NAMES[hand.values[0]] + 's';
        case 7:
            return 'Full House, ' + VALUE_NAMES[hand.values[0]] + 's over ' + VALUE_NAMES[hand.values[3]] + 's';
        case 6:
            return 'Flush, ' + VALUE_NAMES[hand.values[0]] + ' high';
        case 5:
            return 'Straight, ' + VALUE_NAMES[hand.values[0]] + ' high';
        case 4:
            return 'Three ' + VALUE_NAMES[hand.values[0]] + 's';
        case 3:
            return 'Two Pair, ' + VALUE_NAMES[hand.values[0]] + 's and ' + VALUE_NAMES[hand.values[2]] + 's';
        case 2:
            return 'Pair of ' + VALUE_NAMES[hand.values[0]] + 's';
        case 1:
            return VALUE_NAMES[hand.values[0]] + ' high';
        default:
            return 'Unknown hand';
    }
}

// ========== GAME CLASS ==========

class PokerGame {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = [];
        this.waitingPlayers = [];
        this.deck = [];
        this.communityCards = [];
        this.pot = 0;
        this.currentBet = 0;
        this.minRaise = 20;
        this.dealerIndex = 0;
        this.currentPlayerIndex = -1;
        this.gameStarted = false;
        this.handInProgress = false;
        this.bettingRound = 0;
        this.smallBlind = 10;
        this.bigBlind = 20;
        this.lastAction = 'Waiting for host to start the game';
        this.hostId = null;
        this.createdAt = Date.now();
    }

    addPlayer(socketId, playerName) {
        const existingPlayer = this.players.find(p => p.id === socketId);
        if (existingPlayer) {
            console.log('Player ' + playerName + ' already in game');
            return 'already-joined';
        }

        const existingWaiting = this.waitingPlayers.find(p => p.id === socketId);
        if (existingWaiting) {
            console.log('Player ' + playerName + ' already waiting');
            return 'already-waiting';
        }

        const player = {
            id: socketId,
            name: playerName,
            chips: 1000,
            cards: [],
            bet: 0,
            folded: false,
            allIn: false,
            hasActed: false,
            bestHand: null
        };

        if (!this.hostId) {
            this.hostId = socketId;
            console.log(playerName + ' is now the host');
        }

        if (this.handInProgress) {
            this.waitingPlayers.push(player);
            console.log(playerName + ' added to waiting list');
            return 'waiting';
        } else {
            this.players.push(player);
            console.log(playerName + ' added to game (total: ' + this.players.length + ')');
            return 'joined';
        }
    }

    removePlayer(socketId) {
        const playerName = this.players.find(p => p.id === socketId)?.name || 
                          this.waitingPlayers.find(p => p.id === socketId)?.name || 
                          'Unknown';

        this.players = this.players.filter(p => p.id !== socketId);
        this.waitingPlayers = this.waitingPlayers.filter(p => p.id !== socketId);

        console.log(playerName + ' removed from game');

        if (this.hostId === socketId) {
            if (this.players.length > 0) {
                this.hostId = this.players[0].id;
                console.log('Host transferred to ' + this.players[0].name);
            } else if (this.waitingPlayers.length > 0) {
                this.hostId = this.waitingPlayers[0].id;
                console.log('Host transferred to ' + this.waitingPlayers[0].name);
            } else {
                this.hostId = null;
                console.log('No host - game empty');
            }
        }

        if (this.handInProgress && this.players.filter(p => !p.folded).length < 2) {
            console.log('Not enough players, ending hand');
            this.endHand();
        }
    }

    createDeck() {
        const deck = [];
        for (let suit of SUITS) {
            for (let rank of RANKS) {
                deck.push({ suit, rank, value: RANK_VALUES[rank] });
            }
        }
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    startGame() {
        if (this.players.length < 2) {
            console.log('Cannot start: need at least 2 players');
            return false;
        }
        if (this.handInProgress) {
            console.log('Cannot start: hand already in progress');
            return false;
        }

        console.log('Starting game with ' + this.players.length + ' players');

        this.gameStarted = true;
        this.handInProgress = true;
        this.deck = this.createDeck();
        this.communityCards = [];
        this.pot = 0;
        this.currentBet = this.bigBlind;
        this.minRaise = this.bigBlind;
        this.bettingRound = 0;

        this.players.forEach(p => {
            p.cards = [];
            p.bet = 0;
            p.folded = false;
            p.allIn = false;
            p.hasActed = false;
            p.bestHand = null;
        });

        for (let i = 0; i < 2; i++) {
            for (let player of this.players) {
                if (this.deck.length > 0) {
                    player.cards.push(this.deck.pop());
                }
            }
        }

        console.log('Cards dealt to all players');

        if (this.players.length >= 2) {
            const sbIndex = (this.dealerIndex + 1) % this.players.length;
            const bbIndex = (this.dealerIndex + 2) % this.players.length;

            const sbPlayer = this.players[sbIndex];
            const bbPlayer = this.players[bbIndex];

            const sbAmount = Math.min(this.smallBlind, sbPlayer.chips);
            sbPlayer.chips -= sbAmount;
            sbPlayer.bet = sbAmount;
            this.pot += sbAmount;
            if (sbPlayer.chips === 0) sbPlayer.allIn = true;

            const bbAmount = Math.min(this.bigBlind, bbPlayer.chips);
            bbPlayer.chips -= bbAmount;
            bbPlayer.bet = bbAmount;
            this.pot += bbAmount;
            if (bbPlayer.chips === 0) bbPlayer.allIn = true;

            console.log('Blinds posted: SB=' + sbAmount + ', BB=' + bbAmount);
        }

        if (this.players.length === 2) {
            this.currentPlayerIndex = this.dealerIndex;
        } else {
            this.currentPlayerIndex = (this.dealerIndex + 3) % this.players.length;
        }

        let attempts = 0;
        while (attempts < this.players.length && 
               (this.players[this.currentPlayerIndex].folded || 
                this.players[this.currentPlayerIndex].allIn)) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            attempts++;
        }

        this.lastAction = 'New hand started! Blinds: $' + this.smallBlind + '/$' + this.bigBlind;
        console.log('First to act: ' + this.players[this.currentPlayerIndex].name);
        return true;
    }

    playerAction(socketId, action, amount = 0) {
        const playerIndex = this.players.findIndex(p => p.id === socketId);
        if (playerIndex === -1) {
            console.log('Player not found for action');
            return false;
        }

        const player = this.players[playerIndex];
        if (player.folded || player.allIn) {
            console.log('Player cannot act (folded or all-in)');
            return false;
        }
        if (this.currentPlayerIndex !== playerIndex) {
            console.log('Not player turn');
            return false;
        }

        let actionSuccess = false;

        switch (action) {
            case 'fold':
                player.folded = true;
                this.lastAction = player.name + ' folds';
                console.log(this.lastAction);
                actionSuccess = true;
                break;

            case 'check':
                if (player.bet >= this.currentBet) {
                    this.lastAction = player.name + ' checks';
                    console.log(this.lastAction);
                    actionSuccess = true;
                } else {
                    console.log('Cannot check - must call or fold');
                }
                break;

            case 'call':
                const callAmount = this.currentBet - player.bet;
                const actualCall = Math.min(callAmount, player.chips);

                if (actualCall > 0) {
                    player.chips -= actualCall;
                    player.bet += actualCall;
                    this.pot += actualCall;

                    if (player.chips === 0) {
                        player.allIn = true;
                        this.lastAction = player.name + ' calls $' + actualCall + ' (ALL-IN)';
                    } else {
                        this.lastAction = player.name + ' calls $' + actualCall;
                    }
                    console.log(this.lastAction);
                    actionSuccess = true;
                }
                break;

            case 'raise':
                const raiseAmount = parseInt(amount) || 0;
                if (raiseAmount < this.minRaise) {
                    console.log('Raise too small: ' + raiseAmount + ' < ' + this.minRaise);
                    break;
                }

                const newBet = this.currentBet + raiseAmount;
                const toCall = newBet - player.bet;

                if (toCall <= player.chips) {
                    player.chips -= toCall;
                    player.bet = newBet;
                    this.pot += toCall;

                    const oldBet = this.currentBet;
                    this.currentBet = newBet;
                    this.minRaise = raiseAmount;

                    this.players.forEach((p, idx) => {
                        if (idx !== playerIndex && !p.folded && !p.allIn) {
                            p.hasActed = false;
                        }
                    });

                    if (player.chips === 0) {
                        player.allIn = true;
                        this.lastAction = player.name + ' raises to $' + newBet + ' (ALL-IN)';
                    } else {
                        this.lastAction = player.name + ' raises to $' + newBet;
                    }
                    console.log(this.lastAction);
                    actionSuccess = true;
                } else {
                    console.log('Not enough chips to raise');
                }
                break;
        }

        if (actionSuccess) {
            player.hasActed = true;
            this.nextPlayer();
        }

        return actionSuccess;
    }

    nextPlayer() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length <= 1) {
            console.log('Only one player left, ending hand');
            this.endHand();
            return;
        }

        if (this.isBettingRoundComplete()) {
            this.advanceStreet();
            return;
        }

        let attempts = 0;
        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            attempts++;
        } while (attempts < this.players.length && 
                 (this.players[this.currentPlayerIndex].folded || 
                  this.players[this.currentPlayerIndex].allIn));

        if (attempts >= this.players.length) {
            console.log('All players acted, advancing street');
            this.advanceStreet();
        } else {
            console.log('Next to act: ' + this.players[this.currentPlayerIndex].name);
        }
    }

    isBettingRoundComplete() {
        const activePlayers = this.players.filter(p => !p.folded && !p.allIn);
        if (activePlayers.length === 0) return true;
        return activePlayers.every(p => p.hasActed && p.bet === this.currentBet);
    }

    advanceStreet() {
        this.bettingRound++;
        console.log('Advancing to betting round ' + this.bettingRound);

        this.currentBet = 0;
        this.minRaise = this.bigBlind;
        this.players.forEach(p => {
            p.bet = 0;
            if (!p.folded && !p.allIn) {
                p.hasActed = false;
            }
        });

        if (this.bettingRound === 1) {
            if (this.deck.length >= 3) {
                this.deck.pop();
                this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
                this.lastAction = 'Flop dealt';
                console.log('Flop: ' + this.communityCards.map(c => c.rank + c.suit).join(' '));
            }
        } else if (this.bettingRound === 2) {
            if (this.deck.length >= 1) {
                this.deck.pop();
                this.communityCards.push(this.deck.pop());
                this.lastAction = 'Turn dealt';
                console.log('Turn: ' + this.communityCards[3].rank + this.communityCards[3].suit);
            }
        } else if (this.bettingRound === 3) {
            if (this.deck.length >= 1) {
                this.deck.pop();
                this.communityCards.push(this.deck.pop());
                this.lastAction = 'River dealt';
                console.log('River: ' + this.communityCards[4].rank + this.communityCards[4].suit);
            }
        } else {
            this.endHand();
            return;
        }

        this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length;

        let attempts = 0;
        while (attempts < this.players.length && 
               (this.players[this.currentPlayerIndex].folded || 
                this.players[this.currentPlayerIndex].allIn)) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            attempts++;
        }

        const playersToAct = this.players.filter(p => !p.folded && !p.allIn);
        if (playersToAct.length === 0 && this.bettingRound < 3) {
            console.log('All players all-in, auto-advancing');
            setTimeout(() => this.advanceStreet(), 1500);
        }
    }

    endHand() {
        this.handInProgress = false;
        console.log('Hand ended');

        const activePlayers = this.players.filter(p => !p.folded);

        if (activePlayers.length === 1) {
            activePlayers[0].chips += this.pot;
            this.lastAction = '🏆 ' + activePlayers[0].name + ' wins $' + this.pot;
            console.log(this.lastAction);
        } else if (activePlayers.length > 1) {
            // Evaluate hands for all active players
            activePlayers.forEach(p => {
                p.bestHand = evaluateHand(p.cards, this.communityCards);
                console.log(p.name + ': ' + getHandDescription(p.bestHand));
            });

            // Find winners
            let winners = [activePlayers[0]];

            for (let i = 1; i < activePlayers.length; i++) {
                const comparison = compareHands(activePlayers[i].bestHand, winners[0].bestHand);

                if (comparison > 0) {
                    winners = [activePlayers[i]];
                } else if (comparison === 0) {
                    winners.push(activePlayers[i]);
                }
            }

            // Distribute pot
            const winAmount = Math.floor(this.pot / winners.length);
            winners.forEach(w => w.chips += winAmount);

            if (winners.length === 1) {
                const handDesc = getHandDescription(winners[0].bestHand);
                this.lastAction = '🏆 ' + winners[0].name + ' wins $' + this.pot + ' with ' + handDesc;
            } else {
                const names = winners.map(w => w.name).join(', ');
                this.lastAction = '🏆 ' + names + ' split $' + winAmount + ' each';
            }

            console.log(this.lastAction);
        }

        if (this.players.length > 0) {
            this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
        }

        const brokePlayers = this.players.filter(p => p.chips === 0);
        this.players = this.players.filter(p => p.chips > 0);
        if (brokePlayers.length > 0) {
            console.log('Removed ' + brokePlayers.length + ' broke player(s)');
        }

        if (this.waitingPlayers.length > 0) {
            this.players.push(...this.waitingPlayers);
            const count = this.waitingPlayers.length;
            this.lastAction += ' | ' + count + ' player(s) joined';
            console.log(count + ' waiting player(s) joined');
            this.waitingPlayers = [];
        }

        if (this.players.length < 2) {
            this.gameStarted = false;
            this.lastAction = 'Waiting for more players...';
            console.log('Not enough players to continue');
        }
    }

    getState() {
        return {
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                chips: p.chips,
                bet: p.bet,
                folded: p.folded,
                allIn: p.allIn,
                cardCount: p.cards.length
            })),
            waitingPlayers: this.waitingPlayers.map(p => ({
                id: p.id,
                name: p.name
            })),
            communityCards: this.communityCards,
            pot: this.pot,
            currentBet: this.currentBet,
            minRaise: this.minRaise,
            currentPlayerIndex: this.currentPlayerIndex,
            dealerIndex: this.dealerIndex,
            gameStarted: this.gameStarted,
            handInProgress: this.handInProgress,
            lastAction: this.lastAction,
            hostId: this.hostId,
            bettingRound: this.bettingRound
        };
    }

    getPrivateState(socketId) {
        const player = this.players.find(p => p.id === socketId);
        if (!player) return { cards: [], handDescription: '' };

        let handDescription = '';
        if (this.communityCards.length >= 3) {
            const hand = evaluateHand(player.cards, this.communityCards);
            handDescription = getHandDescription(hand);
        }

        return { 
            cards: player.cards,
            handDescription: handDescription
        };
    }
}

// Socket.IO handlers
io.on('connection', (socket) => {
    console.log('✓ Player connected: ' + socket.id);

    socket.on('joinGame', ({ playerName, roomId }) => {
        try {
            roomId = (roomId || '').trim().toUpperCase();

            if (!roomId) {
                roomId = generateRoomCode();
                console.log('Generated new room: ' + roomId);
            }

            if (!games.has(roomId)) {
                games.set(roomId, new PokerGame(roomId));
                console.log('Created new game room: ' + roomId);
            }

            const game = games.get(roomId);

            const oldRoom = playerRooms.get(socket.id);
            if (oldRoom && oldRoom !== roomId) {
                socket.leave(oldRoom);
                const oldGame = games.get(oldRoom);
                if (oldGame) {
                    oldGame.removePlayer(socket.id);
                    io.to(oldRoom).emit('gameState', oldGame.getState());
                }
            }

            const result = game.addPlayer(socket.id, playerName);

            if (result === 'already-joined' || result === 'already-waiting') {
                console.log('Player ' + playerName + ' already in room ' + roomId);
            }

            socket.join(roomId);
            socket.data.roomId = roomId;
            socket.data.playerName = playerName;
            playerRooms.set(socket.id, roomId);

            socket.emit('roomAssigned', roomId);

            io.to(roomId).emit('gameState', game.getState());
            socket.emit('privateState', game.getPrivateState(socket.id));

            let joinMsg = '';
            if (result === 'waiting') {
                joinMsg = playerName + ' will join next hand';
            } else if (result !== 'already-joined' && result !== 'already-waiting') {
                joinMsg = playerName + ' joined the table';
            }

            if (joinMsg) {
                io.to(roomId).emit('chatMessage', {
                    type: 'system',
                    text: joinMsg,
                    timestamp: Date.now()
                });
            }

            console.log('✓ ' + playerName + ' joined room ' + roomId + ' (' + result + ')');
        } catch (error) {
            console.error('Error in joinGame:', error);
            socket.emit('error', 'Failed to join game');
        }
    });

    socket.on('startGame', () => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            if (socket.id !== game.hostId) {
                socket.emit('error', 'Only the host can start the game');
                return;
            }

            if (game.players.length < 2) {
                socket.emit('error', 'Need at least 2 players to start');
                return;
            }

            if (game.startGame()) {
                io.to(roomId).emit('gameState', game.getState());
                game.players.forEach(p => {
                    io.to(p.id).emit('privateState', game.getPrivateState(p.id));
                });
                io.to(roomId).emit('chatMessage', {
                    type: 'system',
                    text: 'Game started!',
                    timestamp: Date.now()
                });
                console.log('✓ Game started in room ' + roomId);
            }
        } catch (error) {
            console.error('Error in startGame:', error);
            socket.emit('error', 'Failed to start game');
        }
    });

    socket.on('playerAction', ({ action, amount }) => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            if (game.playerAction(socket.id, action, amount)) {
                io.to(roomId).emit('gameState', game.getState());

                // Update hand descriptions after each action
                game.players.forEach(p => {
                    io.to(p.id).emit('privateState', game.getPrivateState(p.id));
                });
            } else {
                socket.emit('error', 'Invalid action');
            }
        } catch (error) {
            console.error('Error in playerAction:', error);
            socket.emit('error', 'Failed to perform action');
        }
    });

    socket.on('nextHand', () => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            if (socket.id !== game.hostId) return;

            if (!game.handInProgress && game.players.length >= 2) {
                game.startGame();
                io.to(roomId).emit('gameState', game.getState());
                game.players.forEach(p => {
                    io.to(p.id).emit('privateState', game.getPrivateState(p.id));
                });
            }
        } catch (error) {
            console.error('Error in nextHand:', error);
        }
    });

    socket.on('chatMessage', (message) => {
        try {
            const roomId = socket.data.roomId;
            const playerName = socket.data.playerName;
            if (!roomId || !playerName) return;

            const trimmed = message.trim();
            if (!trimmed) return;

            io.to(roomId).emit('chatMessage', {
                type: 'player',
                name: playerName,
                text: trimmed,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error in chatMessage:', error);
        }
    });

    socket.on('disconnect', () => {
        try {
            const roomId = socket.data.roomId;
            const playerName = socket.data.playerName;

            console.log('✗ ' + (playerName || socket.id) + ' disconnected');

            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            game.removePlayer(socket.id);
            playerRooms.delete(socket.id);

            if (game.players.length === 0 && game.waitingPlayers.length === 0) {
                setTimeout(() => {
                    if (games.has(roomId)) {
                        const g = games.get(roomId);
                        if (g.players.length === 0 && g.waitingPlayers.length === 0) {
                            games.delete(roomId);
                            console.log('Deleted empty room: ' + roomId);
                        }
                    }
                }, 300000);
            } else {
                io.to(roomId).emit('gameState', game.getState());
                io.to(roomId).emit('chatMessage', {
                    type: 'system',
                    text: playerName + ' left the table',
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('Error in disconnect:', error);
        }
    });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

http.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    console.log('');
    console.log('='.repeat(70));
    console.log('  🎰 TEXAS HOLD\'EM POKER SERVER');
    console.log('='.repeat(70));
    console.log('');
    console.log('  📍 Local:   http://localhost:' + PORT);
    console.log('  🌐 Network: http://' + localIP + ':' + PORT);
    console.log('');
    console.log('  ✓ Multiplayer ready');
    console.log('  ✓ Hand evaluation enabled');
    console.log('  ✓ Proper winner detection');
    console.log('');
    console.log('='.repeat(70));
    console.log('');
});
