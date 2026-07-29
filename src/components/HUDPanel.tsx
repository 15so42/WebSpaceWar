import React from 'react';
import { GameState, ShipType, ShipState } from '../types';
import { SHIP_CONFIGS } from '../gameEngine';
import { Shield, Hammer, Compass, Award, LifeBuoy } from 'lucide-react';

interface HUDPanelProps {
  state: GameState;
  playerId: string;
}

export default function HUDPanel({ state, playerId }: HUDPanelProps) {
  const me = state.players[playerId];
  if (!me) return null;

  // Calculate my empire fleet statistics
  const myShips = Object.values(state.ships).filter((s) => s.ownerId === playerId);

  const scouts = myShips.filter((s) => s.type === ShipType.SCOUT);
  const frigates = myShips.filter((s) => s.type === ShipType.FRIGATE);
  const dreadnoughts = myShips.filter((s) => s.type === ShipType.DREADNOUGHT);
  const spies = myShips.filter((s) => s.type === ShipType.SPY);

  const idleScouts = scouts.filter((s) => s.state === ShipState.ORBIT).length;
  const miningScouts = scouts.filter((s) => s.state === ShipState.MINING).length;
  const travellingScouts = scouts.filter((s) => s.state === ShipState.MOVING).length;

  const idleDreads = dreadnoughts.filter((s) => s.state === ShipState.ORBIT).length;
  const travellingDreads = dreadnoughts.filter((s) => s.state === ShipState.MOVING).length;

  // Find other players in game
  const opponents = Object.values(state.players).filter((p) => p.id !== playerId);

  return (
    <div id="hud_panel" className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-[#090e24]/85 border border-[#1b2b5d] p-6 rounded-2xl shadow-xl backdrop-blur-md">
      {/* 1. Resources & Core Health */}
      <div className="space-y-4">
        <h4 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400 flex items-center gap-1.5">
          <Award className="w-4 h-4 text-emerald-400" />
          资源 & 母星防御
        </h4>

        <div className="grid grid-cols-2 gap-3">
          {/* Minerals */}
          <div className="p-4 bg-[#0a102e] border border-[#1d2d60] rounded-xl flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">晶体矿 (Minerals)</span>
              <span className="text-2xl font-black text-emerald-400 font-mono mt-0.5 block">
                {Math.floor(me.minerals)}
              </span>
            </div>
            <span className="text-2xl">💎</span>
          </div>

          {/* Tech points */}
          <div className="p-4 bg-[#0a102e] border border-[#1d2d60] rounded-xl flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">科技点 (Tech Points)</span>
              <span className="text-2xl font-black text-indigo-400 font-mono mt-0.5 block">
                {Math.floor(me.techPoints)}
              </span>
            </div>
            <span className="text-2xl">🧬</span>
          </div>
        </div>

        {/* Home HP progress */}
        <div className="p-4 bg-[#0a102e] border border-[#1d2d60] rounded-xl space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-bold text-slate-300">母星能量护盾</span>
            <span className={`font-mono font-bold ${me.homePlanetHp > 30 ? 'text-emerald-400' : 'text-rose-500'}`}>
              {Math.floor(me.homePlanetHp)} / 100 HP
            </span>
          </div>
          <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-[#23346d]">
            <div
              className={`h-full transition-all duration-300 ${
                me.homePlanetHp > 40
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-400'
                  : 'bg-gradient-to-r from-rose-600 to-pink-500 animate-pulse'
              }`}
              style={{ width: `${me.homePlanetHp}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. Fleet Logistics Allocation */}
      <div className="space-y-4">
        <h4 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400 flex items-center gap-1.5">
          <Hammer className="w-4 h-4 text-sky-400" />
          舰队编制与后勤
        </h4>

        <div className="grid grid-cols-2 gap-3 text-xs">
          {/* Explorers */}
          <div className="p-3 bg-[#0a102e] border border-[#1a2855] rounded-xl space-y-1.5">
            <div className="flex justify-between items-center font-bold text-slate-300">
              <span>探索船 (Scouts)</span>
              <span className="font-mono text-emerald-400 text-sm">{scouts.length}</span>
            </div>
            <div className="text-[10px] text-slate-500 space-y-0.5">
              <div className="flex justify-between">
                <span>空闲轨道:</span> <span className="font-mono text-slate-400">{idleScouts}</span>
              </div>
              <div className="flex justify-between">
                <span>深空采矿:</span> <span className="font-mono text-amber-500">{miningScouts}</span>
              </div>
              <div className="flex justify-between">
                <span>航行迁徙:</span> <span className="font-mono text-sky-400">{travellingScouts}</span>
              </div>
            </div>
          </div>

          {/* Dreadnoughts */}
          <div className="p-3 bg-[#0a102e] border border-[#1a2855] rounded-xl space-y-1.5">
            <div className="flex justify-between items-center font-bold text-slate-300">
              <span>主力舰 (Dreads)</span>
              <span className="font-mono text-rose-400 text-sm">{dreadnoughts.length}</span>
            </div>
            <div className="text-[10px] text-slate-500 space-y-0.5">
              <div className="flex justify-between">
                <span>驻防闲置:</span> <span className="font-mono text-slate-400">{idleDreads}</span>
              </div>
              <div className="flex justify-between">
                <span>跃迁突袭:</span> <span className="font-mono text-rose-500">{travellingDreads}</span>
              </div>
              <div className="flex justify-between">
                <span>护卫舰(驻母星):</span> <span className="font-mono text-amber-400">{frigates.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Spy metrics */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-purple-950/20 border border-purple-900/40 rounded-xl text-xs">
          <span className="font-bold text-purple-300">🕵️ 影子行动：间谍船</span>
          <span className="font-mono font-bold text-purple-400">目前存活: {spies.length} 艘</span>
        </div>
      </div>

      {/* 3. Star-map Intelligence Summary */}
      <div className="space-y-4">
        <h4 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400 flex items-center gap-1.5">
          <Compass className="w-4 h-4 text-amber-400" />
          全星系雷达情报
        </h4>

        <div className="space-y-2.5 overflow-y-auto max-h-[148px] pr-1">
          {opponents.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">
              无其他敌方势力情报。
            </div>
          ) : (
            opponents.map((opp) => (
              <div
                key={opp.id}
                className="flex items-center justify-between p-3 bg-[#0a102e] border border-[#1a2855] rounded-xl text-xs"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: opp.factionId }}
                  />
                  <span className="font-bold text-slate-300">
                    {opp.name} {opp.isBot && '(AI)'}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`font-bold font-mono ${opp.isAlive ? 'text-emerald-400' : 'text-rose-500'}`}>
                    {opp.isAlive ? `${Math.floor(opp.homePlanetHp)} HP` : '💀 已覆灭'}
                  </span>
                  {opp.isAlive && (
                    <span className="text-[10px] bg-[#111631] border border-[#212c60] text-slate-400 px-1.5 py-0.5 rounded font-mono">
                      {Math.floor(opp.minerals)} 💎
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
