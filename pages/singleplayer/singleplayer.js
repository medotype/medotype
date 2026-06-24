const SB_URL = 'https://tzaowqeofmwfnprrfwat.supabase.co';
    const SB_KEY = 'sb_publishable_Sr33ux9FL6QZaJlfhjoqFw_tIwQhSbx';
    const _supabase = supabase.createClient(SB_URL, SB_KEY);

    let availableModes = [];
    let activeModeConfig = null;
    let wordsList = [];

    let isStarted = false;
    let isFinishing = false;
    let activeWordIdx = 0;
    let activeCharIdx = 0;
    let startTime = null;
    let timerInterval = null;
    let correctChars = 0;
    let totalKeystrokes = 0;
    
    let keyPressTimestamps = [];
    let currentCombo = 0;
    let wpmTimeline = [];

    const container = document.getElementById('word-container');
    const statVal = document.getElementById('stat-val');
    const wpmVal = document.getElementById('wpm-val');
    const comboStat = document.getElementById('combo-stat');
    const comboVal = document.getElementById('combo-val');
    const modeIcon = document.getElementById('mode-icon');
    const results = document.getElementById('results-screen');

    window.addEventListener('click', function() {
        const menu = document.getElementById('overflow-menu');
        if (menu) menu.classList.remove('show');
    });

    async function initModes() {
        try {
            const response = await fetch('../../data/json/modelist.json');
            if(!response.ok) throw new Error("File not found");
            availableModes = await response.json();
            buildNav();
            if (availableModes.length > 0) selectMode(availableModes[0]);
        } catch (e) {
            console.error(e);
            statVal.innerText = "Err";
        }
    }

    function buildNav() {
        const nav = document.getElementById('mode-nav');
        nav.innerHTML = '';
        
        if (availableModes.length <= 5) {
            availableModes.forEach(mode => {
                nav.appendChild(createModeElement(mode));
            });
        } else {
            for(let i = 0; i < 4; i++) {
                nav.appendChild(createModeElement(availableModes[i]));
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'dropdown-wrapper';

            const moreBtn = document.createElement('div');
            moreBtn.className = 'mode-item';
            moreBtn.id = 'more-toggle-btn';
            moreBtn.innerHTML = `<i class="fa-solid fa-ellipsis"></i> Other`;
            moreBtn.onclick = (e) => {
                e.stopPropagation();
                menu.classList.toggle('show');
            };

            const menu = document.createElement('div');
            menu.className = 'dropdown-menu';
            menu.id = 'overflow-menu';

            for(let i = 4; i < availableModes.length; i++) {
                menu.appendChild(createModeElement(availableModes[i]));
            }

            wrapper.appendChild(moreBtn);
            wrapper.appendChild(menu);
            nav.appendChild(wrapper);
        }
    }

    function createModeElement(mode) {
        const div = document.createElement('div');
        div.className = 'mode-item';
        div.id = `mode-${mode.id}`;
        
        let targetIcon = mode.icon || (mode.type === 'time' ? 'fa-clock' : 'fa-font');
        div.innerHTML = `<i class="fa-solid ${targetIcon}"></i> ${mode.label}`;
        
        div.onclick = () => selectMode(mode);
        return div;
    }

    async function selectMode(mode) {
        clearInterval(timerInterval);
        isStarted = false;
        activeModeConfig = mode;

        document.querySelectorAll('.mode-item').forEach(el => el.classList.remove('active', 'blitz-active'));
        const activeEl = document.getElementById(`mode-${mode.id}`);
        const moreToggle = document.getElementById('more-toggle-btn');
        
        if (activeEl) {
            activeEl.classList.add(mode.id === 'blitz' ? 'blitz-active' : 'active');
            
            if (activeEl.parentElement.classList.contains('dropdown-menu') && moreToggle) {
                moreToggle.classList.add('active');
            }
        }

        container.className = ''; 
        if (mode.script === 'blind') {
            container.classList.add('mode-blind');
        }

        try {
            let rawPath = mode.wordpool || '/data/json/wordlistcommon.json';
            let safeUrl = rawPath.includes('data/') ? '/data/' + rawPath.split('data/')[1] : 
                          (!rawPath.startsWith('/') && !rawPath.startsWith('http') ? '/' + rawPath : rawPath);

            const resp = await fetch(safeUrl);
            if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
            wordsList = await resp.json();
            if (Array.isArray(wordsList) && wordsList.length > 0) resetGame(); 
            else throw new Error("Wordlist empty");
        } catch (err) {
            console.error("Failed to load words:", err);
            statVal.innerText = "Err";
        }
    }

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

    function updateCombo(reset = false) {
        if (reset) {
            currentCombo = 0;
            comboStat.classList.add('broken');
            setTimeout(() => comboStat.classList.remove('broken'), 200);
        } else {
            currentCombo++;
        }
        comboVal.innerText = currentCombo;
    }

    function resetGame() {
        clearInterval(timerInterval);
        isStarted = false;
        isFinishing = false;
        activeWordIdx = 0;
        activeCharIdx = 0;
        correctChars = 0;
        totalKeystrokes = 0;
        startTime = null;
        
        keyPressTimestamps = [];
        wpmTimeline = []; 
        currentCombo = 0;
        comboVal.innerText = "0";
        wpmVal.innerText = "0";

        container.style.top = "0px";
        results.style.display = 'none';
        container.classList.remove('hidden');
        
        let targetIcon = activeModeConfig.icon || (activeModeConfig.type === 'time' ? 'fa-clock' : 'fa-font');
        modeIcon.className = `fa-solid ${targetIcon}`;

        if (activeModeConfig.type === 'time') {
            statVal.innerText = activeModeConfig.value;
        } else {
            statVal.innerText = `0 / ${activeModeConfig.value}`;
        }

        if (!wordsList || wordsList.length === 0) return;

        const count = activeModeConfig.renderCount || 50;
        const shuffled = [...wordsList].sort(() => Math.random() - 0.5).slice(0, count);
        
        container.innerHTML = shuffled.map((w) => `
            <span class="word">
                ${w.split('').map(c => `<span class="letter">${c}</span>`).join('')}
            </span>
        `).join('');

        updateCaret();
    }

    function updateLiveStats() {
        if (!startTime) return;
        const elapsedMs = Date.now() - startTime;
        const durationMinutes = elapsedMs / 60000;
        const currentWpm = Math.round((correctChars / 5) / durationMinutes) || 0;
        wpmVal.innerText = currentWpm;
        
        wpmTimeline.push(currentWpm);

        if (activeModeConfig.type === 'time') {
            let left = Math.ceil(activeModeConfig.value - (elapsedMs / 1000));
            if (left <= 0) {
                left = 0;
                finish();
            }
            statVal.innerText = left;
        }
    }

    window.addEventListener('keydown', (e) => {
        if (results.style.display === 'block' || !activeModeConfig || isFinishing) return;
        
        if (e.key === 'Tab') { e.preventDefault(); resetGame(); return; }
        if (e.key.length !== 1 && e.key !== 'Backspace' && e.key !== ' ') return;
        if (e.key === ' ') e.preventDefault();

        if (!isStarted && e.key.length === 1) {
            isStarted = true;
            startTime = Date.now();
            timerInterval = setInterval(updateLiveStats, 1000);
        }

        const words = container.querySelectorAll('.word');
        const currentWord = words[activeWordIdx];
        if (!currentWord) return;
        const letters = currentWord.querySelectorAll('.letter');

        if (e.key === 'Backspace') {
            if (activeModeConfig.script === 'sudden_death') return;

            if (activeCharIdx > 0) {
                activeCharIdx--;
                letters[activeCharIdx].className = 'letter';
            } else if (activeWordIdx > 0) {
                activeWordIdx--;
                const prevWord = words[activeWordIdx];
                const prevLetters = prevWord.querySelectorAll('.letter');
                activeCharIdx = prevLetters.length;
                handleScroll(prevWord);
                if (activeModeConfig.type === 'words') statVal.innerText = `${activeWordIdx} / ${activeModeConfig.value}`;
            }
        } else if (e.key === ' ') {
            if (activeCharIdx > 0) {
                if (activeModeConfig.type === 'words' && activeWordIdx + 1 >= activeModeConfig.value) {
                    finish(); return;
                }
                activeWordIdx++;
                activeCharIdx = 0;
                
                if (activeWordIdx < words.length) {
                    handleScroll(words[activeWordIdx]);
                }
                if (activeModeConfig.type === 'words') statVal.innerText = `${activeWordIdx} / ${activeModeConfig.value}`;
            }
        } else if (e.key.length === 1) {
            if (activeCharIdx < letters.length) {
                totalKeystrokes++;
                keyPressTimestamps.push(Date.now());
                
                if (e.key === letters[activeCharIdx].innerText) {
                    letters[activeCharIdx].classList.add('correct');
                    correctChars++;
                    updateCombo(false);
                } else {
                    letters[activeCharIdx].classList.add('incorrect');
                    updateCombo(true);

                    if (activeModeConfig.script === 'sudden_death') {
                        finish(true); 
                        return;
                    }
                }
                activeCharIdx++;

                if (activeModeConfig.type === 'words' && activeWordIdx === activeModeConfig.value - 1 && activeCharIdx === letters.length) {
                    finish();
                    return;
                }
            }
        }
        
        updateCaret();
    });

    function handleScroll(activeWord) {
        const offset = activeWord.offsetTop;
        if (offset > 40) container.style.top = `-${offset}px`;
    }

    async function finish(suddenDeathFailed = false) {
        if (isFinishing) return;
        isFinishing = true;

        clearInterval(timerInterval);
        const durationMinutes = (Date.now() - startTime) / 60000;
        
        let wpm = Math.round((correctChars / 5) / durationMinutes) || 0;
        if (suddenDeathFailed) wpm = Math.round(correctChars / 5) || 0; 

        const acc = totalKeystrokes > 0 ? Math.round((correctChars / totalKeystrokes) * 100) : 0;

        let saved = false;
        let earnedCoins = 0; 
        let earnedXp = 0;
        let leveledUp = false;
        let isBot = false;
        let isWorthyScore = wpm >= 10 && acc >= 50;

        const explicitlySaved = activeModeConfig.isSaved !== false;

        try {
            const { data: { session } } = await _supabase.auth.getSession();
            
            if (keyPressTimestamps.length > 10) {
                let intervals = [];
                for (let i = 1; i < keyPressTimestamps.length; i++) {
                    intervals.push(keyPressTimestamps[i] - keyPressTimestamps[i - 1]);
                }
                let sum = intervals.reduce((a, b) => a + b, 0);
                let avg = sum / intervals.length;
                let variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
                let stdDev = Math.sqrt(variance);

                if (stdDev < 5 || wpm > 500) {
                    isBot = true;
                }
            }

            if (session && isWorthyScore && !isBot && explicitlySaved) {
                const { error: scoreError } = await _supabase
                    .from('scores')
                    .insert([{ 
                        user_id: session.user.id, 
                        wpm: wpm, 
                        accuracy: acc, 
                        mode: activeModeConfig.id
                    }]);
                
                if (!scoreError) saved = true;

                const { data: coinData, error: coinError } = await _supabase
                    .rpc('reward_coins_for_game', { 
                        wpm_score: wpm, 
                        acc_score: acc,
                        game_mode: activeModeConfig.id 
                    });
                
                if (!coinError) earnedCoins = coinData; 

                // Updated: Passing game_mode to the secure RPC function
                const { data: xpData, error: xpError } = await _supabase
                    .rpc('reward_xp_for_game', {
                        wpm_score: wpm,
                        acc_score: acc,
                        game_mode: activeModeConfig.id
                    });
                
                if (!xpError && xpData) {
                    earnedXp = xpData.xp_gained;
                    leveledUp = xpData.leveled_up;
                }
            }
        } catch (dbError) {
            console.error(dbError);
        }

        sessionStorage.setItem('wpmTimeline', JSON.stringify(wpmTimeline));
        
        window.location.href = `results.html?wpm=${wpm}&acc=${acc}&mode=${activeModeConfig.id}&saved=${saved}&coins=${earnedCoins}&xp=${earnedXp}&levelup=${leveledUp}&bot=${isBot}&worthy=${isWorthyScore}&isCustomMode=${!explicitlySaved}&failed=${suddenDeathFailed}`;
    }

    initModes();
