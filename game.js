/* --- GLOBAL AUDIO STATE --- */
let isMuted = true;
function toggleMute() { isMuted = !isMuted; updateMuteUI(); }
function updateMuteUI() {
    const btn = document.getElementById('music-btn');
    if (isMuted) { MusicManager.pause(); btn.innerText = "🔇"; btn.style.opacity = "0.5"; } 
    else { MusicManager.play(); btn.innerText = "🎵"; btn.style.opacity = "1"; }
}

/* --- FIREBASE LEADERBOARD MANAGER --- */
const LeaderboardManager = {
    db: null,
    username: localStorage.getItem('oxford_username'),
    pendingStart: false,
    
    init() {
        // CONFIG FROM USER PROMPT
        try {
            if (typeof FIREBASE_CONFIG !== 'undefined') firebase.initializeApp(FIREBASE_CONFIG);
            this.db = firebase.firestore();
            console.log("Firebase initialized");
        } catch(e) { console.warn("Firebase not configured."); }
    },

    checkName() {
        if (!this.username) {
            this.pendingStart = true;
            document.getElementById('start-overlay').style.display = 'none'; 
            document.getElementById('username-modal').style.display = 'flex';
        } else {
            startGame('daily');
        }
    },

    editName() {
        document.getElementById('username-modal').style.display = 'flex';
        this.pendingStart = false; 
    },

    saveName() {
        const input = document.getElementById('username-input');
        const name = input.value.trim().toUpperCase().substring(0, 12);
        if (name.length < 3) return alert("Name too short!");
        this.username = name;
        localStorage.setItem('oxford_username', name);
        document.getElementById('username-modal').style.display = 'none';
        
        if (this.pendingStart) {
            startGame('daily');
        }
    },

    async submitScore(score, word) {
        if (!this.db || gameMode !== 'daily') return;
        const today = new Date().toISOString().split('T')[0];
        const docId = `${today}_${this.username}`;
        const docRef = this.db.collection('leaderboard').doc(docId);

        try {
            const doc = await docRef.get();
            if (!doc.exists || score > doc.data().score) {
                await docRef.set({
                    name: this.username,
                    score: score,
                    word: word,
                    date: today,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (e) { console.error("Score submit failed", e); }
    },

    async show() {
        document.getElementById('lb-modal').style.display = 'flex';
        const container = document.getElementById('lb-content');
        if (!this.db) { container.innerHTML = "<p>Leaderboard unavailable.</p>"; return; }
        container.innerHTML = "Loading...";
        const today = new Date().toISOString().split('T')[0];
        
        // SPOILER CHECK: Has user played today?
        const lastPlayed = localStorage.getItem('oxford_last_daily_played');
        const userPlayedToday = (lastPlayed === today);

        try {
            const q = await this.db.collection('leaderboard').where('date', '==', today).orderBy('score', 'desc').limit(10).get();
            if (q.empty) { container.innerHTML = "<p>No scores yet today. Be the first!</p>"; return; }

            let html = `<table class="lb-table"><tr><th>#</th><th>Player</th><th>Word</th><th>Score</th></tr>`;
            let rank = 1;
            q.forEach(doc => {
                const d = doc.data();
                // Hide word if user hasn't played today
                const wordDisplay = userPlayedToday ? d.word : `<span class="hidden-word">🙈 HIDDEN</span>`;
                
                html += `<tr><td class="lb-rank">${rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':rank}</td><td>${d.name}</td><td style="font-size:0.8rem;">${wordDisplay}</td><td class="lb-score">${d.score}</td></tr>`;
                rank++;
            });
            html += "</table>";
            if(!userPlayedToday) html += "<p style='font-size:0.7rem; color:#aaa; margin-top:10px;'>* Words hidden until you complete today's hand.</p>";
            
            container.innerHTML = html;
        } catch (e) { container.innerHTML = "<p>Error loading scores. Check Console.</p>"; }
    }
};

/* --- RNG --- */
let currentSeed = 1;
let gameMode = 'free';
function mulberry32(a) { return function() { var t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; } }
let randomFunc = Math.random;

function initSeed(mode) {
    gameMode = mode;
    if (mode === 'daily') {
        const d = new Date();
        const seedStr = d.getUTCFullYear() + "" + (d.getUTCMonth()+1).toString().padStart(2,'0') + "" + d.getUTCDate().toString().padStart(2,'0');
        randomFunc = mulberry32(parseInt(seedStr));
        document.getElementById('mode-indicator').innerText = "DAILY: " + seedStr;
        document.getElementById('mode-indicator').style.background = "var(--mode-daily)";
        document.getElementById('leaderboard-btn').style.display = "inline-block";
    } else {
        randomFunc = Math.random;
        document.getElementById('mode-indicator').innerText = "FREE PLAY";
        document.getElementById('mode-indicator').style.background = "var(--mode-free)";
        document.getElementById('leaderboard-btn').style.display = "none";
    }
}

/* --- AUDIO --- */
const SoundManager = {
    init() { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    play(type) {
        if (isMuted) return;
        if (!this.ctx) this.init();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        if (type === 'flip') {
            const buf = this.ctx.createBuffer(1, this.ctx.sampleRate*0.1, this.ctx.sampleRate);
            const d = buf.getChannelData(0);
            for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
            const n = this.ctx.createBufferSource(); n.buffer=buf;
            const f = this.ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.setValueAtTime(1000,t);
            gain.gain.setValueAtTime(0.3,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.1);
            n.connect(f); f.connect(gain); gain.connect(this.ctx.destination); n.start();
        } else if (type==='chip') {
            osc.frequency.setValueAtTime(1200,t); gain.gain.setValueAtTime(0.1,t); gain.gain.exponentialRampToValueAtTime(0.01,t+0.05); osc.connect(gain); gain.connect(this.ctx.destination); osc.start(); osc.stop(t+0.05);
        } else if (type==='success') {
            osc.type='triangle'; osc.frequency.setValueAtTime(440,t); osc.frequency.exponentialRampToValueAtTime(880,t+0.1);
            gain.gain.setValueAtTime(0.2,t); gain.gain.linearRampToValueAtTime(0,t+0.4);
            osc.connect(gain); gain.connect(this.ctx.destination); osc.start(); osc.stop(t+0.4);
        } else if (type==='error') {
            osc.type='sawtooth'; osc.frequency.setValueAtTime(150,t); osc.frequency.linearRampToValueAtTime(100,t+0.2);
            gain.gain.setValueAtTime(0.2,t); gain.gain.linearRampToValueAtTime(0,t+0.2);
            osc.connect(gain); gain.connect(this.ctx.destination); osc.start(); osc.stop(t+0.2);
        }
    }
};

const MusicManager = {
    audio: new Audio('gambler_8bit.mp3'), 
    init() { this.audio.loop = true; this.audio.volume = 0.3; },
    play() { if (!isMuted) this.audio.play().catch(e => {}); },
    pause() { this.audio.pause(); }
};
MusicManager.init();

/* --- CONFIG --- */
const FREQUENCIES = { 'E':12,'A':9,'I':9,'O':8,'N':6,'R':6,'T':6,'L':4,'S':4,'U':4,'D':4,'G':3,'B':2,'C':2,'M':2,'P':2,'F':2,'H':2,'V':2,'W':2,'Y':2,'K':1,'J':1,'X':1,'Q':1,'Z':1, '*': 2 };
const SCORES = { 'E':1,'T':1,'A':1,'O':2,'I':2,'N':2,'S':3,'H':3,'R':3,'D':4,'L':4,'C':4,'U':5,'M':5,'W':5,'F':6,'G':6,'Y':6,'P':7,'B':7,'V':7,'K':8,'J':8,'X':8,'Q':9,'Z':9, '*':0 };
const ICONS = { 'A':'♠️','B':'🐝','C':'🐱','D':'🐶','E':'🐘','F':'🦊','G':'🦒','H':'🦔','I':'🦎','J':'🫅','K':'👑','L':'🦁','M':'🐒','N':'🥷','O':'🦉','P':'🐼','Q':'👸','R':'🐰','S':'🐍','T':'🐯','U':'🦄','V':'🦅','W':'🐺','X':'⚔️','Y':'🐃','Z':'🦓','*':'🤡' };
const DICT_URL = 'https://raw.githubusercontent.com/redbo/scrabble/master/dictionary.txt';

/* --- STATE --- */
let deck = [], hand = [], board = [], discards = [], draftPool = [], selectedIndices = [], dictionary = [];
let phaseIndex = 0, swapsDoneThisHand = 0, swapLockedThisRound = false;
let handAnims = [], boardAnims = [];

async function initGame() {
    loadStats();
    LeaderboardManager.init();
    renderDistGrid();
    await initDictionary();
    checkDailyStatus();
    document.addEventListener('keydown', handleGlobalKeydown);
}

function showRules() { document.getElementById('rules-modal').style.display = 'flex'; }

function loadStats() {
    document.getElementById('daily-total').innerText = localStorage.getItem('oxford_total') || 0;
    document.getElementById('high-score').innerText = localStorage.getItem('oxford_high') || 0;
    document.getElementById('last-score').innerText = localStorage.getItem('oxford_last') || 0;
}

function confirmReset() {
    if(confirm("Reset all score history?")) {
        localStorage.removeItem('oxford_total'); localStorage.removeItem('oxford_high'); localStorage.removeItem('oxford_last');
        loadStats(); SoundManager.play('chip');
    }
}

function renderDistGrid() {
    const grid = document.getElementById('dist-grid');
    Object.keys(FREQUENCIES).forEach(l => {
        const item = document.createElement('div'); item.className = 'dist-item';
        item.innerHTML = `<span>${l === '*' ? '?' : l}</span> <span>${FREQUENCIES[l]}</span>`;
        grid.appendChild(item);
    });
}

async function initDictionary() {
    const loadingText = document.getElementById('loading-dict-text');
    const cachedDict = localStorage.getItem('oxford_dict_v1');
    if (cachedDict) {
        dictionary = JSON.parse(cachedDict);
    } else {
        try {
            const res = await fetch(DICT_URL);
            const text = await res.text();
            dictionary = text.split('\n').map(w => w.trim().toUpperCase()).filter(w => w.length >= 3 && w.length <= 8);
            try { localStorage.setItem('oxford_dict_v1', JSON.stringify(dictionary)); } catch(e){}
        } catch (e) { alert("Dictionary Error"); return; }
    }
    loadingText.innerText = `Oracle Online: ${dictionary.length} words. Ready.`;
}

function checkDailyStatus() {
    const today = new Date().toISOString().split('T')[0];
    const lastPlayed = localStorage.getItem('oxford_last_daily_played');
    if (lastPlayed === today) {
        const shareBtn = document.getElementById('daily-share-btn');
        if (shareBtn) shareBtn.style.display = 'flex';
    }
}

function handleStartClick(mode) {
    if (mode === 'daily') {
        const today = new Date().toISOString().split('T')[0];
        const lastPlayed = localStorage.getItem('oxford_last_daily_played');
        if (lastPlayed === today) {
            LeaderboardManager.show();
            return;
        }
        LeaderboardManager.checkName(); 
    } else {
        startGame('free');
    }
}

function handleGlobalKeydown(e) {
    if (e.target.tagName === 'INPUT') return;
    
    // Backspace support for Word Phase when not focused
    if (phaseIndex === 5 && e.key === 'Backspace') {
        const input = document.getElementById('word-input');
        input.value = input.value.slice(0, -1);
        handleTyping();
        return;
    }

    const key = e.key.toUpperCase();
    if (!/^[A-Z*?]$/.test(key)) return;
    const searchKey = key === '?' ? '*' : key;

    let pool = null;
    if (phaseIndex === 1) pool = draftPool;
    else if ((phaseIndex === 3 || phaseIndex === 4) && !swapLockedThisRound) pool = hand;
    
    if (pool) {
        const matches = pool.map((l, i) => l === searchKey ? i : -1).filter(i => i !== -1);
        if (matches.length === 0) return;

        // Try to select an unselected one first
        const unselected = matches.find(i => !selectedIndices.includes(i));
        if (unselected !== undefined) {
            toggleSelect(unselected);
        } else {
            // Otherwise deselect one
            const selected = matches.find(i => selectedIndices.includes(i));
            if (selected !== undefined) toggleSelect(selected);
        }
    } else if (phaseIndex === 5) {
        // Auto-focus and type if in word phase
        const input = document.getElementById('word-input');
        input.value += searchKey;
        handleTyping();
        input.focus();
        e.preventDefault();
    }
}

function startGame(mode) {
    initSeed(mode);
    document.getElementById('start-overlay').style.display = 'none';
    updateMuteUI();
    document.getElementById('main-btn').disabled = false;
    nextPhase();
}

function returnToMenu() {
    if(confirm("Quit current game and return to menu?")) {
        location.reload(); 
    }
}

/* --- GAME LOGIC --- */
function initDeck() {
    deck = [];
    Object.keys(FREQUENCIES).forEach(l => { for(let i=0; i<FREQUENCIES[l]; i++) deck.push(l); });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(randomFunc() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    updatePileCounts();
}

function updatePileCounts() {
    document.getElementById('deck-count-display').innerText = deck.length;
    document.getElementById('discard-display').innerText = discards.length;
    document.getElementById('discard-list').innerText = discards.join(', ');
}

function nextPhase() {
    const btn = document.getElementById('main-btn');
    const status = document.getElementById('status-msg');
    handAnims = []; boardAnims = [];
    SoundManager.play('flip');

    if (phaseIndex === 0) {
        const vowels = ['A','E','I','O','U','Y'];
        do {
            initDeck(); discards = [];
            draftPool = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
        } while (!draftPool.some(card => vowels.includes(card) || card === '*'));
        
        handAnims = [0,1,2,3,4];
        status.innerText = "Draft Phase: Keep 3 Cards";
        btn.innerText = "Confirm Hand";
        phaseIndex++;
        render(false, true);
    } else if (phaseIndex === 1) {
        if (selectedIndices.length !== 3) return alert("Select 3 cards to keep.");
        draftPool.forEach((c, i) => { if(!selectedIndices.includes(i)) discards.push(c); });
        hand = selectedIndices.map(i => draftPool[i]);
        selectedIndices = [];
        handAnims = [0,1,2];
        status.innerText = "Dealing Flop...";
        phaseIndex++;
        render(false, true); 
        setTimeout(nextPhase, 600);
    } else if (phaseIndex === 2) {
        board.push(deck.pop(), deck.pop(), deck.pop());
        boardAnims = [0, 1, 2];
        status.innerText = "The Flop: Select Discards";
        btn.innerText = "Deal Turn";
        swapLockedThisRound = false;
        document.getElementById('swap-btn').style.display = "inline";
        phaseIndex++;
        render(false, true);
    } else if (phaseIndex === 3) {
        board.push(deck.pop());
        boardAnims = [3];
        status.innerText = "The Turn";
        btn.innerText = "Deal River";
        swapLockedThisRound = false;
        phaseIndex++;
        render(false, true);
    } else if (phaseIndex === 4) {
        board.push(deck.pop());
        boardAnims = [4];
        status.innerText = "The River: Make a Word!";
        btn.innerText = "Submit Word";
        document.getElementById('swap-btn').style.display = "none";
        const inp = document.getElementById('word-input');
        inp.style.display = "inline-block"; inp.focus();
        phaseIndex++;
        render(false, true);
    } else if (phaseIndex === 5) { 
        calculateFinalScore(); 
    }
}

function executeSwap() {
    if (selectedIndices.length === 0) return alert("Select cards to discard first.");
    selectedIndices.forEach(idx => discards.push(hand[idx]));
    handAnims = [...selectedIndices];
    selectedIndices.forEach(idx => {
        hand[idx] = deck.pop();
        swapsDoneThisHand++;
    });
    selectedIndices = []; 
    swapLockedThisRound = true;
    SoundManager.play('flip');
    document.getElementById('status-msg').innerText = "Swap Locked. Deal Next Card.";
    render(false, false); 
}

function toggleSelect(i, isBoard = false) {
    SoundManager.play('chip');
    
    if (phaseIndex === 5) {
        const char = isBoard ? board[i] : hand[i];
        const input = document.getElementById('word-input');
        input.value += char;
        handleTyping();
        return;
    }
    if (isBoard) return;

    if (phaseIndex === 1) {
        if (selectedIndices.includes(i)) selectedIndices = selectedIndices.filter(x => x !== i);
        else if (selectedIndices.length < 3) selectedIndices.push(i);
    } else if (!swapLockedThisRound && (phaseIndex === 3 || phaseIndex === 4)) {
        const remaining = 2 - swapsDoneThisHand;
        if (selectedIndices.includes(i)) selectedIndices = selectedIndices.filter(x => x !== i);
        else if (selectedIndices.length < remaining) selectedIndices.push(i);
    }
    render(true, false);
}

function createCardElement(letter, index, isBoard, shouldAnimate) {
    const isSelected = !isBoard && selectedIndices.includes(index);
    const isRiver = isBoard && index === 4;
    const isFace = ['J','Q','K','A'].includes(letter); 
    const card = document.createElement('div');
    card.id = `card-${isBoard?'board':'hand'}-${index}`;
    card.className = `card ${isBoard ? 'communal' : ''} ${isSelected ? 'selected' : ''} ${shouldAnimate ? 'animate-deal' : ''} ${isRiver ? 'river-bonus' : ''} ${isFace ? 'face-card' : ''}`;
    card.setAttribute('data-letter', letter);
    const score = SCORES[letter];
    const color = (letter === '*') ? '#e040fb' : (['J','Q','K','A'].includes(letter) ? '#000' : getScoreColor(letter));
    card.innerHTML = `<div class="corner top-left" style="color: ${color}">${score}</div><div class="animal-icon">${ICONS[letter] || '❓'}</div><div class="main-letter">${letter === '*' ? '?' : letter}</div><div class="corner bottom-right" style="color: ${color}">${score}</div>`;
    if (!isBoard || phaseIndex === 5) card.onclick = () => toggleSelect(index, isBoard);
    return card;
}

function render(isInteraction = false, redrawBoard = true) {
    updatePileCounts();
    const handDiv = document.getElementById('hand');
    const boardDiv = document.getElementById('board');
    handDiv.innerHTML = '';
    const displayHand = phaseIndex === 1 ? draftPool : hand;
    displayHand.forEach((l, i) => {
        const animate = !isInteraction && handAnims.includes(i);
        handDiv.appendChild(createCardElement(l, i, false, animate));
    });
    if (redrawBoard) {
        boardDiv.innerHTML = '';
        for (let i = 0; i < 5; i++) {
            if (board[i]) {
                const animate = !isInteraction && boardAnims.includes(i);
                boardDiv.appendChild(createCardElement(board[i], i, true, animate));
            } else {
                const slot = document.createElement('div'); slot.className = 'card-slot';
                if (i === 4) slot.innerHTML = '<span class="river-slot-text">THE RIVER</span>';
                boardDiv.appendChild(slot);
            }
        }
    }
    const swapBtn = document.getElementById('swap-btn');
    if (swapBtn.style.display !== 'none') {
        const remaining = 2 - swapsDoneThisHand;
        swapBtn.innerText = `Confirm Swap (${remaining} left)`;
        swapBtn.disabled = swapLockedThisRound || selectedIndices.length === 0;
    }
    handleTyping();
}

function getScoreColor(l) { const s = SCORES[l]; return s<=1 ? "#2196F3" : s<=3 ? "#4CAF50" : s<=6 ? "#FF9800" : "#E91E63"; }
function canFormWord(word, pool) { let tempPool = [...pool]; for (let char of word) { let idx = tempPool.indexOf(char); if (idx === -1) idx = tempPool.indexOf('*'); if (idx === -1) return false; tempPool.splice(idx, 1); } return true; }

function calculateBaseScore(word, pool) {
    let currentPool = [...pool];
    let score = 0;
    for (let char of word) {
        let idx = currentPool.indexOf(char);
        if (idx !== -1) {
            score += SCORES[char];
            currentPool.splice(idx, 1);
        } else {
            idx = currentPool.indexOf('*');
            if (idx !== -1) {
                score += 0; 
                currentPool.splice(idx, 1);
            } else {
                return -1; 
            }
        }
    }
    return score;
}

function scoreSpecificWord(word, letterPool) {
    const riverIndex = letterPool.length - 1; 
    const riverCard = letterPool[riverIndex];
    const regularPool = letterPool.slice(0, riverIndex);
    
    let maxScore = -1;
    const mult = word.length >= 8 ? 3 : word.length >= 7 ? 2 : word.length >= 5 ? 1.5 : 1;

    // 1. Try forming word WITHOUT River card
    let scoreNoRiver = calculateBaseScore(word, regularPool);
    if (scoreNoRiver !== -1) {
        maxScore = Math.floor(scoreNoRiver * mult);
    }

    // 2. Try using River card for each position
    for (let i = 0; i < word.length; i++) {
        const char = word[i];
        if (riverCard === char || riverCard === '*') {
            const remainingWord = word.slice(0, i) + word.slice(i + 1);
            let restScore = calculateBaseScore(remainingWord, regularPool);
            
            if (restScore !== -1) {
                let riverVal = (riverCard === '*') ? 0 : SCORES[char];
                let totalBase = (riverVal * 2) + restScore;
                let total = Math.floor(totalBase * mult);
                if (total > maxScore) maxScore = total;
            }
        }
    }
    
    return maxScore;
}

function findBestPossibleScore() {
    let pool = [...hand, ...board]; let maxScore = 0; let bestWord = "NONE";
    for (let word of dictionary) {
        if (canFormWord(word, pool)) { let s = scoreSpecificWord(word, pool); if (s > maxScore) { maxScore = s; bestWord = word; } }
    }
    return { word: bestWord, score: maxScore };
}

async function calculateFinalScore() {
    const wordInput = document.getElementById('word-input');
    const word = wordInput.value.toUpperCase().trim();
    if (word.length < 3) return;
    const pool = [...hand, ...board];
    if (!canFormWord(word, pool)) { markInvalid("Missing letters!"); return; }
    if (!dictionary.includes(word)) { markInvalid("Not in dictionary!"); return; }
    let userScore = scoreSpecificWord(word, pool);
    SoundManager.play('success');
    
    // STATS & DAILY LIMIT
    const today = new Date().toISOString().split('T')[0];
    if (gameMode === 'daily') {
        localStorage.setItem('oxford_last_daily_played', today);
        localStorage.setItem('oxford_daily_score', userScore);
        LeaderboardManager.submitScore(userScore, word);
        document.getElementById('next-hand-btn').innerText = "See Leaderboard";
        document.getElementById('next-hand-btn').onclick = function() { 
            document.getElementById('result-modal').style.display = 'none';
            LeaderboardManager.show(); 
        };
    } else {
        document.getElementById('next-hand-btn').innerText = "Next Hand";
        document.getElementById('next-hand-btn').onclick = softReset;
    }

    document.getElementById('modal-word').innerText = word;
    document.getElementById('modal-score').innerText = userScore;
    const best = findBestPossibleScore();
    document.getElementById('best-word-text').innerText = `${best.word} (${best.score} pts)`;
    const daily = parseInt(localStorage.getItem('oxford_total') || 0) + userScore;
    const high = parseInt(localStorage.getItem('oxford_high') || 0);
    localStorage.setItem('oxford_total', daily); localStorage.setItem('oxford_last', userScore);
    if(userScore > high) localStorage.setItem('oxford_high', userScore);
    
    document.getElementById('result-modal').style.display = 'flex';
}

function softReset() {
    document.getElementById('result-modal').style.display = 'none';
    document.getElementById('word-input').value = "";
    document.getElementById('word-input').style.display = "none";
    document.getElementById('swap-btn').style.display = "none";
    
    deck = []; hand = []; board = []; discards = []; draftPool = []; selectedIndices = [];
    phaseIndex = 0; swapsDoneThisHand = 0; swapLockedThisRound = false;
    
    nextPhase();
}

function shareResult() {
    const score = document.getElementById('modal-score').innerText;
    const date = new Date().toISOString().split('T')[0];
    
    // No Emoji Grid (No Spoilers)
    const text = `🃏 Oxford Hold 'Em ${date}\n🏆 Score: ${score}\n\n${window.location.href}`;
    
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('share-btn');
        const orig = btn.innerText;
        btn.innerText = "✅ Copied!";
        setTimeout(() => btn.innerText = orig, 2000);
    });
}

function shareDailyResult() {
    const score = localStorage.getItem('oxford_daily_score');
    if (!score) return;
    const date = new Date().toISOString().split('T')[0];
    const text = `🃏 Oxford Hold 'Em ${date}\n🏆 Score: ${score}\n\n${window.location.href}`;
    
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('daily-share-btn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<div><div>✅ Copied!</div><span class="mode-desc">Paste it anywhere!</span></div><div>📋</div>`;
        setTimeout(() => btn.innerHTML = originalHTML, 2000);
    });
}

function closeLeaderboard() {
    document.getElementById('lb-modal').style.display = 'none';
    if (gameMode === 'daily' && phaseIndex === 5) {
        location.reload();
    }
}

function markInvalid(msg) {
    const inp = document.getElementById('word-input'); inp.classList.add('invalid'); inp.value = ""; inp.placeholder = msg;
    SoundManager.play('error'); setTimeout(() => inp.placeholder = "Enter word...", 1500);
}

function handleTyping() {
    const input = document.getElementById('word-input'); if(input.style.display === 'none') return;
    input.classList.remove('invalid'); const text = input.value.toUpperCase().split('');
    const allCards = document.querySelectorAll('.card'); allCards.forEach(c => c.classList.remove('bumped'));
    let usedIndices = [];
    text.forEach(char => {
        let found = false;
        for(let i=0; i<allCards.length; i++) {
            if (usedIndices.includes(i)) continue;
            if (allCards[i].getAttribute('data-letter') === char) { allCards[i].classList.add('bumped'); usedIndices.push(i); found = true; break; }
        }
        if (!found) {
            for(let i=0; i<allCards.length; i++) {
                if (usedIndices.includes(i)) continue;
                if (allCards[i].getAttribute('data-letter') === '*') { allCards[i].classList.add('bumped'); usedIndices.push(i); break; }
            }
        }
    });
}