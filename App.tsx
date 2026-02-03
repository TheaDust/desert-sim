import React, { useState, useCallback } from 'react';
import SimulationCanvas from './components/SimulationCanvas';
import { HandGesture, SimulationStats } from './types';
import { Activity, Hand, Sparkles, RefreshCw } from 'lucide-react';

const App: React.FC = () => {
  const [stats, setStats] = useState<SimulationStats>({
    fps: 0,
    particleCount: 0,
    gesture: HandGesture.NONE,
  });

  const [sliderValue, setSliderValue] = useState(8000);
  const [activeParticleCount, setActiveParticleCount] = useState(8000);
  const [simulationKey, setSimulationKey] = useState(0);

  const handleReload = () => {
    setActiveParticleCount(sliderValue);
    setSimulationKey(prev => prev + 1);
  };

  const handleStatsUpdate = useCallback((newStats: SimulationStats) => {
    setStats(newStats);
  }, []);

  const getGestureLabel = (gesture: HandGesture) => {
    switch (gesture) {
      case HandGesture.OPEN_PALM: return 'Open Palm (Repel)';
      case HandGesture.CLOSED_FIST: return 'Closed Fist (Attract)';
      default: return 'No Hand Detected';
    }
  };

  const getGestureColor = (gesture: HandGesture) => {
    switch (gesture) {
      case HandGesture.OPEN_PALM: return 'text-amber-400';
      case HandGesture.CLOSED_FIST: return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-zinc-950">
      {/* Simulation Layer - Key forces remount on reload */}
      <div className="absolute inset-0 z-0">
        <SimulationCanvas 
          key={simulationKey}
          particleCount={activeParticleCount}
          onStatsUpdate={handleStatsUpdate} 
        />
      </div>

      {/* UI Overlay */}
      <div className="absolute top-0 left-0 p-6 z-10 pointer-events-none w-full max-w-md">
        <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-xl p-4 shadow-xl pointer-events-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-200 to-yellow-600">
              Desert Gold
            </h1>
            <div className="flex items-center space-x-2 text-xs text-zinc-500 font-mono">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <span>LIVE</span>
            </div>
          </div>

          <div className="space-y-3">
            {/* Gesture Status */}
            <div className="flex items-center justify-between p-2 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
              <div className="flex items-center space-x-2">
                <Hand className={`w-4 h-4 ${getGestureColor(stats.gesture)}`} />
                <span className="text-sm text-zinc-300 font-medium">Gesture</span>
              </div>
              <span className={`text-sm font-mono font-bold ${getGestureColor(stats.gesture)}`}>
                {getGestureLabel(stats.gesture)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Particle Count */}
              <div className="flex flex-col p-2 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
                <div className="flex items-center space-x-2 mb-1">
                  <Sparkles className="w-3 h-3 text-zinc-400" />
                  <span className="text-xs text-zinc-400 uppercase tracking-wider">Particles</span>
                </div>
                <span className="text-lg font-mono text-zinc-200">
                  {stats.particleCount.toLocaleString()}
                </span>
              </div>

              {/* FPS */}
              <div className="flex flex-col p-2 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
                <div className="flex items-center space-x-2 mb-1">
                  <Activity className="w-3 h-3 text-zinc-400" />
                  <span className="text-xs text-zinc-400 uppercase tracking-wider">FPS</span>
                </div>
                <span className={`text-lg font-mono ${stats.fps > 50 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {stats.fps}
                </span>
              </div>
            </div>

            {/* Config Controls */}
            <div className="pt-3 border-t border-zinc-800">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs text-zinc-400 uppercase tracking-wider">Target Count</label>
                <span className="text-xs font-mono text-amber-400">{sliderValue.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min="1000"
                max="15000"
                step="500"
                value={sliderValue}
                onChange={(e) => setSliderValue(Number(e.target.value))}
                className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500 mb-3"
              />
              <button
                onClick={handleReload}
                className="w-full flex items-center justify-center space-x-2 py-2 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors border border-zinc-700"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reload Simulation</span>
              </button>
            </div>
          </div>
          
          <div className="mt-4 text-xs text-zinc-600 border-t border-zinc-800 pt-3">
             <p>Controls:</p>
             <ul className="list-disc pl-4 mt-1 space-y-1">
               <li><span className="text-amber-500">Open Hand</span>: Wind / Repel sand</li>
               <li><span className="text-red-500">Closed Fist</span>: Gravity Well / Attract</li>
               <li>Move hand to drag particles with velocity</li>
             </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;