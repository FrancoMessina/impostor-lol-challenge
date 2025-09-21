// ====== VARIABLES GLOBALES ====== //
const socket = io();
let gameState = {
  currentRoom: null,
  playerName: null,
  isImpostor: false,
  champion: null,
  gamePhase: 'lobby',
  players: [],
  currentPlayerTurn: null,
  timerInterval: null,
  hasVoted: false,
  canDescribe: false,
  hasDescribed: false,
  isCreator: false,
  playerScores: [],
  currentRound: 0
};

// ====== ELEMENTOS DEL DOM ====== //
const elements = {
  // Lobby elements
  lobbyScreen: document.getElementById('lobby-screen'),
  gameScreen: document.getElementById('game-screen'),
  playerNameInput: document.getElementById('playerName'),
  roomCodeInput: document.getElementById('roomCode'),
  playersGrid: document.getElementById('players-list'),
  playerCount: document.getElementById('player-count'),
  startGameBtn: document.getElementById('start-game-btn'),
  
  // Scoreboard elements
  lobbyScoreboard: document.getElementById('lobby-scoreboard'),
  lobbyScoresList: document.getElementById('lobby-scores-list'),
  gameScoresList: document.getElementById('game-scores-list'),
  
  // Public rooms elements
  roomsList: document.getElementById('rooms-list'),
  createRoomModal: document.getElementById('create-room-modal'),
  customRoomName: document.getElementById('custom-room-name'),
  maxPlayersSelect: document.getElementById('max-players'),
  isPublicCheckbox: document.getElementById('is-public'),
  
  // Game elements
  currentRoomCode: document.getElementById('current-room-code'),
  currentRound: document.getElementById('current-round'),
  gamePhase: document.getElementById('game-phase'),
  timerText: document.getElementById('timer-text'),
  playerRole: document.getElementById('player-role'),
  gamePlayersList: document.getElementById('game-players-list'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  
  // Description elements
  descriptionInput: document.getElementById('description-input'),
  wordInput: document.getElementById('word-input'),
  currentPlayerTurn: document.getElementById('current-player-turn'),
  currentPlayerName: document.getElementById('current-player-name'),
  
  // Voting elements
  votingSection: document.getElementById('voting-section'),
  votingButtons: document.getElementById('voting-buttons'),
  voteStatus: document.getElementById('vote-status'),
  
  // Results elements
  resultsSection: document.getElementById('results-section'),
  resultContent: document.getElementById('result-content'),
  
  // Alerts
  errorAlert: document.getElementById('error-alert'),
  successAlert: document.getElementById('success-alert'),
  errorMessage: document.getElementById('error-message'),
  successMessage: document.getElementById('success-message')
};

// ====== FUNCIONES DE UTILIDAD ====== //
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function formatTime(seconds) {
  return seconds.toString().padStart(2, '0');
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  
  // Si es del mismo día, mostrar solo hora
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } else {
    // Si es de otro día, mostrar fecha y hora
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }
}

function showAlert(type, message) {
  const alertElement = type === 'error' ? elements.errorAlert : elements.successAlert;
  const messageElement = type === 'error' ? elements.errorMessage : elements.successMessage;
  
  messageElement.textContent = message;
  alertElement.style.display = 'block';
  
  setTimeout(() => {
    alertElement.style.display = 'none';
  }, 4000);
}

function playNotificationSound() {
  // Simple audio notification (puedes agregar un archivo de audio real)
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.3);
}

// ====== FUNCIONES DE LOBBY ====== //
function createRoom() {
  const playerName = elements.playerNameInput.value.trim();
  
  if (!playerName) {
    showAlert('error', 'Por favor ingresa tu nombre');
    return;
  }
  
  const roomCode = generateRoomCode();
  elements.roomCodeInput.value = roomCode;
  joinRoom();
}

function joinRoom() {
  const playerName = elements.playerNameInput.value.trim();
  const roomCode = elements.roomCodeInput.value.trim();
  
  if (!playerName) {
    showAlert('error', 'Por favor ingresa tu nombre');
    return;
  }
  
  if (!roomCode) {
    showAlert('error', 'Por favor ingresa el código de sala');
    return;
  }
  
  gameState.playerName = playerName;
  gameState.currentRoom = roomCode.toUpperCase();
  
  // Guardar información de sesión para reconexión
  saveSessionData();
  
  socket.emit('joinRoom', { 
    name: playerName, 
    room: gameState.currentRoom 
  });
  
  showAlert('success', `Conectando a la sala ${gameState.currentRoom}...`);
}

function saveSessionData() {
  try {
    localStorage.setItem('lolImpostorSession', JSON.stringify({
      playerName: gameState.playerName,
      currentRoom: gameState.currentRoom,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.warn('No se pudo guardar la sesión:', error);
  }
}

function loadSessionData() {
  try {
    const sessionData = localStorage.getItem('lolImpostorSession');
    if (sessionData) {
      const data = JSON.parse(sessionData);
      // Solo cargar si es de las últimas 2 horas
      if (Date.now() - data.timestamp < 2 * 60 * 60 * 1000) {
        return data;
      }
    }
  } catch (error) {
    console.warn('No se pudo cargar la sesión:', error);
  }
  return null;
}

function clearSessionData() {
  try {
    localStorage.removeItem('lolImpostorSession');
  } catch (error) {
    console.warn('No se pudo limpiar la sesión:', error);
  }
}

function attemptReconnection() {
  const sessionData = loadSessionData();
  if (sessionData && sessionData.playerName && sessionData.currentRoom) {
    // Mostrar botón de reconexión
    showReconnectionDialog(sessionData);
  }
}

function showReconnectionDialog(sessionData) {
  const reconnectHTML = `
    <div id="reconnect-dialog" style="
      position: fixed; 
      top: 50%; 
      left: 50%; 
      transform: translate(-50%, -50%); 
      z-index: 10000; 
      background: var(--bg-card); 
      border: var(--border-gold); 
      border-radius: 15px; 
      padding: 2rem; 
      max-width: 400px;
      box-shadow: var(--shadow-gold);
      text-align: center;
    ">
      <div style="margin-bottom: 1rem;">
        <i class="fas fa-wifi" style="font-size: 3rem; color: var(--lol-gold);"></i>
      </div>
      <h3 style="color: var(--lol-gold); margin-bottom: 1rem;">¿Reconectar?</h3>
      <p style="color: var(--lol-accent); margin-bottom: 1.5rem;">
        Se detectó una sesión anterior:<br>
        <strong>${sessionData.playerName}</strong> en sala <strong>${sessionData.currentRoom}</strong>
      </p>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button class="btn btn-lol btn-warning" onclick="doReconnect('${sessionData.playerName}', '${sessionData.currentRoom}')">
          <i class="fas fa-plug"></i> Reconectar
        </button>
        <button class="btn btn-lol btn-secondary" onclick="closeReconnectDialog()">
          <i class="fas fa-times"></i> Nueva Sesión
        </button>
      </div>
    </div>
    <div id="reconnect-overlay" style="
      position: fixed; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      background: rgba(0, 0, 0, 0.7); 
      z-index: 9999;
    "></div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', reconnectHTML);
}

function doReconnect(playerName, roomCode) {
  gameState.playerName = playerName;
  gameState.currentRoom = roomCode;
  
  elements.playerNameInput.value = playerName;
  elements.roomCodeInput.value = roomCode;
  
  socket.emit('rejoinRoom', { 
    name: playerName, 
    room: roomCode 
  });
  
  closeReconnectDialog();
  showAlert('success', 'Intentando reconectar...');
}

function closeReconnectDialog() {
  const dialog = document.getElementById('reconnect-dialog');
  const overlay = document.getElementById('reconnect-overlay');
  if (dialog) dialog.remove();
  if (overlay) overlay.remove();
  clearSessionData();
}

function startGame() {
  if (!gameState.currentRoom) {
    showAlert('error', 'No estás en una sala');
    return;
  }
  
  socket.emit('startGame', gameState.currentRoom);
}

function restartGame() {
  if (!gameState.currentRoom) {
    showAlert('error', 'No estás en una sala');
    return;
  }
  
  if (!gameState.isCreator) {
    showAlert('error', 'Solo el creador puede reiniciar el juego');
    return;
  }
  
  // Deshabilitar botón para evitar clics múltiples
  const restartBtn = document.querySelector('button[onclick="restartGame()"]');
  if (restartBtn) {
    restartBtn.disabled = true;
    restartBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...';
  }
  
  socket.emit('restartGame', gameState.currentRoom);
  showAlert('success', 'Iniciando nueva partida...');
  
  // Volver al lobby y luego iniciar automáticamente
  setTimeout(() => {
    elements.lobbyScreen.style.display = 'block';
    elements.gameScreen.style.display = 'none';
    
    // Resetear estado
    gameState.gamePhase = 'lobby';
    gameState.hasVoted = false;
    gameState.canDescribe = false;
    gameState.hasDescribed = false;
    
    // Limpiar chat
    elements.chatMessages.innerHTML = '';
    
    showAlert('success', 'Volviendo al lobby...');
  }, 1000);
}

function goBackToLobby() {
  if (confirm('¿Estás seguro de que quieres volver al lobby? Esto te desconectará del juego actual.')) {
    location.reload();
  }
}

function rejoinGame() {
  const name = gameState.playerName;
  const room = gameState.currentRoom;
  
  if (!name || !room) {
    showAlert('error', 'No se puede reconectar: datos de sesión perdidos');
    return;
  }
  
  // Intentar reconectarse
  socket.emit('rejoinRoom', { name, room });
  showAlert('success', 'Intentando reconectar...');
}

function updatePlayersDisplay(playersData) {
  const { players, canStart, creatorId } = playersData;
  
  gameState.players = players;
  gameState.playerScores = players;
  elements.playerCount.textContent = players.length;
  
  // Verificar si el jugador actual es el creador
  const currentPlayer = players.find(p => p.name === gameState.playerName);
  gameState.isCreator = currentPlayer ? currentPlayer.isCreator : false;
  
  // Actualizar grid de jugadores
  const slots = elements.playersGrid.querySelectorAll('.empty-slot, .player-slot');
  
    slots.forEach((slot, index) => {
      if (players[index]) {
        slot.className = 'player-slot';
        let playerText = players[index].name;
        if (players[index].isCreator) {
          playerText += ' 👑';
        }
        if (players[index].disconnected) {
          playerText += ' 📱';
          slot.classList.add('disconnected');
        }
        slot.textContent = playerText;
        
        if (players[index].eliminated) {
          slot.classList.add('eliminated');
        }
      } else {
        slot.className = 'empty-slot';
        slot.textContent = 'Esperando jugador...';
      }
    });
  
  // Actualizar scoreboard
  updateScoreboard(players);
  
  // Mostrar scoreboard si hay jugadores con puntos
  const hasScores = players.some(p => p.score > 0);
  if (hasScores && elements.lobbyScoreboard) {
    elements.lobbyScoreboard.style.display = 'block';
  }
  
  // Habilitar botón de inicio - solo para el creador
  const canStartGame = canStart && gameState.isCreator;
  elements.startGameBtn.disabled = !canStartGame;
  
  if (gameState.isCreator) {
    if (canStart) {
      elements.startGameBtn.classList.add('pulse');
      elements.startGameBtn.innerHTML = '<i class="fas fa-play"></i> Iniciar Juego';
      elements.startGameBtn.style.display = 'block';
    } else {
      elements.startGameBtn.classList.remove('pulse');
      elements.startGameBtn.innerHTML = '<i class="fas fa-users"></i> Esperando más jugadores...';
      elements.startGameBtn.style.display = 'block';
    }
  } else {
    elements.startGameBtn.style.display = 'none';
    
    // Mostrar mensaje para jugadores que no son creadores
    let waitingMessage = document.getElementById('waiting-for-leader');
    if (!waitingMessage) {
      waitingMessage = document.createElement('div');
      waitingMessage.id = 'waiting-for-leader';
      waitingMessage.className = 'waiting-message';
      elements.startGameBtn.parentNode.appendChild(waitingMessage);
    }
    
    const leaderName = players.find(p => p.isCreator)?.name || 'el líder';
    if (canStart) {
      waitingMessage.innerHTML = `
        <i class="fas fa-clock"></i> 
        Esperando a que <strong>${leaderName}</strong> inicie el juego...
      `;
      waitingMessage.style.display = 'block';
    } else {
      waitingMessage.innerHTML = `
        <i class="fas fa-users"></i> 
        Esperando más jugadores... (mínimo 3)
      `;
      waitingMessage.style.display = 'block';
    }
  }
}

// ====== FUNCIONES DE SCOREBOARD ====== //
function updateScoreboard(players) {
  // Ordenar jugadores por puntuación (descendente)
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  
  // Actualizar scoreboard del lobby
  if (elements.lobbyScoresList) {
    updateScoresList(elements.lobbyScoresList, sortedPlayers);
  }
  
  // Actualizar scoreboard del juego
  if (elements.gameScoresList) {
    updateScoresList(elements.gameScoresList, sortedPlayers);
  }
}

function updateScoresList(container, players) {
  container.innerHTML = '';
  
  players.forEach((player, index) => {
    const scoreItem = document.createElement('div');
    scoreItem.className = `score-item ${player.isCreator ? 'creator' : ''}`;
    
    const rankEmoji = ['🥇', '🥈', '🥉'][index] || '🏅';
    
    scoreItem.innerHTML = `
      <div style="display: flex; align-items: center;">
        <span style="margin-right: 8px; font-size: 1.1rem;">${rankEmoji}</span>
        <span class="player-name">${player.name}</span>
      </div>
      <div style="display: flex; align-items: center;">
        <span class="score-details">${player.gamesWon || 0}W</span>
        <span class="player-score">${player.score}</span>
      </div>
    `;
    
    container.appendChild(scoreItem);
  });
}

function animateScoreIncrease(playerName, newScore) {
  // Animar el aumento de puntuación
  const scoreElements = document.querySelectorAll(`.score-item .player-name`);
  scoreElements.forEach(nameElement => {
    if (nameElement.textContent.includes(playerName)) {
      const scoreElement = nameElement.closest('.score-item').querySelector('.player-score');
      if (scoreElement) {
        scoreElement.classList.add('score-increase');
        setTimeout(() => {
          scoreElement.classList.remove('score-increase');
        }, 600);
      }
    }
  });
}

// ====== FUNCIONES DE JUEGO ====== //
function switchToGameScreen() {
  elements.lobbyScreen.style.display = 'none';
  elements.gameScreen.style.display = 'block';
  elements.currentRoomCode.textContent = gameState.currentRoom;
}

function updateGamePhase(phaseData) {
  gameState.gamePhase = phaseData.state;
  
  // Actualizar título de la fase
  const phaseNames = {
    'describing': '📝 Fase de Descripción',
    'debating': '💬 Fase de Debate',
    'voting': '🗳️ Fase de Votación',
    'results': '📊 Resultados'
  };
  
  elements.gamePhase.textContent = phaseNames[phaseData.state] || 'Juego en Curso';
  
  if (phaseData.round) {
    elements.currentRound.textContent = phaseData.round;
  }
  
  // Mostrar/ocultar secciones según la fase
  hideAllSections();
  
  switch (phaseData.state) {
    case 'describing':
      handleDescribingPhase(phaseData);
      break;
    case 'debating':
      handleDebatingPhase();
      break;
    case 'voting':
      handleVotingPhase(phaseData);
      break;
    case 'results':
      handleResultsPhase(phaseData);
      break;
  }
}

function hideAllSections() {
  elements.descriptionInput.style.display = 'none';
  elements.currentPlayerTurn.style.display = 'none';
  elements.votingSection.style.display = 'none';
  elements.resultsSection.style.display = 'none';
}

function handleDescribingPhase(phaseData) {
  // Resetear estado al empezar nueva fase de descripción
  if (phaseData.round !== gameState.currentRound) {
    gameState.hasDescribed = false;
    gameState.canDescribe = false;
    gameState.currentRound = phaseData.round;
  }
  
  if (phaseData.currentPlayer) {
    gameState.currentPlayerTurn = phaseData.currentPlayer;
    elements.currentPlayerName.textContent = phaseData.currentPlayer;
    elements.currentPlayerTurn.style.display = 'block';
    
    // Verificar si es el turno del jugador actual
    if (phaseData.currentPlayer === gameState.playerName && !gameState.hasDescribed) {
      elements.descriptionInput.style.display = 'block';
      gameState.canDescribe = true;
      playNotificationSound();
      showAlert('success', '¡Es tu turno! Describe el campeón con una palabra.');
    }
  }
}

function handleDebatingPhase() {
  showAlert('success', 'Fase de debate iniciada. ¡Discutan quién es el impostor!');
}

function handleVotingPhase(phaseData) {
  elements.votingSection.style.display = 'block';
  
  // Verificar si el jugador actual está eliminado
  const currentPlayer = gameState.players.find(p => p.name === gameState.playerName);
  const isEliminated = currentPlayer && currentPlayer.eliminated;
  
  if (phaseData.candidates) {
    if (isEliminated) {
      // Si está eliminado, mostrar mensaje en lugar de botones
      elements.votingButtons.innerHTML = `
        <div style="text-align: center; padding: 2rem; background: rgba(220, 38, 38, 0.1); border: 2px solid #DC2626; border-radius: 15px; color: #DC2626;">
          <i class="fas fa-times-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
          <h4>Has sido eliminado</h4>
          <p>No puedes votar en esta ronda. Observa cómo termina la partida.</p>
        </div>
      `;
      showAlert('info', 'Has sido eliminado y no puedes votar.');
    } else {
      createVotingButtons(phaseData.candidates);
      showAlert('success', '¡Tiempo de votar! Selecciona a quien crees que es el impostor.');
      playNotificationSound();
    }
  }
}

function handleResultsPhase(phaseData) {
  elements.resultsSection.style.display = 'block';
  // Los resultados se manejan en el evento 'voteResults'
}

function createVotingButtons(candidates) {
  elements.votingButtons.innerHTML = '';
  
  candidates.forEach(candidate => {
    if (candidate !== gameState.playerName) { // No puedes votarte a ti mismo
      const button = document.createElement('button');
      button.className = 'vote-btn';
      button.textContent = candidate;
      button.onclick = () => vote(candidate);
      elements.votingButtons.appendChild(button);
    }
  });
  
  gameState.hasVoted = false;
}

function vote(targetPlayer) {
  if (gameState.hasVoted) return;
  
  // Verificar si el jugador está eliminado
  const currentPlayer = gameState.players.find(p => p.name === gameState.playerName);
  if (currentPlayer && currentPlayer.eliminated) {
    showAlert('error', 'No puedes votar porque has sido eliminado.');
    return;
  }
  
  socket.emit('vote', { 
    room: gameState.currentRoom, 
    targetPlayer: targetPlayer 
  });
  
  gameState.hasVoted = true;
  
  // Marcar botón como votado
  const buttons = elements.votingButtons.querySelectorAll('.vote-btn');
  buttons.forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === targetPlayer) {
      btn.classList.add('voted');
    }
  });
  
  showAlert('success', `Has votado por ${targetPlayer}`);
}

// ====== FUNCIONES DE CHAT ====== //
function addChatMessage(messageData) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${messageData.type}`;
  
  // Solo mostrar color especial del impostor si el mensaje es del jugador actual y es impostor
  if (messageData.impostor && messageData.type === 'player' && 
      messageData.playerName === gameState.playerName && gameState.isImpostor) {
    messageDiv.className += ' my-impostor';
  }
  
  let messageHTML = '';
  
  if (messageData.type === 'system') {
    messageHTML = `
      <div class="message-content">${messageData.message}</div>
      <div class="message-time">${formatTimestamp(messageData.timestamp)}</div>
    `;
  } else if (messageData.type === 'description') {
    messageHTML = `
      <div class="message-header">${messageData.playerName} describe:</div>
      <div class="message-content">"${messageData.message}"</div>
      <div class="message-time">${formatTimestamp(messageData.timestamp)}</div>
    `;
  } else {
    messageHTML = `
      <div class="message-header">${messageData.playerName}:</div>
      <div class="message-content">${messageData.message}</div>
      <div class="message-time">${formatTimestamp(messageData.timestamp)}</div>
    `;
  }
  
  messageDiv.innerHTML = messageHTML;
  elements.chatMessages.appendChild(messageDiv);
  
  // Auto-scroll al último mensaje
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  
  // Efecto de notificación
  if (messageData.type !== 'system') {
    playNotificationSound();
  }
}

function sendMessage() {
  const message = elements.chatInput.value.trim();
  if (!message || gameState.gamePhase === 'describing') return;
  
  socket.emit('sendMessage', {
    room: gameState.currentRoom,
    message: message
  });
  
  elements.chatInput.value = '';
}

function submitDescription() {
  const word = elements.wordInput.value.trim();
  if (!word || !gameState.canDescribe) return;
  
  socket.emit('submitDescription', {
    room: gameState.currentRoom,
    word: word
  });
  
  elements.wordInput.value = '';
  elements.descriptionInput.style.display = 'none';
  gameState.canDescribe = false;
  gameState.hasDescribed = true;
  
  showAlert('success', 'Descripción enviada correctamente');
}

// ====== FUNCIONES DE TEMPORIZADOR ====== //
function startTimer(duration, startTime) {
  clearInterval(gameState.timerInterval);
  
  const updateTimer = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, duration - elapsed);
    const seconds = Math.ceil(remaining / 1000);
    
    elements.timerText.textContent = formatTime(seconds);
    
    // Cambiar color cuando quedan pocos segundos
    if (seconds <= 5) {
      elements.timerText.style.color = '#DC2626';
    } else if (seconds <= 10) {
      elements.timerText.style.color = '#D97706';
    } else {
      elements.timerText.style.color = '#C89B3C';
    }
    
    if (remaining <= 0) {
      clearInterval(gameState.timerInterval);
      elements.timerText.textContent = '00';
    }
  };
  
  updateTimer(); // Actualizar inmediatamente
  gameState.timerInterval = setInterval(updateTimer, 100);
}

// ====== FUNCIONES DE JUGADORES ====== //
function updatePlayerRole(roleData) {
  gameState.isImpostor = roleData.impostor;
  gameState.champion = roleData.champion;
  gameState.championData = roleData.championData;
  gameState.hasDescribed = false;
  
  const roleIcon = elements.playerRole.querySelector('.role-icon');
  const roleText = elements.playerRole.querySelector('.role-text');
  
  // Limpiar contenido previo
  roleText.innerHTML = '';
  
  if (roleData.impostor) {
    roleIcon.innerHTML = '<i class="fas fa-mask"></i>';
    roleIcon.className = 'role-icon impostor';
    
    roleText.innerHTML = `
      <div style="font-size: 1.2rem; font-weight: 700; color: #DC2626; margin-bottom: 1rem;">
        IMPOSTOR
      </div>
      <div class="champion-explanation">
        No conoces el campeón. Debes adivinar basándote en las pistas de los demás jugadores.
      </div>
    `;
  } else {
    roleIcon.innerHTML = '<i class="fas fa-search"></i>';
    roleIcon.className = 'role-icon investigator';
    
    let championContent = `
      <div style="font-size: 1.2rem; font-weight: 700; color: #2563EB; margin-bottom: 1rem;">
        INVESTIGADOR
      </div>
    `;
    
    // Agregar imagen del campeón si está disponible
    if (roleData.championData && roleData.championData.image) {
      championContent += `
        <div class="champion-image-container">
          <img src="${roleData.championData.image}" 
               alt="${roleData.championData.name}" 
               class="champion-image"
               onerror="this.style.display='none';">
        </div>
      `;
    }
    
    championContent += `
      <div class="champion-info">
        <div class="champion-name">${roleData.championData ? roleData.championData.name : roleData.champion}</div>
    `;
    
    if (roleData.championData && roleData.championData.title) {
      championContent += `<div class="champion-title">${roleData.championData.title}</div>`;
    }
    
    championContent += `
        <div class="champion-explanation">
          Describe este campeón sin ser obvio. Encuentra al impostor.
        </div>
      </div>
    `;
    
    roleText.innerHTML = championContent;
  }
  
  switchToGameScreen();
  showAlert('success', `¡Juego iniciado! Eres ${roleData.impostor ? 'IMPOSTOR' : 'INVESTIGADOR'}`);
}

function updateGamePlayersList(players) {
  elements.gamePlayersList.innerHTML = '';
  
  players.forEach(player => {
    const playerDiv = document.createElement('div');
    playerDiv.className = 'game-player-item';
    
    if (player.eliminated) {
      playerDiv.classList.add('eliminated');
    }
    
    if (player.name === gameState.currentPlayerTurn) {
      playerDiv.classList.add('current-turn');
    }
    
    playerDiv.innerHTML = `
      <i class="fas fa-user" style="margin-right: 8px;"></i>
      <span>${player.name}</span>
      ${player.eliminated ? '<i class="fas fa-times" style="color: #DC2626; margin-left: auto;"></i>' : ''}
    `;
    
    elements.gamePlayersList.appendChild(playerDiv);
  });
}

// ====== EVENT LISTENERS ====== //
document.addEventListener('DOMContentLoaded', function() {
  console.log('🎮 LOL Impostor cargado');
  
  // Cargar salas públicas al iniciar
  loadPublicRooms();
  
  // Intentar reconexión automática
  setTimeout(() => {
    attemptReconnection();
  }, 1000);
  
  // Eventos de teclado
  elements.playerNameInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  
  elements.roomCodeInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  
  elements.chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  
  elements.wordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitDescription();
  });
  
  // Cerrar modal con ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCreateRoomModal();
    }
  });
  
  // Auto-focus en inputs
  elements.playerNameInput?.focus();
});

// ====== SOCKET EVENT LISTENERS ====== //
socket.on('connect', () => {
  console.log('✅ Conectado al servidor');
  showAlert('success', '¡Conectado al servidor!');
});

socket.on('disconnect', () => {
  console.log('❌ Desconectado del servidor');
  showAlert('error', 'Conexión perdida con el servidor');
});

socket.on('error', (message) => {
  console.error('❌ Error:', message);
  showAlert('error', message);
});

socket.on('playersUpdate', (data) => {
  console.log('👥 Actualización de jugadores:', data);
  updatePlayersDisplay(data);
  
  if (gameState.gamePhase !== 'lobby') {
    updateGamePlayersList(data.players);
  }
});

socket.on('roleAssigned', (roleData) => {
  console.log('🎭 Rol asignado:', roleData);
  updatePlayerRole(roleData);
});

socket.on('gameStateUpdate', (phaseData) => {
  console.log('🎮 Estado del juego:', phaseData);
  updateGamePhase(phaseData);
});

socket.on('chatMessage', (messageData) => {
  console.log('💬 Mensaje de chat:', messageData);
  addChatMessage(messageData);
});

socket.on('timerUpdate', ({ duration, startTime }) => {
  console.log('⏱️ Temporizador actualizado:', { duration, startTime });
  startTimer(duration, startTime);
});

socket.on('voteUpdate', (voteData) => {
  console.log('🗳️ Actualización de votos:', voteData);
  
  let voteDetailsHTML = `<small>Votos: ${voteData.totalVotes}/${voteData.requiredVotes}</small>`;
  
  if (voteData.voteDetails && voteData.voteDetails.length > 0) {
    voteDetailsHTML += `<div style="margin-top: 8px; font-size: 0.75rem; color: var(--lol-accent);">`;
    voteDetailsHTML += `<strong>Detalles de votación:</strong><br>`;
    
    voteData.voteDetails.forEach(vote => {
      voteDetailsHTML += `${vote.voter} → ${vote.target}<br>`;
    });
    
    voteDetailsHTML += `</div>`;
  }
  
  elements.voteStatus.innerHTML = voteDetailsHTML;
});

socket.on('voteResults', (resultsData) => {
  console.log('📊 Resultados de votación:', resultsData);
  
  let resultHTML = `
    <div class="result-winner ${resultsData.wasImpostor ? 'investigators' : 'impostor'}">
      ${resultsData.message}
    </div>
  `;
  
  if (resultsData.voteDetails && resultsData.voteDetails.length > 0) {
    resultHTML += '<div style="margin-top: 1rem;"><strong>Detalles de la votación:</strong></div>';
    resultHTML += '<div style="background: rgba(30, 60, 114, 0.2); border-radius: 8px; padding: 12px; margin: 8px 0; font-size: 0.9rem;">';
    
    resultsData.voteDetails.forEach(vote => {
      resultHTML += `<div style="margin-bottom: 4px;">🗳️ <strong>${vote.voter}</strong> votó por <strong>${vote.target}</strong></div>`;
    });
    
    resultHTML += '</div>';
    
    // Mostrar resumen de votos
    if (resultsData.votes && Object.keys(resultsData.votes).length > 0) {
      resultHTML += '<div style="margin-top: 0.5rem;"><strong>Resumen:</strong></div>';
      for (const [player, votes] of Object.entries(resultsData.votes)) {
        resultHTML += `<div style="font-size: 0.85rem;">📊 ${player}: ${votes} voto${votes !== 1 ? 's' : ''}</div>`;
      }
    }
  }
  
  elements.resultContent.innerHTML = resultHTML;
  
  showAlert(resultsData.wasImpostor ? 'success' : 'error', resultsData.message);
  playNotificationSound();
});

socket.on('gameEnd', (endData) => {
  console.log('🏆 Juego terminado:', endData);
  
  let endHTML = `
    <div class="result-winner ${endData.winner}">
      ${endData.message}
    </div>
  `;
  
  // Agregar imagen del campeón si está disponible
  if (endData.championData && endData.championData.image) {
    endHTML += `
      <div class="champion-image-container" style="margin: 1.5rem 0;">
        <img src="${endData.championData.image}" 
             alt="${endData.championData.name}" 
             class="champion-image"
             onerror="this.style.display='none';">
      </div>
    `;
  }
  
  endHTML += `
    <div style="margin-top: 1rem;">
      <div class="champion-info">
        <div class="champion-name">${endData.champion}</div>
  `;
  
  if (endData.championData && endData.championData.title) {
    endHTML += `<div class="champion-title">${endData.championData.title}</div>`;
  }
  
  endHTML += `
      </div>
      <div style="margin-top: 1rem; color: var(--lol-accent);">
        <strong>El impostor era:</strong> ${endData.impostor}
      </div>
    </div>
  `;
  
  // Mostrar puntuaciones actualizadas
  if (endData.scores && endData.scores.length > 0) {
    endHTML += `
      <div style="margin-top: 1.5rem;">
        <h5 style="color: var(--lol-gold); margin-bottom: 1rem;">🏆 Puntuaciones Actualizadas</h5>
        <div class="scores-summary">
    `;
    
    // Ordenar por puntuación
    const sortedScores = endData.scores.sort((a, b) => b.score - a.score);
    
    sortedScores.forEach((player, index) => {
      const rankEmoji = ['🥇', '🥈', '🥉'][index] || '🏅';
      const isWinner = (endData.winner === 'impostor' && endData.impostor === player.name) ||
                      (endData.winner === 'investigators' && endData.impostor !== player.name);
      
      endHTML += `
        <div class="score-summary-item ${isWinner ? 'winner' : ''}">
          <span>${rankEmoji} ${player.name}${player.isCreator ? ' 👑' : ''}</span>
          <span class="score-badge ${isWinner ? 'winner-badge' : ''}">${player.score} pts</span>
        </div>
      `;
    });
    
    endHTML += `
        </div>
      </div>
    `;
  }
  
  // Mostrar controles de reinicio - MUY VISIBLE para el líder
  endHTML += `<div style="margin-top: 2rem; padding: 1.5rem; background: rgba(30, 60, 114, 0.2); border-radius: 15px; border: 2px solid var(--lol-gold);">`;
  
  if (endData.canRestart && gameState.isCreator) {
    endHTML += `
      <div style="text-align: center;">
        <div style="margin-bottom: 1.5rem;">
          <i class="fas fa-crown" style="color: var(--lol-gold); font-size: 2rem; margin-bottom: 10px;"></i>
          <h4 style="color: var(--lol-gold); margin: 0;">¡Eres el Líder de la Sala!</h4>
          <p style="color: var(--lol-accent); margin: 5px 0 0 0;">Puedes iniciar otra partida o cerrar la sala</p>
        </div>
        <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-lol btn-warning btn-lg" onclick="restartGame()" style="min-width: 180px;">
            <i class="fas fa-play"></i> ¡NUEVA PARTIDA!
          </button>
          <button class="btn btn-lol btn-secondary" onclick="goBackToLobby()">
            <i class="fas fa-sign-out-alt"></i> Salir al Lobby
          </button>
        </div>
      </div>
    `;
  } else if (endData.canRestart) {
    endHTML += `
      <div style="text-align: center;">
        <div class="waiting-for-leader-restart" style="margin-bottom: 1rem;">
          <i class="fas fa-hourglass-half"></i> 
          Esperando a que <strong>${endData.creatorName}</strong> 👑 inicie otra partida...
        </div>
        <button class="btn btn-lol btn-secondary" onclick="goBackToLobby()">
          <i class="fas fa-sign-out-alt"></i> Salir al Lobby
        </button>
      </div>
    `;
  } else {
    endHTML += `
      <div style="text-align: center;">
        <p style="color: var(--lol-accent); margin-bottom: 1rem;">Partida terminada</p>
        <button class="btn btn-lol btn-warning" onclick="goBackToLobby()">
          <i class="fas fa-redo"></i> Volver al Lobby
        </button>
      </div>
    `;
  }
  
  endHTML += `</div>`;
  
  elements.resultContent.innerHTML = endHTML;
  
  // Cambiar a la sección de resultados
  hideAllSections();
  elements.resultsSection.style.display = 'block';
  gameState.gamePhase = 'results';
  
  // Actualizar puntuaciones en el scoreboard
  if (endData.scores) {
    gameState.playerScores = endData.scores;
    updateScoreboard(endData.scores);
    
    // Animar aumentos de puntuación
    endData.scores.forEach(player => {
      if (player.score > 0) {
        setTimeout(() => animateScoreIncrease(player.name, player.score), 1000);
      }
    });
  }
  
  showAlert('success', '¡Juego terminado!');
  playNotificationSound();
  
  // Resetear estado del juego
  setTimeout(() => {
    gameState.gamePhase = 'lobby';
    gameState.hasVoted = false;
    gameState.canDescribe = false;
    gameState.hasDescribed = false;
  }, 2000);
});

socket.on('reconnectSuccess', (data) => {
  console.log('🔗 Reconexión exitosa:', data);
  
  gameState.currentRoom = data.room;
  gameState.isCreator = data.isCreator;
  
  showAlert('success', data.message);
  
  // Si hay juego en curso, ir a pantalla de juego
  if (data.gameState !== 'lobby') {
    switchToGameScreen();
  }
});

// ====== MANEJO DE SALAS PÚBLICAS ====== //

async function loadPublicRooms() {
  try {
    elements.roomsList.innerHTML = '<div class="loading-rooms"><i class="fas fa-spinner fa-spin"></i> Cargando salas...</div>';
    
    const response = await fetch('/api/rooms');
    const data = await response.json();
    
    displayRooms(data.rooms);
  } catch (error) {
    console.error('Error cargando salas:', error);
    elements.roomsList.innerHTML = `
      <div class="no-rooms">
        <i class="fas fa-exclamation-triangle"></i>
        Error al cargar las salas públicas
      </div>
    `;
  }
}

function displayRooms(rooms) {
  if (!rooms || rooms.length === 0) {
    elements.roomsList.innerHTML = `
      <div class="no-rooms">
        <i class="fas fa-users"></i>
        No hay salas públicas disponibles
        <br><small>¡Sé el primero en crear una!</small>
      </div>
    `;
    return;
  }
  
  let roomsHTML = '';
  
  rooms.forEach(room => {
    const statusClass = room.canJoin ? 'available' : 
                       (room.state === 'lobby' ? 'full' : 'in-game');
    
    const statusText = room.canJoin ? 'Disponible' :
                      (room.state === 'lobby' ? 'Sala Llena' : 'En Juego');
    
    const statusIcon = room.canJoin ? 'circle' :
                      (room.state === 'lobby' ? 'users' : 'play');
    
    const cardClass = room.canJoin ? 'can-join' :
                     (room.state === 'lobby' ? 'full' : 'in-game');
    
    const timeAgo = formatTimeAgo(room.createdAt);
    
    roomsHTML += `
      <div class="room-card ${cardClass}" ${room.canJoin ? `onclick="joinPublicRoom('${room.code}')"` : ''}>
        <div class="room-header">
          <h4 class="room-name">${escapeHtml(room.name)}</h4>
          <div class="room-status ${statusClass}">
            <i class="fas fa-${statusIcon}"></i>
            ${statusText}
          </div>
        </div>
        
        <div class="room-info">
          <div class="room-details">
            <div class="room-detail">
              <i class="fas fa-users"></i>
              <span class="room-players">${room.players}/${room.maxPlayers}</span>
            </div>
            <div class="room-detail">
              <i class="fas fa-crown"></i>
              <span>${escapeHtml(room.creatorName)}</span>
            </div>
            <div class="room-detail">
              <i class="fas fa-clock"></i>
              <span>${timeAgo}</span>
            </div>
          </div>
          
          ${room.canJoin ? `
            <div class="room-actions">
              <button class="btn btn-lol btn-success btn-join-room" onclick="event.stopPropagation(); joinPublicRoom('${room.code}')">
                <i class="fas fa-sign-in-alt"></i> Unirse
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  });
  
  elements.roomsList.innerHTML = roomsHTML;
}

async function joinPublicRoom(roomCode) {
  const playerName = elements.playerNameInput.value.trim();
  
  if (!playerName) {
    showAlert('error', 'Por favor ingresa tu nombre');
    elements.playerNameInput.focus();
    return;
  }
  
  // Usar la función existente joinRoom
  elements.roomCodeInput.value = roomCode;
  joinRoom();
}

function showCreateCustomRoomModal() {
  const playerName = elements.playerNameInput.value.trim();
  
  if (!playerName) {
    showAlert('error', 'Por favor ingresa tu nombre primero');
    elements.playerNameInput.focus();
    return;
  }
  
  // Pre-llenar nombre de la sala
  elements.customRoomName.value = `Sala de ${playerName}`;
  elements.createRoomModal.style.display = 'flex';
  elements.customRoomName.focus();
  elements.customRoomName.select();
}

function closeCreateRoomModal() {
  elements.createRoomModal.style.display = 'none';
}

async function createCustomRoom() {
  const roomName = elements.customRoomName.value.trim();
  const maxPlayers = parseInt(elements.maxPlayersSelect.value);
  const isPublic = elements.isPublicCheckbox.checked;
  const playerName = elements.playerNameInput.value.trim();
  
  if (!roomName) {
    showAlert('error', 'Por favor ingresa un nombre para la sala');
    return;
  }
  
  if (!playerName) {
    showAlert('error', 'Por favor ingresa tu nombre');
    return;
  }
  
  try {
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: roomName,
        maxPlayers: maxPlayers,
        isPublic: isPublic,
        creatorName: playerName
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      closeCreateRoomModal();
      showAlert('success', `Sala "${data.name}" creada exitosamente`);
      
      // Unirse automáticamente a la sala creada
      elements.roomCodeInput.value = data.code;
      joinRoom();
    } else {
      showAlert('error', data.error || 'Error al crear la sala');
    }
  } catch (error) {
    console.error('Error creando sala:', error);
    showAlert('error', 'Error al crear la sala');
  }
}

function refreshRoomList() {
  loadPublicRooms();
}

// Funciones helper
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ====== EVENTOS SOCKET PARA SALAS PÚBLICAS ====== //
socket.on('roomListUpdate', () => {
  // Actualizar lista solo si estamos en el lobby
  if (gameState.gamePhase === 'lobby' || !gameState.currentRoom) {
    loadPublicRooms();
  }
});

// ====== FUNCIONES GLOBALES PARA HTML ====== //
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.startGame = startGame;
window.restartGame = restartGame;
window.sendMessage = sendMessage;
window.submitDescription = submitDescription;
window.goBackToLobby = goBackToLobby;
window.doReconnect = doReconnect;
window.closeReconnectDialog = closeReconnectDialog;

// Nuevas funciones para salas públicas
window.refreshRoomList = refreshRoomList;
window.showCreateCustomRoomModal = showCreateCustomRoomModal;
window.closeCreateRoomModal = closeCreateRoomModal;
window.createCustomRoom = createCustomRoom;
window.joinPublicRoom = joinPublicRoom;
