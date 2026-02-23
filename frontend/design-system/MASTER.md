# LumenLink Design System - Master

## Brand Identity
- **Name**: LumenLink
- **Tagline**: Intelligent Crypto Trading
- **Personality**: Professional, trustworthy, precise, data-driven

## Color Palette

### Core Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | #0a0e17 | Page background |
| `--surface` | #111827 | Card backgrounds |
| `--surface2` | #1a2235 | Nested surfaces, table headers |
| `--border` | #1e2d40 | Borders, dividers |
| `--text` | #e2e8f0 | Primary text |
| `--muted` | #64748b | Secondary text, labels |

### Semantic Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--primary` | #06b6d4 | Brand, links, active states, primary actions |
| `--success` | #10b981 | Profit, buy signals, positive changes |
| `--danger` | #ef4444 | Loss, sell signals, errors, kill switch |
| `--warning` | #f59e0b | Caution, pending states, approaching limits |
| `--info` | #3b82f6 | Informational, paper mode badge |
| `--purple` | #8b5cf6 | Strategy, regime detection |

### Color Usage Rules
- Green = profit/positive/buy ONLY
- Red = loss/negative/sell/danger ONLY
- Never use color as sole indicator - always pair with icon or text
- Pill backgrounds: color at 13% opacity (e.g., #10b98120)

## Typography

### Font Stack
```css
font-family: 'Inter', -apple-system, system-ui, sans-serif;
```

### Scale
| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| H1 (page title) | 1.5rem | 800 | 1.2 |
| H2 (section) | 1.1rem | 700 | 1.3 |
| Card value | 1.55rem | 700 | 1.0 |
| Ticker price | 2rem | 800 | 1.0 |
| Body text | 0.85rem | 400 | 1.5 |
| Label/caption | 0.68rem | 600 | 1.4 |
| Table text | 0.82rem | 400 | 1.4 |
| Monospace data | 0.8rem | 500 | 1.4 |

### Label Style
- ALL CAPS for card labels and section headers
- Letter spacing: 0.8px
- Color: var(--muted)

## Spacing

### Base Unit: 4px
| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Tight gaps |
| sm | 8px | Icon gaps, pill padding |
| md | 12px | Card internal spacing |
| lg | 16px | Grid gaps |
| xl | 20px | Card padding, section spacing |
| 2xl | 24px | Page padding, major sections |

## Components

### Cards
- Background: var(--surface)
- Border: 1px solid var(--border)
- Border radius: 12px
- Padding: 18px 20px
- Optional accent bar: 3px left border with semantic color

### Pills / Badges
- Border radius: 6px
- Padding: 2px 8px
- Font size: 0.7rem
- Font weight: 700
- Background: semantic color at 13-20% opacity
- Text: semantic color at full opacity

### Tables
- Header bg: var(--surface2)
- Header text: var(--muted), uppercase, 0.68rem
- Row border: 1px solid var(--border)
- Row hover: #ffffff08
- Cell padding: 9px 14px

### Buttons
- Primary: bg var(--primary), text white, hover darken 10%
- Danger: bg var(--danger), text white
- Ghost: transparent bg, border 1px solid var(--border), hover var(--surface2)
- Border radius: 8px
- Min height: 44px (touch target)
- Cursor: pointer ALWAYS

### Meters / Progress Bars
- Track: var(--surface2), 6px height, rounded 4px
- Fill: semantic color, transition width 0.5s ease
- Label: flex justify-between above bar

### Input Fields
- Background: var(--surface2)
- Border: 1px solid var(--border)
- Border radius: 8px
- Focus: border-color var(--primary), outline ring
- Padding: 10px 14px
- Min height: 44px

## Charts

### Candlestick (TradingView lightweight-charts)
- Up candle: var(--success) body, var(--success) wick
- Down candle: var(--danger) body, var(--danger) wick
- Grid: var(--border)
- Crosshair: var(--muted)
- Background: transparent

### Line Charts
- Primary line: var(--primary), 2px width
- Fill: primary at 6% opacity
- Tension: 0.3 (smooth)
- Points: hidden, show on hover (4px radius)

### Bar Charts
- Positive: var(--success) at 70% opacity
- Negative: var(--danger) at 70% opacity
- Border radius: 5px (borderSkipped: false)

### Gauge (Fear & Greed)
- SVG-based with needle rotation
- Arc segments for zones
- Extreme Fear: var(--danger)
- Fear: var(--warning)
- Neutral: var(--muted)
- Greed: var(--success)
- Extreme Greed: var(--primary)

## Layout

### Page Structure
```
┌─────────────────────────────────────────┐
│ Header (sticky top, z-100)              │
├──────┬──────────────────────────────────┤
│      │                                  │
│ Side │     Main Content Area            │
│ bar  │     (scrollable)                 │
│      │                                  │
│ 64px │     padding: 20px 24px           │
│      │     gap: 20px between sections   │
│      │                                  │
└──────┴──────────────────────────────────┘
```

### Grid System
- 2-col: `grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))`
- 3-col: `grid-template-columns: 2fr 1fr 1fr`
- 4-col: `grid-template-columns: 3fr 1fr`
- Gap: 16px
- Mobile breakpoint: 900px → single column

### Responsive Breakpoints
| Breakpoint | Layout |
|-----------|--------|
| < 640px | Single column, collapsed sidebar |
| 640-900px | Stacked grids |
| 900-1280px | Standard layout |
| > 1280px | Full dashboard |

## Animation

### Transitions
- Micro-interactions: 150-200ms ease
- Layout changes: 300ms ease
- Chart updates: 'none' (instant for data refresh)
- Respect `prefers-reduced-motion`

### Specific Animations
- Refresh dot pulse: 2s infinite (opacity 1 → 0.3)
- Meter fill: width 0.5s ease
- Hover states: background-color 200ms ease

## Icons
- Library: Lucide React
- Size: 20px default, 16px small, 24px large
- Color: currentColor (inherits text color)
- NO EMOJIS in production UI (use Lucide equivalents)

## Accessibility
- Minimum contrast: 4.5:1 for text, 3:1 for large text
- Focus visible: 2px solid var(--primary), offset 2px
- All interactive elements: cursor-pointer
- Touch targets: minimum 44x44px
- Screen reader: aria-label on icon-only buttons
- Tab order: matches visual order
