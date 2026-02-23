import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  Globe,
  BarChart3,
  Settings2,
  Trophy,
} from 'lucide-react';
import type { StrategyTab } from '../../types/strategy';

const tabs: StrategyTab[] = [
  { label: 'Overview', path: '/strategy', icon: <LayoutGrid size={15} /> },
  { label: 'Market State', path: '/strategy/market', icon: <Globe size={15} /> },
  { label: 'Decisions', path: '/strategy/decisions', icon: <BarChart3 size={15} /> },
  { label: 'Attribution', path: '/strategy/attribution', icon: <Trophy size={15} /> },
  { label: 'Governance', path: '/strategy/governance', icon: <Settings2 size={15} /> },
];

export function StrategyTabNav() {
  return (
    <nav className="flex items-center gap-0.5 px-5 bg-surface border-b border-border overflow-x-auto shrink-0">
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.path === '/strategy'}
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
