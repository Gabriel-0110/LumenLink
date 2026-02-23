interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

interface FilterBarProps {
  options: FilterOption[];
  selected: string;
  onChange: (value: string) => void;
}

export function FilterBar({ options, selected, onChange }: FilterBarProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {options.map((opt) => {
        const isActive = opt.value === selected;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`pill gap-1 cursor-pointer transition-colors ${
              isActive
                ? 'bg-brand/15 text-brand'
                : 'bg-surface2 text-muted hover:bg-surface2/80 hover:text-text'
            }`}
          >
            {opt.label}
            {opt.count != null && (
              <span
                className={`text-[0.6rem] ml-0.5 px-1 rounded-full ${
                  isActive ? 'bg-brand/20' : 'bg-muted/20'
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
