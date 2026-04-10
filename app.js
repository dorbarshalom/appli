// --- CONFIG & STATE ---
const REDEMPTION_THRESHOLD = 100;
const LEVELS_CONFIG = [
    { level: 1, requiredWords: 0, hasNikud: true },
    { level: 2, requiredWords: 10, hasNikud: true },
    { level: 3, requiredWords: 25, hasNikud: false },
    { level: 4, requiredWords: 50, hasNikud: false }
];

// Vocabulary List (Mock)
const VOCABULARY = [
    // Level 1: Simple words, with Nikud
    { text: 'שָׁלוֹם', cleanText: 'שלום', level: 1 },
    { text: 'שֶׁמֶשׁ', cleanText: 'שמש', level: 1 },
    { text: 'אַבָּא', cleanText: 'אבא', level: 1 },
    { text: 'אִמָּא', cleanText: 'אמא', level: 1 },
    { text: 'סֵפֶר', cleanText: 'ספר', level: 1 },
    { text: 'כֶּלֶב', cleanText: 'כלב', level: 1 },
    { text: 'חָתוּל', cleanText: 'חתול', level: 1 },
    { text: 'קָטָן', cleanText: 'קטן', level: 1 },
    
    // Level 2: Phrases, with Nikud
    { text: 'אוֹטוֹ סָגוֹל', cleanText: 'אוטו סגול', level: 2 },
    { text: 'יֶלֶד קָטָן', cleanText: 'ילד קטן', level: 2 },
    { text: 'בַּיִת גָּדוֹל', cleanText: 'בית גדול', level: 2 },
    { text: 'יַלְדָּה חֲכָמָה', cleanText: 'ילדה חכמה', level: 2 },
    
    // Level 3: Simple words, NO Nikud
    { text: 'מחשב', cleanText: 'מחשב', level: 3 },
    { text: 'משפחה', cleanText: 'משפחה', level: 3 }, // Hard word (6+ letters)
    { text: 'אופניים', cleanText: 'אופניים', level: 3 }, // Hard word

    // Level 4: Phrases, NO Nikud
    { text: 'אני אוהב לשחק בחוץ', cleanText: 'אני אוהב לשחק בחוץ', level: 4 },
    { text: 'היא קוראת ספר חדש', cleanText: 'היא קוראת ספר חדש', level: 4 }
];

// Default State
let state = {
    coins: 0,
    level: 1,
    wordsMastered: 0,
    streakHistory: {}, // { "YYYY-MM-DD": { words: 5, coins: 5 }}
    currentStreak: 0, // consecutive correct
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

// --- LOGIC HELPER FUNCTIONS ---
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
    document.getElementById('btn-hear').classList.add('hidden');
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
    } catch(err) {
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
    // Simple verification (can be fuzzy)
    if (spoken.includes(expected) || expected.includes(spoken) || spoken === expected) {
        handleSuccess();
    } else {
        handleFailure();
    }
}

// --- OUTCOME LOGIC ---
function handleSuccess() {
    const analysis = analyzeCard(currentCard.cleanText);
    const earned = analysis.wordsCount + analysis.bonus;
    
    // Update Stats
    state.coins += earned;
    state.currentStreak += 1;
    state.wordsMastered += 1;
    
    const today = getTodayStr();
    if (!state.streakHistory[today]) state.streakHistory[today] = { words: 0, coins: 0 };
    state.streakHistory[today].words += 1;
    state.streakHistory[today].coins += earned;
    
    checkLevelUp();
    checkBadges();
    saveState();
    updateUI();
    
    // Show celebration
    showCelebration(earned);
    
    setTimeout(() => {
        hideCelebration();
        loadNextCard();
    }, 2000);
}

function handleFailure() {
    attemptsLeft--;
    state.currentStreak = 0;
    saveState();
    updateUI();
    
    if (attemptsLeft > 0) {
        showStatusMessage("כמעט! נסי שוב", false);
        document.getElementById('btn-hear').classList.remove('hidden');
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
    
    const utterance = new SpeechSynthesisUtterance(currentCard.cleanText);
    utterance.lang = 'he-IL';
    window.speechSynthesis.speak(utterance);
    
    // Anti-cheat: 0 coins and advance
    attemptsLeft = 0;
    showStatusMessage("מקשיבים לומדים", false);
    
    setTimeout(() => {
        loadNextCard();
    }, 2000);
}

// --- LEVEL & BADGES ---
function checkLevelUp() {
    const nextLevelConfig = LEVELS_CONFIG.find(l => l.level === state.level + 1);
    if (nextLevelConfig && state.wordsMastered >= nextLevelConfig.requiredWords) {
        state.level += 1;
        // Optionally show Level Up animation
    }
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
    
    if (nextLvlConfig && currLvlConfig) {
        const required = nextLvlConfig.requiredWords;
        const progress = state.wordsMastered;
        const percentage = Math.min(((progress - currLvlConfig.requiredWords) / (required - currLvlConfig.requiredWords)) * 100, 100);
        document.getElementById('status-progress').style.width = `${percentage}%`;
        document.getElementById('level-progress-text').textContent = `${progress}/${required} למעבר רמה`;
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
    btnRecord.addEventListener('touchstart', startRecording, {passive: false});
    
    window.addEventListener('mouseup', stopRecording);
    window.addEventListener('touchend', stopRecording);
    
    document.getElementById('btn-hear').addEventListener('click', playTTS);
    document.getElementById('btn-reset').addEventListener('click', resetState);
}

function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabs = document.querySelectorAll('.tab-content');
    
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            tabs.forEach(t => t.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });
}
