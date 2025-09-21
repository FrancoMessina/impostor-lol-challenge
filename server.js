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
  DESCRIBE_TIME: 10, // segundos por turno
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

function initializeRoom(roomCode, creatorId) {
  return {
    code: roomCode,
    players: [],
    state: GAME_STATES.LOBBY,
    champion: null,
    championData: null,
    impostorIndex: -1,
    currentTurn: 0,
    turnStartTime: null,
    timer: null,
    votes: {},
    eliminated: [],
    chatMessages: [],
    round: 0,
    creatorId: creatorId,
    gameHistory: []
  };
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
  const alivePlayers = roomData.players.filter(p => !p.eliminated);
  const aliveImpostors = alivePlayers.filter(p => p.impostor);
  const aliveInvestigators = alivePlayers.filter(p => !p.impostor);
  
  // Impostor gana si hay igual cantidad de impostores e investigadores
  if (aliveImpostors.length >= aliveInvestigators.length) {
    return { ended: true, winner: 'impostor' };
  }
  
  // Investigadores ganan si eliminaron a todos los impostores
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
      rooms[room] = initializeRoom(room, socket.id); // El primer jugador es el creador
    }

    const roomData = rooms[room];

    // Verificar si la sala está llena
    if (roomData.players.length >= GAME_CONFIG.MAX_PLAYERS) {
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
      gamesAsInvestigator: 0
    });

    socket.join(room);

    // Enviar actualización a todos
    io.to(room).emit("playersUpdate", {
      players: roomData.players.map(p => ({
        name: p.name,
        eliminated: p.eliminated,
        isCreator: p.isCreator,
        score: p.score
      })),
      gameState: roomData.state,
      canStart: roomData.players.length >= 3, // Mínimo 3 para testing
      creatorId: roomData.creatorId
    });

    io.to(room).emit('chatMessage', {
      type: 'system',
      message: `${name} se unió a la sala${isCreator ? ' (Creador)' : ''}`,
      timestamp: Date.now()
    });
  });

  socket.on("startGame", async (room) => {
    if (!rooms[room]) return;
    
    const roomData = rooms[room];
    
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
      
      // Mezclar jugadores y asignar impostor
      let shuffledPlayers = [...roomData.players].sort(() => Math.random() - 0.5);
      const impostorIndex = 0; // El primer jugador mezclado será el impostor
      
      shuffledPlayers.forEach((player, index) => {
        player.impostor = index === impostorIndex;
        player.eliminated = false;
        player.hasVoted = false;
        player.hasDescribed = false;
      });

      roomData.players = shuffledPlayers;
      roomData.champion = championInfo.name;
      roomData.championData = championInfo; // Guardar datos completos del campeón
      roomData.impostorIndex = impostorIndex;
      roomData.state = GAME_STATES.DESCRIBING;
      roomData.currentTurn = 0;
      roomData.votes = {};
      roomData.round++;

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
        currentPlayer: roomData.players[0].name,
        round: roomData.round,
        champion: null // Los investigadores ya saben el campeón
      });

      io.to(room).emit('chatMessage', {
        type: 'system',
        message: `¡Juego iniciado! Ronda ${roomData.round}. Es el turno de ${roomData.players[0].name} para describir.`,
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
    if (currentPlayer.id !== socket.id) return;

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
    roomData.votes[targetPlayer] = (roomData.votes[targetPlayer] || 0) + 1;

    io.to(room).emit('voteUpdate', {
      voter: voter.name,
      target: targetPlayer,
      totalVotes: Object.keys(roomData.votes).length,
      requiredVotes: roomData.players.filter(p => !p.eliminated).length
    });

    // Verificar si todos votaron
    const alivePlayers = roomData.players.filter(p => !p.eliminated);
    const votedPlayers = alivePlayers.filter(p => p.hasVoted);
    
    if (votedPlayers.length === alivePlayers.length) {
      processVoteResults(room);
    }
  });

  socket.on('restartGame', (room) => {
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

    // Reiniciar el juego manteniendo los puntos
    io.to(room).emit('chatMessage', {
      type: 'system',
      message: `${player.name} ha iniciado una nueva partida`,
      timestamp: Date.now()
    });

    // Iniciar nuevo juego usando la misma lógica que startGame
    socket.emit('startGame', room);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (room && rooms[room]) {
      const roomData = rooms[room];
      const disconnectedPlayer = roomData.players.find(p => p.id === socket.id);
      
      if (disconnectedPlayer) {
        // Si se desconecta el creador, asignar a otro jugador como creador
        if (disconnectedPlayer.isCreator && roomData.players.length > 1) {
          const newCreator = roomData.players.find(p => p.id !== socket.id);
          if (newCreator) {
            newCreator.isCreator = true;
            roomData.creatorId = newCreator.id;
            
            io.to(room).emit('chatMessage', {
              type: 'system',
              message: `${newCreator.name} es ahora el nuevo creador de la sala`,
              timestamp: Date.now()
            });
          }
        }
        
        roomData.players = roomData.players.filter(p => p.id !== socket.id);
        
        io.to(room).emit('chatMessage', {
          type: 'system',
          message: `${disconnectedPlayer.name} se desconectó`,
          timestamp: Date.now()
        });

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

        // Si no quedan jugadores suficientes, resetear sala
        if (roomData.players.length < 2 && roomData.state !== GAME_STATES.LOBBY) {
          roomData.state = GAME_STATES.LOBBY;
          if (roomData.timer) {
            clearTimeout(roomData.timer);
          }
        }
      }
    }
  });
});

function nextTurn(room) {
  const roomData = rooms[room];
  if (!roomData) return;

  if (roomData.timer) {
    clearTimeout(roomData.timer);
  }

  // Buscar el siguiente jugador que no haya sido eliminado
  const alivePlayers = roomData.players.filter(p => !p.eliminated);
  roomData.currentTurn = (roomData.currentTurn + 1) % alivePlayers.length;

  // Verificar si todos los jugadores vivos han descrito
  const playersWhoDescribed = alivePlayers.filter(p => p.hasDescribed).length;
  
  if (playersWhoDescribed >= alivePlayers.length) {
    // Todos describieron, iniciar fase de debate
    startDebatePhase(room);
  } else {
    // Continuar con el siguiente turno
    const nextPlayer = alivePlayers[roomData.currentTurn];
    
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

  // Resetear votos
  roomData.players.forEach(player => {
    player.hasVoted = false;
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
  roomData.currentTurn = 0;
  roomData.votes = {};
  roomData.round++;

  const alivePlayers = roomData.players.filter(p => !p.eliminated);

  io.to(room).emit('gameStateUpdate', {
    state: GAME_STATES.DESCRIBING,
    currentPlayer: alivePlayers[0].name,
    round: roomData.round
  });

  io.to(room).emit('chatMessage', {
    type: 'system',
    message: `¡Nueva ronda ${roomData.round}! Es el turno de ${alivePlayers[0].name} para describir.`,
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

  const winMessage = winner === 'impostor' 
    ? '🔥 El IMPOSTOR ha ganado! Logró sobrevivir y engañar a todos!' 
    : '🏆 Los INVESTIGADORES han ganado! Eliminaron al impostor!';

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
    impostor: impostorPlayer.name,
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
    message: `${winMessage} El campeón era: ${roomData.champion}`,
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

server.listen(3000, () => console.log("🎮 Servidor LOL Impostor en http://localhost:3000"));