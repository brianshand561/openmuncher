/**
 * ASCII mascots for OpenMuncher. Each mascot has:
 *  - frames: array of multi-line ASCII strings shown in sequence (TTY animation)
 *  - trophy: a single static frame embedded in the stats footer (always visible)
 *  - color: ANSI 256-color escape applied to all frames
 *
 * Random selection happens once per CLI invocation — see pickMascot().
 * Designs are deliberately compact (≤ 6 lines tall) to fit in narrow terminals.
 */

const RESET = '\x1b[0m';
const ansi = (code: string) => `\x1b[${code}m`;

const COLORS = {
  green: ansi('38;5;34'),
  brown: ansi('38;5;130'),
  orange: ansi('38;5;208'),
  red: ansi('38;5;196'),
  yellow: ansi('38;5;220'),
  gray: ansi('38;5;244'),
} as const;

export interface Mascot {
  name: string;
  color: string;
  frames: string[];
  trophy: string;
}

const WOODCHIPPER: Mascot = {
  name: 'Woodchipper',
  color: COLORS.gray,
  frames: [
    String.raw`
       _____
      /     \    🪵
     | () () |  /
     | \===/ | /
      \_____/
        | |
       /___\
`,
    String.raw`
       _____
      /     \   🪵
     | (>_<) |/
     | \===/ |~
      \_____/  ✨
        | |
       /___\
`,
    String.raw`
       _____
      /  X  \   ·
     | (×_×) |💨
     | \===/ |
      \_____/  ·
        | |
       /___\   ·
`,
    String.raw`
       _____
      /     \  💨💨💨
     | (^_^) |
     | \===/ |  💨
      \_____/
        | |
       /___\
`,
  ],
  trophy: String.raw`
       _____
      /     \
     | (^_^) |   shredded.
     | \===/ |
      \_____/`,
};

const BEAVER: Mascot = {
  name: 'Beaver',
  color: COLORS.brown,
  frames: [
    String.raw`
        __
      /'  '\__         🪵
     ( o  o    )______/
      \  ⌒    /
       '----'
       //  \\
`,
    String.raw`
        __
      /'CHOMP\        🪵
     ( o  o    )=====/
      \  ⌣    /  ✨
       '----'
       //  \\
`,
    String.raw`
        __
      /'  '\__       🪵·
     ( ^  ^    )==/   ·
      \  ⌣    /  💨
       '----'
       //  \\   ·
`,
    String.raw`
        __
      /'  '\__
     ( -  -    )       💨
      \  ⌒    /  💨💨
       '----'
       //  \\
`,
  ],
  trophy: String.raw`
        __
      /'  '\__
     ( o  o    )      gnawed.
      \  ⌣    /
       '----'`,
};

const FURNACE: Mascot = {
  name: 'Furnace',
  color: COLORS.orange,
  frames: [
    String.raw`
      ┌──────┐         📜
      │ ░░░░ │        /
      │ ░░░░ │═══════/
      │██████│
      └──┬┬──┘
         ││
`,
    String.raw`
      ┌──────┐    🔥
      │ ▒▒▒▒ │  📜
      │ ▒▒▒▒ │∼∼/
      │██████│
      └──┬┬──┘   🔥
         ││
`,
    String.raw`
      ┌──────┐  🔥🔥
      │ ▓▓▓▓ │ 🔥
      │ ▓▓▓▓ │
      │██████│  🔥
      └──┬┬──┘ 🔥🔥
         ││
`,
    String.raw`
      ┌──────┐
      │ ████ │   ·  💨
      │ ████ │  ash
      │██████│   ·
      └──┬┬──┘
         ││
`,
  ],
  trophy: String.raw`
      ┌──────┐
      │ ▓▓▓▓ │     incinerated.
      │██████│
      └──┬┬──┘`,
};

const COMPACTOR: Mascot = {
  name: 'Compactor',
  color: COLORS.gray,
  frames: [
    String.raw`
     ╔══════════╗
     ║          ║       💵
     ║ ▼      ▼ ║      /
     ║          ║═════/
     ║          ║
     ╚══════════╝
`,
    String.raw`
     ╔══════════╗
     ║▼▼▼▼▼▼▼▼▼▼║
     ║          ║   💵
     ║          ║~ /
     ║          ║
     ╚══════════╝
`,
    String.raw`
     ╔══════════╗
     ║██████████║
     ║██████████║
     ║██████████║   ·
     ║██████████║
     ╚══════════╝
`,
    String.raw`
     ╔══════════╗
     ║██▓██▓██▓█║   *crunch*
     ║██▓██▓██▓█║
     ║▲▲▲▲▲▲▲▲▲▲║
     ║          ║
     ╚══════════╝
`,
  ],
  trophy: String.raw`
     ╔══════════╗
     ║██████████║      compacted.
     ║██████████║
     ╚══════════╝`,
};

const LUMBERJACK: Mascot = {
  name: 'Lumberjack',
  color: COLORS.red,
  frames: [
    String.raw`
        _O_
       (o o)             🌲
      __\=/__           /
     /   |   \─────────/
         |             ╲ax
        / \
`,
    String.raw`
        _O_
       (o o)         💢  🌲
      __\=/__       \  /
     /   |   \─ax───\/
         |
        / \
`,
    String.raw`
        _O_
       (>_<)        🪵💢
      __\|/__         \\\
     /   |   \════════/
         |
        / \
`,
    String.raw`
        _O_
       (^_^)
      __\=/__         🪵🪵🪵
     /   |   \─ax─
         |          ✓
        / \
`,
  ],
  trophy: String.raw`
        _O_
       (^_^)
      __\=/__           felled.
     /   |   \
         |`,
};

export const MASCOTS: readonly Mascot[] = [
  WOODCHIPPER,
  BEAVER,
  FURNACE,
  COMPACTOR,
  LUMBERJACK,
];

export function pickMascot(rand: () => number = Math.random): Mascot {
  const idx = Math.floor(rand() * MASCOTS.length);
  return MASCOTS[idx]!;
}

export function colorize(text: string, color: string): string {
  return color + text + RESET;
}
