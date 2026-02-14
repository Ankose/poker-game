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

const ACTION_TIMEOUT_MS = 60000;

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

    if (isFlush && isStraight && sorted[0].value === 14) {
        return {
            rank: 10,
            name: 'Royal Flush',
            values: [14, 13, 12, 11, 10],
            cards: sorted
        };
    }

    if (isFlush && isStraight) {
        return {
            rank: 9,
            name: 'Straight Flush',
            values: sorted.map(c => c.value),
            cards: sorted
        };
    }

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

    if (isFlush) {
        return {
            rank: 6,
            name: 'Flush',
            values: sorted.map(c => c.value),
            cards: sorted
        };
    }

    if (isStraight) {
        return {
            rank: 5,
            name: 'Straight',
            values: sorted.map(c => c.value),
            cards: sorted
        };
    }

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
        this.actionTimer = null;
        this.showdownCards = null;
        this.handHistory = []; // NEW: Hand history
        this.handNumber = 0; // NEW: Track hand count
        this.settings = { // NEW: Game settings
            startingChips: 1000,
            smallBlind: 10,
            bigBlind: 20,
            turnTimer: 60,
            rebuyEnabled: false,
            rebuyAmount: 1000
        };
        this.rebuyRequests = []; // NEW: Rebuy requests
    }

    // NEW: Broadcast helper
    broadcast(message) {
        io.to(this.roomId).emit('chatMessage', {
            type: 'system',
            text: message.text || message,
            timestamp: Date.now()
        });
    }

    // NEW: Emit state to all players
    emitState() {
        io.to(this.roomId).emit('gameState', this.getState());
        this.players.forEach(p => {
            io.to(p.id).emit('privateState', this.getPrivateState(p.id));
        });
    }

    addPlayer(socketId, playerName) {
        const existingPlayer = this.players.find(p => p.id === socketId);
        if (existingPlayer) {
            console.log('Player ' + playerName + ' already in game (duplicate prevented)');
            return 'already-joined';
        }

        const existingWaiting = this.waitingPlayers.find(p => p.id === socketId);
        if (existingWaiting) {
            console.log('Player ' + playerName + ' already waiting (duplicate prevented)');
            return 'already-waiting';
        }

        const player = {
            id: socketId,
            name: playerName,
            chips: this.settings.startingChips,
            cards: [],
            bet: 0,
            folded: false,
            allIn: false,
            hasActed: false,
            bestHand: null,
            isAway: false
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

    toggleAway(socketId) {
        const player = this.players.find(p => p.id === socketId);
        if (player) {
            player.isAway = !player.isAway;
            console.log(player.name + ' is now ' + (player.isAway ? 'AWAY' : 'ACTIVE'));

            if (player.isAway && this.players[this.currentPlayerIndex]?.id === socketId && this.handInProgress) {
                this.clearActionTimer();
                player.folded = true;
                player.hasActed = true;
                this.lastAction = player.name + ' went away (auto-fold)';
                this.nextPlayer();
            }

            return player.isAway;
        }
        return false;
    }

    removePlayer(socketId) {
        const playerName = this.players.find(p => p.id === socketId)?.name || 
                          this.waitingPlayers.find(p => p.id === socketId)?.name || 
                          'Unknown';

        const wasCurrentPlayer = this.players[this.currentPlayerIndex]?.id === socketId;
        if (wasCurrentPlayer && this.actionTimer) {
            clearTimeout(this.actionTimer);
            this.actionTimer = null;
            console.log('Timer cleared for disconnected player');
        }

        this.players = this.players.filter(p => p.id !== socketId);
        this.waitingPlayers = this.waitingPlayers.filter(p => p.id !== socketId);
        this.rebuyRequests = this.rebuyRequests.filter(r => r.playerId !== socketId);

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

        if (wasCurrentPlayer && this.handInProgress) {
            console.log('Current player left - auto-folding and advancing');
            this.lastAction = playerName + ' disconnected (auto-fold)';
            this.nextPlayer();
        }

        if (this.handInProgress && this.players.filter(p => !p.folded && !p.isAway).length < 2) {
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

    startActionTimer(io) {
        this.clearActionTimer();

        const currentPlayer = this.players[this.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.folded || currentPlayer.allIn || currentPlayer.isAway) {
            return;
        }

        console.log('⏱️  Timer started for ' + currentPlayer.name);

        this.actionTimer = setTimeout(() => {
            console.log('⏰ TIME EXPIRED - Auto-folding ' + currentPlayer.name);

            currentPlayer.folded = true;
            currentPlayer.hasActed = true;
            this.lastAction = currentPlayer.name + ' timed out (auto-fold)';

            this.nextPlayer();

            this.emitState();

            if (this.handInProgress) {
                this.startActionTimer(io);
            }
        }, this.settings.turnTimer * 1000);
    }

    clearActionTimer() {
        if (this.actionTimer) {
            clearTimeout(this.actionTimer);
            this.actionTimer = null;
        }
    }

    startGame() {
        const activePlayers = this.players.filter(p => !p.isAway);

        if (activePlayers.length < 2) {
            console.log('Cannot start: need at least 2 active players');
            return false;
        }
        if (this.handInProgress) {
            console.log('Cannot start: hand already in progress');
            return false;
        }

        console.log('Starting hand #' + (this.handNumber + 1) + ' with ' + this.players.length + ' players');

        this.handNumber++;
        this.gameStarted = true;
        this.handInProgress = true;
        this.deck = this.createDeck();
        this.communityCards = [];
        this.pot = 0;
        this.currentBet = this.settings.bigBlind;
        this.minRaise = this.settings.bigBlind;
        this.bettingRound = 0;
        this.showdownCards = null;

        this.players.forEach(p => {
            p.cards = [];
            p.bet = 0;
            p.folded = p.isAway;
            p.allIn = false;
            p.hasActed = false;
            p.bestHand = null;
        });

        for (let i = 0; i < 2; i++) {
            for (let player of this.players) {
                if (!player.isAway && this.deck.length > 0) {
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

            if (!sbPlayer.isAway) {
                const sbAmount = Math.min(this.settings.smallBlind, sbPlayer.chips);
                sbPlayer.chips -= sbAmount;
                sbPlayer.bet = sbAmount;
                this.pot += sbAmount;
                if (sbPlayer.chips === 0) sbPlayer.allIn = true;
            }

            if (!bbPlayer.isAway) {
                const bbAmount = Math.min(this.settings.bigBlind, bbPlayer.chips);
                bbPlayer.chips -= bbAmount;
                bbPlayer.bet = bbAmount;
                this.pot += bbAmount;
                if (bbPlayer.chips === 0) bbPlayer.allIn = true;
            }

            console.log('Blinds posted');
        }

        if (this.players.length === 2) {
            this.currentPlayerIndex = this.dealerIndex;
        } else {
            this.currentPlayerIndex = (this.dealerIndex + 3) % this.players.length;
        }

        let attempts = 0;
        while (attempts < this.players.length && 
               (this.players[this.currentPlayerIndex].folded || 
                this.players[this.currentPlayerIndex].allIn ||
                this.players[this.currentPlayerIndex].isAway)) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            attempts++;
        }

        this.lastAction = 'Hand #' + this.handNumber + ' started! Blinds: $' + this.settings.smallBlind + '/$' + this.settings.bigBlind;
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
        if (player.folded || player.allIn || player.isAway) {
            console.log('Player cannot act');
            return false;
        }
        if (this.currentPlayerIndex !== playerIndex) {
            console.log('Not player turn');
            return false;
        }

        this.clearActionTimer();

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
                        if (idx !== playerIndex && !p.folded && !p.allIn && !p.isAway) {
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
        const activePlayers = this.players.filter(p => !p.folded && !p.isAway);
        if (activePlayers.length <= 1) {
            console.log('Only one player left, ending hand');
            this.clearActionTimer();
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
                  this.players[this.currentPlayerIndex].allIn ||
                  this.players[this.currentPlayerIndex].isAway));

        if (attempts >= this.players.length) {
            console.log('All players acted, advancing street');
            this.advanceStreet();
        } else {
            console.log('Next to act: ' + this.players[this.currentPlayerIndex].name);
        }
    }

    isBettingRoundComplete() {
        const activePlayers = this.players.filter(p => !p.folded && !p.allIn && !p.isAway);
        if (activePlayers.length === 0) return true;
        return activePlayers.every(p => p.hasActed && p.bet === this.currentBet);
    }

    advanceStreet() {
        this.bettingRound++;
        console.log('Advancing to betting round ' + this.bettingRound);

        this.currentBet = 0;
        this.minRaise = this.settings.bigBlind;
        this.players.forEach(p => {
            p.bet = 0;
            if (!p.folded && !p.allIn && !p.isAway) {
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
            this.clearActionTimer();
            this.endHand();
            return;
        }

        this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length;

        let attempts = 0;
        while (attempts < this.players.length && 
               (this.players[this.currentPlayerIndex].folded || 
                this.players[this.currentPlayerIndex].allIn ||
                this.players[this.currentPlayerIndex].isAway)) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            attempts++;
        }

        const playersToAct = this.players.filter(p => !p.folded && !p.allIn && !p.isAway);
        if (playersToAct.length === 0 && this.bettingRound < 3) {
            console.log('All players all-in, auto-advancing');
            setTimeout(() => this.advanceStreet(), 1500);
        }
    }

    endHand() {
        this.handInProgress = false;
        this.clearActionTimer();
        console.log('Hand #' + this.handNumber + ' ended');

        const activePlayers = this.players.filter(p => !p.folded && !p.isAway);

        // Collect hand history data
        const handHistoryEntry = {
            handNumber: this.handNumber,
            pot: this.pot,
            communityCards: [...this.communityCards],
            players: this.players.map(p => ({
                playerId: p.id,
                playerName: p.name,
                cards: [...p.cards],
                folded: p.folded,
                finalChips: p.chips
            })),
            winners: [],
            timestamp: Date.now()
        };

        if (activePlayers.length > 1) {
            this.showdownCards = activePlayers.map(p => {
                const hand = evaluateHand(p.cards, this.communityCards);
                return {
                    id: p.id,
                    name: p.name,
                    cards: p.cards,
                    hand: getHandDescription(hand)
                };
            });
        } else {
            this.showdownCards = null;
        }

        if (activePlayers.length === 1) {
            activePlayers[0].chips += this.pot;
            this.lastAction = '🏆 ' + activePlayers[0].name + ' wins $' + this.pot;
            console.log(this.lastAction);

            handHistoryEntry.winners = [{
                playerId: activePlayers[0].id,
                playerName: activePlayers[0].name,
                cards: activePlayers[0].cards,
                handRank: 'Won uncontested',
                amount: this.pot
            }];
        } else if (activePlayers.length > 1) {
            activePlayers.forEach(p => {
                p.bestHand = evaluateHand(p.cards, this.communityCards);
                console.log(p.name + ': ' + getHandDescription(p.bestHand));
            });

            let winners = [activePlayers[0]];

            for (let i = 1; i < activePlayers.length; i++) {
                const comparison = compareHands(activePlayers[i].bestHand, winners[0].bestHand);

                if (comparison > 0) {
                    winners = [activePlayers[i]];
                } else if (comparison === 0) {
                    winners.push(activePlayers[i]);
                }
            }

            const winAmount = Math.floor(this.pot / winners.length);
            winners.forEach(w => w.chips += winAmount);

            if (winners.length === 1) {
                const handDesc = getHandDescription(winners[0].bestHand);
                this.lastAction = '🏆 ' + winners[0].name + ' wins $' + this.pot + ' with ' + handDesc;

                handHistoryEntry.winners = [{
                    playerId: winners[0].id,
                    playerName: winners[0].name,
                    cards: winners[0].cards,
                    handRank: handDesc,
                    amount: this.pot
                }];
            } else {
                const names = winners.map(w => w.name).join(', ');
                this.lastAction = '🏆 ' + names + ' split $' + winAmount + ' each';

                handHistoryEntry.winners = winners.map(w => ({
                    playerId: w.id,
                    playerName: w.name,
                    cards: w.cards,
                    handRank: getHandDescription(w.bestHand),
                    amount: winAmount
                }));
            }

            console.log(this.lastAction);
        }

        // Add to hand history (keep last 50 hands)
        this.handHistory.unshift(handHistoryEntry);
        if (this.handHistory.length > 50) {
            this.handHistory = this.handHistory.slice(0, 50);
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

        if (this.players.filter(p => !p.isAway).length < 2) {
            this.gameStarted = false;
            this.lastAction = 'Waiting for more players...';
            console.log('Not enough active players to continue');
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
                cardCount: p.cards.length,
                isAway: p.isAway
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
            bettingRound: this.bettingRound,
            showdownCards: this.showdownCards,
            handHistory: this.handHistory,
            settings: this.settings,
            rebuyRequests: this.rebuyRequests
        };
    }

    getPrivateState(socketId) {
        const player = this.players.find(p => p.id === socketId);
        if (!player) return { cards: [], handDescription: '' };

        let handDescription = '';
        if (this.communityCards.length >= 3 && !player.isAway) {
            const hand = evaluateHand(player.cards, this.communityCards);
            handDescription = getHandDescription(hand);
        }

        return { 
            cards: player.cards,
            handDescription: handDescription
        };
    }
}

// ========== SOCKET.IO HANDLERS ==========

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

    socket.on('toggleAway', () => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            const isAway = game.toggleAway(socket.id);
            io.to(roomId).emit('gameState', game.getState());

            const playerName = socket.data.playerName;
            io.to(roomId).emit('chatMessage', {
                type: 'system',
                text: playerName + (isAway ? ' is now away' : ' is back'),
                timestamp: Date.now()
            });

            if (game.handInProgress) {
                game.startActionTimer(io);
            }
        } catch (error) {
            console.error('Error in toggleAway:', error);
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

            if (game.players.filter(p => !p.isAway).length < 2) {
                socket.emit('error', 'Need at least 2 active players to start');
                return;
            }

            if (game.startGame()) {
                game.emitState();
                io.to(roomId).emit('chatMessage', {
                    type: 'system',
                    text: 'Game started!',
                    timestamp: Date.now()
                });

                game.startActionTimer(io);

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
                game.emitState();

                if (game.handInProgress) {
                    game.startActionTimer(io);
                }
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

            if (!game.handInProgress && game.players.filter(p => !p.isAway).length >= 2) {
                game.startGame();
                game.emitState();
                game.startActionTimer(io);
            }
        } catch (error) {
            console.error('Error in nextHand:', error);
        }
    });

    // NEW: Update settings
    socket.on('updateSettings', (newSettings) => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            if (socket.id !== game.hostId) {
                socket.emit('error', 'Only the host can change settings');
                return;
            }

            if (game.handInProgress) {
                socket.emit('error', 'Cannot change settings during a hand');
                return;
            }

            game.settings = {
                startingChips: parseInt(newSettings.startingChips) || 1000,
                smallBlind: parseInt(newSettings.smallBlind) || 10,
                bigBlind: parseInt(newSettings.bigBlind) || 20,
                turnTimer: parseInt(newSettings.turnTimer) || 60,
                rebuyEnabled: !!newSettings.rebuyEnabled,
                rebuyAmount: parseInt(newSettings.rebuyAmount) || 1000
            };

            game.smallBlind = game.settings.smallBlind;
            game.bigBlind = game.settings.bigBlind;

            console.log('Settings updated in room ' + roomId);

            socket.emit('settingsUpdated', game.settings);
            game.emitState();

            io.to(roomId).emit('chatMessage', {
                type: 'system',
                text: 'Host updated game settings',
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error in updateSettings:', error);
            socket.emit('error', 'Failed to update settings');
        }
    });

    // NEW: Give chips to player
    socket.on('giveChips', ({ playerId, amount }) => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            if (socket.id !== game.hostId) {
                socket.emit('error', 'Only the host can give chips');
                return;
            }

            const player = game.players.find(p => p.id === playerId);
            if (!player) {
                socket.emit('error', 'Player not found');
                return;
            }

            const chipsAmount = parseInt(amount) || 0;
            if (chipsAmount < 1) {
                socket.emit('error', 'Invalid chip amount');
                return;
            }

            player.chips += chipsAmount;

            console.log('Host gave ' + chipsAmount + ' chips to ' + player.name);

            game.emitState();

            io.to(roomId).emit('chatMessage', {
                type: 'system',
                text: '💰 Host gave $' + chipsAmount + ' to ' + player.name,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error in giveChips:', error);
            socket.emit('error', 'Failed to give chips');
        }
    });

    // NEW: Kick player (FIXED VERSION)
    socket.on('kickPlayer', (playerId) => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            if (socket.id !== game.hostId) {
                socket.emit('error', 'Only the host can kick players');
                return;
            }

            if (playerId === socket.id) {
                socket.emit('error', 'You cannot kick yourself');
                return;
            }

            const player = game.players.find(p => p.id === playerId);
            if (!player) {
                socket.emit('error', 'Player not found');
                return;
            }

            const playerName = player.name;

            // Remove from game state
            game.players = game.players.filter(p => p.id !== playerId);
            game.waitingPlayers = game.waitingPlayers.filter(p => p.id !== playerId);

            // ✅ FIX: Remove from rebuy requests
            game.rebuyRequests = game.rebuyRequests.filter(r => r.playerId !== playerId);

            const kickedSocket = io.sockets.sockets.get(playerId);
            if (kickedSocket) {
                // ✅ CRITICAL: Clean up ALL server-side state
                kickedSocket.data.roomId = null;
                kickedSocket.data.playerName = null;
                playerRooms.delete(playerId);     // ✅ FIX: Remove from Map
                kickedSocket.leave(roomId);       // ✅ FIX: Leave Socket.IO room

                // Send kick notification
                kickedSocket.emit('kicked', 'You have been removed from the game by the host');

                console.log('✅ ' + playerName + ' fully disconnected from server state');
            }

            // Notify other players
            io.to(roomId).emit('chatMessage', {
                type: 'system',
                text: '🚫 ' + playerName + ' was removed by host',
                timestamp: Date.now()
            });

            // Update game state
            game.emitState();

            console.log(playerName + ' was kicked by host from room ' + roomId);
        } catch (error) {
            console.error('Error in kickPlayer:', error);
            socket.emit('error', 'Failed to kick player');
        }
    });

    // NEW: Request rebuy
    socket.on('requestRebuy', () => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            const player = game.players.find(p => p.id === socket.id);
            if (!player) return;

            if (!game.settings.rebuyEnabled) {
                socket.emit('error', 'Rebuy is not enabled');
                return;
            }

            if (player.chips > 0) {
                socket.emit('error', 'You still have chips');
                return;
            }

            const existingRequest = game.rebuyRequests.find(r => r.playerId === socket.id);
            if (existingRequest) {
                socket.emit('error', 'You already have a pending rebuy request');
                return;
            }

            game.rebuyRequests.push({
                playerId: socket.id,
                playerName: player.name
            });

            console.log(player.name + ' requested rebuy');

            game.emitState();

            io.to(game.hostId).emit('rebuyRequest', {
                playerId: socket.id,
                playerName: player.name
            });

            io.to(roomId).emit('chatMessage', {
                type: 'system',
                text: player.name + ' requested a rebuy',
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error in requestRebuy:', error);
            socket.emit('error', 'Failed to request rebuy');
        }
    });

    // NEW: Handle rebuy approval/denial
    socket.on('handleRebuy', ({ playerId, approved }) => {
        try {
            const roomId = socket.data.roomId;
            if (!roomId) return;

            const game = games.get(roomId);
            if (!game) return;

            if (socket.id !== game.hostId) {
                socket.emit('error', 'Only the host can handle rebuy requests');
                return;
            }

            const requestIndex = game.rebuyRequests.findIndex(r => r.playerId === playerId);
            if (requestIndex === -1) {
                socket.emit('error', 'Rebuy request not found');
                return;
            }

            const request = game.rebuyRequests[requestIndex];
            game.rebuyRequests.splice(requestIndex, 1);

            const player = game.players.find(p => p.id === playerId);

            if (approved && player) {
                player.chips = game.settings.rebuyAmount;
                console.log('Rebuy approved for ' + request.playerName);

                io.to(roomId).emit('chatMessage', {
                    type: 'system',
                    text: '✅ ' + request.playerName + ' received rebuy ($' + game.settings.rebuyAmount + ')',
                    timestamp: Date.now()
                });

                io.to(playerId).emit('chatMessage', {
                    type: 'system',
                    text: '✅ Your rebuy was approved!',
                    timestamp: Date.now()
                });
            } else {
                console.log('Rebuy denied for ' + request.playerName);

                io.to(playerId).emit('chatMessage', {
                    type: 'system',
                    text: '❌ Your rebuy was denied',
                    timestamp: Date.now()
                });
            }

            game.emitState();
        } catch (error) {
            console.error('Error in handleRebuy:', error);
            socket.emit('error', 'Failed to handle rebuy');
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

                if (game.handInProgress) {
                    game.startActionTimer(io);
                }
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
    console.log('  🎰 TEXAS HOLD\'EM POKER - COMPLETE & FIXED');
    console.log('='.repeat(70));
    console.log('');
    console.log('  📍 Local:   http://localhost:' + PORT);
    console.log('  🌐 Network: http://' + localIP + ':' + PORT);
    console.log('');
    console.log('  ✓ Hand evaluation working');
    console.log('  ✓ Action timer (configurable)');
    console.log('  ✓ Showdown cards display');
    console.log('  ✓ Away/idle mode');
    console.log('  ✓ Settings panel (host)');
    console.log('  ✓ Player management (kick/give chips)');
    console.log('  ✓ Rebuy system');
    console.log('  ✓ Hand history');
    console.log('  ✓ Kick/rejoin bug FIXED');
    console.log('  ✓ All cleanup bugs fixed');
    console.log('');
    console.log('='.repeat(70));
    console.log('');
