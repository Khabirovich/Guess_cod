// Firebase configuration (replace with real keys for online play)
const firebaseConfig = {
  apiKey: "your-api-key-here",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com/",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};

// Detect offline demo mode when placeholders are still present
const offlineMode = firebaseConfig.apiKey === 'your-api-key-here';

// Initialize Firebase only if not offline mode
let database = null;
if (!offlineMode) {
  try {
    firebase.initializeApp(firebaseConfig);
    database = firebase.database();
  } catch (e) {
    console.log('Firebase initialization failed, running in offline mode');
  }
}

/*******************  GAME STATE  *************************/
const localRoom = {
  players: {},
  guesses: [],
  winner: null,
};

let currentRoomCode = null;
let currentPlayerId = null;
let playerName = null;
let secretCode = null;
let roomRef = null; // Firebase reference
let playersInRoom = {};
let gameHistory = [];
let gameWinner = null;
let currentGuess = '';

/*******************  DOM REFERENCES  *********************/
const homeView = document.getElementById('home-view');
const gameView = document.getElementById('game-view');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const displayRoomCode = document.getElementById('displayRoomCode');
const sendGuessBtn = document.getElementById('sendGuessBtn');
const resetBtn = document.getElementById('resetBtn');
const historyTable = document.getElementById('history');
const playerAStatus = document.getElementById('playerAStatus');
const playerBStatus = document.getElementById('playerBStatus');
const winModal = document.getElementById('win-modal');
const winMessage = document.getElementById('winMessage');
const currentGuessDisplay = document.getElementById('currentGuessDisplay');
const turnIndicator = document.getElementById('turnIndicator');

/*******************  UTILITIES  *************************/
function randomCode(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function randomSecret() {
  const digits = [0,1,2,3,4,5,6,7,8,9];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  if (digits[0] === 0) [digits[0], digits[1]] = [digits[1], digits[0]];
  return digits.slice(0,4).join('');
}

function calcBullsCows(secret, guess) {
  let bulls = 0, cows = 0;
  for (let i = 0; i < 4; i++) {
    if (secret[i] === guess[i]) bulls++;
    else if (secret.includes(guess[i])) cows++;
  }
  return { bulls, cows };
}

function validateGuess(input) {
  const msgs = [];
  if (input.length !== 4) msgs.push('Число должно содержать ровно 4 цифры');
  if (!/^[0-9]{4}$/.test(input)) msgs.push('Можно использовать только цифры');
  if (new Set(input.split('')).size !== 4) msgs.push('Все цифры должны быть разными');
  if (/^(\d)\1{3}$/.test(input)) msgs.push('Нельзя использовать одинаковые цифры');
  if (gameHistory.some(g => g.playerId === currentPlayerId && g.guess === input)) msgs.push('Вы уже пробовали это число');
  return msgs;
}

function showError(message) {
  let box = document.querySelector('.error-box');
  if (!box) {
    box = document.createElement('div');
    box.className = 'error-box';
    currentGuessDisplay.parentNode.appendChild(box);
  }
  box.textContent = message;
  setTimeout(() => { if (box) box.textContent = ''; }, 3000);
}

function updateCurrentGuessDisplay() {
  currentGuessDisplay.innerHTML = '';
  currentGuess.split('').forEach(d => {
    const span = document.createElement('span');
    span.className = 'digit-span';
    span.textContent = d;
    currentGuessDisplay.appendChild(span);
  });
  // Placeholder blanks for remaining digits
  for (let i = currentGuess.length; i < 4; i++) {
    const span = document.createElement('span');
    span.className = 'digit-span none';
    span.style.opacity = '0.3';
    span.textContent = '•';
    currentGuessDisplay.appendChild(span);
  }
  sendGuessBtn.disabled = currentGuess.length !== 4;
}

function renderHistory() {
  historyTable.innerHTML = '';
  gameHistory.forEach((entry, idx) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${idx + 1}</td>
      <td>${playersInRoom[entry.playerId] || 'Я'}</td>
      <td></td>
      <td class="result-cell"></td>
      <td class="result-cell">${entry.opponentResult || '?Б ?К'}</td>`;

    // Guess digits with highlight relative to OUR secret
    const guessCell = row.children[2];
    entry.guess.split('').forEach((digit, i) => {
      const span = document.createElement('span');
      span.className = 'digit-span';
      span.textContent = digit;
      if (secretCode[i] === digit) span.classList.add('bull');
      else if (secretCode.includes(digit)) span.classList.add('cow');
      else span.classList.add('none');
      guessCell.appendChild(span);
    });

    const myRes = calcBullsCows(secretCode, entry.guess);
    row.children[3].textContent = `${myRes.bulls}Б ${myRes.cows}К`;

    historyTable.appendChild(row);
  });

  updateTurnIndicator();
}

function updatePlayerStatus() {
  const ids = Object.keys(playersInRoom);
  const aId = ids[0];
  const bId = ids[1];
  playerAStatus.textContent = aId ? playersInRoom[aId] : 'Ожидание...';
  playerAStatus.className = 'status ' + (aId ? 'status--connected' : 'status--waiting');
  playerBStatus.textContent = bId ? playersInRoom[bId] : 'Ожидание...';
  playerBStatus.className = 'status ' + (bId ? 'status--connected' : 'status--waiting');
}

function updateTurnIndicator() {
  if (Object.keys(playersInRoom).length < 2) {
    turnIndicator.classList.add('hidden');
    return;
  }
  const isMyTurn = gameHistory.length % 2 === 0 ? true : false; // creator starts first
  if (isMyTurn) {
    turnIndicator.textContent = 'Ваш ход';
    turnIndicator.className = 'turn-indicator your-turn';
    sendGuessBtn.disabled = currentGuess.length !== 4;
  } else {
    turnIndicator.textContent = 'Ход соперника';
    turnIndicator.className = 'turn-indicator opponent-turn';
    sendGuessBtn.disabled = true;
  }
  turnIndicator.classList.remove('hidden');
}

function showWinModal() {
  const winnerName = playersInRoom[gameWinner] || 'Неизвестно';
  winMessage.textContent = gameWinner === currentPlayerId ? 'Поздравляем! Вы выиграли!' : `${winnerName} выиграл!`;
  winModal.classList.remove('hidden');
  sendGuessBtn.disabled = true;
}

/*******************  FIREBASE LISTENERS  *****************/
function initRoomListeners() {
  if (offlineMode || !roomRef) return;

  roomRef.child('players').on('value', snap => {
    playersInRoom = {};
    const val = snap.val() || {};
    Object.keys(val).forEach(id => (playersInRoom[id] = val[id].name));
    updatePlayerStatus();
    updateTurnIndicator();
  });

  roomRef.child('guesses').on('child_added', snap => {
    const g = snap.val();
    if (!gameHistory.find(x => x.id === snap.key)) {
      g.id = snap.key;
      gameHistory.push(g);
      gameHistory.sort((a, b) => a.timestamp - b.timestamp);
      renderHistory();
    }
  });

  roomRef.child('winner').on('value', snap => {
    const w = snap.val();
    if (w && !gameWinner) {
      gameWinner = w;
      showWinModal();
    }
  });
}

/*******************  EVENT HANDLERS  *********************/
createRoomBtn.addEventListener('click', async () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    alert('Введите ваше имя');
    return;
  }
  
  playerName = name;
  currentRoomCode = randomCode(6);
  currentPlayerId = Date.now().toString(36);
  secretCode = randomSecret();

  displayRoomCode.textContent = currentRoomCode;
  
  // Switch views
  homeView.classList.add('hidden');
  gameView.classList.remove('hidden');

  if (offlineMode) {
    localRoom.players[currentPlayerId] = playerName;
    playersInRoom = { ...localRoom.players };
    updatePlayerStatus();
  } else {
    try {
      createRoomBtn.disabled = true;
      roomRef = database.ref(`rooms/${currentRoomCode}`);
      await roomRef.set({
        players: { [currentPlayerId]: { name: playerName } },
        createdAt: Date.now(),
      });
      initRoomListeners();
      createRoomBtn.disabled = false;
    } catch (e) {
      console.log('Firebase error, using offline mode');
      createRoomBtn.disabled = false;
      localRoom.players[currentPlayerId] = playerName;
      playersInRoom = { ...localRoom.players };
      updatePlayerStatus();
    }
  }
});

joinRoomBtn.addEventListener('click', async () => {
  if (offlineMode) {
    alert('Демо офлайн: доступно только создание комнаты');
    return;
  }
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) {
    alert('Введите ваше имя');
    return;
  }
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    alert('Введите корректный код комнаты');
    return;
  }
  
  playerName = name;
  currentPlayerId = Date.now().toString(36);
  secretCode = randomSecret();
  currentRoomCode = code;
  roomRef = database.ref(`rooms/${code}`);
  
  try {
    const snap = await roomRef.once('value');
    if (!snap.exists()) throw new Error('Комната не найдена');
    const pl = snap.val().players || {};
    if (Object.keys(pl).length >= 2) throw new Error('Комната заполнена');
    await roomRef.child('players').child(currentPlayerId).set({ name: playerName });
    displayRoomCode.textContent = currentRoomCode;
    homeView.classList.add('hidden');
    gameView.classList.remove('hidden');
    initRoomListeners();
  } catch (err) {
    alert(err.message);
  }
});

// Initialize keypad buttons after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const keypadButtons = document.querySelectorAll('.keypad-btn[data-digit]');
  
  keypadButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const digit = btn.getAttribute('data-digit');
      if (currentGuess.length >= 4) return; // already full
      if (currentGuess.includes(digit)) {
        showError('Повторяющиеся цифры');
        return;
      }
      currentGuess += digit;
      updateCurrentGuessDisplay();
    });
  });

  resetBtn.addEventListener('click', () => {
    currentGuess = '';
    updateCurrentGuessDisplay();
  });

  sendGuessBtn.addEventListener('click', async () => {
    const guess = currentGuess;
    const errs = validateGuess(guess);
    if (errs.length) {
      showError(errs[0]);
      return;
    }
    if (Object.keys(playersInRoom).length < 1) {
      showError('Нет соперника');
      return;
    }

    // turn check
    if (!turnIndicator.classList.contains('your-turn') && Object.keys(playersInRoom).length >= 2) {
      showError('Сейчас не ваш ход');
      return;
    }

    sendGuessBtn.disabled = true;
    sendGuessBtn.textContent = 'Отправка...';

    const guessEntry = { playerId: currentPlayerId, guess, timestamp: Date.now() };
    const myRes = calcBullsCows(secretCode, guess);

    if (offlineMode) {
      gameHistory.push(guessEntry);
      renderHistory();
      if (myRes.bulls === 4) {
        gameWinner = currentPlayerId;
        showWinModal();
      }
      doneSending();
    } else {
      try {
        await roomRef.child('guesses').push(guessEntry);
        if (myRes.bulls === 4) await roomRef.child('winner').set(currentPlayerId);
        doneSending();
      } catch (e) {
        alert('Ошибка отправки');
        doneSending();
      }
    }
  });

  function doneSending() {
    currentGuess = '';
    updateCurrentGuessDisplay();
    sendGuessBtn.disabled = true;
    sendGuessBtn.textContent = 'Отправить';
  }

  /*******************  INIT  *********************/
  updateCurrentGuessDisplay();
  updatePlayerStatus();
});