import type { CSSProperties } from 'react';

export function Checkmark({
  size = 40,
  fill = 'none',
  stroke = 'var(--ink)',
  strokeWidth = 8,
  style,
}: {
  size?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={style} aria-hidden>
      <polyline
        points="20,52 42,74 82,28"
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export type ShapeKind = 'triangle' | 'diamond' | 'circle' | 'square';

export const CHANNELS: Array<{
  key: ShapeKind;
  color: string;
  label: string;
  number: string;
}> = [
  { key: 'triangle', color: 'var(--vermilion)', label: 'TRIANGLE', number: '01' },
  { key: 'diamond', color: 'var(--cobalt)', label: 'DIAMOND', number: '02' },
  { key: 'circle', color: 'var(--marigold)', label: 'CIRCLE', number: '03' },
  { key: 'square', color: 'var(--ivy)', label: 'SQUARE', number: '04' },
];

export function Shape({
  kind,
  size = 40,
  fill = 'currentColor',
  stroke = 'var(--ink)',
  strokeWidth = 2,
  style,
}: {
  kind: ShapeKind;
  size?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 100 100',
    style,
    'aria-hidden': true,
  } as const;

  switch (kind) {
    case 'triangle':
      return (
        <svg {...common}>
          <polygon
            points="50,10 92,86 8,86"
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="miter"
          />
        </svg>
      );
    case 'diamond':
      return (
        <svg {...common}>
          <polygon
            points="50,8 92,50 50,92 8,50"
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="miter"
          />
        </svg>
      );
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        </svg>
      );
    case 'square':
      return (
        <svg {...common}>
          <rect
            x="10"
            y="10"
            width="80"
            height="80"
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        </svg>
      );
  }
}
