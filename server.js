const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fetch = require("node-fetch");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let rooms = {}; // { roomCode: { players: [], started: false } }

async function getChampions() {
  const res = await fetch("https://ddragon.leagueoflegends.com/cdn/14.17.1/data/en_US/champion.json");
  const data = await res.json();
  return Object.keys(data.data);
}

io.on("connection", (socket) => {
  console.log("Jugador conectado:", socket.id);

  socket.on("joinRoom", ({ name, room }) => {
    if (!rooms[room]) rooms[room] = { players: [], started: false };

    rooms[room].players.push({ id: socket.id, name });
    socket.join(room);

    io.to(room).emit("playersUpdate", rooms[room].players.map(p => p.name));
  });

  socket.on("startGame", async (room) => {
    if (!rooms[room]) return;
    const champions = await getChampions();

    // shuffle jugadores
    let shuffled = [...rooms[room].players].sort(() => Math.random() - 0.5);

    shuffled.forEach((player, i) => {
      let champ = champions[Math.floor(Math.random() * champions.length)];
      let impostor = i === 0; // primero impostor
      io.to(player.id).emit("role", { champ, impostor });
    });

    rooms[room].started = true;
  });

  socket.on("disconnect", () => {
    for (let room in rooms) {
      rooms[room].players = rooms[room].players.filter(p => p.id !== socket.id);
      io.to(room).emit("playersUpdate", rooms[room].players.map(p => p.name));
    }
  });
});

server.listen(3000, () => console.log("Servidor en http://localhost:3000"));
