import { Outlet } from 'react-router-dom';
import { ExecutionStatusBar } from './ExecutionStatusBar';
import { ExecutionTabNav } from './ExecutionTabNav';

export function ExecutionLayout() {
  return (
    <div className="flex flex-col h-full -m-5">
      <ExecutionStatusBar />
      <ExecutionTabNav />
      <div className="flex-1 overflow-y-auto p-5">
        <Outlet />
      </div>
    </div>
  );
}
