import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  GameState,
  ClientCommand,
  CommandType,
  ServerMessage,
  MessageType,
  PlayerId,
  LobbyInfo,
} from './src/types';
import {
  createGame,
  tickGame,
  playCard,
  dispatchFleet,
  runBotAI,
  generateId,
} from './src/gameEngine';

// Version declarations for matching check
const PROTOCOL_VERSION = '1.0.0';

interface GameRoom {
  roomId: string;
  state: GameState;
  clients: Map<PlayerId, WebSocket>;
  botTickAccumulator: number;
  lastActivity: number;
  tickInterval: NodeJS.Timeout | null;
}

const rooms: Record<string, GameRoom> = {};

// Broadcast lobby lists to clients looking at selection screen
const lobbyViewers = new Set<WebSocket>();

function broadcastLobbies() {
  const lobbies: LobbyInfo[] = Object.values(rooms).map((r) => {
    const playerCount = Object.values(r.state.players).filter((p) => !p.isBot).length;
    return {
      roomId: r.roomId,
      playerCount,
      maxPlayers: 4,
      gameStarted: r.state.gameStarted,
    };
  });

  const payload: ServerMessage = {
    type: MessageType.LOBBY_LIST,
    lobbies,
  };

  const msg = JSON.stringify(payload);
  lobbyViewers.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

function stopRoomTicker(room: GameRoom) {
  if (room.tickInterval) {
    clearInterval(room.tickInterval);
    room.tickInterval = null;
  }
}

function startRoomTicker(room: GameRoom) {
  stopRoomTicker(room);

  room.tickInterval = setInterval(() => {
    // Check for room timeouts (e.g. 60 seconds without active clients)
    const now = Date.now();
    const activeClients = Array.from(room.clients.values()).filter((ws) => ws.readyState === WebSocket.OPEN);

    if (activeClients.length === 0) {
      if (now - room.lastActivity > 60000) {
        console.log(`[Room ${room.roomId}] Inactivity timeout. Freeing resources.`);
        stopRoomTicker(room);
        delete rooms[room.roomId];
        broadcastLobbies();
        return;
      }
    } else {
      room.lastActivity = now;
    }

    if (room.state.gameOver) {
      console.log(`[Room ${room.roomId}] Game over reached.`);
      stopRoomTicker(room);
      broadcastRoomState(room);
      return;
    }

    // Tick State: dt is 0.05 seconds
    room.state = tickGame(room.state, 0.05);

    // Bot AI Decision triggers every 2.4 seconds
    room.botTickAccumulator += 0.05;
    if (room.botTickAccumulator >= 2.4) {
      room.botTickAccumulator = 0;
      Object.values(room.state.players).forEach((p) => {
        if (p.isBot && p.isAlive) {
          const cmd = runBotAI(room.state, p.id);
          if (cmd) {
            try {
              if (cmd.type === CommandType.PLAY_CARD) {
                room.state = playCard(room.state, p.id, cmd.cardInstanceId, cmd.targetPlanetId);
              } else if (cmd.type === CommandType.DISPATCH_FLEET) {
                room.state = dispatchFleet(
                  room.state,
                  p.id,
                  cmd.sourcePlanetId,
                  cmd.targetPlanetId,
                  cmd.shipType,
                  cmd.count
                );
              }
            } catch (err) {
              // Bot execution error; suppress to ensure non-blocking
            }
          }
        }
      });
    }

    // Broadcast current synchronized state
    broadcastRoomState(room);
  }, 50);
}

function broadcastRoomState(room: GameRoom) {
  room.clients.forEach((ws, playerId) => {
    if (ws.readyState === WebSocket.OPEN) {
      const msg: ServerMessage = {
        type: MessageType.ROOM_STATE,
        state: room.state,
        playerId,
      };
      ws.send(JSON.stringify(msg));
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Standard JSON middleware
  app.use(express.json());

  // Health endpoint check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: PROTOCOL_VERSION });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket Upgrade
  server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';
    const pathname = url.split('?')[0];
    console.log(`[WebSocket Upgrade] Received upgrade request for URL: "${url}", Pathname: "${pathname}"`);
    
    if (pathname === '/ws' || pathname === '/ws/' || pathname.endsWith('/ws') || pathname.endsWith('/ws/')) {
      console.log(`[WebSocket Upgrade] Upgrade approved for pathname: "${pathname}"`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      console.log(`[WebSocket Upgrade] Upgrade rejected for pathname: "${pathname}"`);
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('New connection established.');
    let registeredPlayerId: string | null = null;
    let registeredRoomId: string | null = null;

    // Immediately push current active lobbies list to new connection
    lobbyViewers.add(ws);
    // Send immediate lobby info
    const lobbies: LobbyInfo[] = Object.values(rooms).map((r) => {
      const playerCount = Object.values(r.state.players).filter((p) => !p.isBot).length;
      return {
        roomId: r.roomId,
        playerCount,
        maxPlayers: 4,
        gameStarted: r.state.gameStarted,
      };
    });
    ws.send(JSON.stringify({ type: MessageType.LOBBY_LIST, lobbies }));

    ws.on('message', (message: string) => {
      try {
        const cmd: ClientCommand & { version?: string } = JSON.parse(message);

        // Version verification step
        if (cmd.type === CommandType.JOIN_ROOM) {
          if (cmd.version && cmd.version !== PROTOCOL_VERSION) {
            ws.send(
              JSON.stringify({
                type: MessageType.ERROR,
                message: `版本冲突！客户端协议 (${cmd.version}) 不匹配服务端版本 (${PROTOCOL_VERSION})。请刷新重连。`,
              })
            );
            return;
          }

          lobbyViewers.delete(ws); // No longer purely a lobby viewer

          const { roomId, playerName, playerId } = cmd;
          registeredPlayerId = playerId;
          registeredRoomId = roomId;

          // Retrieve or construct game room
          if (!rooms[roomId]) {
            console.log(`[Lobby] Creating new room: ${roomId}`);
            rooms[roomId] = {
              roomId,
              state: {
                roomId,
                players: {},
                planets: {},
                ships: {},
                gameStarted: false,
                gameOver: false,
                winnerId: null,
                logs: [`大厅 ${roomId} 已创建。等待玩家加入...`],
              },
              clients: new Map(),
              botTickAccumulator: 0,
              lastActivity: Date.now(),
              tickInterval: null,
            };
          }

          const room = rooms[roomId];

          if (room.state.gameStarted) {
            // Reconnection flow
            if (room.state.players[playerId]) {
              console.log(`[Room ${roomId}] Player ${playerName} (${playerId}) reconnected.`);
              room.clients.set(playerId, ws);
              room.lastActivity = Date.now();
              broadcastRoomState(room);
              broadcastLobbies();
              return;
            } else {
              ws.send(
                JSON.stringify({
                  type: MessageType.ERROR,
                  message: '战役已经开始，无法中途加入。',
                })
              );
              lobbyViewers.add(ws);
              return;
            }
          }

          // Join lobby phase
          if (Object.keys(room.state.players).length >= 4) {
            ws.send(JSON.stringify({ type: MessageType.ERROR, message: '该房间已满员 (上限 4 人)。' }));
            lobbyViewers.add(ws);
            return;
          }

          // Add player object to state
          room.clients.set(playerId, ws);
          room.state.players[playerId] = {
            id: playerId,
            name: playerName,
            factionId: '#ffffff', // assigned upon start_game
            minerals: 12,
            techPoints: 0,
            homePlanetHp: 100,
            isAlive: true,
            hand: [],
            effects: [],
            isBot: false,
          };

          room.state.logs.unshift(`📡 玩家 ${playerName} 加入了游戏大厅。`);
          ws.send(JSON.stringify({ type: MessageType.JOIN_SUCCESS, playerId, roomId }));

          broadcastRoomState(room);
          broadcastLobbies();
        } else {
          // Standard in-game commands
          if (!registeredRoomId || !registeredPlayerId) {
            ws.send(JSON.stringify({ type: MessageType.ERROR, message: '尚未加入任何房间。' }));
            return;
          }

          const room = rooms[registeredRoomId];
          if (!room) {
            ws.send(JSON.stringify({ type: MessageType.ERROR, message: '房间未找到。' }));
            return;
          }

          room.lastActivity = Date.now();

          switch (cmd.type) {
            case CommandType.START_GAME: {
              if (room.state.gameStarted) return;

              // Generate game state
              const playersList = Object.values(room.state.players).map((p) => ({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
              }));

              if (playersList.length === 0) {
                ws.send(JSON.stringify({ type: MessageType.ERROR, message: '无有效加入玩家，无法启动。' }));
                return;
              }

              // Create final fully populated state
              room.state = createGame(registeredRoomId, playersList);
              room.state.gameStarted = true;

              // Launch room interval ticker
              startRoomTicker(room);
              broadcastLobbies();
              break;
            }

            case CommandType.PLAY_CARD: {
              if (!room.state.gameStarted || room.state.gameOver) return;
              try {
                room.state = playCard(room.state, registeredPlayerId, cmd.cardInstanceId, cmd.targetPlanetId);
              } catch (err: any) {
                ws.send(JSON.stringify({ type: MessageType.ERROR, message: err.message || '卡牌施放失败' }));
              }
              break;
            }

            case CommandType.DISPATCH_FLEET: {
              if (!room.state.gameStarted || room.state.gameOver) return;
              try {
                room.state = dispatchFleet(
                  room.state,
                  registeredPlayerId,
                  cmd.sourcePlanetId,
                  cmd.targetPlanetId,
                  cmd.shipType,
                  cmd.count
                );
              } catch (err: any) {
                ws.send(JSON.stringify({ type: MessageType.ERROR, message: err.message || '舰队派遣失败' }));
              }
              break;
            }

            case CommandType.ADD_BOT: {
              if (room.state.gameStarted) return;
              const botCount = Object.values(room.state.players).filter((p) => p.isBot).length;
              const botId = generateId('bot');
              const botName = `AI 掠夺者 #${botCount + 1}`;

              room.state.players[botId] = {
                id: botId,
                name: botName,
                factionId: '#aaaaaa',
                minerals: 12,
                techPoints: 0,
                homePlanetHp: 100,
                isAlive: true,
                hand: [],
                effects: [],
                isBot: true,
              };

              room.state.logs.unshift(`🤖 添加了电脑 AI: ${botName}`);
              broadcastRoomState(room);
              break;
            }

            case CommandType.LEAVE_ROOM: {
              cleanUpPlayer(registeredRoomId, registeredPlayerId, ws);
              registeredPlayerId = null;
              registeredRoomId = null;
              lobbyViewers.add(ws);
              broadcastLobbies();
              break;
            }

            default:
              break;
          }
        }
      } catch (err) {
        console.error('Failed to process incoming WS message:', err);
      }
    });

    ws.on('close', () => {
      console.log('Connection closed.');
      lobbyViewers.delete(ws);

      if (registeredRoomId && registeredPlayerId) {
        const room = rooms[registeredRoomId];
        if (room) {
          console.log(`[Room ${registeredRoomId}] Client ${registeredPlayerId} disconnected (held for reconnect).`);
          // Note: we do NOT remove them from room.state.players, allowing reconnects.
          // However, we remove the socket mapping from room.clients
          room.clients.delete(registeredPlayerId);
          room.lastActivity = Date.now();
          broadcastLobbies();
        }
      }
    });
  });

  function cleanUpPlayer(roomId: string, playerId: string, ws: WebSocket) {
    const room = rooms[roomId];
    if (!room) return;

    room.clients.delete(playerId);

    if (!room.state.gameStarted) {
      // If lobby hasn't started, fully remove player
      delete room.state.players[playerId];
      room.state.logs.unshift(`📡 玩家已退出大厅。`);
      broadcastRoomState(room);
    } else {
      // If started, turn them into an active BOT so the game keeps going smoothly!
      const player = room.state.players[playerId];
      if (player && player.isAlive) {
        player.isBot = true;
        player.name = `${player.name} (AI接管)`;
        room.state.logs.unshift(`🤖 玩家离线，已由 AI 托管：${player.name}`);
        broadcastRoomState(room);
      }
    }
  }

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server fully running on http://localhost:${PORT}`);
  });
}

startServer();
