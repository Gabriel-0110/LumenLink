import type { ReactNode } from 'react';

export interface ExecutionTab {
  label: string;
  path: string;
  icon: ReactNode;
  badgeKey?: string;
}
