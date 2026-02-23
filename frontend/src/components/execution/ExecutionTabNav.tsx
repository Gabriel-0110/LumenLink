import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  Layers,
  ClipboardList,
  Receipt,
  SlidersHorizontal,
  Signal,
  BookOpen,
  GitCompare,
  BarChart3,
  Bell,
} from 'lucide-react';
import type { ExecutionTab } from '../../types/execution';

const tabs: ExecutionTab[] = [
  { label: 'Overview', path: '/execution', icon: <LayoutGrid size={15} /> },
  { label: 'Positions', path: '/execution/positions', icon: <Layers size={15} /> },
  { label: 'Orders', path: '/execution/orders', icon: <ClipboardList size={15} /> },
  { label: 'Executions', path: '/execution/fills', icon: <Receipt size={15} /> },
  { label: 'Signals', path: '/execution/signals', icon: <Signal size={15} /> },
  { label: 'Controls', path: '/execution/controls', icon: <SlidersHorizontal size={15} /> },
  { label: 'Journal', path: '/execution/journal', icon: <BookOpen size={15} /> },
  { label: 'Reconciliation', path: '/execution/reconciliation', icon: <GitCompare size={15} /> },
  { label: 'Performance', path: '/execution/performance', icon: <BarChart3 size={15} /> },
  { label: 'Alerts', path: '/execution/alerts', icon: <Bell size={15} /> },
];

export function ExecutionTabNav() {
  return (
    <nav className="flex items-center gap-0.5 px-5 bg-surface border-b border-border overflow-x-auto shrink-0">
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.path === '/execution'}
          className={({ isActive }) =>
            `flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap
             border-b-2 transition-colors cursor-pointer
             ${
               isActive
                 ? 'border-brand text-brand'
                 : 'border-transparent text-muted hover:text-text hover:border-border'
             }`
          }
        >
          {tab.icon}
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
