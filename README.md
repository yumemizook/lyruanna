# Lyruanna

A modern BMS (Be-Music Source) rhythm game player built with Electron.


## Features

### 🎮 Game Engine
- **7+1 Key Layout** - Full support for IIDX-style play (7 keys + scratch)
- **Dual Player Support** - Configurable keybinds for P1 and P2
- **Judgement System** - PGREAT / GREAT / GOOD / BAD / POOR with timing windows
- **Multiple Gauge Types** - GROOVE, EASY, HARD, EX-HARD, ASSIST

### 📁 Song Management
- **BMS/BME/BML/PMS Support** - Parse and play standard BMS formats
- **Shift-JIS Encoding** - Proper Japanese title/artist display
- **Library Scanning** - Auto-detect songs in configured folder
- **Metadata Display** - Title, Artist, Genre, Subtitle, BPM, Notes, NPS stats

### 🎚️ Player Options (IIDX-Style)
- **Hi-Speed** - Adjustable note scroll speed (1.0x - 10.0x)
- **Sudden+** - Top lane cover percentage
- **Lift** - Bottom lane cover percentage
- **Note Modifiers** - RANDOM, R-RANDOM, S-RANDOM, MIRROR
- **Auto-Scratch** - Toggle

### 📊 HUD Display
- **EX Score** - Real-time scoring
- **Combo Counter** - With max combo tracking
- **Judgement Tally** - PGREAT/GREAT/GOOD/BAD/POOR + FAST/SLOW + Combo Breaks
- **Gauge Bar** - Visual gauge with clear marker

### 🖼️ Visual Features
- **STAGEFILE Display** - Background image on song select and gameplay
- **BANNER Display** - Song banner in detail panel
- **BGA Container** - Ready for background animation support
- **Lane Covers** - Sudden+ and Lift visual indicators

## Installation

```bash
# Clone the repository
git clone [<repository-url>](https://github.com/yumemizook/lyruanna)
git clone 
cd lyruanna

# Install dependencies
npm install

# Run the application
npm start
```

## Controls

### Player 1 (Default)
| Action | Key |
|--------|-----|
| Scratch | Left Shift |
| Key 1-7 | Z, S, X, D, C, F, V |

### Player 2 (Default)
| Action | Key |
|--------|-----|
| Scratch | Right Shift |
| Key 1-7 | N, J, M, K, ,, L, . |

### Game Controls
| Action | Key |
|--------|-----|
| Exit to Menu | Escape |

## Usage

1. **Launch the app** - Run `npm start`
2. **Scan library** - Click 🔄 to scan your BMS folder
3. **Select a song** - Click on any song in the list
4. **Configure options** - Click 🎮 to adjust Hi-Speed, gauge type, etc.
5. **Play** - Click START to begin

## File Structure

```
lyruanna/
├── index.html      # Main UI and game logic
├── main.js         # Electron main process
├── preload.js      # Electron preload scripts
├── package.json    # Dependencies
└── library.json    # Cached song library (auto-generated)
```

## Dependencies

- **Electron** - Desktop application framework
- **fs-extra** - Enhanced file system operations
- **glob** - File pattern matching
- **iconv-lite** - Shift-JIS encoding support

## Browser Support

The web version (without Electron) supports:
- Folder selection via File API
- All gameplay features
- Note: Image/STAGEFILE loading requires Electron

## License

MIT
