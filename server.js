const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://your-frontend.vercel.app"], // Allow local & deployed frontend
    methods: ["GET", "POST"]
  }
});

let players = {};
let currentRound = 0;
let roundHistory = [];
const attributes = ["A", "B", "C", "D", "E"];

io.on("connection", (socket) => {
  console.log("A user connected: ", socket.id);

  socket.on("joinGame", (playerData) => {
    players[socket.id] = playerData;
    console.log("Player joined:", playerData);
    
    if (Object.keys(players).length === 2) {
      io.emit("gameStart", { players });
      startNewRound();
    }
  });

  socket.on("playRound", () => {
    if (currentRound < 7) {
      const attribute = selectRandomAttribute();
      roundHistory.push(attribute);
      io.emit("roundPlayed", { round: currentRound + 1, attribute });
      currentRound++;
    }
    if (currentRound === 7) {
      io.emit("gameOver");
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected: ", socket.id);
    delete players[socket.id];
  });
});

function selectRandomAttribute() {
  let availableAttributes = attributes.filter(attr => !roundHistory.includes(attr) || roundHistory.filter(a => a === attr).length < 2);
  return availableAttributes[Math.floor(Math.random() * availableAttributes.length)];
}

function startNewRound() {
  setTimeout(() => {
    if (Object.keys(players).length === 2) {
      io.emit("playRound");
    }
  }, 2000);
}

server.listen(3001, () => {
  console.log("Server running on port 3001");
});
