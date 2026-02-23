import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  CandlestickChart,
  Brain,
  ShieldAlert,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { useDashboardStore } from '../../store/dashboardStore';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: <LayoutDashboard size={20} /> },
  { label: 'Trading', path: '/trading', icon: <CandlestickChart size={20} /> },
  { label: 'Strategy', path: '/strategy', icon: <Brain size={20} /> },
  { label: 'Risk', path: '/risk', icon: <ShieldAlert size={20} /> },
  { label: 'Reports', path: '/reports', icon: <BarChart3 size={20} /> },
  { label: 'Settings', path: '/settings', icon: <Settings size={20} /> },
];

export function Sidebar() {
  const collapsed = useDashboardStore((s) => s.sidebarCollapsed);
  const toggle = useDashboardStore((s) => s.toggleSidebar);

  return (
    <aside
      className={`
        flex flex-col h-screen bg-surface border-r border-border
        transition-all duration-300 ease-in-out shrink-0
        ${collapsed ? 'w-[68px]' : 'w-[220px]'}
      `}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-[60px] border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
          <Zap size={18} className="text-brand" />
        </div>
        {!collapsed && (
          <span className="font-extrabold text-sm tracking-wide">
            <span className="text-brand">Lumen</span>
            <span className="text-text">Link</span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-input text-sm font-medium
               transition-colors cursor-pointer min-h-[44px]
               ${
                 isActive
                   ? 'bg-brand/10 text-brand'
                   : 'text-muted hover:bg-surface2 hover:text-text'
               }
               ${collapsed ? 'justify-center' : ''}
              `
            }
            title={collapsed ? item.label : undefined}
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        className="flex items-center justify-center h-[48px] border-t border-border
                   text-muted hover:text-text hover:bg-surface2
                   transition-colors cursor-pointer"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    </aside>
  );
}
