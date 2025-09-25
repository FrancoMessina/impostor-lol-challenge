const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fetch = require("node-fetch");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));
app.use(express.json()); // Para manejar JSON en requests

// Estados del juego
const GAME_STATES = {
  LOBBY: 'lobby',
  DESCRIBING: 'describing',
  DEBATING: 'debating', 
  VOTING: 'voting',
  RESULTS: 'results'
};

// Configuración del juego
const GAME_CONFIG = {
  MAX_PLAYERS: 5,
  DESCRIBE_TIME: 20, // segundos por turno
  DEBATE_TIME: 50, // segundos para debate
  VOTING_TIME: 30 // segundos para votar
};

let rooms = {}; // Estructura completa de las salas

async function getChampions() {
  try {
  const res = await fetch("https://ddragon.leagueoflegends.com/cdn/14.17.1/data/en_US/champion.json");
  const data = await res.json();
    return data.data; // Devolver datos completos en lugar de solo nombres
  } catch (error) {
    console.error("Error obteniendo campeones:", error);
    // Campeones de respaldo con datos básicos
    const fallbackChamps = {};
    ["Ahri", "Jinx", "Yasuo", "Lux", "Zed", "Katarina", "Ezreal", "Ashe", "Garen", "Darius"].forEach(name => {
      fallbackChamps[name] = {
        id: name,
        name: name,
        image: { full: `${name}.png` }
      };
    });
    return fallbackChamps;
  }
}

function getChampionImageUrl(championData, championKey) {
  const version = "14.17.1";
  if (championData[championKey] && championData[championKey].image) {
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championData[championKey].image.full}`;
  }
  // URL de respaldo
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championKey}.png`;
}

function initializeRoom(roomCode, creatorId, roomData = {}) {
  return {
    code: roomCode,
    players: [],
    state: GAME_STATES.LOBBY,
    champion: null,
    championData: null,
    impostorIndices: [], // Array para múltiples impostores
    currentTurn: 0,
    turnStartTime: null,
    timer: null,
    votes: {},
    eliminated: [],
    chatMessages: [],
    round: 0,
    creatorId: creatorId,
    gameHistory: [],
    
    // Nueva metadata para salas públicas
    name: roomData.name || `Sala de ${roomData.creatorName || 'Anónimo'}`,
    isPublic: roomData.isPublic !== false, // Por defecto público
    maxPlayers: roomData.maxPlayers || 6,
    numImpostors: roomData.numImpostors || getRecommendedImpostors(roomData.maxPlayers || 6),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    creatorName: roomData.creatorName || 'Anónimo'
  };
}

// Función helper para recomendar número de impostores según jugadores
function getRecommendedImpostors(maxPlayers) {
  if (maxPlayers <= 4) return 1;
  if (maxPlayers <= 6) return 1; // Por defecto 1, pero se puede configurar 2
  return 2; // 7-8 jugadores, recomendar 2
}

// Validar que el número de impostores sea apropiado
function validateImpostorCount(numPlayers, numImpostors) {
  if (numImpostors < 1) return false;
  if (numPlayers <= 3) return numImpostors === 1; // 3 jugadores: solo 1 impostor
  if (numPlayers <= 4) return numImpostors <= 1; // 4 jugadores: máximo 1
  if (numPlayers <= 8) return numImpostors <= 2; // 5-8 jugadores: máximo 2
  return numImpostors <= Math.floor(numPlayers / 3); // Regla general: máximo 1/3
}


function getPlayerById(room, socketId) {
  return rooms[room].players.find(p => p.id === socketId);
}

function getRoomBySocket(socketId) {
  for (let roomCode in rooms) {
    if (rooms[roomCode].players.some(p => p.id === socketId)) {
      return roomCode;
    }
  }
  return null;
}

function checkGameEnd(room) {
  const roomData = rooms[room];
  const alivePlayers = roomData.players.filter(p => !p.eliminated && !p.disconnected);
  const aliveImpostors = alivePlayers.filter(p => p.impostor);
  const aliveInvestigators = alivePlayers.filter(p => !p.impostor);
  
  // Impostores ganan si son >= investigadores (y hay al menos 1 impostor vivo)
  if (aliveImpostors.length >= aliveInvestigators.length && aliveImpostors.length > 0) {
    return { ended: true, winner: 'impostor' };
  }
  
  // Investigadores ganan si eliminaron a TODOS los impostores
  if (aliveImpostors.length === 0) {
    return { ended: true, winner: 'investigators' };
  }
  
  return { ended: false };
}

function startTimer(room, duration, callback) {
  const roomData = rooms[room];
  
  if (roomData.timer) {
    clearTimeout(roomData.timer);
  }
  
  roomData.turnStartTime = Date.now();
  
  // Emitir el temporizador a todos los clientes
  io.to(room).emit('timerUpdate', { 
    duration: duration * 1000, 
    startTime: roomData.turnStartTime 
  });
  
  roomData.timer = setTimeout(callback, duration * 1000);
}

io.on("connection", (socket) => {
  console.log("Jugador conectado:", socket.id);

  socket.on("joinRoom", ({ name, room }) => {
    if (!rooms[room]) {
      // El primer jugador es el creador - crear sala con nombre automático
      rooms[room] = initializeRoom(room, socket.id, {
        creatorName: name,
        name: `Sala de ${name}`,
        isPublic: true,
        maxPlayers: 6
      });
    }

    const roomData = rooms[room];
    
    // Verificar si la sala está llena
    if (roomData.players.length >= roomData.maxPlayers) {
      socket.emit('error', 'La sala está llena');
      return;
    }

    // Verificar si ya hay un jugador con ese nombre
    if (roomData.players.some(p => p.name === name)) {
      socket.emit('error', 'Ya hay un jugador con ese nombre');
      return;
    }

    const isCreator = roomData.players.length === 0;

    // Agregar jugador
    roomData.players.push({
      id: socket.id,
      name: name,
      impostor: false,
      eliminated: false,
      hasVoted: false,
      hasDescribed: false,
      isCreator: isCreator,
      score: 0,
      gamesWon: 0,
      gamesAsImpostor: 0,
      gamesAsInvestigator: 0,
      disconnected: false
    });

    socket.join(room);
    // Actualizar actividad de la sala
    updateRoomActivity(room);

    // Enviar actualización a todos
    io.to(room).emit("playersUpdate", {
      players: roomData.players.map(p => ({
        name: p.name,
        eliminated: p.eliminated,
        isCreator: p.isCreator,
        score: p.score,
        disconnected: p.disconnected
      })),
      gameState: roomData.state,
      canStart: roomData.players.length >= 3, // Mínimo 3 para testing
      creatorId: roomData.creatorId
    });

    // Notificar cambios en la lista de salas públicas
    notifyRoomListUpdate();

    io.to(room).emit('chatMessage', {
      type: 'system',
      message: `${name} se unió a la sala${isCreator ? ' (Creador)' : ''}`,
      timestamp: Date.now()
    });
  });

  // Nuevo evento para reconectar jugadores
  socket.on('rejoinRoom', ({ name, room }) => {
    if (!rooms[room]) {
      socket.emit('error', 'La sala no existe');
      return;
    }

    const roomData = rooms[room];
    const existingPlayer = roomData.players.find(p => p.name === name);

    if (!existingPlayer) {
      socket.emit('error', 'No se encontró tu jugador en esta sala');
      return;
    }

    // Reconectar el jugador
    existingPlayer.id = socket.id;
    existingPlayer.disconnected = false;
    socket.join(room);

    // Si hay un juego en curso, enviar el estado actual
    if (roomData.state !== GAME_STATES.LOBBY) {
      // Enviar rol si está en juego
      socket.emit("roleAssigned", {
        champion: existingPlayer.impostor ? null : roomData.champion,
        championData: existingPlayer.impostor ? null : roomData.championData,
        impostor: existingPlayer.impostor,
        gameState: roomData.state
      });

      // Enviar estado del juego
      const currentPlayer = roomData.players[roomData.currentTurn];
      socket.emit('gameStateUpdate', {
        state: roomData.state,
        currentPlayer: currentPlayer && !currentPlayer.eliminated ? currentPlayer.name : null,
        round: roomData.round,
        candidates: roomData.state === GAME_STATES.VOTING ? 
          roomData.players.filter(p => !p.eliminated).map(p => p.name) : undefined
      });

      // Enviar temporizador si está activo
      if (roomData.turnStartTime) {
        socket.emit('timerUpdate', { 
          duration: GAME_CONFIG.DESCRIBE_TIME * 1000, 
          startTime: roomData.turnStartTime 
        });
      }
    }

    // Actualizar a todos los jugadores
    io.to(room).emit("playersUpdate", {
      players: roomData.players.map(p => ({
        name: p.name,
        eliminated: p.eliminated,
        isCreator: p.isCreator,
        score: p.score,
        disconnected: p.disconnected
      })),
      gameState: roomData.state,
      canStart: roomData.players.length >= 3,
      creatorId: roomData.creatorId
    });

    io.to(room).emit('chatMessage', {
      type: 'system',
      message: `${name} se reconectó al juego`,
      timestamp: Date.now()
    });

    // Actualizar actividad y notificar cambios
    updateRoomActivity(room);
    notifyRoomListUpdate();

    socket.emit('reconnectSuccess', {
      room: room,
      gameState: roomData.state,
      isCreator: existingPlayer.isCreator,
      message: '¡Reconectado exitosamente!'
    });
  });


  // SALE DE LA SALA
  socket.on("leaveRoom", (roomCode) => {
    socket.leave(roomCode);
  
    if (rooms[roomCode]) {
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
  
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode]; // borra la sala si queda vacía
      } else {
        io.to(roomCode).emit("playersUpdate", {
          players: rooms[roomCode].players,
          gameState: rooms[roomCode].state
        });
      }
    }
  
    socket.emit("leftRoom");
  });

  // Comienza el juego
  socket.on("startGame", async (room) => {
    if (!rooms[room]) return;
    
    const roomData = rooms[room];
    
    // Verificar si quien solicita es el creador
    const player = getPlayerById(room, socket.id);
    if (!player || !player.isCreator) {
      socket.emit('error', 'Solo el líder de la sala puede iniciar el juego');
      return;
    }
    
    if (roomData.players.length < 3) {
      socket.emit('error', 'Se necesitan al menos 3 jugadores');
      return;
    }

    if (roomData.state !== GAME_STATES.LOBBY) {
      socket.emit('error', 'El juego ya está en curso');
      return;
    }

    try {
      const championsData = await getChampions();
      const championKeys = Object.keys(championsData);
      const selectedChampionKey = championKeys[Math.floor(Math.random() * championKeys.length)];
      const selectedChampion = championsData[selectedChampionKey];
      
      const championInfo = {
        name: selectedChampion.name || selectedChampionKey,
        image: getChampionImageUrl(championsData, selectedChampionKey),
        title: selectedChampion.title || "",
        key: selectedChampionKey
      };
      
      // Validar número de impostores para los jugadores actuales
      const currentPlayers = roomData.players.filter(p => !p.disconnected);
      if (!validateImpostorCount(currentPlayers.length, roomData.numImpostors)) {
        // Ajustar automáticamente si la configuración no es válida
        roomData.numImpostors = getRecommendedImpostors(currentPlayers.length);
      }
      
      // Mezclar jugadores y asignar impostores
      let shuffledPlayers = [...roomData.players].sort(() => Math.random() - 0.5);
      
      // Seleccionar múltiples impostores
      const impostorIndices = [];
      for (let i = 0; i < roomData.numImpostors && i < shuffledPlayers.length; i++) {
        impostorIndices.push(i);
      }
      
      shuffledPlayers.forEach((player, index) => {
        player.impostor = impostorIndices.includes(index);
        player.eliminated = false;
        player.hasVoted = false;
        player.hasDescribed = false;
      });

      roomData.players = shuffledPlayers;
      roomData.champion = championInfo.name;
      roomData.championData = championInfo; // Guardar datos completos del campeón
      roomData.impostorIndices = impostorIndices;
      roomData.state = GAME_STATES.DESCRIBING;
      roomData.votes = {};
      roomData.round++;

      // Encontrar el primer jugador vivo y conectado (al inicio todos están vivos, pero por consistencia)
      let firstAliveIndex = 0;
      while (firstAliveIndex < roomData.players.length && (roomData.players[firstAliveIndex].eliminated || roomData.players[firstAliveIndex].disconnected)) {
        firstAliveIndex++;
      }
      roomData.currentTurn = firstAliveIndex;

      // Enviar roles a cada jugador
      roomData.players.forEach(player => {
        io.to(player.id).emit("roleAssigned", {
          champion: player.impostor ? null : championInfo.name,
          championData: player.impostor ? null : championInfo,
          impostor: player.impostor,
          gameState: GAME_STATES.DESCRIBING
        });
      });

      // Enviar estado inicial del juego
      io.to(room).emit('gameStateUpdate', {
        state: GAME_STATES.DESCRIBING,
        currentPlayer: roomData.players[roomData.currentTurn].name,
        round: roomData.round,
        champion: null // Los investigadores ya saben el campeón
      });

      io.to(room).emit('chatMessage', {
        type: 'system',
        message: `¡Juego iniciado! Ronda ${roomData.round}. Es el turno de ${roomData.players[roomData.currentTurn].name} para describir.`,
        timestamp: Date.now()
      });

      // Iniciar temporizador para el primer turno
      startTimer(room, GAME_CONFIG.DESCRIBE_TIME, () => {
        nextTurn(room);
      });

    } catch (error) {
      console.error("Error iniciando juego:", error);
      socket.emit('error', 'Error al iniciar el juego');
    }
  });

  socket.on('sendMessage', ({ room, message }) => {
    const roomData = rooms[room];
    if (!roomData) return;

    const player = getPlayerById(room, socket.id);
    if (!player || player.eliminated) return;

    const messageData = {
      type: 'player',
      playerName: player.name,
      message: message.trim(),
      timestamp: Date.now(),
      impostor: player.impostor
    };

    roomData.chatMessages.push(messageData);
    io.to(room).emit('chatMessage', messageData);
  });

  socket.on('submitDescription', ({ room, word }) => {
    const roomData = rooms[room];
    if (!roomData || roomData.state !== GAME_STATES.DESCRIBING) return;

    const player = getPlayerById(room, socket.id);
    if (!player || player.eliminated || player.hasDescribed) return;

    // Verificar si es el turno del jugador
    const currentPlayer = roomData.players[roomData.currentTurn];
    if (!currentPlayer || currentPlayer.disconnected || currentPlayer.id !== socket.id) return;

    // Marcar como descrito y avanzar turno
    player.hasDescribed = true;
    
    io.to(room).emit('chatMessage', {
      type: 'description',
      playerName: player.name,
      message: word.trim(),
      timestamp: Date.now()
    });

    nextTurn(room);
  });

  socket.on('vote', ({ room, targetPlayer }) => {
    const roomData = rooms[room];
    if (!roomData || roomData.state !== GAME_STATES.VOTING) return;

    const voter = getPlayerById(room, socket.id);
    if (!voter || voter.eliminated || voter.hasVoted) return;

    const target = roomData.players.find(p => p.name === targetPlayer);
    if (!target || target.eliminated) return;

    voter.hasVoted = true;
    voter.votedFor = targetPlayer; // Guardar a quién votó
    
    // Estructurar votos de manera más detallada
    if (!roomData.voteDetails) {
      roomData.voteDetails = [];
    }
    roomData.voteDetails.push({
      voter: voter.name,
      target: targetPlayer,
      timestamp: Date.now()
    });
    
    roomData.votes[targetPlayer] = (roomData.votes[targetPlayer] || 0) + 1;

    io.to(room).emit('voteUpdate', {
      voter: voter.name,
      target: targetPlayer,
      totalVotes: roomData.voteDetails.length,
      requiredVotes: roomData.players.filter(p => !p.eliminated).length,
      voteDetails: roomData.voteDetails
    });

    // Verificar si todos votaron
    const alivePlayers = roomData.players.filter(p => !p.eliminated);
    const votedPlayers = alivePlayers.filter(p => p.hasVoted);
    
    if (votedPlayers.length === alivePlayers.length) {
      processVoteResults(room);
    }
  });

  socket.on('restartGame', async (room) => {
    const roomData = rooms[room];
    if (!roomData) return;

    // Verificar si quien solicita es el creador
    const player = getPlayerById(room, socket.id);
    if (!player || !player.isCreator) {
      socket.emit('error', 'Solo el creador puede reiniciar el juego');
      return;
    }

    if (roomData.state !== GAME_STATES.LOBBY) {
      socket.emit('error', 'El juego debe haber terminado para reiniciar');
      return;
    }

    if (roomData.players.length < 3) {
      socket.emit('error', 'Se necesitan al menos 3 jugadores');
      return;
    }

    // Notificar que se está reiniciando
    io.to(room).emit('chatMessage', {
      type: 'system',
      message: `${player.name} 👑 ha iniciado una nueva partida`,
      timestamp: Date.now()
    });

    // Esperar un momento para el feedback visual
    setTimeout(async () => {
      try {
        const championsData = await getChampions();
        const championKeys = Object.keys(championsData);
        const selectedChampionKey = championKeys[Math.floor(Math.random() * championKeys.length)];
        const selectedChampion = championsData[selectedChampionKey];
        
        const championInfo = {
          name: selectedChampion.name || selectedChampionKey,
          image: getChampionImageUrl(championsData, selectedChampionKey),
          title: selectedChampion.title || "",
          key: selectedChampionKey
        };
        
        // Validar número de impostores para los jugadores actuales
        const currentPlayers = roomData.players.filter(p => !p.disconnected);
        if (!validateImpostorCount(currentPlayers.length, roomData.numImpostors)) {
          // Ajustar automáticamente si la configuración no es válida
          roomData.numImpostors = getRecommendedImpostors(currentPlayers.length);
        }
        
        // Mezclar jugadores y asignar impostores
        let shuffledPlayers = [...roomData.players].sort(() => Math.random() - 0.5);
        
        // Seleccionar múltiples impostores
        const impostorIndices = [];
        for (let i = 0; i < roomData.numImpostors && i < shuffledPlayers.length; i++) {
          impostorIndices.push(i);
        }
        
        shuffledPlayers.forEach((player, index) => {
          player.impostor = impostorIndices.includes(index);
          player.eliminated = false;
          player.hasVoted = false;
          player.hasDescribed = false;
        });

        roomData.players = shuffledPlayers;
        roomData.champion = championInfo.name;
        roomData.championData = championInfo;
        roomData.impostorIndices = impostorIndices;
        roomData.state = GAME_STATES.DESCRIBING;
        roomData.votes = {};
        roomData.round++;

        // Encontrar el primer jugador vivo y conectado
        let firstAliveIndex = 0;
        while (firstAliveIndex < roomData.players.length && (roomData.players[firstAliveIndex].eliminated || roomData.players[firstAliveIndex].disconnected)) {
          firstAliveIndex++;
        }
        roomData.currentTurn = firstAliveIndex;

        // Enviar roles a cada jugador
        roomData.players.forEach(player => {
          io.to(player.id).emit("roleAssigned", {
            champion: player.impostor ? null : championInfo.name,
            championData: player.impostor ? null : championInfo,
            impostor: player.impostor,
            gameState: GAME_STATES.DESCRIBING
          });
        });

        // Enviar estado inicial del juego
        io.to(room).emit('gameStateUpdate', {
          state: GAME_STATES.DESCRIBING,
          currentPlayer: roomData.players[roomData.currentTurn].name,
          round: roomData.round,
          champion: null
        });

        io.to(room).emit('chatMessage', {
          type: 'system',
          message: `¡Nueva partida iniciada! Ronda ${roomData.round} con ${roomData.numImpostors} impostor${roomData.numImpostors > 1 ? 'es' : ''}. Es el turno de ${roomData.players[roomData.currentTurn].name} para describir.`,
          timestamp: Date.now()
        });

        // Iniciar temporizador para el primer turno
        startTimer(room, GAME_CONFIG.DESCRIBE_TIME, () => {
          nextTurn(room);
        });

      } catch (error) {
        console.error("Error reiniciando juego:", error);
        socket.emit('error', 'Error al reiniciar el juego');
      }
    }, 1000);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (room && rooms[room]) {
      const roomData = rooms[room];
      const disconnectedPlayer = roomData.players.find(p => p.id === socket.id);
      
      if (disconnectedPlayer) {
        // Marcar como desconectado en lugar de eliminar
        disconnectedPlayer.disconnected = true;
        disconnectedPlayer.id = null; // Limpiar socket ID
        
        // Si se desconecta el creador, asignar a otro jugador conectado como creador
        if (disconnectedPlayer.isCreator) {
          const newCreator = roomData.players.find(p => !p.disconnected && p.id !== socket.id);
          if (newCreator) {
            disconnectedPlayer.isCreator = false;
            newCreator.isCreator = true;
            roomData.creatorId = newCreator.id;
            
            io.to(room).emit('chatMessage', {
              type: 'system',
              message: `${newCreator.name} es ahora el nuevo líder de la sala`,
              timestamp: Date.now()
            });
          }
        }
        
        io.to(room).emit('chatMessage', {
          type: 'system',
          message: `${disconnectedPlayer.name} se desconectó (puede volver a conectarse)`,
          timestamp: Date.now()
        });

        io.to(room).emit("playersUpdate", {
          players: roomData.players.map(p => ({
            name: p.name,
            eliminated: p.eliminated,
            isCreator: p.isCreator,
            score: p.score,
            disconnected: p.disconnected
          })),
          gameState: roomData.state,
          canStart: roomData.players.filter(p => !p.disconnected).length >= 3,
          creatorId: roomData.creatorId
        });

        // Solo resetear si no quedan jugadores conectados
        const connectedPlayers = roomData.players.filter(p => !p.disconnected);
        if (connectedPlayers.length < 2 && roomData.state !== GAME_STATES.LOBBY) {
          io.to(room).emit('chatMessage', {
            type: 'system',
            message: 'No hay suficientes jugadores conectados. El juego se pausa.',
            timestamp: Date.now()
          });
        }

        // Actualizar actividad y notificar cambios en lista de salas
        updateRoomActivity(room);
        notifyRoomListUpdate();
      }
    }
  });
  // TESTEO
  socket.on("test", () => {
      console.log("testeo del socket");
      console.log(rooms);
  });

});

function nextTurn(room) {
  const roomData = rooms[room];
  if (!roomData) return;

  if (roomData.timer) {
    clearTimeout(roomData.timer);
  }

  // Buscar el siguiente jugador vivo y conectado
  const alivePlayers = roomData.players.filter(p => !p.eliminated && !p.disconnected);
  
  // Encontrar el siguiente jugador vivo después del currentTurn actual
  let nextTurnIndex = roomData.currentTurn;
  let attempts = 0;
  
  do {
    nextTurnIndex = (nextTurnIndex + 1) % roomData.players.length;
    attempts++;
  } while ((roomData.players[nextTurnIndex].eliminated || roomData.players[nextTurnIndex].disconnected) && attempts < roomData.players.length);
  
  roomData.currentTurn = nextTurnIndex;

  // Verificar si todos los jugadores vivos han descrito
  const playersWhoDescribed = alivePlayers.filter(p => p.hasDescribed).length;
  
  if (playersWhoDescribed >= alivePlayers.length) {
    // Todos describieron, iniciar fase de debate
    startDebatePhase(room);
  } else {
    // Continuar con el siguiente turno
    const nextPlayer = roomData.players[roomData.currentTurn];
    
    io.to(room).emit('gameStateUpdate', {
      state: GAME_STATES.DESCRIBING,
      currentPlayer: nextPlayer.name,
      round: roomData.round
    });

    io.to(room).emit('chatMessage', {
      type: 'system',
      message: `Es el turno de ${nextPlayer.name} para describir.`,
      timestamp: Date.now()
    });

    startTimer(room, GAME_CONFIG.DESCRIBE_TIME, () => {
      nextTurn(room);
    });
  }
}

function startDebatePhase(room) {
  const roomData = rooms[room];
  roomData.state = GAME_STATES.DEBATING;

  io.to(room).emit('gameStateUpdate', {
    state: GAME_STATES.DEBATING,
    round: roomData.round
  });

  io.to(room).emit('chatMessage', {
    type: 'system',
    message: `¡Fase de debate! Tienen ${GAME_CONFIG.DEBATE_TIME} segundos para discutir quién es el impostor.`,
    timestamp: Date.now()
  });

  startTimer(room, GAME_CONFIG.DEBATE_TIME, () => {
    startVotingPhase(room);
  });
}

function startVotingPhase(room) {
  const roomData = rooms[room];
  roomData.state = GAME_STATES.VOTING;
  roomData.votes = {};
  roomData.voteDetails = []; // Limpiar detalles de votos anteriores

  // Resetear votos
  roomData.players.forEach(player => {
    player.hasVoted = false;
    player.votedFor = null; // Limpiar voto anterior
  });

  const alivePlayers = roomData.players.filter(p => !p.eliminated);

  io.to(room).emit('gameStateUpdate', {
    state: GAME_STATES.VOTING,
    round: roomData.round,
    candidates: alivePlayers.map(p => p.name)
  });

  io.to(room).emit('chatMessage', {
    type: 'system',
    message: `¡Fase de votación! Voten para expulsar a quien crean que es el impostor.`,
    timestamp: Date.now()
  });

  startTimer(room, GAME_CONFIG.VOTING_TIME, () => {
    processVoteResults(room);
  });
}

function processVoteResults(room) {
  const roomData = rooms[room];
  
  if (roomData.timer) {
    clearTimeout(roomData.timer);
  }

  // Encontrar el jugador con más votos
  let maxVotes = 0;
  let eliminatedPlayer = null;
  
  for (const [playerName, votes] of Object.entries(roomData.votes)) {
    if (votes > maxVotes) {
      maxVotes = votes;
      eliminatedPlayer = roomData.players.find(p => p.name === playerName);
    }
  }

  let resultMessage = '';
  
  if (!eliminatedPlayer || maxVotes === 0) {
    resultMessage = 'No hubo suficientes votos. Nadie fue eliminado.';
  } else {
    eliminatedPlayer.eliminated = true;
    
    if (eliminatedPlayer.impostor) {
      resultMessage = `${eliminatedPlayer.name} era el IMPOSTOR! Los investigadores ganan! 🏆`;
    } else {
      resultMessage = `${eliminatedPlayer.name} era un investigador... El impostor sigue entre ustedes. 😈`;
    }
  }

  roomData.state = GAME_STATES.RESULTS;

  io.to(room).emit('voteResults', {
    eliminatedPlayer: eliminatedPlayer ? eliminatedPlayer.name : null,
    wasImpostor: eliminatedPlayer ? eliminatedPlayer.impostor : false,
    votes: roomData.votes,
    voteDetails: roomData.voteDetails || [],
    message: resultMessage
  });

  io.to(room).emit('chatMessage', {
    type: 'system',
    message: resultMessage,
    timestamp: Date.now()
  });

  // Verificar fin del juego
  const gameEnd = checkGameEnd(room);
  
  setTimeout(() => {
    if (gameEnd.ended) {
      endGame(room, gameEnd.winner);
    } else {
      startNextRound(room);
    }
  }, 5000);
}

function startNextRound(room) {
  const roomData = rooms[room];
  
  // Resetear estado para nueva ronda
  roomData.players.forEach(player => {
    player.hasDescribed = false;
    player.hasVoted = false;
  });
  
  roomData.state = GAME_STATES.DESCRIBING;
  roomData.votes = {};
  roomData.round++;

  // Encontrar el primer jugador vivo y conectado para empezar la ronda
  let firstAliveIndex = 0;
  while (firstAliveIndex < roomData.players.length && (roomData.players[firstAliveIndex].eliminated || roomData.players[firstAliveIndex].disconnected)) {
    firstAliveIndex++;
  }
  
  roomData.currentTurn = firstAliveIndex;
  const firstPlayer = roomData.players[firstAliveIndex];

  io.to(room).emit('gameStateUpdate', {
    state: GAME_STATES.DESCRIBING,
    currentPlayer: firstPlayer.name,
    round: roomData.round
  });

  io.to(room).emit('chatMessage', {
    type: 'system',
    message: `¡Nueva ronda ${roomData.round}! Es el turno de ${firstPlayer.name} para describir.`,
    timestamp: Date.now()
  });

  startTimer(room, GAME_CONFIG.DESCRIBE_TIME, () => {
    nextTurn(room);
  });
}

function endGame(room, winner) {
  const roomData = rooms[room];
  roomData.state = GAME_STATES.LOBBY;
  
  if (roomData.timer) {
    clearTimeout(roomData.timer);
  }

  const impostorPlayers = roomData.players.filter(p => p.impostor);
  const impostorNames = impostorPlayers.map(p => p.name).join(', ');
  
  const winMessage = winner === 'impostor' 
    ? `🔥 ${roomData.numImpostors > 1 ? 'Los IMPOSTORES han ganado' : 'El IMPOSTOR ha ganado'}! ${roomData.numImpostors > 1 ? 'Lograron' : 'Logró'} sobrevivir y engañar a todos!` 
    : `🏆 Los INVESTIGADORES han ganado! Eliminaron ${roomData.numImpostors > 1 ? 'a todos los impostores' : 'al impostor'}!`;

  // Calcular y asignar puntos
  const impostorPlayer = roomData.players.find(p => p.impostor);
  const investigatorPlayers = roomData.players.filter(p => !p.impostor);

  if (winner === 'impostor') {
    // Impostor gana: +3 puntos al impostor
    impostorPlayer.score += 3;
    impostorPlayer.gamesWon++;
    impostorPlayer.gamesAsImpostor++;
    
    // Los investigadores aumentan su contador pero no ganan puntos
    investigatorPlayers.forEach(player => {
      player.gamesAsInvestigator++;
    });
  } else {
    // Investigadores ganan: +1 punto a cada investigador
    investigatorPlayers.forEach(player => {
      player.score += 1;
      player.gamesWon++;
      player.gamesAsInvestigator++;
    });
    
    // El impostor aumenta su contador pero no gana puntos
    impostorPlayer.gamesAsImpostor++;
  }

  // Guardar en historial
  roomData.gameHistory.push({
    round: roomData.round,
    winner: winner,
    champion: roomData.champion,
    impostor: impostorPlayer.name,
    timestamp: Date.now()
  });

  const creatorPlayer = roomData.players.find(p => p.isCreator);

  io.to(room).emit('gameEnd', {
    winner: winner,
    message: winMessage,
    champion: roomData.champion,
    championData: roomData.championData,
    impostor: impostorPlayer.name, // Para compatibilidad
    impostors: impostorNames, // Lista de todos los impostores
    numImpostors: roomData.numImpostors,
    scores: roomData.players.map(p => ({
      name: p.name,
      score: p.score,
      gamesWon: p.gamesWon,
      isCreator: p.isCreator
    })),
    canRestart: creatorPlayer ? true : false,
    creatorName: creatorPlayer ? creatorPlayer.name : null
  });

  io.to(room).emit('chatMessage', {
    type: 'system',
    message: `${winMessage} ${roomData.numImpostors > 1 ? 'Los impostores eran:' : 'El impostor era:'} ${impostorNames}. El campeón era: ${roomData.champion}`,
    timestamp: Date.now()
  });

  // Resetear jugadores para nueva partida (mantener puntos)
  roomData.players.forEach(player => {
    player.impostor = false;
    player.eliminated = false;
    player.hasVoted = false;
    player.hasDescribed = false;
  });

  // Actualizar lista de jugadores con nuevos puntajes
  io.to(room).emit("playersUpdate", {
    players: roomData.players.map(p => ({
      name: p.name,
      eliminated: p.eliminated,
      isCreator: p.isCreator,
      score: p.score
    })),
    gameState: roomData.state,
    canStart: roomData.players.length >= 3,
    creatorId: roomData.creatorId
  });
}

// ====== ENDPOINTS REST PARA SALAS PÚBLICAS ====== //

// Listar salas públicas disponibles
app.get('/api/rooms', (req, res) => {
  const publicRooms = Object.values(rooms)
    .filter(room => room.isPublic && room.players.length > 0) // Solo salas públicas con jugadores
    .map(room => ({
      code: room.code,
      name: room.name,
      players: room.players.length,
      maxPlayers: room.maxPlayers,
      numImpostors: room.numImpostors,
      state: room.state,
      createdAt: room.createdAt,
      creatorName: room.creatorName,
      canJoin: room.state === GAME_STATES.LOBBY && room.players.length < room.maxPlayers
    }))
    .sort((a, b) => {
      // Priorizar salas que se pueden unir, luego por jugadores
      if (a.canJoin && !b.canJoin) return -1;
      if (!a.canJoin && b.canJoin) return 1;
      return b.players - a.players; // Más jugadores primero
    });
    
  res.json({ rooms: publicRooms });
});

// Crear sala con nombre personalizado
app.post('/api/rooms', (req, res) => {
  const { name, isPublic = true, maxPlayers = 6, numImpostors, creatorName = 'Anónimo' } = req.body;
  
  if (!name || name.trim().length < 1) {
    return res.status(400).json({ error: 'El nombre de la sala es requerido' });
  }
  
  if (name.length > 50) {
    return res.status(400).json({ error: 'El nombre de la sala es muy largo (máximo 50 caracteres)' });
  }
  
  if (maxPlayers < 3 || maxPlayers > 8) {
    return res.status(400).json({ error: 'El número de jugadores debe estar entre 3 y 8' });
  }
  
  // Validar o ajustar número de impostores
  const finalNumImpostors = numImpostors !== undefined ? 
    Math.max(1, Math.min(numImpostors, Math.floor(maxPlayers / 2))) : 
    getRecommendedImpostors(maxPlayers);
    
  if (!validateImpostorCount(maxPlayers, finalNumImpostors)) {
    return res.status(400).json({ 
      error: `Configuración inválida: ${finalNumImpostors} impostor(es) para ${maxPlayers} jugadores` 
    });
  }
  
  // Generar código único
  let roomCode;
  do {
    roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms[roomCode]);
  
  // Crear sala con metadata
  rooms[roomCode] = initializeRoom(roomCode, null, {
    name: name.trim(),
    isPublic,
    maxPlayers,
    numImpostors: finalNumImpostors,
    creatorName: creatorName.trim() || 'Anónimo'
  });
  
  res.json({ 
    code: roomCode, 
    name: rooms[roomCode].name,
    success: true 
  });
});

// ====== FUNCIONES HELPER PARA SALAS ====== //
function updateRoomActivity(room) {
  if (rooms[room]) {
    rooms[room].lastActivity = Date.now();
  }
}

function notifyRoomListUpdate() {
  // Notificar a todos los clientes para actualizar la lista de salas públicas
  io.emit('roomListUpdate');
}

// ====== LIMPIEZA AUTOMÁTICA DE SALAS ====== //
function cleanupEmptyRooms() {
  const now = Date.now();
  const roomsToDelete = [];
  
  for (const [code, room] of Object.entries(rooms)) {
    const isEmpty = room.players.filter(p => !p.disconnected).length === 0;
    const isOld = now - room.lastActivity > 30 * 60 * 1000; // 30 minutos sin actividad
    
    if (isEmpty && isOld) {
      roomsToDelete.push(code);
    }
  }
  
  roomsToDelete.forEach(code => {
    console.log(`🧹 Limpiando sala vacía: ${code}`);
    delete rooms[code];
  });
  
  if (roomsToDelete.length > 0) {
    // Notificar a todos los clientes para actualizar la lista
    io.emit('roomListUpdate');
  }
}

// Ejecutar limpieza cada 10 minutos
setInterval(cleanupEmptyRooms, 10 * 60 * 1000);

server.listen(3000, () => console.log("🎮 Servidor LOL Impostor en http://localhost:3000"));