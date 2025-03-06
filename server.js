const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"], 
    transports: ["websocket", "polling"], 
  },
});

app.use(cors());

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });

  // Handle game rounds
  socket.on("playRound", ({ card, round }) => {
    console.log(`Player ${socket.id} played a card for round ${round}`);

    // Store the played round
    if (!gameRounds[round]) {
      gameRounds[round] = [];
    }
    gameRounds[round].push({ playerId: socket.id, card });

    // If both players have submitted a card for this round, determine the winner
    if (gameRounds[round].length === 2) {
      const player1 = gameRounds[round][0];
      const player2 = gameRounds[round][1];

      // Randomly select an attribute (A-E)
      const attributes = ["A", "B", "C", "D", "E"];
      const selectedAttribute = attributes[Math.floor(Math.random() * attributes.length)];

      let winner = null;
      if (player1.card.attributes[selectedAttribute] > player2.card.attributes[selectedAttribute]) {
        winner = player1.playerId;
      } else if (player1.card.attributes[selectedAttribute] < player2.card.attributes[selectedAttribute]) {
        winner = player2.playerId;
      }

      console.log(`Round ${round + 1} - Attribute: ${selectedAttribute}, Winner: ${winner || "Tie"}`);

      // Emit the round result to both players
      io.emit("roundResult", {
        round: round + 1,
        attribute: selectedAttribute,
        player1Card: player1.card,
        player2Card: player2.card,
        winner,
      });

      // If all 7 rounds are completed, declare a final winner
      if (round + 1 === 7) {
        io.emit("gameOver", { message: "Game Over!" });
      } else {
        setTimeout(() => {
          io.emit("nextRound");
        }, 5000); // Add a delay before the next round starts
      }
    }
  });
});


server.listen(3001, () => {
  console.log("Server running on port 3001");
});
