import React from 'react';
import { GameState, CardInstance, CardType } from '../types';
import { CARD_DEFINITIONS } from '../cardsData';
import { getCardMineralCost } from '../gameEngine';
import { Coins } from 'lucide-react';

interface CardDeckProps {
  state: GameState;
  playerId: string;
  selectedCardId: string | null;
  setSelectedCardId: (id: string | null) => void;
  onPlayCardDirect: (cardInstanceId: string) => void;
}

export default function CardDeck({
  state,
  playerId,
  selectedCardId,
  setSelectedCardId,
  onPlayCardDirect,
}: CardDeckProps) {
  const player = state.players[playerId];
  if (!player) return null;

  const handleCardClick = (card: CardInstance, def: any) => {
    if (def.type === CardType.ABILITY) {
      return;
    }

    // Only Purge needs a target planet now, Blood Sacrifice is an instant direct conversion card
    if (def.id === 'purge') {
      if (selectedCardId === card.id) {
        setSelectedCardId(null);
      } else {
        setSelectedCardId(card.id);
      }
    } else {
      // Instant action cards played immediately
      onPlayCardDirect(card.id);
    }
  };

  return (
    <div
      id="card_deck_container"
      className="bg-[#05081b]/90 border border-indigo-500/40 p-3 rounded-2xl shadow-2xl shadow-indigo-950/80 backdrop-blur-md"
    >
      <div className="flex justify-between items-center mb-1.5 px-1 text-[10px] text-slate-400 font-bold">
        <span className="text-indigo-400 flex items-center gap-1 uppercase tracking-wider">
          <Coins className="w-3 h-3 text-emerald-400" />
          星际战术卡牌库
        </span>
        <span className="font-mono">
          可用: <b className="text-emerald-400">{Math.floor(player.minerals)} 💎</b> /{' '}
          <b className="text-indigo-400">{Math.floor(player.techPoints)} 🧬</b>
        </span>
      </div>

      {player.hand.length === 0 ? (
        <div className="text-center py-4 text-slate-500 text-xs border border-dashed border-[#1a254c] rounded-xl font-mono">
          [ 战术卡牌筹备中... ]
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-indigo-950 scrollbar-track-transparent">
          {player.hand.map((card) => {
            const def = CARD_DEFINITIONS[card.definitionId];
            if (!def) return null;

            const actualMineralCost = getCardMineralCost(def.id, player);
            const actualTechCost = def.costTech;

            const canAfford =
              player.minerals >= actualMineralCost && player.techPoints >= actualTechCost;

            const isSelected = selectedCardId === card.id;

            // Color classes based on type
            let cardBorderClass = 'border-[#1e2e60] hover:border-indigo-500';
            let cardBg = 'bg-[#080c21]';
            let typeLabel = '战术事件';
            let iconColor = 'text-sky-400';

            if (def.type === CardType.CONTINUOUS) {
              cardBorderClass = 'border-amber-900/60 hover:border-amber-500';
              cardBg = 'bg-[#100b03]';
              typeLabel = '持续增益';
              iconColor = 'text-amber-400';
            } else if (def.type === CardType.ABILITY) {
              cardBorderClass = 'border-purple-900/60 hover:border-purple-500';
              cardBg = 'bg-[#0f071f]';
              typeLabel = '被动能力';
              iconColor = 'text-purple-400';
            }

            if (isSelected) {
              cardBorderClass = 'border-rose-500 animate-pulse bg-rose-950/10';
            }

            return (
              <button
                key={card.id}
                onClick={() => handleCardClick(card, def)}
                disabled={(!canAfford && def.type !== CardType.ABILITY) || def.type === CardType.ABILITY}
                className={`relative p-2.5 border ${cardBorderClass} ${cardBg} ${
                  canAfford ? 'opacity-100 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                } rounded-xl shadow-lg text-left flex flex-col justify-between w-[115px] sm:w-[125px] h-[132px] shrink-0 group transition-all transform hover:-translate-y-1.5`}
                id={`card_button_${card.id}`}
              >
                {/* Header */}
                <div>
                  <div className="flex justify-between items-start gap-1">
                    <span className="text-slate-100 font-extrabold text-[11px] truncate group-hover:text-white">
                      {def.name}
                    </span>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      {actualMineralCost > 0 && (
                        <span className="text-[8px] bg-emerald-950/80 text-emerald-300 border border-emerald-900 px-0.5 py-0.2 rounded font-black font-mono">
                          {actualMineralCost}💎
                        </span>
                      )}
                      {actualTechCost > 0 && (
                        <span className="text-[8px] bg-indigo-950/80 text-indigo-300 border border-indigo-900 px-0.5 py-0.2 rounded font-black font-mono">
                          {actualTechCost}🧬
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-[7.5px] font-bold tracking-wider uppercase ${iconColor} block mt-0.5`}>
                    {typeLabel}
                  </span>
                </div>

                {/* Body */}
                <p className="text-slate-400 text-[9px] leading-snug my-1.5 flex-1 overflow-hidden line-clamp-3">
                  {def.description}
                </p>

                {/* Footer */}
                <div className="text-[8px] text-right font-bold w-full leading-none mt-1">
                  {def.id === 'purge' ? (
                    <span className="text-rose-400 animate-pulse">⚡ 选择目标</span>
                  ) : def.type === CardType.ABILITY ? (
                    <span className="text-purple-400">✨ 被动加成</span>
                  ) : (
                    <span className="text-emerald-400 group-hover:underline">立即施放</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
