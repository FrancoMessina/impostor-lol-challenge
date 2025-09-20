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
  canDescribe: false
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
  
  socket.emit('joinRoom', { 
    name: playerName, 
    room: gameState.currentRoom 
  });
  
  showAlert('success', `Conectando a la sala ${gameState.currentRoom}...`);
}

function startGame() {
  if (!gameState.currentRoom) {
    showAlert('error', 'No estás en una sala');
    return;
  }
  
  socket.emit('startGame', gameState.currentRoom);
}

function updatePlayersDisplay(playersData) {
  const { players, canStart } = playersData;
  
  gameState.players = players;
  elements.playerCount.textContent = players.length;
  
  // Actualizar grid de jugadores
  const slots = elements.playersGrid.querySelectorAll('.empty-slot, .player-slot');
  
  slots.forEach((slot, index) => {
    if (players[index]) {
      slot.className = 'player-slot';
      slot.textContent = players[index].name;
      if (players[index].eliminated) {
        slot.classList.add('eliminated');
      }
    } else {
      slot.className = 'empty-slot';
      slot.textContent = 'Esperando jugador...';
    }
  });
  
  // Habilitar botón de inicio
  elements.startGameBtn.disabled = !canStart;
  if (canStart) {
    elements.startGameBtn.classList.add('pulse');
  } else {
    elements.startGameBtn.classList.remove('pulse');
  }
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
  
  if (phaseData.candidates) {
    createVotingButtons(phaseData.candidates);
    showAlert('success', '¡Tiempo de votar! Selecciona a quien crees que es el impostor.');
    playNotificationSound();
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
  
  if (messageData.impostor && messageData.type === 'player') {
    messageDiv.className += ' impostor';
  }
  
  let messageHTML = '';
  
  if (messageData.type === 'system') {
    messageHTML = `
      <div class="message-content">${messageData.message}</div>
      <div class="message-time">${new Date(messageData.timestamp).toLocaleTimeString()}</div>
    `;
  } else if (messageData.type === 'description') {
    messageHTML = `
      <div class="message-header">${messageData.playerName} describe:</div>
      <div class="message-content">"${messageData.message}"</div>
      <div class="message-time">${new Date(messageData.timestamp).toLocaleTimeString()}</div>
    `;
  } else {
    messageHTML = `
      <div class="message-header">${messageData.playerName}:</div>
      <div class="message-content">${messageData.message}</div>
      <div class="message-time">${new Date(messageData.timestamp).toLocaleTimeString()}</div>
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
  elements.voteStatus.innerHTML = `
    <small>Votos: ${voteData.totalVotes}/${voteData.requiredVotes}</small>
    <small>Último voto: ${voteData.voter} → ${voteData.target}</small>
  `;
});

socket.on('voteResults', (resultsData) => {
  console.log('📊 Resultados de votación:', resultsData);
  
  let resultHTML = `
    <div class="result-winner ${resultsData.wasImpostor ? 'investigators' : 'impostor'}">
      ${resultsData.message}
    </div>
  `;
  
  if (resultsData.votes && Object.keys(resultsData.votes).length > 0) {
    resultHTML += '<div style="margin-top: 1rem;"><strong>Resultados de la votación:</strong></div>';
    for (const [player, votes] of Object.entries(resultsData.votes)) {
      resultHTML += `<div>${player}: ${votes} voto${votes !== 1 ? 's' : ''}</div>`;
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
    <button class="btn btn-lol btn-warning" onclick="location.reload()" style="margin-top: 1.5rem;">
      <i class="fas fa-redo"></i> Jugar Otra Vez
    </button>
  `;
  
  elements.resultContent.innerHTML = endHTML;
  
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

// ====== FUNCIONES GLOBALES PARA HTML ====== //
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.startGame = startGame;
window.sendMessage = sendMessage;
window.submitDescription = submitDescription;
