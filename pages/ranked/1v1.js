const SB_URL = 'https://tzaowqeofmwfnprrfwat.supabase.co';
const SB_KEY = 'sb_publishable_Sr33ux9FL6QZaJlfhjoqFw_tIwQhSbx';
const _supabase = supabase.createClient(SB_URL, SB_KEY);

let currentCombo = 0;
const comboVal = document.getElementById('combo-val');
const comboStat = document.getElementById('combo-stat');

const matchId = new URLSearchParams(window.location.search).get('id') || window.location.search.replace('?', '');
let matchChannel;

let myId, myUsername, myElo;
let oppId = null, oppUsername = "Opponent", oppElo = 0;

let gameState = 'WAITING'; 
const TOTAL_ROUNDS = 4;
const WORDS_PER_ROUND = 15;
let currentRound = 1;
let allWords = [];
let isGeneratingWords = false; 

let syncInterval = null;
let lastOpponentActivity = Date.now(); 

let myTotalScore = 0;
let oppTotalScore = 0;

let myLastRoundScore = 0;
let oppLastRoundScore = 0;

let myScoreHistory = [];
let oppScoreHistory = [];

let activeWordIdx = 0;
let activeCharIdx = 0;
let isStarted = false;
let startTime = null;
let correctChars = 0;
let totalKeystrokes = 0;
let myRoundFinished = false;
let oppRoundFinished = false;

// Aggregated match tracking for stats (if needed in future)
let matchTotalWpm = 0;
let matchTotalCorrectChars = 0;
let matchTotalKeystrokes = 0;

const container = document.getElementById('word-container');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const statusText = document.getElementById('round-status');

const fallbackWords = "the be to of and a in that have I it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us".split(" ");

async function initMatch() {
    console.log("[INIT] Initializing match logic. ID:", matchId);
    if (!matchId) return window.location.href = 'home.html';

    const { data: { session }, error: sessionErr } = await _supabase.auth.getSession();
    if (sessionErr || !session) {
        console.error("[INIT] Failed to retrieve authentication session:", sessionErr);
        return window.location.href = 'home.html';
    }
    myId = session.user.id;
    console.log("[INIT] Authenticated as User UUID:", myId);

    const { data: profile, error: profileErr } = await _supabase.from('profiles').select('username, elo').eq('id', myId).single();
    if (profileErr) console.warn("[INIT] Profile load warning/error:", profileErr);
    
    myUsername = profile?.username || "Me";
    myElo = profile?.elo || 0;
    
    const myNameEl = document.getElementById('my-name');
    if (myNameEl) myNameEl.innerText = myUsername;
    
    const modeDisplay = document.getElementById('mode-display');
    if (modeDisplay) modeDisplay.innerText = "1v1 Match";

    matchChannel = _supabase.channel(`match_${matchId}`, {
        config: { broadcast: { self: false } }
    });

    matchChannel.on('broadcast', { event: 'player_joined' }, handlePlayerJoined)
                .on('broadcast', { event: 'game_words' }, handleGameWords)
                .on('broadcast', { event: 'player_ready' }, handlePlayerReady)
                .on('broadcast', { event: 'round_finished' }, handleRoundFinished)
                .on('broadcast', { event: 'player_heartbeat' }, handlePlayerHeartbeat) 
                .on('broadcast', { event: 'player_left' }, handlePlayerLeft)    
                .on('broadcast', { event: 'battle_attack' }, handleBattleAttack)
                .on('broadcast', { event: 'battle_progress' }, handleBattleProgress)
                .subscribe(async (status, err) => {
                    if (status === 'SUBSCRIBED') {
                        statusText.innerText = "Searching for opponent...";
                        syncInterval = setInterval(syncGame, 1000);
                    }
                });
}

function showActionText(text, color = "var(--accent)") {
    const el = document.getElementById('action-text');
    el.innerText = text;
    el.style.color = color;
    el.classList.remove('action-anim');
    void el.offsetWidth; 
    el.classList.add('action-anim');
}

function updateCombo(reset = false) {
    if (reset) {
        currentCombo = 0;
        comboStat.style.color = "var(--error)";
        setTimeout(() => comboStat.style.color = "var(--accent)", 200);
    } else {
        currentCombo++;
        if (currentCombo > 0 && currentCombo % 15 === 0) {
            matchChannel.send({
                type: 'broadcast',
                event: 'battle_attack',
                payload: { id: myId }
            });
            showActionText("+15 COMBO");
        }
    }
    comboVal.innerText = currentCombo;
    
    if (currentCombo > 0 && currentCombo % 10 === 0) {
        comboStat.style.transform = "scale(1.2)";
        setTimeout(() => comboStat.style.transform = "scale(1)", 150);
    }
}

function handleBattleAttack({ payload }) {
    if (payload.id !== myId && gameState === 'PLAYING') {
        document.body.classList.add('shake-anim');
        document.getElementById('damage-overlay').classList.add('flash');
        showActionText("GO QUICKER!", "var(--error)");
        
        setTimeout(() => {
            document.body.classList.remove('shake-anim');
            document.getElementById('damage-overlay').classList.remove('flash');
        }, 500);
    }
}

function updateProgressBar(wordIdx, isOpponent = false) {
    const pct = Math.min(100, Math.max(0, (wordIdx / WORDS_PER_ROUND) * 100));
    if (isOpponent) {
        document.getElementById('opp-runner').style.left = `${pct}%`;
    } else {
        document.getElementById('my-runner').style.left = `${pct}%`;
    }
}

function handleBattleProgress({ payload }) {
    if (payload.id === oppId && gameState === 'PLAYING') {
        updateProgressBar(payload.wordIdx, true);
    }
}

async function syncGame() {
    if (gameState === 'GAME_OVER') return;

    if (gameState === 'WAITING') {
        matchChannel.send({ type: 'broadcast', event: 'player_joined', payload: { id: myId, username: myUsername, elo: myElo } });

        if (oppId && myId > oppId) {
            if (allWords.length === 0 && !isGeneratingWords) {
                await generateWordsLocal();
            } else if (allWords.length > 0) {
                matchChannel.send({ type: 'broadcast', event: 'game_words', payload: { words: allWords } });
            }
        }
    } else if (['COUNTDOWN', 'PLAYING', 'ROUND_OVER'].includes(gameState)) {
        matchChannel.send({ type: 'broadcast', event: 'player_heartbeat', payload: { id: myId } });

        if (oppId && (Date.now() - lastOpponentActivity > 60000)) {
            handleOpponentForfeit('AFK');
        }
    }
}

async function removeFromQueue() {
    if (!myId) return;
    await _supabase.from('queue').delete().eq('user_id', myId);
    if (matchId) await _supabase.from('matches').delete().eq('id', matchId); 
}

function handlePlayerJoined({ payload }) {
    if (payload.id !== myId && !oppId) {
        oppId = payload.id;
        oppUsername = payload.username;
        oppElo = payload.elo;
        document.getElementById('opp-name').innerText = oppUsername;
        lastOpponentActivity = Date.now(); 
        statusText.innerText = "Syncing with opponent...";
    }
}

async function generateWordsLocal() {
    isGeneratingWords = true;
    let fetchedWords = fallbackWords;
    try {
        const resp = await fetch('../../data/json/wordlistcommon.json');
        if (resp.ok) fetchedWords = await resp.json();
    } catch(e) {}

    allWords = fetchedWords.sort(() => Math.random() - 0.5).slice(0, TOTAL_ROUNDS * WORDS_PER_ROUND);
    isGeneratingWords = false;
}

function handleGameWords({ payload }) {
    if (gameState !== 'WAITING') {
        if (['COUNTDOWN', 'PLAYING'].includes(gameState)) {
            matchChannel.send({ type: 'broadcast', event: 'player_ready' });
        }
        return;
    }
    allWords = payload.words;
    lastOpponentActivity = Date.now();
    matchChannel.send({ type: 'broadcast', event: 'player_ready' });
    removeFromQueue();
    startRoundSequence();
}

function handlePlayerReady() {
    if (gameState !== 'WAITING') return;
    lastOpponentActivity = Date.now();
    removeFromQueue(); 
    startRoundSequence();
}

function handlePlayerHeartbeat({ payload }) {
    if (payload.id === oppId) lastOpponentActivity = Date.now();
}

function handlePlayerLeft({ payload }) {
    if (payload.id === oppId && gameState !== 'GAME_OVER') handleOpponentForfeit('LEFT');
}

async function handleOpponentForfeit(reason) {
    gameState = 'GAME_OVER';
    clearInterval(syncInterval); 
    
    overlay.style.display = 'none';
    document.getElementById('round-results-overlay').classList.remove('show');
    document.getElementById('typing-viewport').style.display = 'none';
    document.querySelector('.match-header').style.display = 'none';
    document.getElementById('battle-track-container').style.display = 'none';

    const resultsScreen = document.getElementById('results-screen');
    const resultText = document.getElementById('final-result');
    const eloText = document.getElementById('elo-change-text');

    resultsScreen.classList.remove('hidden');

    resultText.innerText = "VICTORY";
    resultText.style.color = "#10b981";
    
    if (reason === 'AFK') {
        statusText.innerText = "Opponent went AFK. You win!";
        eloText.innerText = "+25 Elo (Opponent AFK)";
    } else {
        statusText.innerText = "Opponent left midmatch. You win!";
        eloText.innerText = "+25 Elo (Opponent Abandoned)";
    }
    eloText.className = "elo-change";
    
    let newElo = myElo + 25;
    await _supabase.from('profiles').update({ elo: newElo }).eq('id', myId);

    await removeFromQueue(); 
    _supabase.removeChannel(matchChannel);
    renderMatchChart();
}

function startRoundSequence() {
    gameState = 'COUNTDOWN';
    myRoundFinished = false;
    oppRoundFinished = false;
    
    document.getElementById('battle-track-container').style.display = 'block';
    updateProgressBar(0, false);
    updateProgressBar(0, true);

    const roundWords = allWords.slice((currentRound - 1) * WORDS_PER_ROUND, currentRound * WORDS_PER_ROUND);
    container.innerHTML = roundWords.map((w) => `
        <span class="word">
            ${w.split('').map(c => `<span class="letter">${c}</span>`).join('')}
        </span>
    `).join('');
    
    container.style.top = "0px";
    activeWordIdx = 0;
    activeCharIdx = 0;
    correctChars = 0;
    totalKeystrokes = 0;
    isStarted = false;
    startTime = null;

    document.getElementById('round-display').innerText = currentRound;
    statusText.innerText = "Get Ready!";
    overlay.classList.remove('hidden');
    overlaySub.innerText = `Round ${currentRound} of ${TOTAL_ROUNDS}`;

    updateCaret();

    let count = 3;
    overlayTitle.innerText = count;
    const countInterval = setInterval(() => {
        count--;
        if (count > 0) {
            overlayTitle.innerText = count;
        } else if (count === 0) {
            overlayTitle.innerText = "GO!";
        } else {
            clearInterval(countInterval);
            overlay.classList.add('hidden');
            gameState = 'PLAYING';
            statusText.innerText = "Typing...";
        }
    }, 1000);
}

window.addEventListener('keydown', (e) => {
    if (gameState !== 'PLAYING') return;

    if (!isStarted) {
        isStarted = true;
        startTime = Date.now();
    }

    const words = container.querySelectorAll('.word');
    const currentWord = words[activeWordIdx];
    if (!currentWord) return;
    const letters = currentWord.querySelectorAll('.letter');

    if (e.key === 'Backspace') {
        if (activeCharIdx > 0) {
            activeCharIdx--;
            letters[activeCharIdx].className = 'letter';
        } else if (activeWordIdx > 0) {
            activeWordIdx--;
            const prevWord = words[activeWordIdx];
            const prevLetters = prevWord.querySelectorAll('.letter');
            activeCharIdx = prevLetters.length;
            handleScroll(prevWord);
        }
    } else if (e.key === ' ') {
        if (activeCharIdx > 0) {
            activeWordIdx++;
            
            matchChannel.send({ type: 'broadcast', event: 'battle_progress', payload: { id: myId, wordIdx: activeWordIdx } });
            updateProgressBar(activeWordIdx, false); 

            if (activeWordIdx >= WORDS_PER_ROUND) {
                finishTyping(); 
                return;
            }
            activeCharIdx = 0;
            handleScroll(words[activeWordIdx]);
        }
    } else if (e.key.length === 1) {
        if (activeCharIdx < letters.length) {
            totalKeystrokes++;
            if (e.key === letters[activeCharIdx].innerText) {
                letters[activeCharIdx].classList.add('correct');
                correctChars++;
                updateCombo(false); 
            } else {
                letters[activeCharIdx].classList.add('incorrect');
                updateCombo(true); 
            }
            activeCharIdx++;

            if (activeWordIdx === WORDS_PER_ROUND - 1 && activeCharIdx === letters.length) {
                matchChannel.send({ type: 'broadcast', event: 'battle_progress', payload: { id: myId, wordIdx: WORDS_PER_ROUND } });
                updateProgressBar(WORDS_PER_ROUND, false); 
                finishTyping(); 
                return;
            }
        }
    }
    updateCaret();
});

function updateCaret() {
    document.querySelectorAll('.active-char, .active-end, .word.active').forEach(el => el.classList.remove('active-char', 'active-end', 'active'));
    const words = container.querySelectorAll('.word');
    const currentWord = words[activeWordIdx];
    if (!currentWord) return;

    currentWord.classList.add('active');
    const letters = currentWord.querySelectorAll('.letter');

    if (activeCharIdx < letters.length) {
        letters[activeCharIdx].classList.add('active-char');
    } else {
        currentWord.classList.add('active-end');
    }
}

function handleScroll(activeWord) {
    const offset = activeWord.offsetTop;
    if (offset > 40) container.style.top = `-${offset}px`;
}

function finishTyping() {
    gameState = 'ROUND_OVER';
    const durationMinutes = (Date.now() - startTime) / 60000;
    const wpm = Math.round((correctChars / 5) / durationMinutes) || 0;
    const acc = totalKeystrokes > 0 ? Math.round((correctChars / totalKeystrokes) * 100) : 0;
    
    matchTotalWpm += wpm;
    matchTotalCorrectChars += correctChars;
    matchTotalKeystrokes += totalKeystrokes;

    const roundScore = wpm + acc;
    myLastRoundScore = roundScore;
    myTotalScore += roundScore;
    myScoreHistory.push(roundScore);
    
    document.getElementById('my-score').innerText = myTotalScore;

    if (!oppRoundFinished) {
        statusText.innerText = `You scored ${roundScore}! Waiting for opponent to finish...`;
    } else {
        statusText.innerText = `You scored ${roundScore}!`;
    }

    matchChannel.send({ type: 'broadcast', event: 'round_finished', payload: { id: myId, score: roundScore } });
    myRoundFinished = true;
    checkRoundAdvance();
}

function handleRoundFinished({ payload }) {
    if (payload.id === oppId) {
        oppLastRoundScore = payload.score;
        oppTotalScore += payload.score;
        oppScoreHistory.push(payload.score);
        document.getElementById('opp-score').innerText = oppTotalScore;
        lastOpponentActivity = Date.now(); 
        oppRoundFinished = true;
        
        updateProgressBar(WORDS_PER_ROUND, true);

        if (myRoundFinished) {
            statusText.innerText = "Opponent finished!";
        }
        checkRoundAdvance();
    }
}

function checkRoundAdvance() {
    if (myRoundFinished && oppRoundFinished) {
        const animOverlay = document.getElementById('round-results-overlay');
        const myScoreAnim = document.getElementById('anim-my-score');
        const oppScoreAnim = document.getElementById('anim-opp-score');

        myScoreAnim.innerText = "+" + myLastRoundScore;
        oppScoreAnim.innerText = "+" + oppLastRoundScore;

        myScoreAnim.style.color = myLastRoundScore > oppLastRoundScore ? '#10b981' : (myLastRoundScore === oppLastRoundScore ? 'var(--text-bright)' : 'var(--error)');
        oppScoreAnim.style.color = oppLastRoundScore > myLastRoundScore ? '#10b981' : (oppLastRoundScore === myLastRoundScore ? 'var(--text-bright)' : 'var(--error)');
        
        animOverlay.classList.add('show');
        statusText.innerText = "Round Complete!";

        currentRound++;

        setTimeout(() => {
            animOverlay.classList.remove('show');
            if (currentRound > TOTAL_ROUNDS) {
                endMatch();
            } else {
                startRoundSequence();
            }
        }, 3500); 
    }
}

async function endMatch() {
    gameState = 'GAME_OVER';
    clearInterval(syncInterval); 
    overlay.style.display = 'none';
    
    const resultsScreen = document.getElementById('results-screen');
    const resultText = document.getElementById('final-result');
    const eloText = document.getElementById('elo-change-text');

    resultsScreen.classList.remove('hidden');
    document.getElementById('typing-viewport').style.display = 'none';
    document.querySelector('.match-header').style.display = 'none';
    document.getElementById('battle-track-container').style.display = 'none';
    
    let newElo = myElo;

    // Apply strict 1v1 Server Logic (No Elo modifications unless forfeited)
    if (myTotalScore > oppTotalScore) {
        resultText.innerText = "VICTORY";
        resultText.style.color = "#10b981";
        eloText.innerText = "No ELO gained";
        eloText.className = "elo-change";
        newElo += 0;
    } else if (myTotalScore < oppTotalScore) {
        resultText.innerText = "DEFEAT";
        resultText.style.color = "var(--error)";
        eloText.innerText = "No ELO lost";
        eloText.className = "elo-change negative";
        newElo = Math.max(0, newElo - 0);
    } else {
        resultText.innerText = "DRAW";
        resultText.style.color = "var(--text-bright)";
        eloText.innerText = "No ELO gained";
        eloText.className = "elo-change";
    }

    if (newElo !== myElo) {
        await _supabase.from('profiles').update({ elo: newElo }).eq('id', myId);
    }

    // Hide extra Ranked elements for 1v1
    const coinRewardText = document.getElementById('coin-reward-text');
    const xpRewardText = document.getElementById('xp-reward-text');
    if (coinRewardText) coinRewardText.style.display = 'none';
    if (xpRewardText) xpRewardText.style.display = 'none';

    await removeFromQueue(); 
    _supabase.removeChannel(matchChannel);
    renderMatchChart();
}

function renderMatchChart() {
    const ctx = document.getElementById('matchChart');
    if (!ctx) return;
    const labels = Array.from({ length: Math.max(myScoreHistory.length, oppScoreHistory.length, 1) }, (_, i) => `Round ${i + 1}`);
    new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: myUsername || 'You',
                    data: myScoreHistory,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.15)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                },
                {
                    label: oppUsername || 'Opponent',
                    data: oppScoreHistory,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: 'rgba(255,255,255,0.9)', font: { family: "'Inter', sans-serif" } }
                }
            },
            scales: {
                x: { 
                    ticks: { color: 'rgba(255,255,255,0.6)' }, 
                    grid: { color: 'rgba(255,255,255,0.05)' } 
                },
                y: { 
                    ticks: { color: 'rgba(255,255,255,0.6)' }, 
                    grid: { color: 'rgba(255,255,255,0.05)' }, 
                    beginAtZero: true 
                }
            }
        }
    });
}

window.addEventListener('beforeunload', () => {
    if (myId) _supabase.from('queue').delete().eq('user_id', myId);
    if (matchChannel && gameState !== 'GAME_OVER' && oppId) {
        matchChannel.send({ type: 'broadcast', event: 'player_left', payload: { id: myId } });
    }
});

initMatch();
