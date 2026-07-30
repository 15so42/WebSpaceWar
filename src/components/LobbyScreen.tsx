import React, { useState } from 'react';
import { LobbyInfo, GameState } from '../types';
import { Space, User, Plus, Bot, Play, LogOut, RefreshCw } from 'lucide-react';

interface LobbyScreenProps {
  playerName: string;
  setPlayerName: (name: string) => void;
  roomId: string;
  setRoomId: (id: string) => void;
  lobbies: LobbyInfo[];
  currentRoomState: GameState | null;
  playerId: string;
  onJoinRoom: (roomId?: string) => void;
  onAddBot: () => void;
  onStartGame: () => void;
  onLeaveRoom: () => void;
  onStartSinglePlayer: () => void;
}

export default function LobbyScreen({
  playerName,
  setPlayerName,
  roomId,
  setRoomId,
  lobbies,
  currentRoomState,
  playerId,
  onJoinRoom,
  onAddBot,
  onStartGame,
  onLeaveRoom,
  onStartSinglePlayer,
}: LobbyScreenProps) {
  const [customRoomId, setCustomRoomId] = useState('');

  const handleJoinCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRoomId.trim()) return;
    const normalizedRoomId = customRoomId.toUpperCase().trim();
    setRoomId(normalizedRoomId);
    onJoinRoom(normalizedRoomId);
  };

  const handleJoinLobby = (id: string) => {
    setRoomId(id);
    onJoinRoom(id);
  };

  const isLobbyOwner = currentRoomState
    ? Object.keys(currentRoomState.players)[0] === playerId
    : false;

  const currentPlayers = currentRoomState
    ? Object.values(currentRoomState.players)
    : [];

  return (
    <div
      id="lobby_screen_container"
      className="min-h-screen bg-[#060814] text-slate-100 flex flex-col justify-center items-center p-6 relative overflow-hidden"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 50%, #0c122b 0%, #03040b 100%)`,
      }}
    >
      {/* Decorative Stars Background */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-10 left-1/4 w-1 h-1 bg-white rounded-full animate-ping"></div>
        <div className="absolute top-1/3 left-2/3 w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></div>
        <div className="absolute top-3/4 left-1/5 w-1 h-1 bg-purple-400 rounded-full animate-pulse"></div>
        <div className="absolute top-1/2 left-4/5 w-1 h-1 bg-yellow-200 rounded-full animate-ping"></div>
      </div>

      <div className="w-full max-w-2xl bg-[#090e24]/80 backdrop-blur-md border border-[#1d2d5c] rounded-2xl shadow-2xl p-8 relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 bg-[#111a3e] border border-[#2b3e81] px-4 py-2 rounded-full mb-4">
            <Space className="w-6 h-6 text-emerald-400 animate-spin-slow" />
            <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold">Host 权威多人联机</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400 bg-clip-text text-transparent">
            像素太空卡牌 RTS
          </h1>
          <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
            拖拽派遣舰队，运用强力战术卡牌，在这场服务端执行的实时星战中摧毁敌方的母星。
          </p>
        </div>

        {/* STEP 1: Enter Profile & Select Lobbies */}
        {!currentRoomState ? (
          <div className="space-y-8 animate-fade-in">
            {/* Nickname input */}
            <div className="bg-[#0e1635] border border-[#1c2a5e] p-5 rounded-xl space-y-3">
              <label className="block text-sm font-semibold tracking-wide text-slate-300">
                你的指挥官代号
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  maxLength={16}
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="请输入指挥官昵称..."
                  className="w-full bg-[#070b1d] border border-[#253975] rounded-lg py-3 pl-11 pr-4 text-slate-200 focus:outline-none focus:border-emerald-500 font-medium tracking-wide transition-colors"
                />
              </div>
            </div>

            {/* Quick Create / Join */}
            <form onSubmit={handleJoinCustom} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <input
                  type="text"
                  placeholder="输入房间代码 (如: ASIA-8)"
                  value={customRoomId}
                  onChange={(e) => setCustomRoomId(e.target.value)}
                  className="w-full bg-[#0c122b] border border-[#1e2e60] rounded-lg px-4 py-3 text-slate-200 focus:outline-none focus:border-indigo-500 font-bold uppercase"
                />
              </div>
              <button
                type="submit"
                disabled={!playerName.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg px-6 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Plus className="w-5 h-5" />
                创建/加入
              </button>
            </form>

            <button
              onClick={onStartSinglePlayer}
              disabled={!playerName.trim()}
              className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg px-6 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Bot className="w-5 h-5" />
              离线单机模式（对抗 3 名 AI）
            </button>

            {/* Existing Lobbies list */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">活动中的星域</h3>
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin-slow" /> 自动刷新
                </span>
              </div>

              {lobbies.length === 0 ? (
                <div className="text-center py-8 bg-[#0a0f26] border border-dashed border-[#1c2a5e] rounded-xl text-slate-500 text-sm">
                  目前暂无活跃星域。在上方创建一个吧！
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 max-h-48 overflow-y-auto pr-1">
                  {lobbies.map((lob) => (
                    <div
                      key={lob.roomId}
                      className="flex items-center justify-between p-4 bg-[#0d1433] hover:bg-[#121c46] border border-[#1c2c5f] hover:border-indigo-500 rounded-xl transition-all group"
                    >
                      <div>
                        <div className="font-bold text-slate-200 text-base">{lob.roomId}</div>
                        <div className="text-xs text-slate-400 mt-1">
                          状态:{' '}
                          {lob.gameStarted ? (
                            <span className="text-amber-400 font-semibold">进行中</span>
                          ) : (
                            <span className="text-emerald-400 font-semibold">等待中</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-mono text-slate-300">
                          {lob.playerCount} / {lob.maxPlayers} 玩家
                        </span>
                        <button
                          onClick={() => handleJoinLobby(lob.roomId)}
                          disabled={!playerName.trim() || (lob.gameStarted && lob.playerCount >= lob.maxPlayers)}
                          className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors cursor-pointer"
                        >
                          加入
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* STEP 2: In Lobby, Waiting to Start */
          <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center bg-[#0d1538] border border-[#1b2b5d] px-5 py-3 rounded-xl">
              <div>
                <span className="text-xs text-indigo-400 uppercase tracking-widest font-bold">当前星域大厅</span>
                <h2 className="text-xl font-extrabold text-slate-200">{roomId}</h2>
              </div>
              <button
                onClick={onLeaveRoom}
                className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg text-xs flex items-center gap-1 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                退出大厅
              </button>
            </div>

            {/* Players slots */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">就绪指挥官 ({currentPlayers.length} / 4)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {currentPlayers.map((p, idx) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-4 bg-[#0a102b] border border-[#1d2e61] rounded-xl relative"
                  >
                    <div
                      className="w-3.5 h-3.5 rounded-full"
                      style={{
                        backgroundColor: p.isBot
                          ? '#888888'
                          : ['#10b981', '#f59e0b', '#3b82f6', '#ec4899'][idx % 4],
                      }}
                    />
                    <div className="flex-1">
                      <div className="font-bold text-slate-200 flex items-center gap-1.5">
                        {p.name}
                        {p.id === playerId && (
                          <span className="text-[10px] bg-indigo-900 text-indigo-300 px-1.5 py-0.5 rounded font-mono font-bold">你</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {p.isBot ? '🤖 智能电脑 AI' : '📡 远程主控端'}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Fill empty slots with placeholder */}
                {Array.from({ length: Math.max(0, 4 - currentPlayers.length) }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-center p-4 border border-dashed border-[#16224d] rounded-xl text-slate-600 text-xs font-semibold select-none"
                  >
                    等待席位...
                  </div>
                ))}
              </div>
            </div>

            {/* Lobby Controls */}
            <div className="pt-4 flex flex-col sm:flex-row gap-4">
              <button
                onClick={onAddBot}
                disabled={!isLobbyOwner || currentPlayers.length >= 4}
                className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 border border-slate-700 font-bold rounded-lg px-5 py-3.5 flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Bot className="w-5 h-5 text-indigo-400" />
                添加电脑 AI
              </button>

              <button
                onClick={onStartGame}
                disabled={!isLobbyOwner || currentPlayers.length === 0}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold rounded-lg px-6 py-3.5 flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-colors cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" />
                开始星际战役
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
