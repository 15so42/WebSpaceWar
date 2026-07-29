import React, { useState, useEffect, useRef } from 'react';
import { GameState, LobbyInfo, ServerMessage, MessageType, CommandType, ShipType, Player } from './types';
import LobbyScreen from './components/LobbyScreen';
import SpaceBattlefield from './components/SpaceBattlefield';
import CardDeck from './components/CardDeck';
import GameLogs from './components/GameLogs';
import { Play, LogOut, Radio, RefreshCw, Sparkles, LogIn, AlertCircle } from 'lucide-react';

const PROTOCOL_VERSION = '1.0.0';

export default function App() {
  // Profiles
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('commander_name') || `指挥官_${Math.floor(Math.random() * 900) + 100}`;
  });
  const [roomId, setRoomId] = useState('ALPHA');
  const [playerId, setPlayerId] = useState(() => {
    return localStorage.getItem('commander_id') || `p_${Math.random().toString(36).substring(2, 11)}`;
  });

  // Keep in local storage for convenience
  useEffect(() => {
    localStorage.setItem('commander_name', playerName);
  }, [playerName]);

  useEffect(() => {
    localStorage.setItem('commander_id', playerId);
  }, [playerId]);

  // Network State
  const [lobbies, setLobbies] = useState<LobbyInfo[]>([]);
  const [roomState, setRoomState] = useState<GameState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isDisconnectedExplicitly, setIsDisconnectedExplicitly] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Card target select helper
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Keep references to prevent stale closures in WebSocket event handlers
  const roomStateRef = useRef(roomState);
  const roomIdRef = useRef(roomId);
  const playerNameRef = useRef(playerName);
  const playerIdRef = useRef(playerId);

  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  // 1. Establish WebSocket Connection
  const connectWS = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log(`Connecting to WebSocket: ${wsUrl}`);
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      if (wsRef.current !== socket) return;
      setIsConnected(true);
      setIsDisconnectedExplicitly(false);
      setErrorToast(null);

      // If we were already in a room, send auto-rejoin command
      if (roomStateRef.current) {
        socket.send(
          JSON.stringify({
            type: CommandType.JOIN_ROOM,
            roomId: roomIdRef.current,
            playerName: playerNameRef.current,
            playerId: playerIdRef.current,
            version: PROTOCOL_VERSION,
          })
        );
      }
    };

    socket.onmessage = (event) => {
      if (wsRef.current !== socket) return;
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case MessageType.LOBBY_LIST:
            setLobbies(msg.lobbies);
            break;
          case MessageType.ROOM_STATE:
            setRoomState(msg.state);
            break;
          case MessageType.JOIN_SUCCESS:
            console.log(`Joined room successfully: ${msg.roomId}`);
            break;
          case MessageType.ERROR:
            showError(msg.message);
            break;
          default:
            break;
        }
      } catch (err) {
        console.error('Failed to parse websocket message:', err);
      }
    };

    socket.onclose = () => {
      if (wsRef.current !== socket) return;
      setIsConnected(false);
      // Guidelines: Client 断线后不得自动重连，必须询问玩家是否恢复对局
      setIsDisconnectedExplicitly(true);
    };

    socket.onerror = (err) => {
      if (wsRef.current !== socket) return;
      console.error('WebSocket error:', err);
      setIsConnected(false);
    };
  };

  useEffect(() => {
    connectWS();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Utility toast
  const showError = (msg: string) => {
    setErrorToast(msg);
    setTimeout(() => {
      setErrorToast(null);
    }, 5000);
  };

  // 2. Client Command Helpers
  const joinRoom = () => {
    if (!isConnected) {
      showError('服务器未连接，无法加入。');
      return;
    }
    const cleanRoomId = roomId.trim().toUpperCase() || 'ALPHA';
    setRoomId(cleanRoomId);

    wsRef.current?.send(
      JSON.stringify({
        type: CommandType.JOIN_ROOM,
        roomId: cleanRoomId,
        playerName,
        playerId,
        version: PROTOCOL_VERSION,
      })
    );
  };

  const startGame = () => {
    wsRef.current?.send(JSON.stringify({ type: CommandType.START_GAME }));
  };

  const addBot = () => {
    wsRef.current?.send(JSON.stringify({ type: CommandType.ADD_BOT }));
  };

  const leaveRoom = () => {
    wsRef.current?.send(JSON.stringify({ type: CommandType.LEAVE_ROOM }));
    setRoomState(null);
  };

  const playCardDirect = (cardInstanceId: string) => {
    wsRef.current?.send(
      JSON.stringify({
        type: CommandType.PLAY_CARD,
        cardInstanceId,
      })
    );
  };

  const playCardTarget = (planetId: string) => {
    if (!selectedCardId) return;
    wsRef.current?.send(
      JSON.stringify({
        type: CommandType.PLAY_CARD,
        cardInstanceId: selectedCardId,
        targetPlanetId: planetId,
      })
    );
    setSelectedCardId(null);
  };

  const dispatchFleet = (
    sourcePlanetId: string,
    targetPlanetId: string,
    shipType: ShipType,
    count: number
  ) => {
    wsRef.current?.send(
      JSON.stringify({
        type: CommandType.DISPATCH_FLEET,
        sourcePlanetId,
        targetPlanetId,
        shipType,
        count,
      })
    );
  };

  // Reconnect recovery manually triggered by user
  const handleRestoreSession = () => {
    connectWS();
  };

  return (
    <div className="h-screen w-screen bg-[#02030a] text-slate-100 flex flex-col font-sans overflow-hidden relative select-none">
      {/* 1. Global Alert Toast */}
      {errorToast && (
        <div className="fixed top-4 right-4 z-50 bg-rose-950/95 border border-rose-800 text-rose-200 px-5 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 animate-fade-in max-w-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <p className="text-xs font-semibold leading-relaxed">{errorToast}</p>
        </div>
      )}

      {/* 2. Disconnect Session Recovery Prompt Modal */}
      {isDisconnectedExplicitly && (
        <div className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-[#090e24] border-2 border-amber-500/40 p-6 rounded-2xl max-w-md w-full shadow-2xl shadow-amber-950/25 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-950/80 border border-amber-600 flex items-center justify-center mx-auto text-amber-400 animate-pulse">
              <RefreshCw className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-black text-amber-400">指挥网络连接中途中断</h3>
              <p className="text-slate-300 text-xs leading-relaxed">
                依据星际公约，由于网络颠簸您已暂离本局战场。主机（Host）将在服务器为您保留席位{' '}
                <span className="text-amber-400 font-bold">60秒</span>。是否立即尝试重连并恢复星环战役？
              </p>
            </div>
            <button
              onClick={handleRestoreSession}
              className="w-full bg-indigo-600 hover:bg-indigo-500 font-extrabold text-white py-3 px-6 rounded-xl transition-all shadow-lg shadow-indigo-950/40 cursor-pointer text-xs"
            >
              立即恢复对局
            </button>
          </div>
        </div>
      )}

      {/* 3. Global Navbar Header */}
      <header className="bg-[#040613]/90 border-b border-[#121b40] px-6 h-[64px] flex items-center justify-between z-20 shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-tr from-emerald-500 to-indigo-500 flex items-center justify-center shadow-lg">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-wider flex items-center gap-2">
              STARGAZER RTS
              <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                v{PROTOCOL_VERSION}
              </span>
            </h1>
            <p className="text-[9px] text-slate-500 font-mono">SERVER-AUTHORITATIVE TACTICAL SIMULATION</p>
          </div>
        </div>

        {roomState && (
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400 hidden sm:inline">
              星域波段: <b className="text-indigo-400 font-mono text-xs bg-[#0b0f2a] px-2 py-1 rounded border border-[#16214f]">{roomId}</b>
            </span>

            {/* Connection indicator */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#09102b] border border-[#162553] rounded-full text-[10px]">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-500 animate-ping'}`} />
              <span className="text-slate-300 font-bold">{isConnected ? '星道连通' : '离线状态'}</span>
            </div>

            {/* Leave room / surrender */}
            <button
              onClick={leaveRoom}
              className="p-1.5 bg-slate-800/80 hover:bg-rose-950 hover:text-rose-300 border border-slate-700 hover:border-rose-900 rounded-lg text-slate-400 transition-colors text-[11px] flex items-center gap-1 cursor-pointer font-bold"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">撤离战局</span>
            </button>
          </div>
        )}
      </header>

      {/* 4. Core Screen routing */}
      {!roomState ? (
        <div className="flex-1 overflow-y-auto">
          <LobbyScreen
            playerName={playerName}
            setPlayerName={setPlayerName}
            roomId={roomId}
            setRoomId={setRoomId}
            lobbies={lobbies}
            currentRoomState={null}
            playerId={playerId}
            onJoinRoom={joinRoom}
            onAddBot={addBot}
            onStartGame={startGame}
            onLeaveRoom={leaveRoom}
          />
        </div>
      ) : !roomState.gameStarted ? (
        <div className="flex-1 overflow-y-auto">
          {/* Render lobby wait list */}
          <LobbyScreen
            playerName={playerName}
            setPlayerName={setPlayerName}
            roomId={roomId}
            setRoomId={setRoomId}
            lobbies={lobbies}
            currentRoomState={roomState}
            playerId={playerId}
            onJoinRoom={joinRoom}
            onAddBot={addBot}
            onStartGame={startGame}
            onLeaveRoom={leaveRoom}
          />
        </div>
      ) : (
        // Main Active Game Frame - Immersive Screen with Tilted Overlays (Game feel!)
        <main className="flex-1 relative overflow-hidden w-full h-[calc(100vh-64px)]">
          {/* Full viewport background interactive 3D map */}
          <div className="absolute inset-0 z-0">
            <SpaceBattlefield
              state={roomState}
              playerId={playerId}
              onDispatchFleet={dispatchFleet}
              onPlayCardTarget={playCardTarget}
              selectedCardId={selectedCardId}
              setSelectedCardId={setSelectedCardId}
            />
          </div>

          {/* Floating HUD: Top Left Commander Dashboard */}
          <div className="absolute top-4 left-4 z-10 p-3.5 bg-[#030614]/90 border border-indigo-500/40 rounded-2xl shadow-2xl shadow-black/80 backdrop-blur-md w-[250px] pointer-events-auto">
            <div className="flex items-center justify-between border-b border-[#14204c] pb-2 mb-2.5">
              <span className="text-[10px] uppercase font-black tracking-widest text-indigo-400">战略指挥控制台</span>
              <span className="text-[9px] bg-indigo-950/80 text-indigo-300 border border-indigo-800 px-1.5 py-0.5 rounded font-mono font-black">
                科技 T{Math.floor((roomState.players[playerId]?.techPoints || 0) / 10) + 1}
              </span>
            </div>

            <div className="space-y-2.5 text-xs">
              {/* Home Planet HP Indicator */}
              <div className="space-y-1">
                <div className="flex justify-between font-black text-slate-300 text-[9px] tracking-wider uppercase">
                  <span>母星屏障 (Base HP)</span>
                  <span className={(roomState.players[playerId]?.homePlanetHp || 0) > 30 ? "text-emerald-400" : "text-rose-500"}>
                    {Math.floor(roomState.players[playerId]?.homePlanetHp || 0)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-[#172551]">
                  <div
                    className={`h-full transition-all duration-300 ${
                      (roomState.players[playerId]?.homePlanetHp || 0) > 40
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                        : 'bg-gradient-to-r from-rose-500 to-pink-500 animate-pulse'
                    }`}
                    style={{ width: `${roomState.players[playerId]?.homePlanetHp || 0}%` }}
                  />
                </div>
              </div>

              {/* Resource grid */}
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <div className="px-2 py-1.5 bg-[#070b22] border border-[#142352] rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[8px] text-slate-500 font-bold block uppercase">矿物晶体</span>
                    <span className="text-xs font-black text-emerald-400 font-mono mt-0.5 block">
                      {Math.floor(roomState.players[playerId]?.minerals || 0)}
                    </span>
                  </div>
                  <span className="text-xs">💎</span>
                </div>

                <div className="px-2 py-1.5 bg-[#070b22] border border-[#142352] rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[8px] text-slate-500 font-bold block uppercase">科技能量</span>
                    <span className="text-xs font-black text-indigo-400 font-mono mt-0.5 block">
                      {Math.floor(roomState.players[playerId]?.techPoints || 0)}
                    </span>
                  </div>
                  <span className="text-xs">🧬</span>
                </div>
              </div>

              {/* Progress to next level bar */}
              <div className="space-y-0.5">
                <div className="flex justify-between text-[8px] text-slate-500 font-bold uppercase tracking-wider">
                  <span>科技突破进度 (T{Math.floor((roomState.players[playerId]?.techPoints || 0) / 10) + 1}级)</span>
                  <span className="font-mono text-indigo-300">{(roomState.players[playerId]?.techPoints || 0) % 10} / 10</span>
                </div>
                <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${((roomState.players[playerId]?.techPoints || 0) % 10) * 10}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Floating HUD: Top Right Fleet Presence List */}
          <div className="absolute top-4 right-4 z-10 p-3.5 bg-[#030614]/90 border border-indigo-500/40 rounded-2xl shadow-2xl shadow-black/80 backdrop-blur-md w-[220px] pointer-events-auto max-h-[250px] overflow-y-auto scrollbar-none">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-300 pb-2 border-b border-[#14204c] mb-2 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              星战指挥态势
            </h3>
            <div className="space-y-1.5">
              {Object.values(roomState.players).map((p: any) => (
                <div
                  key={p.id}
                  className={`p-2 bg-[#070b20]/60 border ${
                    p.id === playerId ? 'border-indigo-500/80' : 'border-[#14224c]'
                  } rounded-xl flex flex-col gap-0.5`}
                >
                  <div className="flex justify-between items-center text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full shadow-inner" style={{ backgroundColor: p.factionId }} />
                      <span className="font-bold text-slate-200 truncate max-w-[95px]">
                        {p.name} {p.id === playerId && '(你)'}
                      </span>
                    </div>
                    <span className={`font-mono font-black ${p.isAlive ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {p.isAlive ? `${Math.floor(p.homePlanetHp)}%` : '💀 沦陷'}
                    </span>
                  </div>
                  {p.isAlive && (
                    <div className="flex justify-between text-[8px] text-slate-500 font-mono mt-0.5">
                      <span>💎 {Math.floor(p.minerals)}</span>
                      <span>🧬 {Math.floor(p.techPoints)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Floating HUD: Bottom Left Live Tactical Log Console */}
          <div className="absolute bottom-4 left-4 z-10 pointer-events-auto w-[270px] hidden md:block max-h-[170px]">
            <GameLogs logs={roomState.logs} />
          </div>

          {/* Floating HUD: Bottom Right Active Continuous Card Buff Zone */}
          {roomState.players[playerId] && roomState.players[playerId].effects.length > 0 && (
            <div className="absolute bottom-4 right-4 z-10 p-3 bg-[#030614]/95 border border-amber-500/35 rounded-2xl shadow-2xl shadow-black/80 backdrop-blur-md w-[200px] pointer-events-auto">
              <span className="text-[9px] font-black uppercase tracking-widest text-amber-400 block mb-2 border-b border-amber-950/40 pb-1">
                ⏳ 持续卡组能效
              </span>
              <div className="space-y-1.5">
                {roomState.players[playerId].effects.map((eff: any) => (
                  <div key={eff.id} className="p-1.5 bg-amber-950/15 border border-amber-900/30 rounded-lg space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-amber-200 font-bold truncate max-w-[130px]">{eff.name}</span>
                      <span className="text-amber-400 font-mono font-bold">{eff.timeLeft.toFixed(1)}s</span>
                    </div>
                    <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 transition-all duration-200"
                        style={{ width: `${(eff.timeLeft / eff.maxTime) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Floating Card Deck: Centered beautifully at the bottom fanning out */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto w-[90%] sm:w-[80%] md:w-[65%] lg:w-[50%]">
            <CardDeck
              state={roomState}
              playerId={playerId}
              selectedCardId={selectedCardId}
              setSelectedCardId={setSelectedCardId}
              onPlayCardDirect={playCardDirect}
            />
          </div>
        </main>
      )}
    </div>
  );
}
