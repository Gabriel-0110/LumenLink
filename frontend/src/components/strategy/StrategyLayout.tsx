import { Outlet } from 'react-router-dom';
import { StrategyStatusBar } from './StrategyStatusBar';
import { StrategyTabNav } from './StrategyTabNav';

export function StrategyLayout() {
  return (
    <div className="flex flex-col h-full -m-5">
      <StrategyStatusBar />
      <StrategyTabNav />
      <div className="flex-1 overflow-y-auto p-5">
        <Outlet />
      </div>
    </div>
  );
}
