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

// Variables to track the scores for the current round specifically for the animation
let myLastRoundScore = 0;
let oppLastRoundScore = 0;

let activeWordIdx = 0;
let activeCharIdx = 0;
let isStarted = false;
let startTime = null;
let correctChars = 0;
let totalKeystrokes = 0;
let myRoundFinished = false;
let oppRoundFinished = false;

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

    // Fetch profile
    const { data: profile, error: profileErr } = await _supabase.from('profiles').select('username, elo').eq('id', myId).single();
    if (profileErr) console.warn("[INIT] Profile load warning/error:", profileErr);
    
    myUsername = profile?.username || "Me";
    myElo = profile?.elo || 0;
    
    const myNameEl = document.getElementById('my-name');
    if (myNameEl) {
        myNameEl.innerText = myUsername;
    }

    console.log("[INIT] Subscribing to Supabase Realtime channel: match_" + matchId);
    
    matchChannel = _supabase.channel(`match_${matchId}`, {
        config: { broadcast: { self: false } }
    });

    matchChannel.on('broadcast', { event: 'player_joined' }, handlePlayerJoined)
                .on('broadcast', { event: 'game_words' }, handleGameWords)
                .on('broadcast', { event: 'player_ready' }, handlePlayerReady)
                .on('broadcast', { event: 'round_finished' }, handleRoundFinished)
                .on('broadcast', { event: 'player_heartbeat' }, handlePlayerHeartbeat) 
                .on('broadcast', { event: 'player_left' }, handlePlayerLeft)          
                .subscribe(async (status, err) => {
                    if (err) console.error("[REALTIME] Subscription Error:", err);
                    console.log("[REALTIME] Connection Status changed to:", status);
                    
                    if (status === 'SUBSCRIBED') {
                        console.log("[REALTIME] Channel verified. Starting heartbeat synchronization loop.");
                        statusText.innerText = "Searching for opponent...";
                        syncInterval = setInterval(syncGame, 1000);
                    }
                });
}

function updateCombo(reset = false) {
    if (reset) {
        currentCombo = 0;
        comboStat.style.color = "var(--error)";
        setTimeout(() => comboStat.style.color = "var(--accent)", 200);
    } else {
        currentCombo++;
    }
    comboVal.innerText = currentCombo;
    
    if (currentCombo > 0 && currentCombo % 10 === 0) {
        comboStat.style.transform = "scale(1.2)";
        setTimeout(() => comboStat.style.transform = "scale(1)", 150);
    }
}

async function syncGame() {
    if (gameState === 'GAME_OVER') return;

    if (gameState === 'WAITING') {
        matchChannel.send({
            type: 'broadcast',
            event: 'player_joined',
            payload: { id: myId, username: myUsername, elo: myElo }
        });

        if (oppId && myId > oppId) {
            if (allWords.length === 0) {
                if (!isGeneratingWords) {
                    await generateWordsLocal();
                }
            } else {
                matchChannel.send({
                    type: 'broadcast',
                    event: 'game_words',
                    payload: { words: allWords }
                });
            }
        }
    } 
    else if (gameState === 'COUNTDOWN' || gameState === 'PLAYING' || gameState === 'ROUND_OVER') {
        matchChannel.send({
            type: 'broadcast',
            event: 'player_heartbeat',
            payload: { id: myId }
        });

        if (oppId && (Date.now() - lastOpponentActivity > 60000)) {
            console.warn("[TIMEOUT] Opponent dropped connections or went AFK for 60s.");
            handleOpponentForfeit('AFK');
        }
    }
}

async function removeFromQueue() {
    if (!myId) return;
    await _supabase.from('queue').delete().eq('user_id', myId);
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
        if (resp.ok) {
            fetchedWords = await resp.json();
        }
    } catch(e) {}

    allWords = fetchedWords.sort(() => Math.random() - 0.5).slice(0, TOTAL_ROUNDS * WORDS_PER_ROUND);
    isGeneratingWords = false;
}

function handleGameWords({ payload }) {
    if (gameState !== 'WAITING') {
        if (gameState === 'COUNTDOWN' || gameState === 'PLAYING') {
            matchChannel.send({ type: 'broadcast', event: 'player_ready' });
        }
        return;
    }

    allWords = payload.words;
    lastOpponentActivity = Date.now();
    
    matchChannel.send({
        type: 'broadcast',
        event: 'player_ready'
    });
    
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
    if (payload.id === oppId) {
        lastOpponentActivity = Date.now();
    }
}

function handlePlayerLeft({ payload }) {
    if (payload.id === oppId && gameState !== 'GAME_OVER') {
        handleOpponentForfeit('LEFT');
    }
}

async function handleOpponentForfeit(reason) {
    gameState = 'GAME_OVER';
    clearInterval(syncInterval); 
    
    overlay.style.display = 'none';
    document.getElementById('round-results-overlay').classList.remove('show');
    document.getElementById('typing-viewport').style.display = 'none';
    document.querySelector('.match-header').style.display = 'none';

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
}

function startRoundSequence() {
    gameState = 'COUNTDOWN';
    myRoundFinished = false;
    oppRoundFinished = false;
    
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

} else if (e.key.length === 1) {
        if (activeCharIdx < letters.length) {
            totalKeystrokes++;
            if (e.key === letters[activeCharIdx].innerText) {
                letters[activeCharIdx].classList.add('correct');
                correctChars++;
                updateCombo(false); // NEW: Increase combo
            } else {
                letters[activeCharIdx].classList.add('incorrect');
                updateCombo(true); // NEW: Break combo
            }
            activeCharIdx++;

            if (activeWordIdx === WORDS_PER_ROUND - 1 && activeCharIdx === letters.length) {
                finishTyping(); return;
            }
        }
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
            if (activeWordIdx + 1 >= WORDS_PER_ROUND) {
                finishTyping(); return;
            }
            activeWordIdx++;
            activeCharIdx = 0;
            handleScroll(words[activeWordIdx]);
        }
    } else if (e.key.length === 1) {
        if (activeCharIdx < letters.length) {
            totalKeystrokes++;
            if (e.key === letters[activeCharIdx].innerText) {
                letters[activeCharIdx].classList.add('correct');
                correctChars++;
            } else {
                letters[activeCharIdx].classList.add('incorrect');
            }
            activeCharIdx++;

            if (activeWordIdx === WORDS_PER_ROUND - 1 && activeCharIdx === letters.length) {
                finishTyping(); return;
            }
        }
    }
    updateCaret();
});

function updateCaret() {
    document.querySelectorAll('.active-char, .active-end, .word.active').forEach(el => {
        el.classList.remove('active-char', 'active-end', 'active');
    });
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
    
    const roundScore = wpm + acc;
    myLastRoundScore = roundScore;
    myTotalScore += roundScore;
    
    document.getElementById('my-score').innerText = myTotalScore;

    if (!oppRoundFinished) {
        statusText.innerText = `You scored ${roundScore}! Waiting for opponent to finish...`;
    } else {
        statusText.innerText = `You scored ${roundScore}!`;
    }

    matchChannel.send({
        type: 'broadcast',
        event: 'round_finished',
        payload: { id: myId, score: roundScore }
    });

    myRoundFinished = true;
    checkRoundAdvance();
}

function handleRoundFinished({ payload }) {
    if (payload.id === oppId) {
        oppLastRoundScore = payload.score;
        oppTotalScore += payload.score;
        document.getElementById('opp-score').innerText = oppTotalScore;
        lastOpponentActivity = Date.now(); 
        oppRoundFinished = true;
        
        if (myRoundFinished) {
            statusText.innerText = "Opponent finished!";
        }

        checkRoundAdvance();
    }
}

function checkRoundAdvance() {
    if (myRoundFinished && oppRoundFinished) {
        
        // Trigger the cool round end animation
        const animOverlay = document.getElementById('round-results-overlay');
        const myScoreAnim = document.getElementById('anim-my-score');
        const oppScoreAnim = document.getElementById('anim-opp-score');

        myScoreAnim.innerText = "+" + myLastRoundScore;
        oppScoreAnim.innerText = "+" + oppLastRoundScore;

        // Highlight the winner of the round in green
        myScoreAnim.style.color = myLastRoundScore > oppLastRoundScore ? '#10b981' : (myLastRoundScore === oppLastRoundScore ? 'var(--text-bright)' : 'var(--error)');
        oppScoreAnim.style.color = oppLastRoundScore > myLastRoundScore ? '#10b981' : (oppLastRoundScore === myLastRoundScore ? 'var(--text-bright)' : 'var(--error)');
        
        animOverlay.classList.add('show');
        statusText.innerText = "Round Complete!";

        currentRound++;

        // Hide the animation after 3.5 seconds and proceed
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
    
    let newElo = myElo;
    
    const scoreDiff = Math.abs(myTotalScore - oppTotalScore);
    const performanceBonus = Math.floor(scoreDiff * 0.15); 
    
    let eloChange = 0;

    if (myTotalScore > oppTotalScore) {
        resultText.innerText = "VICTORY";
        resultText.style.color = "#10b981";
        
        eloChange = Math.min(15 + performanceBonus, 50);
        eloText.innerText = `+${eloChange} Elo`;
        eloText.className = "elo-change";
        newElo += eloChange;
    } else if (myTotalScore < oppTotalScore) {
        resultText.innerText = "DEFEAT";
        resultText.style.color = "var(--error)";
        
        eloChange = Math.min(5 + performanceBonus, 30);
        eloText.innerText = `-${eloChange} Elo`;
        eloText.className = "elo-change negative";
        newElo = Math.max(0, newElo - eloChange);
    } else {
        resultText.innerText = "DRAW";
        resultText.style.color = "var(--text-bright)";
        eloText.innerText = "+0 Elo";
        eloText.className = "elo-change";
    }

    if (newElo !== myElo) {
        await _supabase.from('profiles').update({ elo: newElo }).eq('id', myId);
    }


    const estimatedAverageWpm = Math.floor(myTotalScore / TOTAL_ROUNDS);
    
    const { data: coinData, error: coinError } = await _supabase
        .rpc('reward_coins_for_game', { wpm_score: estimatedAverageWpm, acc_score: 95 });
        
    if (coinError) {
        console.error("Failed to reward coins:", coinError);
    } else {
        console.log(`Awarded ${coinData} coins!`);
    }

    await removeFromQueue(); 
    _supabase.removeChannel(matchChannel);
}

window.addEventListener('beforeunload', () => {
    if (myId) {
        _supabase.from('queue').delete().eq('user_id', myId);
    }
    if (matchChannel && gameState !== 'GAME_OVER' && oppId) {
        matchChannel.send({
            type: 'broadcast',
            event: 'player_left',
            payload: { id: myId }
        });
    }
});

initMatch();
