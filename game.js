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

            // Process data for ranking
            let scores = [];
            q.forEach(doc => scores.push(doc.data()));
            
            // Sort by score desc, then timestamp asc (earlier is better)
            scores.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const tA = a.timestamp ? a.timestamp.seconds : Number.MAX_SAFE_INTEGER;
                const tB = b.timestamp ? b.timestamp.seconds : Number.MAX_SAFE_INTEGER;
                return tA - tB;
            });

            let html = `<table class="lb-table"><tr><th style="width: 60px;">#</th><th>Player</th><th>Word</th><th>Score</th></tr>`;
            
            for (let i = 0; i < scores.length; i++) {
                const d = scores[i];
                let rank = i + 1;
                if (i > 0 && d.score === scores[i-1].score) rank = scores[i-1].displayRank;
                d.displayRank = rank;

                const isTied = (i > 0 && d.score === scores[i-1].score) || (i < scores.length - 1 && d.score === scores[i+1].score);
                
                let rankSymbol = rank;
                if (rank === 1) rankSymbol = '🥇';
                else if (rank === 2) rankSymbol = '🥈';
                else if (rank === 3) rankSymbol = '🥉';
                
                let rankStr = isTied ? `T-${rankSymbol}` : rankSymbol;
                let rankStyle = (rank <= 3) ? '' : 'color: #ccc;';

                // Hide word if user hasn't played today
                const wordDisplay = userPlayedToday ? d.word : `<span class="hidden-word">🙈 HIDDEN</span>`;
                
                html += `<tr><td class="lb-rank" style="${rankStyle} white-space:nowrap;">${rankStr}</td><td>${d.name}</td><td style="font-size:0.8rem;">${wordDisplay}</td><td class="lb-score">${d.score}</td></tr>`;
            }
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
let currentDeckSort = { field: 'left', dir: 'desc' };
const ENABLE_VARIABLE_HOLE_CARDS = true;

async function initGame() {
    loadStats();
    LeaderboardManager.init();
    await initDictionary();
    checkDailyStatus();
    
    // Remove inline handlers to prevent conflicts with global keydown logic
    const input = document.getElementById('word-input');
    input.onkeydown = null;
    input.oninput = null;
    input.addEventListener('input', handleTyping);
    
    // Add focus listeners for mobile layout adjustment
    input.addEventListener('focus', () => document.body.classList.add('keyboard-active'));
    input.addEventListener('blur', () => document.body.classList.remove('keyboard-active'));
    
    document.addEventListener('keydown', handleGlobalKeydown);
    updateRulesUI();
}

function showRules() { document.getElementById('rules-modal').style.display = 'flex'; }

function updateRulesUI() {
    const draftRule = document.getElementById('rule-draft');
    const holeBonuses = document.getElementById('rule-hole-bonuses');
    
    let draftText = "";
    let scoringText = "";

    if (ENABLE_VARIABLE_HOLE_CARDS) {
        draftText = '<strong>Draft:</strong> Pick 1, 2, or 3 hole cards. Fewer cards = higher multipliers!';
        
        scoringText += '<div style="margin-bottom: 5px; font-weight: bold; color: #333;">Hole Card Multipliers</div>';
        scoringText += '<ul style="margin-top: 5px; padding-left: 20px; margin-bottom: 15px; font-size: 0.9rem; color: #555;">';
        
        scoringText += '<li style="margin-bottom: 4px;"><strong>1 Card:</strong> <span style="color:#d32f2f; font-weight:bold;">Feelin\' Lucky (3x)</span></li>';
        scoringText += '<li style="margin-bottom: 4px;"><strong>2 Cards:</strong> <span style="color:#ef6c00; font-weight:bold;">Texas Two Step (1.5x)</span></li>';
        scoringText += '<li><strong>3 Cards:</strong> <span style="color:#666;">Standard Hand (1x)</span></li>';
        
        scoringText += '</ul>';
    } else {
        draftText = '<strong>Draft:</strong> Pick the best 3 hole cards from 5 options.';
    }

    scoringText += '<div style="background:#f5f5f5; padding:10px; border-radius:8px; border:1px solid #e0e0e0; margin-bottom:10px;">';
    scoringText += '<div style="font-weight:bold; color:#333; margin-bottom:4px;">Formula</div>';
    scoringText += '<div style="color:#555; font-size:0.9rem;">(Points × <span style="color:#9c27b0; font-weight:bold;">Card Mults</span>) × <span style="color:#d32f2f; font-weight:bold;">Length Mult</span></div>';
    scoringText += '</div>';

    scoringText += '<div style="font-size:0.9rem; color:#555;">';
    scoringText += '<span style="color:#2e7d32; font-weight:bold; cursor:pointer; text-decoration:underline;" onclick="document.getElementById(\'rules-modal\').style.display=\'none\'; showDeckStats();">Tip: Tap deck for letter values!</span>';
    scoringText += '</div>';

    if (draftRule) draftRule.innerHTML = draftText;
    if (holeBonuses) {
        holeBonuses.innerHTML = scoringText;
        holeBonuses.style.display = 'block';
    }
}

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

function showDeckStats(sortBy) {
    const modal = document.getElementById('deck-stats-modal');
    const content = document.getElementById('deck-stats-content');
    if (!modal || !content) return;

    if (sortBy) {
        if (currentDeckSort.field === sortBy) {
            currentDeckSort.dir = currentDeckSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            currentDeckSort.field = sortBy;
            currentDeckSort.dir = 'desc';
            if (sortBy === 'card') currentDeckSort.dir = 'asc';
        }
    }

    const remainingCounts = {};
    Object.keys(FREQUENCIES).forEach(k => remainingCounts[k] = 0);
    deck.forEach(card => {
        if (remainingCounts[card] !== undefined) remainingCounts[card]++;
    });

    const rows = Object.keys(FREQUENCIES).map(k => ({
        key: k,
        cardDisplay: (k === '*' ? '?' : k) + ' ' + (ICONS[k] || k),
        pts: SCORES[k],
        orig: FREQUENCIES[k],
        left: remainingCounts[k]
    }));

    rows.sort((a, b) => {
        let valA = a[currentDeckSort.field];
        let valB = b[currentDeckSort.field];
        if (currentDeckSort.field === 'card') { valA = a.key; valB = b.key; }
        if (valA < valB) return currentDeckSort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return currentDeckSort.dir === 'asc' ? 1 : -1;
        return 0;
    });

    const getArrow = (f) => currentDeckSort.field === f ? (currentDeckSort.dir === 'asc' ? '↑' : '↓') : '';

    let html = '<table class="rules-table" style="text-align:center; margin-top:0;">';
    html += `<tr>
        <th onclick="showDeckStats('card')" style="cursor:pointer; user-select:none;">Card ${getArrow('card')}</th>
        <th onclick="showDeckStats('pts')" style="cursor:pointer; user-select:none;">Pts ${getArrow('pts')}</th>
        <th onclick="showDeckStats('orig')" style="cursor:pointer; user-select:none;">Orig ${getArrow('orig')}</th>
        <th onclick="showDeckStats('left')" style="cursor:pointer; user-select:none;">Left ${getArrow('left')}</th>
    </tr>`;
    
    rows.forEach(row => {
        const style = row.left === 0 ? 'opacity: 0.3' : '';
        html += `<tr style="${style}"><td>${row.cardDisplay}</td><td>${row.pts}</td><td>${row.orig}</td><td style="font-weight:bold; color:${row.left>0?'var(--mode-daily)':'#555'}">${row.left}</td></tr>`;
    });
    html += '</table>';
    
    content.innerHTML = html;
    modal.style.display = 'flex';
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
    const dailyScore = localStorage.getItem('oxford_daily_score');
    
    if (lastPlayed === today && dailyScore) {
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
    const key = e.key.toUpperCase();

    // 1. Enter Key (Global)
    if (key === 'ENTER') {
        if (phaseIndex === 5) calculateFinalScore();
        else {
            const btn = document.getElementById('main-btn');
            if (!btn.disabled) nextPhase();
        }
        e.preventDefault();
        return;
    }
    
    // 2. Phase 5: Word Entry (Typing & Validation)
    if (phaseIndex === 5) {
        if (document.getElementById('main-btn').innerText === "Go Bust") return;

        const input = document.getElementById('word-input');
        
        if (key === 'BACKSPACE') {
            // Handle backspace manually since we might preventDefault
            if (document.activeElement !== input) {
                 input.value = input.value.slice(0, -1);
                 handleTyping();
            }
            return; 
        }

        if (!/^[A-Z*?]$/.test(key)) return; // Ignore non-letters
        
        const searchKey = key === '?' ? '*' : key;
        const pool = [...hand, ...board];
        const currentWord = input.value.toUpperCase();
        const nextWord = currentWord + searchKey;

        if (canFormWord(nextWord, pool)) {
            // Valid: Append
            input.value += searchKey;
            handleTyping();
        } else {
            // Invalid: Check for Deselect (Toggle behavior)
            const lastIndex = currentWord.lastIndexOf(searchKey);
            if (lastIndex !== -1) {
                input.value = currentWord.slice(0, lastIndex) + currentWord.slice(lastIndex + 1);
                handleTyping();
            } else {
                SoundManager.play('error');
            }
        }
        
        e.preventDefault(); // Prevent default typing to enforce our validation
        return;
    }

    // 3. Other Phases: Selection Logic
    if (e.target.tagName === 'INPUT') return;

    if (key === 'DELETE' || key === 'BACKSPACE') {
        if (selectedIndices.length > 0) {
            selectedIndices.pop();
            SoundManager.play('chip');
            render(true, false);
        }
        e.preventDefault();
        return;
    }

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
        if (ENABLE_VARIABLE_HOLE_CARDS) {
            status.innerText = "Draft: Keep up to 3 hole cards. Fewer cards = bigger bonuses, but shorter words!";
            btn.innerText = "Select hole cards to keep";
        } else {
            status.innerText = "Draft Phase: Keep 3 Hole Cards";
            btn.innerText = "Confirm Hole Cards";
        }
        phaseIndex++;
        render(false, true);
    } else if (phaseIndex === 1) {
        if (ENABLE_VARIABLE_HOLE_CARDS) {
            if (selectedIndices.length < 1 || selectedIndices.length > 3) return alert("Select 1, 2, or 3 hole cards to keep.");
        } else {
            if (selectedIndices.length !== 3) return alert("Select 3 hole cards to keep.");
        }
        
        draftPool.forEach((c, i) => { if(!selectedIndices.includes(i)) discards.push(c); });
        hand = selectedIndices.map(i => draftPool[i]);
        selectedIndices = [];
        handAnims = [0,1,2];
        
        if (hand.length < 3) {
            handAnims = Array.from({length: hand.length}, (_, i) => i);
        }
        
        status.innerText = "Dealing Flop...";
        phaseIndex++;
        render(false, true); 
        setTimeout(nextPhase, 600);
    } else if (phaseIndex === 2) {
        board.push(deck.pop(), deck.pop(), deck.pop());
        boardAnims = [0, 1, 2];
        status.innerText = "The Flop: select hole cards to swap (if you want to.)";
        btn.innerText = "Deal Turn";
        swapLockedThisRound = false;
        document.getElementById('swap-btn').style.display = "inline";
        phaseIndex++;
        render(false, true);
    } else if (phaseIndex === 3) {
        board.push(deck.pop());
        boardAnims = [3];
        status.innerText = "The Turn: select hole cards to swap (if you want to.)";
        btn.innerText = "Deal River";
        swapLockedThisRound = false;
        phaseIndex++;
        render(false, true);
    } else if (phaseIndex === 4) {
        board.push(deck.pop());
        boardAnims = [4];
        
        // Check for bust (no possible words)
        const best = findBestPossibleScore();
        if (best.score === 0) {
            status.innerText = "The River: No possible words!";
            btn.innerText = "Go Bust";
            document.getElementById('word-input').style.display = "none";
        } else {
            status.innerText = "The River: Make a Word!";
            btn.innerText = "Submit Word";
            const inp = document.getElementById('word-input');
            inp.style.display = "inline-block"; inp.focus();
        }

        document.getElementById('swap-btn').style.display = "none";
        phaseIndex++;
        render(false, true);
    } else if (phaseIndex === 5) { 
        calculateFinalScore(); 
    }
}

function executeSwap() {
    if (selectedIndices.length === 0) return alert("Select hole cards to discard first.");
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
        const card = document.getElementById(`card-${isBoard?'board':'hand'}-${i}`);
        
        // If card is already used, remove it (Deselect)
        if (card.classList.contains('bumped')) {
            const idx = parseInt(card.dataset.inputIndex);
            if (!isNaN(idx)) {
                const val = input.value;
                input.value = val.slice(0, idx) + val.slice(idx + 1);
                handleTyping();
            }
            return;
        }
        
        if (char === '*') {
            const letter = prompt("What letter is this wildcard?");
            if (letter && /^[a-zA-Z]$/.test(letter.trim())) {
                input.value += letter.trim().toUpperCase();
            }
        } else {
            input.value += char;
        }
        handleTyping();
        return;
    }
    if (isBoard) return;

    if (phaseIndex === 1) {
        if (selectedIndices.includes(i)) selectedIndices = selectedIndices.filter(x => x !== i);
        else if (selectedIndices.length < 3) selectedIndices.push(i);
        
        if (ENABLE_VARIABLE_HOLE_CARDS) {
            const btn = document.getElementById('main-btn');
            const count = selectedIndices.length;
            if (count === 0) btn.innerHTML = "Select at least one hole card to keep";
            else if (count === 1) btn.innerHTML = "Confirm: <span style='color:#d32f2f'>Feelin' Lucky (3x)</span>";
            else if (count === 2) btn.innerHTML = "Confirm: <span style='color:#ef6c00'>Texas Two Step (1.5x)</span>";
            else btn.innerHTML = "Confirm Hole Cards";
        }
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
    
    let bonusClass = '';
    if (ENABLE_VARIABLE_HOLE_CARDS && !isBoard && phaseIndex > 1) {
        if (hand.length === 1) bonusClass = 'hole-bonus-3x';
        else if (hand.length === 2) bonusClass = 'hole-bonus-15x';
    }

    const card = document.createElement('div');
    card.id = `card-${isBoard?'board':'hand'}-${index}`;
    card.className = `card ${isBoard ? 'communal' : ''} ${isSelected ? 'selected' : ''} ${shouldAnimate ? 'animate-deal' : ''} ${isRiver ? 'river-bonus' : ''} ${bonusClass}`;
    card.setAttribute('data-letter', letter);
    const score = SCORES[letter];
    const color = (letter === '*') ? '#e040fb' : getScoreColor(letter);
    const displayLetter = letter === '*' ? '?' : letter;
    const icon = ICONS[letter] || '❓';

    card.innerHTML = `
        <div class="corner-letter top-left" style="color: ${color}">${displayLetter}</div>
        <div class="corner-score top-right" style="color: ${color}">${score}</div>
        <div class="main-content">
            <div class="animal-icon">${icon}</div>
            <div class="main-letter">${displayLetter}</div>
            <div class="animal-icon" style="transform: rotate(180deg);">${icon}</div>
        </div>
        <div class="corner-score bottom-left" style="color: ${color}">${score}</div>
        <div class="corner-letter bottom-right" style="color: ${color}">${displayLetter}</div>
    `;
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

    const mainBtn = document.getElementById('main-btn');
    if (phaseIndex === 1) {
        const valid = ENABLE_VARIABLE_HOLE_CARDS 
            ? (selectedIndices.length >= 1 && selectedIndices.length <= 3)
            : (selectedIndices.length === 3);
        mainBtn.disabled = !valid;
        mainBtn.style.opacity = valid ? "1" : "0.5";
        mainBtn.style.cursor = valid ? "pointer" : "not-allowed";
    } else if (phaseIndex === 5 && mainBtn.innerText === "Go Bust") {
        mainBtn.disabled = false;
        mainBtn.style.opacity = "1";
        mainBtn.style.cursor = "pointer";
    } else if (phaseIndex !== 5) {
        mainBtn.disabled = false;
        mainBtn.style.opacity = "1";
        mainBtn.style.cursor = "pointer";
    }

    const swapBtn = document.getElementById('swap-btn');
    if (swapBtn.style.display !== 'none') {
        const remaining = 2 - swapsDoneThisHand;
        swapBtn.innerText = `Confirm Swap (${remaining} left)`;
        swapBtn.disabled = swapLockedThisRound || selectedIndices.length === 0;
        swapBtn.style.opacity = swapBtn.disabled ? "0.5" : "1";
        swapBtn.style.cursor = swapBtn.disabled ? "not-allowed" : "pointer";
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

function getCardObjects() {
    let cards = [];
    // Hole cards
    let holeMult = 1;
    if (ENABLE_VARIABLE_HOLE_CARDS) {
        if (hand.length === 1) holeMult = 3;
        else if (hand.length === 2) holeMult = 1.5;
    }
    hand.forEach(c => cards.push({ char: c, mult: holeMult }));
    
    // Board cards
    board.forEach((c, i) => {
        let mult = 1;
        if (i === 4) mult = 2; // River
        cards.push({ char: c, mult: mult });
    });
    return cards;
}

function calculateOptimalScore(word, cardObjects) {
    let pool = cardObjects.map(c => ({...c}));
    let baseScore = 0;
    
    for (let char of word) {
        let matches = pool.filter(c => c.char === char);
        if (matches.length > 0) {
            matches.sort((a, b) => b.mult - a.mult);
            let best = matches[0];
            baseScore += SCORES[char] * best.mult;
            let idx = pool.indexOf(best);
            pool.splice(idx, 1);
        } else {
            let wildcards = pool.filter(c => c.char === '*');
            if (wildcards.length > 0) {
                let idx = pool.indexOf(wildcards[0]);
                pool.splice(idx, 1);
            } else {
                return 0;
            }
        }
    }
    
    let mult = word.length >= 8 ? 3 : word.length >= 7 ? 2 : word.length >= 5 ? 1.5 : 1;
    return Math.floor(baseScore * mult);
}

function findBestPossibleScore() {
    let cardObjs = getCardObjects();
    let simplePool = [...hand, ...board];
    let maxScore = 0; let bestWord = "NONE";
    for (let word of dictionary) {
        if (canFormWord(word, simplePool)) { 
            let s = calculateOptimalScore(word, cardObjs); 
            if (s > maxScore) { maxScore = s; bestWord = word; } 
        }
    }
    return { word: bestWord, score: maxScore };
}

async function calculateFinalScore() {
    const btn = document.getElementById('main-btn');
    let word = "";
    let userScore = 0;

    if (btn.innerText === "Go Bust") {
        word = "BUST";
        SoundManager.play('error');
    } else {
        const wordInput = document.getElementById('word-input');
        word = wordInput.value.toUpperCase().trim();
        if (word.length < 3) return;
        const pool = [...hand, ...board];
        if (!canFormWord(word, pool)) { markInvalid("Missing letters!"); return; }
        if (!dictionary.includes(word)) { markInvalid("Not in dictionary!"); return; }
        userScore = calculateScoreWithMultipliers(word);
        SoundManager.play('success');
    }
    
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
    
    const preview = document.getElementById('score-preview');
    if (preview) {
        preview.innerHTML = "";
        preview.style.display = "none";
    }
    
    deck = []; hand = []; board = []; discards = []; draftPool = []; selectedIndices = [];
    phaseIndex = 0; swapsDoneThisHand = 0; swapLockedThisRound = false;
    
    nextPhase();
}

function shareResult() {
    const score = document.getElementById('modal-score').innerText;
    let text;
    
    if (gameMode === 'daily') {
        const date = new Date().toISOString().split('T')[0];
        text = `🃏 Oxford Hold 'Em ${date}\n🏆 Score: ${score}\n\n${window.location.href}`;
    } else {
        text = `🃏 Oxford Hold 'Em Freeplay\n🏆 Score: ${score}\n\n${window.location.href}`;
    }
    
    copyToClipboard(text, () => {
        const btn = document.getElementById('share-btn');
        const orig = btn.innerText;
        btn.innerText = "✅ Copied!";
        setTimeout(() => btn.innerText = orig, 2000);
    });
}

function shareDailyResult() {
    const score = localStorage.getItem('oxford_daily_score');
    if (!score) {
        alert("Score not found. Please play today's hand to generate a score.");
        return;
    }
    const date = new Date().toISOString().split('T')[0];
    const text = `🃏 Oxford Hold 'Em ${date}\n🏆 Score: ${score}\n\n${window.location.href}`;
    
    copyToClipboard(text, () => {
        const btn = document.getElementById('daily-share-btn');
        if (btn) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `<div><div>✅ Copied!</div><span class="mode-desc">Paste it anywhere!</span></div><div>📋</div>`;
            setTimeout(() => btn.innerHTML = originalHTML, 2000);
        }
    });
}

function copyToClipboard(text, onSuccess) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onSuccess).catch(() => fallbackCopy(text, onSuccess));
    } else {
        fallbackCopy(text, onSuccess);
    }
}

function fallbackCopy(text, onSuccess) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "0";
    textArea.style.top = "0";
    textArea.style.opacity = "0";
    
    // iOS requirements for successful copy
    textArea.contentEditable = true;
    textArea.readOnly = false;
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    if (textArea.setSelectionRange) {
        textArea.setSelectionRange(0, 999999); // iOS selection
    }
    
    try {
        const successful = document.execCommand('copy');
        if (successful && onSuccess) onSuccess();
    } catch (err) {
        console.error('Fallback copy failed', err);
    }
    document.body.removeChild(textArea);
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
    
    const mainBtn = document.getElementById('main-btn');
    if (phaseIndex === 5 && mainBtn.innerText !== "Go Bust") {
        const valid = input.value.trim().length >= 3;
        mainBtn.disabled = !valid;
        mainBtn.style.opacity = valid ? "1" : "0.5";
        mainBtn.style.cursor = valid ? "pointer" : "not-allowed";
    }
    
    // Get all cards and sort to prioritize River card (visually)
    const allCards = Array.from(document.querySelectorAll('.card'));
    allCards.forEach(c => {
        c.classList.remove('bumped');
        delete c.dataset.inputIndex;
    });
    
    allCards.sort((a, b) => {
        const getMult = (c) => {
            if (c.classList.contains('hole-bonus-3x')) return 3;
            if (c.classList.contains('river-bonus')) return 2;
            if (c.classList.contains('hole-bonus-15x')) return 1.5;
            return 1;
        };
        return getMult(b) - getMult(a);
    });

    let usedCards = new Set();
    text.forEach((char, idx) => {
        let found = false;
        // 1. Exact Match
        for(let card of allCards) {
            if (usedCards.has(card)) continue;
            if (card.getAttribute('data-letter') === char) { 
                card.classList.add('bumped'); 
                card.dataset.inputIndex = idx;
                usedCards.add(card); 
                found = true; 
                break; 
            }
        }
        // 2. Wildcard Match
        if (!found) {
            for(let card of allCards) {
                if (usedCards.has(card)) continue;
                if (card.getAttribute('data-letter') === '*') { 
                    card.classList.add('bumped'); 
                    card.dataset.inputIndex = idx;
                    usedCards.add(card); 
                    break; 
                }
            }
        }
    });
    updateScorePreview(input.value.toUpperCase());
}

function calculateScoreWithMultipliers(word) {
    let baseScore = 0;
    const allCards = Array.from(document.querySelectorAll('.card.bumped'));
    
    for (let i = 0; i < word.length; i++) {
        const card = allCards.find(c => c.dataset.inputIndex == i);
        if (card) {
            const cardLetter = card.getAttribute('data-letter');
            let val = (cardLetter === '*') ? 0 : SCORES[cardLetter];
            
            const isRiver = card.classList.contains('river-bonus');
            const isHole3x = card.classList.contains('hole-bonus-3x');
            const isHole15x = card.classList.contains('hole-bonus-15x');
            
            if (isRiver) {
                val *= 2;
            } else if (isHole3x) {
                val *= 3;
            } else if (isHole15x) {
                val *= 1.5;
            }
            
            baseScore += val;
        }
    }
    
    let mult = word.length >= 8 ? 3 : word.length >= 7 ? 2 : word.length >= 5 ? 1.5 : 1;
    return Math.floor(baseScore * mult);
}

function updateScorePreview(word) {
    let previewEl = document.getElementById('score-preview');
    if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.id = 'score-preview';
        // Styles for readability
        previewEl.style.marginTop = '5px';
        previewEl.style.fontSize = '0.9rem';
        previewEl.style.color = '#ffffff';
        previewEl.style.backgroundColor = 'rgba(0,0,0,0.85)';
        previewEl.style.padding = '6px 12px';
        previewEl.style.borderRadius = '20px';
        previewEl.style.width = 'fit-content';
        previewEl.style.margin = '5px auto';
        previewEl.style.fontFamily = 'monospace';
        previewEl.style.display = 'none';
        const input = document.getElementById('word-input');
        input.insertAdjacentElement('afterend', previewEl);
    }
    
    if (!word || word.length < 3) {
        previewEl.innerHTML = "";
        previewEl.style.display = 'none';
        return;
    }
    previewEl.style.display = 'block';

    let breakdown = [];
    let baseScore = 0;
    const allCards = Array.from(document.querySelectorAll('.card.bumped'));
    
    for (let i = 0; i < word.length; i++) {
        const card = allCards.find(c => c.dataset.inputIndex == i);
        if (card) {
            const cardLetter = card.getAttribute('data-letter');
            const displayLetter = word[i];
            let val = (cardLetter === '*') ? 0 : SCORES[cardLetter];
            
            const isRiver = card.classList.contains('river-bonus');
            const isHole3x = card.classList.contains('hole-bonus-3x');
            const isHole15x = card.classList.contains('hole-bonus-15x');
            
            if (isRiver) {
                val *= 2;
                breakdown.push(`<span style="color:var(--bonus-purple)">${displayLetter}(${val/2}x2)</span>`);
            } else if (isHole3x) {
                val *= 3;
                breakdown.push(`<span style="color:#ff5252">${displayLetter}(${val/3}x3)</span>`);
            } else if (isHole15x) {
                val *= 1.5;
                breakdown.push(`<span style="color:#ff9800">${displayLetter}(${val/1.5}x1.5)</span>`);
            } else {
                breakdown.push(`${displayLetter}(${val})`);
            }
            baseScore += val;
        }
    }
    
    let mult = word.length >= 8 ? 3 : word.length >= 7 ? 2 : word.length >= 5 ? 1.5 : 1;
    let total = Math.floor(baseScore * mult);
    
    let calculationHtml = breakdown.join('+');
    if (mult > 1) {
        let color = mult >= 3 ? '#d32f2f' : mult >= 2 ? '#1565c0' : '#2e7d32';
        calculationHtml = `(${calculationHtml}) <span style="color:${color}; font-weight:bold;">x${mult}</span>`;
    }
    
    let html = '<span style="color:#ccc; margin-right:8px;">Score Preview:</span>';
    html += calculationHtml;
    html += ` = <span style="color:white; font-weight:bold;">${total}</span>`;
    
    previewEl.innerHTML = html;
}