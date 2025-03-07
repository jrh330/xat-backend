const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://your-frontend.vercel.app"],
    methods: ["GET", "POST"]
  }
});

// Game state management
let waitingPlayer = null;
let activeGames = {};

io.on("connection", (socket) => {
  console.log("A user connected: ", socket.id);

  // Player joins with their deck
  socket.on("joinGame", ({ deck }) => {
    console.log(`Player ${socket.id} joined with deck of ${deck?.length || 0} cards`);
    
    // Validate deck
    const validation = validateDeck(deck);
    if (!validation.valid) {
      socket.emit("gameError", { message: validation.message });
      return;
    }
    
    // Add player ID to each card
    const playerDeck = deck.map(card => ({
      ...card,
      playerId: socket.id
    }));

    if (!waitingPlayer) {
      waitingPlayer = { id: socket.id, deck: playerDeck, socket };
      socket.emit("waitingForOpponent");
    } else {
      // Create a new game session with both players
      const gameId = `game_${Date.now()}`;
      const player1 = waitingPlayer;
      const player2 = { id: socket.id, deck: playerDeck, socket };
      
      // Initialize game state
      activeGames[gameId] = {
        players: [player1, player2],
        currentRound: 0,
        scores: { [player1.id]: 0, [player2.id]: 0 },
        usedAttributes: [],
        gameOver: false
      };

      // Associate players with their game
      player1.socket.join(gameId);
      player2.socket.join(gameId);
      player1.gameId = gameId;
      player2.gameId = gameId;
      
      // Notify players the game has started
      io.to(gameId).emit("gameStart", { 
        gameId,
        playerIds: [player1.id, player2.id]
      });

      // Start the first round
      startNewRound(gameId);
      
      // Reset waiting player
      waitingPlayer = null;
    }
  });

  socket.on("startGame", () => {
    // Find the game this player is in
    const gameId = Object.keys(activeGames).find(id => {
      const game = activeGames[id];
      return game.players.some(p => p.id === socket.id);
    });

    if (gameId) {
      startNewRound(gameId);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected: ", socket.id);
    
    // Handle player disconnection
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
    
    // End any active games for this player
    Object.keys(activeGames).forEach(gameId => {
      const game = activeGames[gameId];
      if (game.players.some(p => p.id === socket.id)) {
        const winner = game.players.find(p => p.id !== socket.id);
        if (winner) {
          winner.socket.emit("opponentDisconnected", { 
            message: "Your opponent disconnected. You win!",
            gameOver: true,
            winner: winner.id
          });
        }
        delete activeGames[gameId];
      }
    });
  });
});

function validateDeck(deck) {
  if (!deck || !Array.isArray(deck) || deck.length !== 7) {
    return { valid: false, message: "Deck must contain exactly 7 cards." };
  }
  
  for (let i = 0; i < deck.length; i++) {
    const card = deck[i];
    
    // Check if card has a name
    if (!card.name || card.name.trim() === "") {
      return { valid: false, message: `Card #${i+1} must have a name.` };
    }
    
    // Check if card has attributes
    if (!card.attributes) {
      return { valid: false, message: `Card #${i+1} is missing attributes.` };
    }
    
    // Check if total attribute points don't exceed 15
    const totalPoints = Object.values(card.attributes).reduce((sum, val) => sum + val, 0);
    if (totalPoints > 15) {
      return { valid: false, message: `Card #${i+1} has more than 15 attribute points.` };
    }
    
    // Check if all attributes have values between 1-5
    for (const [attr, value] of Object.entries(card.attributes)) {
      if (value < 1 || value > 5) {
        return { 
          valid: false, 
          message: `Card #${i+1} has invalid value for attribute ${attr}. Must be between 1-5.` 
        };
      }
    }
  }
  
  return { valid: true };
}

function startNewRound(gameId) {
  const game = activeGames[gameId];
  if (!game || game.gameOver) return;

  const currentRound = game.currentRound;
  if (currentRound >= 7) {
    endGame(gameId);
    return;
  }

  // Select an attribute for this round
  const attribute = selectAttribute(game.usedAttributes);
  game.usedAttributes.push(attribute);

  // Get the current cards for this round
  const player1Card = game.players[0].deck[currentRound];
  const player2Card = game.players[1].deck[currentRound];

  // Determine the winner of this round
  let roundWinner;
  
  // Updated to handle ties - both players get a point in a tie
  if (player1Card.attributes[attribute] > player2Card.attributes[attribute]) {
    roundWinner = game.players[0].id;
    game.scores[game.players[0].id]++;
  } else if (player2Card.attributes[attribute] > player1Card.attributes[attribute]) {
    roundWinner = game.players[1].id;
    game.scores[game.players[1].id]++;
  } else {
    // It's a tie - both players get a point
    roundWinner = "tie";
    game.scores[game.players[0].id]++;
    game.scores[game.players[1].id]++;
  }

  // Send round results to both players
  io.to(gameId).emit("roundResult", {
    round: currentRound + 1,
    attribute,
    player1Card,
    player2Card,
    roundWinner,
    scores: game.scores
  });

  // Move to next round
  game.currentRound++;

  // Auto-start next round after delay
  if (game.currentRound < 7) {
    setTimeout(() => {
      startNewRound(gameId);
    }, 5000); // 5 second delay between rounds
  } else {
    // End the game after the last round
    setTimeout(() => {
      endGame(gameId);
    }, 3000);
  }
}

function endGame(gameId) {
  const game = activeGames[gameId];
  if (!game) return;

  game.gameOver = true;
  const player1Score = game.scores[game.players[0].id] || 0;
  const player2Score = game.scores[game.players[1].id] || 0;
  
  let winner;
  if (player1Score > player2Score) {
    winner = game.players[0].id;
  } else if (player2Score > player1Score) {
    winner = game.players[1].id;
  } else {
    // It's a tie
    winner = "tie";
  }

  // Notify players of game end
  io.to(gameId).emit("gameOver", {
    winner,
    scores: game.scores
  });

  // Clean up after a delay
  setTimeout(() => {
    delete activeGames[gameId];
  }, 10000);
}

function selectAttribute(usedAttributes) {
  const attributes = ["A", "B", "C", "D", "E"];
  
  // First ensure each attribute is used at least once
  const unusedAttributes = attributes.filter(attr => 
    !usedAttributes.includes(attr)
  );
  
  if (unusedAttributes.length > 0) {
    return unusedAttributes[Math.floor(Math.random() * unusedAttributes.length)];
  }
  
  // Then select any attribute that hasn't been used twice
  const attributeCount = {};
  attributes.forEach(attr => { attributeCount[attr] = 0; });
  
  usedAttributes.forEach(attr => {
    attributeCount[attr]++;
  });
  
  const availableAttributes = attributes.filter(attr => attributeCount[attr] < 2);
  
  if (availableAttributes.length > 0) {
    return availableAttributes[Math.floor(Math.random() * availableAttributes.length)];
  }
  
  // Fallback - should not happen in a 7-round game with 5 attributes
  return attributes[Math.floor(Math.random() * attributes.length)];
}

server.listen(3001, () => {
  console.log("Server running on port 3001");
});