import React, { useRef, useEffect } from 'react';
import { Terminal, ShieldAlert } from 'lucide-react';

interface GameLogsProps {
  logs: string[];
}

export default function GameLogs({ logs }: GameLogsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to top when a new log enters (logs are unshifted, so newest is index 0)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [logs]);

  return (
    <div
      id="game_logs_container"
      className="bg-[#090e24]/85 border border-[#1b2b5d] p-5 rounded-2xl shadow-xl backdrop-blur-md flex flex-col h-full h-[600px]"
    >
      <div className="flex items-center gap-2 pb-3 border-b border-[#1b2b5d] mb-3">
        <Terminal className="w-4 h-4 text-emerald-400" />
        <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-200">
          星际战役通讯日志
        </h3>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-indigo-900 scrollbar-track-transparent"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 text-xs text-center py-20 italic">
            星轨静默中，暂无战术日志汇报...
          </div>
        ) : (
          logs.map((log, index) => {
            // Emphasize alerts or victories
            const isAlert = log.includes('💀') || log.includes('摧毁') || log.includes('击毁');
            const isVictory = log.includes('🎉') || log.includes('🏆') || log.includes('占领');
            const isBotLog = log.includes('🤖');

            let logColor = 'text-slate-300';
            if (isAlert) logColor = 'text-rose-400 font-medium';
            else if (isVictory) logColor = 'text-emerald-400 font-bold';
            else if (isBotLog) logColor = 'text-indigo-300';

            return (
              <div
                key={index}
                className={`p-2 rounded-lg bg-[#070b1f]/60 border ${
                  isAlert
                    ? 'border-rose-900/30'
                    : isVictory
                    ? 'border-emerald-900/30'
                    : 'border-[#1b2b5d]/30'
                } text-[11px] leading-relaxed transition-all hover:bg-[#070b1f]`}
              >
                <div className={`${logColor} flex items-start gap-1.5`}>
                  {isAlert && <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-500" />}
                  <span>{log}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
