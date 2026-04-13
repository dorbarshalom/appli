// --- CONFIG & STATE ---
const REDEMPTION_THRESHOLD = 100;
const LEVELS_CONFIG = [
    { level: 1, requiredWords: 0, hasNikud: true },
    { level: 2, requiredWords: 10, hasNikud: true },
    { level: 3, requiredWords: 25, hasNikud: false },
    { level: 4, requiredWords: 50, hasNikud: false },
    { level: 5, requiredWords: 100, hasNikud: false }
];

// Vocabulary List - Loaded from separate data files
const VOCABULARY = window.VOCABULARY_DATA || [];

// Default State
let state = {
    coins: 0,
    level: 1,
    wordsMastered: 0,
    streakHistory: {}, // { "YYYY-MM-DD": { words: 5, coins: 5 }}
    currentStreak: 0, // consecutive correct
    failureStreak: 0, // consecutive failed attempts
    badges: [],
    retryPile: [] // words missed 2 times, to be tried another day
};

let currentCard = null;
let attemptsLeft = 2; // 2 attempts per card
let isRecording = false;
let recognition = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupNavigation();
    setupSpeechRecognition();
    setupEventListeners();
    updateUI();
    loadNextCard();
    generateCalendar();

    // Warm up voices
    window.speechSynthesis.getVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
});

// --- LOCAL STORAGE ---
function loadState() {
    const saved = localStorage.getItem('hebrewReaderState');
    if (saved) {
        state = { ...state, ...JSON.parse(saved) };
    }
}

function saveState() {
    localStorage.setItem('hebrewReaderState', JSON.stringify(state));
}

function resetState() {
    if (confirm('האם לאפס את כל ההתקדמות? (להורים בלבד)')) {
        localStorage.removeItem('hebrewReaderState');
        location.reload();
    }
}

const SIMILARITY_THRESHOLD = 0.7; // 60% similarity needed

// --- LOGIC HELPER FUNCTIONS ---
function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function getSimilarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;
    return (longer.length - levenshteinDistance(longer, shorter)) / parseFloat(longer.length);
}

const getTodayStr = () => new Date().toISOString().split('T')[0];

function normalizeHebrew(text) {
    // Remove nikud (Hebrew vowels \u0591-\u05C7) and punctuation
    return text.replace(/[\u0591-\u05C7]/g, '')
        .replace(/[.,!?״'"]/g, '')
        .trim()
        .replace(/\s+/g, ' ');
}

function analyzeCard(cardText) {
    const clean = normalizeHebrew(cardText);
    const words = clean.split(' ').filter(w => w.length > 0);
    const isHard = words.some(w => w.length >= 6);
    return {
        wordsCount: words.length,
        isHard,
        bonus: isHard ? 2 : 0 // Bonus of 2 coins for hard cards
    };
}

// --- CARD QUEUE ---
function loadNextCard() {
    // Determine pool based on current level
    let pool = VOCABULARY.filter(v => v.level <= state.level);

    // Choose a random word
    let nextWord = pool[Math.floor(Math.random() * pool.length)];

    // Check if level should hide Nikud config
    const levelConfig = LEVELS_CONFIG.find(l => l.level === state.level);

    let displayHtml = nextWord.text;
    if (!levelConfig || !levelConfig.hasNikud) {
        displayHtml = normalizeHebrew(nextWord.text);
    }

    currentCard = {
        ...nextWord,
        displayText: displayHtml
    };
    attemptsLeft = 2;

    // UI Updates
    document.getElementById('flashcard-text').textContent = currentCard.displayText;
    
    // Always show hear button on its new card location
    const btnHear = document.getElementById('btn-hear');
    if (btnHear) btnHear.classList.remove('hidden');
    
    hideStatusMessage();
}

// --- SPEECH RECOGNITION ---
function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("הדפדפן שלך אינו תומך בזיהוי דיבור. אנא השתמש ב-Chrome.");
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'he-IL';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        handleSpeechResult(transcript);
    };

    recognition.onerror = (event) => {
        console.error("Speech error", event.error);
        finishRecordingState();
        showStatusMessage("לא שמענו טוב. נסו שוב!", false);
    };

    recognition.onend = () => {
        if (isRecording) {
            // Reached if we stopped talking. Force check.
            finishRecordingState();
        }
    };
}

function startRecording(e) {
    if (e) e.preventDefault();
    if (!recognition || attemptsLeft <= 0) return;

    isRecording = true;
    const btn = document.getElementById('btn-record');
    btn.classList.add('recording');
    document.getElementById('record-text').textContent = "דברי עכשיו...";
    document.getElementById('audio-wave').classList.remove('hidden');

    // Haptics
    if (navigator.vibrate) navigator.vibrate(50);

    try {
        recognition.start();
    } catch (err) {
        // Already started
    }
}

function stopRecording(e) {
    if (e) e.preventDefault();
    if (!isRecording) return;

    isRecording = false;
    recognition.stop();

    // Haptics
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

    const btn = document.getElementById('btn-record');
    btn.classList.remove('recording');
    btn.classList.add('checking');
    document.getElementById('record-text').textContent = "בודק...";
    document.getElementById('audio-wave').classList.add('hidden');
}

function finishRecordingState() {
    const btn = document.getElementById('btn-record');
    btn.classList.remove('recording');
    btn.classList.remove('checking');
    document.getElementById('record-text').textContent = "החזק כדי לדבר";
    document.getElementById('audio-wave').classList.add('hidden');
    isRecording = false;
}

function handleSpeechResult(transcript) {
    finishRecordingState();

    if (!currentCard) return;

    const spoken = normalizeHebrew(transcript);
    const expected = normalizeHebrew(currentCard.cleanText);

    console.log(`Expected: ${expected} | Spoken: ${spoken}`);

    const similarity = getSimilarity(spoken, expected);
    console.log(`Similarity: ${(similarity * 100).toFixed(1)}%`);

    // Success if:
    // 1. Exact match 
    // 2. High similarity score (e.g. 60%)
    // 3. Spoken text contains the word (robust for noise)
    if (similarity >= SIMILARITY_THRESHOLD || spoken.includes(expected) || expected.includes(spoken)) {
        handleSuccess();
    } else {
        handleFailure();
    }
}

// --- AUDIO FEEDBACK ---
function playSuccessSound() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    // Nice "ding-ding" sound
    oscillator.frequency.setValueAtTime(523.25, now); // C5
    oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.1); // A5

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

    oscillator.start(now);
    oscillator.stop(now + 0.5);
}

// --- OUTCOME LOGIC ---
function handleSuccess() {
    playSuccessSound();
    const analysis = analyzeCard(currentCard.cleanText);
    const earned = analysis.wordsCount + analysis.bonus;

    // Update Stats
    state.coins += earned;
    state.currentStreak += 1;
    state.failureStreak = 0;
    state.wordsMastered += 1;

    const today = getTodayStr();
    if (!state.streakHistory[today]) state.streakHistory[today] = { words: 0, coins: 0 };
    state.streakHistory[today].words += 1;
    state.streakHistory[today].coins += earned;

    const leveledUp = checkLevelUp();
    checkBadges();
    saveState();
    updateUI();

    if (!leveledUp) {
        // Show celebration
        showCelebration(earned);
    }

    setTimeout(() => {
        hideCelebration();
        loadNextCard();
    }, 2000);
}

function handleFailure() {
    attemptsLeft--;
    state.currentStreak = 0;
    state.failureStreak += 1;

    const leveledDown = checkLevelDown();
    saveState();
    updateUI();

    if (leveledDown) {
        setTimeout(() => {
            loadNextCard();
        }, 2000);
        return;
    }

    if (attemptsLeft > 0) {
        showStatusMessage("כמעט! נסי שוב", false);
    } else {
        // Add to retry pile, move on
        showStatusMessage("לא נורא. ננסה שוב מחר!", false);
        state.retryPile.push({ word: currentCard, date: getTodayStr() });
        saveState();

        setTimeout(() => {
            loadNextCard();
        }, 1500);
    }
}

// --- TEXT TO SPEECH ---
function playTTS() {
    if (!currentCard) return;

    // Stop any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(currentCard.cleanText);
    
    // Try to find a Hebrew voice
    const voices = window.speechSynthesis.getVoices();
    const heVoice = voices.find(v => v.lang === 'he-IL' || v.lang === 'he');
    if (heVoice) {
        utterance.voice = heVoice;
    }
    
    utterance.lang = 'he-IL';
    utterance.rate = 0.9; // Slightly slower for clarity
    utterance.pitch = 1.1; // Slightly higher/clearer pitch

    // UI Feedback - Show a positive message instead of an error-styled one
    showStatusMessage("מקשיבים ונהנים!", true);
    
    // Speak!
    window.speechSynthesis.speak(utterance);

    // We no longer force advance to the next card. 
    // This allows the user to hear the word AND THEN try to say it.
    // If we want a penalty later, we can add a flag, but for now, let's make it useful.
    
    // Hide status message after 2 seconds
    setTimeout(() => {
        hideStatusMessage();
    }, 2000);
}

function playLevelUpSound() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

    notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = freq;
        osc.type = 'triangle';
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        const now = audioCtx.currentTime;
        const start = now + (i * 0.1);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.2, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, start + 0.4);

        osc.start(start);
        osc.stop(start + 0.5);
    });
}

// --- LEVEL & BADGES ---
function checkLevelUp() {
    if (state.currentStreak >= 5) {
        const nextLevelConfig = LEVELS_CONFIG.find(l => l.level === state.level + 1);
        if (nextLevelConfig) {
            state.level += 1;
            state.currentStreak = 0;
            state.failureStreak = 0;
            playLevelUpSound();
            showStatusMessage(`איזו אלופה! עלית לרמה ${state.level}!`, true);
            return true;
        }
    }
    return false;
}

function checkLevelDown() {
    if (state.failureStreak >= 3) {
        if (state.level > 1) {
            state.level -= 1;
            state.currentStreak = 0;
            state.failureStreak = 0;
            showStatusMessage(`ננסה רמה קלה יותר (רמה ${state.level}) כדי להתאמן`, false);
            return true;
        } else {
            // Level 1 logic: reset streak but stay here
            state.failureStreak = 0;
        }
    }
    return false;
}

function checkBadges() {
    const earns = (id) => {
        if (!state.badges.includes(id)) state.badges.push(id);
    };

    if (state.wordsMastered >= 10) earns('first_10');
    if (state.wordsMastered >= 100) earns('words_100');

    const playDays = Object.keys(state.streakHistory).length;
    if (playDays >= 7) earns('streak_7');
}

// --- UI UPDATES ---
function updateUI() {
    // HUD
    document.getElementById('hud-level').textContent = state.level;
    document.getElementById('hud-coins').textContent = state.coins;
    document.getElementById('hud-streak').textContent = state.currentStreak;

    // Status Tab
    document.getElementById('status-level').textContent = state.level;
    document.getElementById('status-coins').textContent = state.coins;

    // Progress
    const nextLvlConfig = LEVELS_CONFIG.find(l => l.level === state.level + 1);
    const currLvlConfig = LEVELS_CONFIG.find(l => l.level === state.level);

    if (nextLvlConfig) {
        const required = 5;
        const progress = state.currentStreak;
        const percentage = (progress / required) * 100;
        document.getElementById('status-progress').style.width = `${percentage}%`;
        document.getElementById('level-progress-text').textContent = `${progress}/${required} הצלחות ברצף למעבר רמה`;
    } else {
        document.getElementById('status-progress').style.width = '100%';
        document.getElementById('level-progress-text').textContent = 'רמת דיוק מרבית!';
    }

    // Redemption Section
    const redmSec = document.getElementById('redemption-area');
    if (state.coins >= REDEMPTION_THRESHOLD) {
        redmSec.innerHTML = `<div class="redemption-success">עשית את זה! תגידי לבאבא</div>`;
    } else {
        redmSec.innerHTML = `<button class="btn-redeem" disabled>בקשי מבאבא לבצע המרה (עוד ${REDEMPTION_THRESHOLD - state.coins}🪙)</button>`;
    }

    updateBadgesUI();
    generateCalendar();
}

function showStatusMessage(msg, isSuccess) {
    const el = document.getElementById('status-message');
    el.textContent = msg;
    el.className = `status-message ${isSuccess ? 'success' : 'error'}`;
}

function hideStatusMessage() {
    document.getElementById('status-message').className = 'status-message hidden';
}

function showCelebration(coins) {
    document.getElementById('earned-amount').textContent = coins;
    document.getElementById('celebration').classList.remove('hidden');
}

function hideCelebration() {
    document.getElementById('celebration').classList.add('hidden');
}

function updateBadgesUI() {
    const container = document.getElementById('badges-container');
    const badgeConfigs = [
        { id: 'first_10', icon: '🥉', name: '10 מילים' },
        { id: 'streak_7', icon: '🔥', name: '7 ימים ברצף' },
        { id: 'words_100', icon: '🏆', name: '100 מילים' },
    ];

    container.innerHTML = badgeConfigs.map(b => {
        const earned = state.badges.includes(b.id) ? 'earned' : '';
        return `
            <div class="badge-item ${earned}">
                <div class="badge-icon">${b.icon}</div>
                <div class="badge-name">${b.name}</div>
            </div>
        `;
    }).join('');
}

function generateCalendar() {
    const container = document.getElementById('calendar-days');
    container.innerHTML = '';

    // Get last 7 days
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dStr = d.toISOString().split('T')[0];

        const dayNames = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
        const dayName = dayNames[d.getDay()];

        const history = state.streakHistory[dStr];
        const hasPlayed = history && history.words > 0;

        const activeClass = i === 0 ? 'today active' : '';
        const playClass = hasPlayed ? 'played' : '';

        const tooltip = hasPlayed
            ? `<div class="day-tooltip">+${history.coins}🪙 | ${history.words} מילים</div>`
            : `<div class="day-tooltip">לא שיחקת</div>`;

        container.innerHTML += `
            <div class="day-circle ${playClass} ${activeClass}" onmouseenter="this.classList.add('active')" onmouseleave="this.classList.remove('active')">
                ${dayName}
                ${tooltip}
            </div>
        `;
    }
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    const btnRecord = document.getElementById('btn-record');

    // Mouse / Touch
    btnRecord.addEventListener('mousedown', startRecording);
    btnRecord.addEventListener('touchstart', startRecording, { passive: false });

    window.addEventListener('mouseup', stopRecording);
    window.addEventListener('touchend', stopRecording);

    document.getElementById('btn-hear').addEventListener('click', playTTS);
    document.getElementById('btn-reset').addEventListener('click', resetState);
}

function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabs = document.querySelectorAll('.tab-content');

    navBtns.forEach(btn => {
        btn.onclick = (e) => {
            const targetId = btn.getAttribute('data-target');
            if (!targetId) return;

            // Remove active from all
            navBtns.forEach(b => b.classList.remove('active'));
            tabs.forEach(t => t.classList.remove('active'));

            // Add active to current
            btn.classList.add('active');
            const targetTab = document.getElementById(targetId);
            if (targetTab) {
                targetTab.classList.add('active');
            }
        };
    });
}
