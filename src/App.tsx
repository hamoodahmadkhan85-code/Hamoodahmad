import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import {
  ArrowLeft, Bot, ChevronRight, CircleHelp, Crown, Flame, Globe2, KeyRound, Loader2, Moon, Pencil,
  Settings, Shield, Sparkles, Smartphone, SlidersHorizontal, Sun, Trophy, Users,
  UserRound, CircleUserRound, Volume2, VolumeX, X,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { ref, set, onValue, off, get, onDisconnect, remove } from 'firebase/database';
import {
  colors, colorOrder, slotColor, initialPawns, getLegalPawns,
  movePawn, hasWon, getNextTurn, getProgress, chooseComputerMove, didCapture,
  trackCoords, homeStretchCoords, safeCellIndices, getTrackStartColor,
  type Color, type Pawns, type GamePhase, type GameMode, type RoomState, type RoomPlayer,
} from '@/lib/ludo';
import { DiceDots } from '@/components/DiceDots';

type Mode = 'home' | 'game';
type Modal = 'settings' | 'friends' | 'computer' | 'pass' | 'online' | 'hybrid' | null;
type MatrixState = 'full' | 'minimized';
type Theme = 'light' | 'dark';

const botNames: Array<{ name: string; gender: 'Male' | 'Female' }> = [
  { name: 'Ahmed', gender: 'Male' }, { name: 'Sara', gender: 'Female' },
  { name: 'Omar', gender: 'Male' }, { name: 'Layla', gender: 'Female' },
  { name: 'Khalid', gender: 'Male' }, { name: 'Fatima', gender: 'Female' },
  { name: 'Yusuf', gender: 'Male' }, { name: 'Mariam', gender: 'Female' },
  { name: 'Ali', gender: 'Male' }, { name: 'Noor', gender: 'Female' },
  { name: 'Hassan', gender: 'Male' }, { name: 'Zainab', gender: 'Female' },
];

function pickBot(existing: string[]): { name: string; gender: 'Male' | 'Female' } {
  const available = botNames.filter((b) => !existing.includes(b.name));
  return available[Math.floor(Math.random() * available.length)] ?? botNames[0];
}

function App() {
  const [mode, setMode] = useState<Mode>('home');
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState('Faaa');
  const [gender, setGender] = useState('Male');
  const [speed, setSpeed] = useState('Normal');
  const [sound, setSound] = useState(true);
  const [theme, setTheme] = useState<Theme>('light');
  const [secretVisible, setSecretVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [matrix, setMatrix] = useState(false);
  const [matrixState, setMatrixState] = useState<MatrixState>('full');
  const helpTapRef = useRef<number | null>(null);

  const [roomCode, setRoomCode] = useState(() => localStorage.getItem('ludo_active_room_code') ?? '');
  const [roomStatus, setRoomStatus] = useState('');
  const [isHost, setIsHost] = useState(() => localStorage.getItem('ludo_is_host') === 'true');
  const [myPlayerId, setMyPlayerId] = useState<string | null>(() => localStorage.getItem('ludo_player_id') ?? null);
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [joining, setJoining] = useState(false);
  const roomRefKey = useRef<string | null>(null);
  const modeRef = useRef<Mode>('home');
  const isHostRef = useRef(false);
  modeRef.current = mode;
  isHostRef.current = isHost;

  // Restore room session from localStorage on mount and on window focus
  const restoreRoomSession = useCallback(() => {
    const saved = localStorage.getItem('ludo_active_room_code');
    if (saved) {
      roomRefKey.current = saved;
      setRoomCode(saved);
      setMyPlayerId(localStorage.getItem('ludo_player_id'));
      setIsHost(localStorage.getItem('ludo_is_host') === 'true');
      setModal((prev) => prev ?? 'friends');
    }
  }, []);

  useEffect(() => {
    restoreRoomSession();
    const onFocus = () => restoreRoomSession();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [restoreRoomSession]);

  // Online matchmaking state
  const [searchTimer, setSearchTimer] = useState(0);
  const [onlineBots, setOnlineBots] = useState<Record<number, { name: string; gender: 'Male' | 'Female' } | null>>({});
  const searchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<string | null>(null);

  const [computerStep, setComputerStep] = useState(1);
  const [playerColor, setPlayerColor] = useState<Color>('blue');
  const [opponents, setOpponents] = useState(2);
  const [computerColors, setComputerColors] = useState<Color[]>(['red', 'yellow']);
  const [passPlayers, setPassPlayers] = useState<Color[]>(['red', 'yellow']);

  // Hybrid mode setup state
  const [hybridStep, setHybridStep] = useState(1);
  const [hybridTotalPlayers, setHybridTotalPlayers] = useState(4);
  const [hybridHumanCount, setHybridHumanCount] = useState(1);
  const [hybridHumanColors, setHybridHumanColors] = useState<Color[]>(['blue']);
  const [hybridComputerColors, setHybridComputerColors] = useState<Color[]>(['red', 'green', 'yellow']);
  const [setupMode, setSetupMode] = useState<'pass' | 'computer' | 'hybrid'>('hybrid');

  // Game state
  const [gameMode, setGameMode] = useState<GameMode>('pass');
  const [activeColors, setActiveColors] = useState<Color[]>(colorOrder);
  const [turn, setTurn] = useState<Color>('blue');
  const [dice, setDice] = useState<number>(0);
  const [rolling, setRolling] = useState(false);
  const [phase, setPhase] = useState<GamePhase>('roll');
  const [pawns, setPawns] = useState<Pawns>(initialPawns);
  const [legalPawns, setLegalPawns] = useState<number[]>([]);
  const [winner, setWinner] = useState<Color | null>(null);
  const [winners, setWinners] = useState<Color[]>([]);
  const [diceAnim, setDiceAnim] = useState(false);
  const [victoryDismissed, setVictoryDismissed] = useState(false);

  const [unlimited, setUnlimited] = useState(false);
  const [matrixDice, setMatrixDice] = useState<number>(0);
  const [applyMe, setApplyMe] = useState(true);
  const [applyOpponents, setApplyOpponents] = useState(false);
  // Firebase room subscription — persistent lobby + game sync (stays active across tab switches)
  useEffect(() => {
    if (!db || !roomRefKey.current) return;
    const roomRef = ref(db, `rooms/${roomRefKey.current}`);
    const handler = (snapshot: { val: () => RoomState | null }) => {
      const data = snapshot.val();
      if (!data) return;
      if (data.players) {
        setRoomPlayers(Object.values(data.players));
      }
      if (data.status === 'PLAYING') {
        if (data.turn) setTurn(data.turn);
        if (data.dice !== undefined) setDice(data.dice);
        if (data.phase) setPhase(data.phase);
        if (data.pawns) setPawns(data.pawns);
        if (data.legalPawns) setLegalPawns(data.legalPawns);
        // Transition guests into the game board when host starts
        if (modeRef.current === 'home' && !isHostRef.current) {
          const playerColors = Object.values(data.players).map((p) => p.color);
          setGameMode('friends');
          setActiveColors(playerColors);
          setMode('game');
          setModal(null);
        }
      }
    };
    onValue(roomRef, handler);
    return () => off(roomRef, 'value', handler);
  }, [roomRefKey.current]);

  const pushGameState = useCallback((partial: Partial<RoomState>) => {
    if (!db || !roomRefKey.current) return;
    set(ref(db, `rooms/${roomRefKey.current}`), {
      turn,
      dice,
      phase,
      pawns,
      legalPawns,
      ...partial,
    }).catch(() => {});
  }, [turn, dice, phase, pawns, legalPawns]);

  const openSetup = (mode: 'pass' | 'computer' | 'hybrid') => {
    setSetupMode(mode);
    setHybridStep(1);
    setHybridTotalPlayers(4);
    setHybridHumanCount(mode === 'computer' ? 1 : 2);
    const initialHumans: Color[] = mode === 'computer' ? ['blue'] : mode === 'pass' ? ['blue', 'red'] : ['blue'];
    const initialComputers: Color[] = colorOrder.filter((c) => !initialHumans.includes(c));
    setHybridHumanColors(initialHumans);
    setHybridComputerColors(initialComputers);
    setModal('hybrid');
  };

  const startGame = (selected: Color[], mode: GameMode) => {
    // Clear all online/Firebase state for offline modes to prevent stale listeners
    if (mode === 'computer' || mode === 'pass' || mode === 'hybrid') {
      if (searchIntervalRef.current) { clearInterval(searchIntervalRef.current); searchIntervalRef.current = null; }
      if (queueRef.current && db) { remove(ref(db, `matchmaking/${queueRef.current}`)).catch(() => {}); queueRef.current = null; }
      roomRefKey.current = null;
      localStorage.removeItem('ludo_active_room_code');
      localStorage.removeItem('ludo_player_id');
      localStorage.removeItem('ludo_is_host');
      setMyPlayerId(null);
      setOnlineBots({});
      setSearchTimer(0);
      setIsHost(false);
    }
    setGameMode(mode);
    setActiveColors(selected);
    setTurn(selected[0] ?? 'blue');
    const fresh = initialPawns();
    setPawns(fresh);
    setDice(0);
    setPhase('roll');
    setLegalPawns([]);
    setWinner(null);
    setWinners([]);
    setVictoryDismissed(false);
    setMode('game');
    setModal(null);
  };

  const computeDice = useCallback((): number => {
    const myColor = myPlayerId ? slotColor[Number(myPlayerId.split('_')[1]) ?? 1] : null;
    const isMyTurn = myColor ? myColor === turn : true;
    const targetMe = matrix && applyMe && isMyTurn;
    const targetOpp = matrix && applyOpponents && !isMyTurn;
    if (matrix && (targetMe || targetOpp)) {
      if (unlimited) return 6;
      if (matrixDice > 0) return matrixDice;
    }
    return Math.floor(Math.random() * 6) + 1;
  }, [matrix, applyMe, applyOpponents, unlimited, matrixDice, turn, myPlayerId]);

  const rollDice = useCallback(() => {
    if (rolling || phase !== 'roll' || winner) return;
    if (!activeColors.includes(turn)) return;
    setRolling(true);
    setDiceAnim(true);
    let animCount = 0;
    const animTimer = setInterval(() => {
      setDice(Math.floor(Math.random() * 6) + 1);
      animCount++;
      if (animCount >= 6) {
        clearInterval(animTimer);
        setDiceAnim(false);
        const result = computeDice();
        setDice(result);
        const legal = getLegalPawns(turn, pawns, result);
        setLegalPawns(legal);
        setRolling(false);
        if (legal.length === 0) {
          window.setTimeout(() => {
            const next = getNextTurn(turn, activeColors, new Set(winners));
            setTurn(next);
            setDice(0);
            setPhase('roll');
            if (roomRefKey.current) pushGameState({ turn: next, dice: 0, phase: 'roll' as GamePhase, legalPawns: [] });
          }, 1200);
        } else {
          setPhase('move');
          if (roomRefKey.current) pushGameState({ dice: result, phase: 'move' as GamePhase, legalPawns: legal });
        }
      }
    }, 80);
  }, [rolling, phase, winner, turn, pawns, activeColors, computeDice, pushGameState]);

  const movePawnByPlayer = useCallback((color: Color, pawnIndex: number) => {
    if (phase !== 'move' || color !== turn || rolling) return;
    if (!activeColors.includes(color)) return;
    if (!legalPawns.includes(pawnIndex)) return;
    const captured = didCapture(color, pawnIndex, dice, pawns);
    const newPawns = movePawn(color, pawnIndex, dice, pawns);
    setPawns(newPawns);
    setPhase('roll');
    setDice(0);
    setLegalPawns([]);
    const reachedHome = newPawns[color][pawnIndex] === 56;
    if (hasWon(color, newPawns)) {
      setWinner(color);
      setWinners((prev) => [...prev, color]);
      return;
    }
    const isExtraTurn = dice === 6 || captured || reachedHome;
    const finished = new Set<Color>(winners);
    const next = isExtraTurn ? turn : getNextTurn(turn, activeColors, finished);
    setTurn(next);
    if (roomRefKey.current) pushGameState({ pawns: newPawns, phase: 'roll' as GamePhase, dice: 0, legalPawns: [], turn: next });
  }, [phase, turn, rolling, legalPawns, dice, pawns, activeColors, pushGameState, winners]);

  // Computer bot: auto-roll and auto-move (for computer mode and online bot fill)
  const isBotTurn = useCallback((color: Color): boolean => {
    if (gameMode === 'computer') return computerColors.includes(color);
    if (gameMode === 'hybrid') return hybridComputerColors.includes(color);
    if (gameMode === 'online') {
      const slot = Object.entries(slotColor).find(([, c]) => c === color)?.[0];
      if (slot) return onlineBots[Number(slot)] != null;
    }
    return false;
  }, [gameMode, computerColors, hybridComputerColors, onlineBots]);

  useEffect(() => {
    if (mode !== 'game' || winner) return;
    if (!isBotTurn(turn)) return;

    if (phase === 'roll' && !rolling) {
      const timer = window.setTimeout(() => rollDice(), 700);
      return () => clearTimeout(timer);
    }
    if (phase === 'move' && legalPawns.length > 0 && !rolling) {
      const timer = window.setTimeout(() => {
        const choice = chooseComputerMove(turn, pawns, dice, legalPawns);
        movePawnByPlayer(turn, choice);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [mode, gameMode, turn, phase, rolling, legalPawns, dice, pawns, winner, isBotTurn, rollDice, movePawnByPlayer]);

  const showFriends = () => {
    const saved = localStorage.getItem('ludo_active_room_code');
    if (saved) {
      roomRefKey.current = saved;
      setRoomCode(saved);
      setMyPlayerId(localStorage.getItem('ludo_player_id'));
      setIsHost(localStorage.getItem('ludo_is_host') === 'true');
    } else {
      setRoomStatus('');
    }
    setModal('friends');
  };

  const createRoom = async () => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const playerId = 'player_1';
    roomRefKey.current = code;
    setRoomCode(code);
    setIsHost(true);
    setMyPlayerId(playerId);
    setRoomPlayers([{ id: playerId, name, color: slotColor[1], ready: true }]);
    setRoomStatus('Creating room...');
    localStorage.setItem('ludo_active_room_code', code);
    localStorage.setItem('ludo_player_id', playerId);
    localStorage.setItem('ludo_is_host', 'true');
    if (db) {
      const roomRef = ref(db, `rooms/${code}`);
      try {
        await set(roomRef, {
          hostId: playerId,
          status: 'LOBBY',
          playerCount: 1,
          players: {
            player_1: { id: playerId, name, color: slotColor[1], ready: true },
          },
        });
        onDisconnect(roomRef).remove();
        setRoomStatus('Room created · share the code with friends');
      } catch {
        setRoomStatus('Room created locally · online sync unavailable');
      }
    } else {
      setRoomStatus('Room created · online sync needs Firebase config');
    }
  };

  const joinRoom = async () => {
    if (roomCode.length !== 6) { setRoomStatus('Enter a 6-digit room code'); return; }
    if (!db) { setRoomStatus('Cannot connect · Firebase not configured'); return; }
    setJoining(true);
    setRoomStatus('Joining room...');
    const roomRef = ref(db, `rooms/${roomCode}`);
    try {
      const snapshot = await get(roomRef);
      const data = snapshot.val() as RoomState | null;
      if (!data) { setRoomStatus('Room code not found.'); setJoining(false); return; }
      const players = data.players ?? {};
      const count = Object.keys(players).length;
      if (count >= 4) { setRoomStatus('Room is full.'); setJoining(false); return; }
      const usedSlots = new Set(Object.keys(players).map((k) => Number(k.split('_')[1])));
      let assignedSlot = 0;
      let assignedColor: Color = 'red';
      for (let i = 2; i <= 4; i++) {
        if (!usedSlots.has(i)) { assignedSlot = i; assignedColor = slotColor[i]; break; }
      }
      if (!assignedSlot) { setRoomStatus('Room is full.'); setJoining(false); return; }
      const playerId = `player_${assignedSlot}`;
      roomRefKey.current = roomCode;
      setIsHost(false);
      setMyPlayerId(playerId);
      setRoomStatus(`Joined as ${colors[assignedColor].label}`);
      localStorage.setItem('ludo_active_room_code', roomCode);
      localStorage.setItem('ludo_player_id', playerId);
      localStorage.setItem('ludo_is_host', 'false');
      await set(ref(db, `rooms/${roomCode}/players/${playerId}`), {
        id: playerId, name, color: assignedColor, ready: true,
      });
      await set(ref(db, `rooms/${roomCode}/playerCount`), count + 1);
      onDisconnect(ref(db, `rooms/${roomCode}/players/${playerId}`)).remove();
      onDisconnect(ref(db, `rooms/${roomCode}/playerCount`)).set(Math.max(0, count));
    } catch {
      setRoomStatus('Connection error · please try again');
    }
    setJoining(false);
  };

  const exitRoom = () => {
    if (roomRefKey.current && db && myPlayerId) {
      if (isHost) {
        set(ref(db, `rooms/${roomRefKey.current}`), null).catch(() => {});
      } else {
        set(ref(db, `rooms/${roomRefKey.current}/players/${myPlayerId}`), null).catch(() => {});
      }
    }
    roomRefKey.current = null;
    localStorage.removeItem('ludo_active_room_code');
    localStorage.removeItem('ludo_player_id');
    localStorage.removeItem('ludo_is_host');
    setRoomCode('');
    setRoomStatus('');
    setIsHost(false);
    setMyPlayerId(null);
    setRoomPlayers([]);
    setModal(null);
  };

  // Online matchmaking
  const startOnlineSearch = useCallback(() => {
    setSearchTimer(20);
    setOnlineBots({});
    setModal('online');

    if (db) {
      const queueId = `q_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      queueRef.current = queueId;
      const queueEntryRef = ref(db, `matchmaking/${queueId}`);
      set(queueEntryRef, { name, gender, timestamp: Date.now() }).catch(() => {});
      onDisconnect(queueEntryRef).remove();
    }

    if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
    searchIntervalRef.current = setInterval(() => {
      setSearchTimer((prev) => {
        if (prev <= 1) {
          if (searchIntervalRef.current) { clearInterval(searchIntervalRef.current); searchIntervalRef.current = null; }
          finishOnlineMatchmaking();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [name, gender]);

  useEffect(() => () => {
    if (searchIntervalRef.current) clearInterval(searchIntervalRef.current);
    if (queueRef.current && db) { remove(ref(db, `matchmaking/${queueRef.current}`)).catch(() => {}); queueRef.current = null; }
  }, []);

  const finishOnlineMatchmaking = useCallback(async () => {
    if (queueRef.current && db) { remove(ref(db, `matchmaking/${queueRef.current}`)).catch(() => {}); queueRef.current = null; }

    const usedNames = [name];
    const bots: Record<number, { name: string; gender: 'Male' | 'Female' } | null> = {};

    // Try to match with real players from the matchmaking queue
    let realPlayers: Array<{ name: string; gender: 'Male' | 'Female'; queueId: string }> = [];
    if (db) {
      try {
        const snapshot = await get(ref(db, 'matchmaking'));
        const data = snapshot.val() as Record<string, { name: string; gender: 'Male' | 'Female' }> | null;
        if (data) {
          realPlayers = Object.entries(data)
            .filter(([id]) => id !== queueRef.current)
            .slice(0, 3)
            .map(([id, player]) => ({ ...player, queueId: id }));
          // Remove matched players from queue
          for (const rp of realPlayers) {
            remove(ref(db, `matchmaking/${rp.queueId}`)).catch(() => {});
            usedNames.push(rp.name);
          }
        }
      } catch { /* ignore — fall back to bots */ }
    }

    for (let slot = 2; slot <= 4; slot++) {
      const realPlayer = realPlayers[slot - 2];
      if (realPlayer) {
        bots[slot] = { name: realPlayer.name, gender: realPlayer.gender };
      } else {
        const bot = pickBot(usedNames);
        usedNames.push(bot.name);
        bots[slot] = bot;
      }
    }
    setOnlineBots(bots);
    setMyPlayerId('player_1');
    setRoomPlayers([]);
    setModal(null);
    startGame(colorOrder, 'online');
  }, [name]);

  const cancelOnlineSearch = useCallback(() => {
    if (searchIntervalRef.current) { clearInterval(searchIntervalRef.current); searchIntervalRef.current = null; }
    if (queueRef.current && db) { remove(ref(db, `matchmaking/${queueRef.current}`)).catch(() => {}); queueRef.current = null; }
    setSearchTimer(0);
    setModal(null);
  }, []);

  const handleHelpClick = () => {
    const now = Date.now();
    const previousTap = helpTapRef.current;
    helpTapRef.current = now;
    if (previousTap && now - previousTap <= 400) {
      helpTapRef.current = null;
      setSecretVisible((visible) => !visible);
      return;
    }
    window.setTimeout(() => {
      if (helpTapRef.current === now) helpTapRef.current = null;
    }, 450);
  };

  const verifyPassword = () => {
    if (password === '12157') { setMatrix(true); setMatrixState('full'); setMatrixDice(0); setUnlimited(false); setModal(null); setPassword(''); setSecretVisible(false); }
  };

  const startRoomGame = async () => {
    if (!db || !roomRefKey.current) return;
    const fresh = initialPawns();
    const playerColors = roomPlayers.map((p) => p.color);
    await set(ref(db, `rooms/${roomRefKey.current}`), {
      hostId: 'player_1',
      status: 'PLAYING',
      playerCount: roomPlayers.length,
      players: Object.fromEntries(roomPlayers.map((p) => [p.id, p])),
      turn: playerColors[0] ?? 'blue',
      dice: 0,
      phase: 'roll',
      pawns: fresh,
      legalPawns: [],
    });
    startGame(playerColors, 'friends');
  };
  const exitGame = () => { if (roomRefKey.current && db) set(ref(db, `rooms/${roomRefKey.current}`), null).catch(() => {}); roomRefKey.current = null; localStorage.removeItem('ludo_active_room_code'); localStorage.removeItem('ludo_player_id'); localStorage.removeItem('ludo_is_host'); setMode('home'); setWinner(null); setWinners([]); setVictoryDismissed(false); setMatrix(false); };

  const playerLabel = (color: Color) => {
    if (gameMode === 'computer') {
      if (color === playerColor) return 'Player 1';
      const computerIndex = computerColors.indexOf(color);
      return computerIndex >= 0 ? `Computer ${computerIndex + 1}` : `${colors[color].label} Player`;
    }
    if (gameMode === 'hybrid') {
      if (hybridHumanColors.includes(color)) {
 const humanIndex = hybridHumanColors.indexOf(color);
 return `Player ${humanIndex + 1}`;
      }
      const computerIndex = hybridComputerColors.indexOf(color);
      return computerIndex >= 0 ? `Computer ${computerIndex + 1}` : `${colors[color].label} Player`;
    }
    if (gameMode === 'online') {
      const slot = Object.entries(slotColor).find(([, c]) => c === color)?.[0];
      if (slot) {
        const slotNum = Number(slot);
        if (slotNum === 1) return name;
        const bot = onlineBots[slotNum];
        if (bot) return bot.name;
      }
      return `${colors[color].label} Player`;
    }
    if (gameMode === 'pass') {
      const num = colorOrder.indexOf(color) + 1;
      return `Player ${num}`;
    }
    if (gameMode === 'friends') {
      const player = roomPlayers.find((p) => p.color === color);
      if (player) return player.name;
      return `${colors[color].label} Player`;
    }
    return `${colors[color].label} Player`;
  };

  const playerAvatar = (color: Color): { icon: 'person' | 'computer'; gender: string } => {
    if (gameMode === 'computer') {
      if (color === playerColor) return { icon: 'person', gender };
      return { icon: 'computer', gender: 'Male' };
    }
    if (gameMode === 'hybrid') {
      if (hybridHumanColors.includes(color)) return { icon: 'person', gender };
      return { icon: 'computer', gender: 'Male' };
    }
    if (gameMode === 'online') {
      const slot = Object.entries(slotColor).find(([, c]) => c === color)?.[0];
      if (slot) {
        const slotNum = Number(slot);
        if (slotNum === 1) return { icon: 'person', gender };
        const bot = onlineBots[slotNum];
        if (bot) return { icon: 'person', gender: bot.gender };
      }
      return { icon: 'person', gender: 'Male' };
    }
    if (gameMode === 'friends') {
      const player = roomPlayers.find((p) => p.color === color);
      if (player && player.id === myPlayerId) return { icon: 'person', gender };
      return { icon: 'person', gender: 'Male' };
    }
    return { icon: 'person', gender: 'Male' };
  };

  return (
    <main className={`app-shell theme-${theme}`}>
      {mode === 'home' ? (
        <section className="home-screen">
          <div className="home-glow glow-one" /><div className="home-glow glow-two" />
          <header className="home-header"><div className="brand-mark"><Sparkles size={16} /></div><span className="header-brand">HAMOOD LUDO</span><button className="icon-button" onClick={() => setModal('settings')} aria-label="Open settings"><Settings size={21} /></button></header>
          <div className="hero-copy"><div className="eyebrow">THE CLASSIC · REIMAGINED</div><h1><span className="title-gradient">HAMOOD</span><br /><em>LUDO</em></h1><p>Roll your way to victory.</p></div>
          <div className="profile-panel"><label>ENTER PROFILE NAME</label><div className="input-wrap"><Pencil size={15} /><input value={name} onChange={(event) => setName(event.target.value)} /></div><label>SELECT GENDER</label><div className="gender-grid">{['Male', 'Female'].map((value) => <button key={value} className={gender === value ? 'choice active' : 'choice'} onClick={() => setGender(value)}>{value}</button>)}</div></div>
          <div className="mode-grid mode-grid-vertical">
            <ModeCard icon={<Globe2 />} title="Play Online" subtitle="Find players around the world" onClick={startOnlineSearch} />
            <ModeCard icon={<Users />} title="Play with Friends" subtitle="Create or join a private room" onClick={showFriends} />
            <ModeCard icon={<Smartphone />} title="Pass and Play" subtitle="Local multiplayer on one screen" onClick={() => openSetup('pass')} />
            <ModeCard icon={<Bot />} title="Play with Computer" subtitle="Challenge AI opponents" onClick={() => openSetup('computer')} />
            <ModeCard icon={<Users />} title="Both Pass & Play and Computer" subtitle="Mix human and AI players" onClick={() => openSetup('hybrid')} />
          </div>
          <div className="home-footer"><span><Shield size={14} /> Fair play, always</span><button onClick={() => setModal('settings')}><SlidersHorizontal size={14} /> Game settings</button></div>
          <div className="base44-badge">Made on Base 44</div>
        </section>
      ) : (
        <GameBoard
          name={name}
          gender={gender}
          turn={turn}
          dice={dice}
          rolling={rolling}
          phase={phase}
          pawns={pawns}
          legalPawns={legalPawns}
          activeColors={activeColors}
          winner={winner}
          winners={winners}
          playerLabel={playerLabel}
          playerAvatar={playerAvatar}
          gameMode={gameMode}
          computerColors={computerColors}
          playerColor={playerColor}
          onRoll={rollDice}
          onMovePawn={movePawnByPlayer}
          onBack={exitGame}
          onSettings={() => setModal('settings')}
          onContinue={() => setVictoryDismissed(true)}
          onNewGame={exitGame}
          victoryDismissed={victoryDismissed}
          diceAnim={diceAnim}
        />
      )}

      {modal === 'settings' && <SettingsModal name={name} setName={setName} gender={gender} setGender={setGender} speed={speed} setSpeed={setSpeed} sound={sound} setSound={setSound} theme={theme} setTheme={setTheme} secretVisible={secretVisible} setSecretVisible={setSecretVisible} password={password} setPassword={setPassword} onVerify={verifyPassword} onHelpClick={handleHelpClick} showHelpGuide={mode === 'game'} onClose={() => setModal(null)} />}
      {modal === 'friends' && <FriendsModal roomCode={roomCode} setRoomCode={setRoomCode} roomStatus={roomStatus} roomPlayers={roomPlayers} isHost={isHost} joining={joining} onCreate={createRoom} onJoin={joinRoom} onStart={startRoomGame} onExitRoom={exitRoom} onClose={() => setModal(null)} />}
      {modal === 'hybrid' && <HybridModal step={hybridStep} setStep={setHybridStep} totalPlayers={hybridTotalPlayers} setTotalPlayers={setHybridTotalPlayers} humanCount={hybridHumanCount} setHumanCount={setHybridHumanCount} humanColors={hybridHumanColors} setHumanColors={setHybridHumanColors} computerColors={hybridComputerColors} setComputerColors={setHybridComputerColors} setupMode={setupMode} onStart={() => startGame([...hybridHumanColors, ...hybridComputerColors], setupMode)} onClose={() => setModal(null)} />}
      {modal === 'online' && <OnlineModal timer={searchTimer} onCancel={cancelOnlineSearch} />}

      {mode === 'game' && matrix && matrixState === 'full' && (
        <MatrixPanel onClose={() => setMatrix(false)} onMinimize={() => setMatrixState('minimized')} matrixDice={matrixDice} setMatrixDice={setMatrixDice} unlimited={unlimited} setUnlimited={setUnlimited} applyMe={applyMe} setApplyMe={setApplyMe} applyOpponents={applyOpponents} setApplyOpponents={setApplyOpponents} />
      )}
      {mode === 'game' && matrix && matrixState === 'minimized' && (
        <MatrixHIcon onOpen={() => setMatrixState('full')} />
      )}
    </main>
  );
}

function ModeCard({ icon, title, subtitle, onClick }: { icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return <button className="mode-card" onClick={onClick}><span className="mode-card-icon">{icon}</span><span className="mode-card-body"><strong>{title}</strong><small>{subtitle}</small></span><ChevronRight size={18} /></button>;
}

function SettingsModal(props: { name: string; setName: (v: string) => void; gender: string; setGender: (v: string) => void; speed: string; setSpeed: (v: string) => void; sound: boolean; setSound: (v: boolean) => void; theme: Theme; setTheme: (v: Theme) => void; secretVisible: boolean; setSecretVisible: (v: boolean) => void; password: string; setPassword: (v: string) => void; onVerify: () => void; onHelpClick: () => void; showHelpGuide: boolean; onClose: () => void }) {
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (props.secretVisible) passwordRef.current?.focus(); }, [props.secretVisible]);
  return <ModalFrame title="GAME SETTINGS" onClose={props.onClose}><label>EDIT PROFILE NAME</label><div className="input-wrap"><Pencil size={15} /><input value={props.name} onChange={(event) => props.setName(event.target.value)} /></div><label>CHANGE GENDER</label><div className="gender-grid">{['Male', 'Female'].map((value) => <button key={value} className={props.gender === value ? 'choice active' : 'choice'} onClick={() => props.setGender(value)}>{value}</button>)}</div><button className="primary-button">Save Profile</button><label>GAME SPEED</label><div className="speed-grid">{['Normal', 'Fast', 'Turbo'].map((value) => <button key={value} className={props.speed === value ? 'choice active' : 'choice'} onClick={() => props.setSpeed(value)}>{value}</button>)}</div><button className="setting-row" onClick={() => props.setSound(!props.sound)}><span>{props.sound ? <Volume2 size={17} /> : <VolumeX size={17} />} Sound Effects</span><Toggle active={props.sound} /></button><button className="setting-row" onClick={() => props.setTheme(props.theme === 'light' ? 'dark' : 'light')}><span>{props.theme === 'light' ? <Sun size={17} /> : <Moon size={17} />} Theme · {props.theme === 'light' ? 'Light Mode' : 'Dark Mode'}</span><Toggle active={props.theme === 'dark'} /></button>{props.showHelpGuide && <button className="guide-button" onPointerUp={props.onHelpClick}><CircleHelp size={17} /> Help & Guide</button>}{props.secretVisible && <div className="secret-area"><div className="input-wrap"><KeyRound size={15} /><input ref={passwordRef} type="password" placeholder="Enter password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} /></div><button className="primary-button" onClick={props.onVerify}>Verify</button></div>}</ModalFrame>;
}

function FriendsModal({ roomCode, setRoomCode, roomStatus, roomPlayers, isHost, joining, onCreate, onJoin, onStart, onExitRoom, onClose }: { roomCode: string; setRoomCode: (v: string) => void; roomStatus: string; roomPlayers: RoomPlayer[]; isHost: boolean; joining: boolean; onCreate: () => void; onJoin: () => void; onStart: () => void; onExitRoom: () => void; onClose: () => void }) {
  const playerCount = roomPlayers.length;
  const hasRoomCode = Boolean(roomCode);
  const slotMap: Record<number, RoomPlayer | null> = { 1: null, 2: null, 3: null, 4: null };
  for (const p of roomPlayers) {
    const slotNum = Number(p.id.split('_')[1]);
    if (slotNum >= 1 && slotNum <= 4) slotMap[slotNum] = p;
  }
  return <ModalFrame title="PLAY WITH FRIENDS" onClose={onClose}><div className="connection-pill"><span className="pulse-dot" /> Cross-city rooms are live</div>{!hasRoomCode && <><button className="room-action" onClick={onCreate} disabled={joining}><span className="room-icon">#</span><span><b>Create Room</b><small>Host a private game · you are Blue</small></span><ChevronRight size={17} /></button><div className="or-line"><span>OR</span></div><div className="room-input"><KeyRound size={17} /><input type="text" maxLength={6} placeholder="Enter 6-digit room code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter' && roomCode.length === 6 && !joining) onJoin(); }} /><button onClick={onJoin} disabled={joining || roomCode.length !== 6}>{joining ? '...' : 'Join'}</button></div></>}{hasRoomCode && <div className="room-code"><span>{isHost ? 'YOUR ROOM CODE' : 'ROOM CODE'}</span><strong>{roomCode}</strong><small>{roomStatus || 'Share this code with friends'}</small><div className="room-slots">{[1, 2, 3, 4].map((slot) => <i key={slot} className={slotMap[slot] ? 'filled' : ''}>{slotMap[slot] ? slotMap[slot]!.name : `Slot ${slot}`}</i>)}</div><div className="player-count-badge">Players Connected: {playerCount}/4</div>{joining && <div className="joining-spinner"><Loader2 size={20} className="animate-spin" /> Joining room...</div>}<div className="room-actions-row">{isHost && <button className="primary-button" disabled={playerCount < 2} onClick={onStart}>Start Game</button>}{!isHost && <span className="waiting-text">Waiting for host to start...</span>}<button className="text-button danger-text" onClick={onExitRoom}>Exit Room</button></div></div>}</ModalFrame>;
}

function OnlineModal({ timer, onCancel }: { timer: number; onCancel: () => void }) {
  return <div className="modal-backdrop"><section className="modal-card online-card"><div className="online-search"><div className="online-spinner"><Loader2 size={40} className="animate-spin" /></div><h2>Finding players...</h2><div className="online-timer">{timer}<span>seconds remaining</span></div><div className="online-progress"><div className="online-progress-bar" style={{ width: `${(timer / 20) * 100}%` }} /></div><p className="online-note">Matching you with real players worldwide. Bots will fill empty seats if needed.</p><button className="primary-button" onClick={onCancel}>Cancel</button></div></section></div>;
}

function HybridModal({ step, setStep, totalPlayers, setTotalPlayers, humanCount, setHumanCount, humanColors, setHumanColors, computerColors, setComputerColors, setupMode, onStart, onClose }: {
  step: number; setStep: (v: number) => void; totalPlayers: number; setTotalPlayers: (v: number) => void; humanCount: number; setHumanCount: (v: number) => void; humanColors: Color[]; setHumanColors: (v: Color[]) => void; computerColors: Color[]; setComputerColors: (v: Color[]) => void; setupMode: 'pass' | 'computer' | 'hybrid'; onStart: () => void; onClose: () => void;
}) {
  const availableColors = colorOrder;
  const computerCount = totalPlayers - humanCount;
  const modeLabel = setupMode === 'computer' ? 'VS COMPUTER' : setupMode === 'pass' ? 'PASS & PLAY' : 'PASS & PLAY / VS COMPUTER';

  const selectTotal = (n: number) => {
    setTotalPlayers(n);
    const maxHumans = n;
    if (humanCount > maxHumans) setHumanCount(maxHumans);
    if (humanCount < 1) setHumanCount(1);
  };

  const selectHumanCount = (n: number) => {
    setHumanCount(n);
    const compN = totalPlayers - n;
    const usedColors = new Set(humanColors);
    const compColors: Color[] = [];
    for (const c of colorOrder) {
      if (!usedColors.has(c) && compColors.length < compN) compColors.push(c);
    }
    setComputerColors(compColors);
  };

  const toggleHumanColor = (color: Color) => {
    if (humanColors.includes(color)) {
      if (humanColors.length <= 1) return;
      setHumanColors(humanColors.filter((c) => c !== color));
    } else {
      if (humanColors.length >= humanCount) return;
      setHumanColors([...humanColors, color]);
    }
    // Reassign computer colors to remaining
    const newHuman = humanColors.includes(color) ? humanColors.filter((c) => c !== color) : [...humanColors, color];
    const compN = totalPlayers - humanCount;
    const used = new Set(newHuman);
    const compColors: Color[] = [];
    for (const c of colorOrder) {
      if (!used.has(c) && compColors.length < compN) compColors.push(c);
    }
    setComputerColors(compColors);
  };

  const toggleComputerColor = (color: Color) => {
    if (humanColors.includes(color)) return;
    if (computerColors.includes(color)) {
      if (computerColors.length <= computerCount) return;
      setComputerColors(computerColors.filter((c) => c !== color));
    } else {
      if (computerColors.length >= computerCount) return;
      setComputerColors([...computerColors, color]);
    }
  };

  const colorsValid = humanColors.length === humanCount && computerColors.length === computerCount;

  return <ModalFrame title={`${modeLabel} · STEP ${step} OF 4`} onClose={onClose}>
    {step === 1 && <>
      <h3>Select Total Players</h3>
      <p className="modal-intro">How many players will be in this game?</p>
      <div className="number-options">{[2, 3, 4].map((value) => <button key={value} className={totalPlayers === value ? 'number-choice selected' : 'number-choice'} onClick={() => selectTotal(value)}>{value}</button>)}</div>
      <p className="selection-note">{totalPlayers} total players</p>
      <button className="primary-button" onClick={() => { selectHumanCount(Math.min(humanCount, totalPlayers)); setStep(2); }}>Continue</button>
    </>}
    {step === 2 && <>
      <h3>Configure Player Types</h3>
      <p className="modal-intro">How many are human players (sharing this screen)?</p>
      <div className="number-options">{Array.from({ length: totalPlayers }, (_, i) => i + 1).map((value) => <button key={value} className={humanCount === value ? 'number-choice selected' : 'number-choice'} onClick={() => selectHumanCount(value)}>{value}</button>)}</div>
      <p className="selection-note">{humanCount} human · {totalPlayers - humanCount} computer</p>
      <button className="primary-button" disabled={humanCount < 1} onClick={() => setStep(3)}>Continue</button>
      <button className="text-button" onClick={() => setStep(1)}>Back</button>
    </>}
    {step === 3 && <>
      <h3>Pick Human Colors</h3>
      <p className="modal-intro">Select colors for the {humanCount} human player{humanCount > 1 ? 's' : ''}.</p>
      <div className="color-options two-col">{availableColors.map((color) => {
        const taken = computerColors.includes(color);
        return <button key={color} style={{ '--tone': colors[color].hex, '--soft': colors[color].soft } as React.CSSProperties} className={humanColors.includes(color) ? 'color-option selected' : taken ? 'color-option disabled' : 'color-option'} disabled={taken} onClick={() => toggleHumanColor(color)}><span>{colors[color].label}</span><span className="radio-dot" /></button>;
      })}</div>
      <p className="selection-note">{humanColors.length}/{humanCount} human colors selected</p>
      {computerCount > 0 && <>
        <h3 style={{ marginTop: '16px' }}>Computer Colors</h3>
        <p className="modal-intro">Assign colors for the {computerCount} AI opponent{computerCount > 1 ? 's' : ''}.</p>
        <div className="color-options two-col">{availableColors.filter((c) => !humanColors.includes(c)).map((color) => <button key={color} style={{ '--tone': colors[color].hex, '--soft': colors[color].soft } as React.CSSProperties} className={computerColors.includes(color) ? 'color-option selected' : 'color-option'} onClick={() => toggleComputerColor(color)}><span>{colors[color].label}</span><span className="radio-dot" /></button>)}</div>
        <p className="selection-note">{computerColors.length}/{computerCount} computer colors assigned</p>
      </>}
      <button className="primary-button" disabled={!colorsValid} onClick={() => setStep(4)}>Continue</button>
      <button className="text-button" onClick={() => setStep(2)}>Back</button>
    </>}
    {step === 4 && <>
      <h3>Review & Start</h3>
      <div className="hybrid-review">
        <div className="hybrid-review-row"><span>Total Players</span><strong>{totalPlayers}</strong></div>
        <div className="hybrid-review-row"><span>Human Players</span><strong>{humanCount}</strong></div>
        <div className="hybrid-review-row"><span>Computer Players</span><strong>{computerCount}</strong></div>
        <div className="hybrid-review-colors">
          {humanColors.map((c) => <div key={c} className="hybrid-review-chip human" style={{ '--tone': colors[c].hex } as React.CSSProperties}><UserRound size={14} /> {colors[c].label}</div>)}
          {computerColors.map((c) => <div key={c} className="hybrid-review-chip computer" style={{ '--tone': colors[c].hex } as React.CSSProperties}><Bot size={14} /> {colors[c].label}</div>)}
        </div>
      </div>
      <button className="primary-button" onClick={onStart}>Start Game</button>
      <button className="text-button" onClick={() => setStep(3)}>Back</button>
    </>}
  </ModalFrame>;
}

function ModalFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="modal-backdrop"><section className="modal-card"><div className="modal-title"><span>{title}</span><button onClick={onClose} aria-label="Close"><X size={20} /></button></div>{children}</section></div>; }
function Toggle({ active }: { active: boolean }) { return <span className={active ? 'toggle active' : 'toggle'}><i /></span>; }

function GameBoard({ name, gender, turn, dice, rolling, phase, pawns, legalPawns, activeColors, winner, winners, victoryDismissed, playerLabel, playerAvatar, gameMode, computerColors, playerColor, onRoll, onMovePawn, onBack, onSettings, onContinue, onNewGame, diceAnim }: {
  name: string; gender: string; turn: Color; dice: number; rolling: boolean; phase: GamePhase; pawns: Pawns; legalPawns: number[]; activeColors: Color[]; winner: Color | null; winners: Color[]; victoryDismissed: boolean;
  playerLabel: (color: Color) => string; playerAvatar: (color: Color) => { icon: 'person' | 'computer'; gender: string }; gameMode: GameMode; computerColors: Color[]; playerColor: Color; onRoll: () => void; onMovePawn: (color: Color, pawnIndex: number) => void; onBack: () => void; onSettings: () => void; onContinue: () => void; onNewGame: () => void; diceAnim: boolean;
}) {
  const progressMap = activeColors.reduce((acc, c) => { acc[c] = getProgress(c, pawns); return acc; }, {} as Record<Color, number>);
  const isComputer = (color: Color) => gameMode === 'computer' && color !== playerColor;
  return (
    <section className="game-screen">
      <header className="game-header">
        <button className="round-button" onClick={onBack}><ArrowLeft size={20} /></button>
        <div className="header-center"><span className="header-title"><span className="title-gradient">HAMOOD</span> LUDO</span><div className="turn-banner" style={{ background: colors[turn].soft, color: colors[turn].hex }}><span className="turn-pulse" style={{ background: colors[turn].hex }} />{playerLabel(turn)}'S Turn</div></div>
        <button className="round-button" onClick={onSettings}><Settings size={20} /></button>
      </header>

      <div className="game-layout">
        {activeColors.includes('red') && <div className="corner-player corner-red"><PlayerCard color="red" name={playerLabel('red')} progress={progressMap.red} active={turn === 'red'} avatar={playerAvatar('red')} dice={turn === 'red' ? dice : undefined} onDice={() => phase === 'roll' && !rolling && onRoll()} rolling={turn === 'red' && (rolling || diceAnim)} /></div>}
        {activeColors.includes('green') && <div className="corner-player corner-green"><PlayerCard color="green" name={playerLabel('green')} progress={progressMap.green} active={turn === 'green'} avatar={playerAvatar('green')} dice={turn === 'green' ? dice : undefined} onDice={() => phase === 'roll' && !rolling && onRoll()} rolling={turn === 'green' && (rolling || diceAnim)} /></div>}
        {activeColors.includes('blue') && <div className="corner-player corner-blue"><PlayerCard color="blue" name={playerLabel('blue')} progress={progressMap.blue} active={turn === 'blue'} avatar={playerAvatar('blue')} dice={turn === 'blue' ? dice : undefined} onDice={() => phase === 'roll' && !rolling && onRoll()} rolling={turn === 'blue' && (rolling || diceAnim)} /></div>}
        {activeColors.includes('yellow') && <div className="corner-player corner-yellow"><PlayerCard color="yellow" name={playerLabel('yellow')} progress={progressMap.yellow} active={turn === 'yellow'} avatar={playerAvatar('yellow')} dice={turn === 'yellow' ? dice : undefined} onDice={() => phase === 'roll' && !rolling && onRoll()} rolling={turn === 'yellow' && (rolling || diceAnim)} /></div>}
        <LudoBoard pawns={pawns} turn={turn} activeColors={activeColors} legalPawns={legalPawns} phase={phase} onPawnClick={(pawnIndex) => onMovePawn(turn, pawnIndex)} />
        {phase === 'move' && <p className="move-hint">Tap a highlighted pawn to move it</p>}
      </div>

        <div className="rule-hint"><Sparkles size={14} /> {gameMode === 'computer' || gameMode === 'hybrid' ? 'Bots play automatically · tap your dice & pawns' : 'Roll a 6 to release a pawn · roll again on a 6'}</div>

      {winner && !victoryDismissed && <VictoryOverlay winner={winner} winners={winners} totalPlayers={activeColors.length} playerLabel={playerLabel} playerAvatar={playerAvatar} onContinue={onContinue} onNewGame={onNewGame} />}
      <div className="base44-badge base44-badge-game">Made on Base 44</div>
    </section>
  );
}

function VictoryOverlay({ winner, winners, totalPlayers, playerLabel, playerAvatar, onContinue, onNewGame }: {
  winner: Color; winners: Color[]; totalPlayers: number; playerLabel: (color: Color) => string; playerAvatar: (color: Color) => { icon: 'person' | 'computer'; gender: string }; onContinue: () => void; onNewGame: () => void;
}) {
  const av = playerAvatar(winner);
  const avatar = av.icon === 'computer' ? <Bot size={52} strokeWidth={2.5} /> : av.gender === 'Female' ? <CircleUserRound size={52} strokeWidth={2.5} /> : <UserRound size={52} strokeWidth={2.5} />;
  const fwColors = ['#ef3340', '#2760d8', '#27b76b', '#f5af18', '#ff6b9d', '#48dbfb'];
  const place = winners.length;
  const placeLabel = place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
  const remaining = totalPlayers - winners.length;
  const canContinue = totalPlayers >= 3 && remaining >= 2;
  return (
    <div className="victory-overlay">
      <div className="fireworks">
        {fwColors.map((fwColor, i) => (
          <div key={i} className="firework-burst" style={{ '--fw-x': `${15 + (i * 14) % 70}%`, '--fw-y': `${15 + (i * 23) % 50}%`, '--fw-color': fwColor, '--fw-delay': `${i * 0.4}s` } as React.CSSProperties}>
            {Array.from({ length: 8 }).map((_, p) => <span key={p} className="fw-particle" style={{ '--p-angle': `${p * 45}deg` } as React.CSSProperties} />)}
          </div>
        ))}
      </div>
      <div className="victory-card">
        <div className="victory-crown"><Crown size={48} strokeWidth={2.2} /></div>
        <h2 className="victory-title">VICTORY!</h2>
        <p className="victory-name-top">{playerLabel(winner)}</p>
        <div className="victory-wreath" style={{ '--tone': colors[winner].hex } as React.CSSProperties}>
          <div className="victory-avatar" style={{ background: colors[winner].hex }}>{avatar}</div>
        </div>
        <p className="victory-name">{playerLabel(winner).toUpperCase()} HAS WON THE MATCH!</p>
        <div className="victory-rank">
          <Trophy size={36} style={{ color: '#f5af18' }} />
          <span className="rank-badge">{place}</span>
        </div>
        <p className="victory-place">{placeLabel} PLACE WINNER</p>
        <div className="victory-buttons">
          {canContinue && <button className="victory-btn continue-btn" onClick={onContinue}>CONTINUE GAME</button>}
          <button className="victory-btn new-game-btn" onClick={onNewGame}>NEW GAME</button>
        </div>
      </div>
    </div>
  );
}

function PlayerCard({ color, name, progress, active, avatar, dice, onDice, rolling }: { color: Color; name: string; progress: number; active: boolean; avatar: { icon: 'person' | 'computer'; gender: string }; dice?: number; onDice?: () => void; rolling?: boolean }) {
  const avatarIcon = avatar.icon === 'computer' ? <Bot size={20} strokeWidth={2.5} /> : avatar.gender === 'Female' ? <CircleUserRound size={20} strokeWidth={2.5} /> : <UserRound size={20} strokeWidth={2.5} />;
  return <div className={active ? 'corner-card active' : 'corner-card'} style={{ '--tone': colors[color].hex, '--soft': colors[color].soft } as React.CSSProperties}><div className="corner-avatar" style={{ background: colors[color].hex }}>{avatarIcon}</div><div className="corner-info"><strong>{name}</strong><span>{progress}%</span></div>{dice !== undefined && <button className={`card-dice ${rolling ? 'rolling' : ''}`} onClick={onDice} aria-label="Roll dice">{rolling ? '···' : (dice === 0 ? 'ROLL' : <DiceDots value={dice} color={colors[color].hex} />)}</button>}</div>;
}

function LudoBoard({ pawns, turn, activeColors, legalPawns, phase, onPawnClick }: { pawns: Pawns; turn: Color; activeColors: Color[]; legalPawns: number[]; phase: GamePhase; onPawnClick: (pawnIndex: number) => void }) {
  const activeSet = new Set(activeColors);
  const trackSet = new Set(trackCoords.map(([r, c]) => `${r},${c}`));
  const stretchSet = new Set<string>();
  for (const color of colorOrder) homeStretchCoords[color].forEach(([r, c]) => stretchSet.add(`${r},${c}`));
  const cellColor: Record<string, Color> = {};
  const cellSafe = new Set<string>();
  for (let i = 0; i < 52; i++) {
    const [r, c] = trackCoords[i]; cellColor[`${r},${c}`] = getTrackStartColor(i) ?? cellColor[`${r},${c}`];
    if (safeCellIndices.has(i)) cellSafe.add(`${r},${c}`);
  }
  const stretchColor: Record<string, Color> = {};
  for (const color of colorOrder) homeStretchCoords[color].forEach(([r, c]) => { stretchColor[`${r},${c}`] = color; });
  const allPawnsOnBoard: Array<{ color: Color; index: number; row: number; col: number }> = [];
  for (const color of colorOrder) {
    pawns[color].forEach((pos, index) => {
      if (pos === -1) return;
      const coord = pos === 56 ? [7, 7] : getPawnCoord(color, pos);
      if (coord) allPawnsOnBoard.push({ color, index, row: coord[0], col: coord[1] });
    });
  }
  return (
    <div className="ludo-board">
      <div className={`home-zone zone-red ${activeSet.has('red') ? '' : 'vacant'}`}><PawnBase color="red" active={activeSet.has('red')} pawns={pawns} turn={turn} legalPawns={legalPawns} phase={phase} onPawnClick={onPawnClick} /></div>
      <div className={`home-zone zone-green ${activeSet.has('green') ? '' : 'vacant'}`}><PawnBase color="green" active={activeSet.has('green')} pawns={pawns} turn={turn} legalPawns={legalPawns} phase={phase} onPawnClick={onPawnClick} /></div>
      <div className={`home-zone zone-blue ${activeSet.has('blue') ? '' : 'vacant'}`}><PawnBase color="blue" active={activeSet.has('blue')} pawns={pawns} turn={turn} legalPawns={legalPawns} phase={phase} onPawnClick={onPawnClick} /></div>
      <div className={`home-zone zone-yellow ${activeSet.has('yellow') ? '' : 'vacant'}`}><PawnBase color="yellow" active={activeSet.has('yellow')} pawns={pawns} turn={turn} legalPawns={legalPawns} phase={phase} onPawnClick={onPawnClick} /></div>
      <div className="board-grid">
        {Array.from({ length: 15 * 15 }).map((_, idx) => {
          const row = Math.floor(idx / 15); const col = idx % 15; const key = `${row},${col}`;
          const isTrack = trackSet.has(key);
          const isStretch = stretchSet.has(key);
          const isCenter = row >= 6 && row <= 8 && col >= 6 && col <= 8;
          if (!isTrack && !isStretch && !isCenter) return null;
          const startColor = cellColor[key];
          const stretchCol = stretchColor[key];
          const isSafe = cellSafe.has(key);
          const pawnsHere = allPawnsOnBoard.filter((p) => p.row === row && p.col === col);
          const classes = ['grid-cell'];
          if (isTrack) classes.push('track-cell');
          if (isStretch) classes.push('stretch-cell');
          if (isSafe) classes.push('safe-cell');
          if (startColor) classes.push(`start-${startColor}`);
          const bgStyle: React.CSSProperties = stretchCol ? { background: colors[stretchCol].light } : startColor ? { background: colors[startColor].light } : {};
          return <div key={idx} className={classes.join(' ')} style={{ gridRow: row + 1, gridColumn: col + 1, ...bgStyle }}>{isSafe && <span className="star">★</span>}{pawnsHere.length > 0 && pawnsHere.map((p) => <div key={`${p.color}-${p.index}`} className="board-pawn" style={{ background: colors[p.color].hex, '--glow': colors[p.color].hex } as React.CSSProperties}>{pawnsHere.length > 1 && <span>{pawnsHere.length}</span>}</div>)}</div>;
        })}
        <div className="center-triangle" />
      </div>
    </div>
  );
}

function getPawnCoord(color: Color, pos: number): [number, number] | null {
  if (pos <= 50) {
    const startIdx = { blue: 0, red: 13, green: 26, yellow: 39 }[color];
    return trackCoords[(startIdx + pos) % 52];
  }
  if (pos <= 55) return homeStretchCoords[color][pos - 51];
  return [7, 7];
}

function PawnBase({ color, active, pawns, turn, legalPawns, phase, onPawnClick }: { color: Color; active: boolean; pawns: Pawns; turn: Color; legalPawns: number[]; phase: GamePhase; onPawnClick: (pawnIndex: number) => void }) {
  if (!active) return <div className="vacant-base">VACANT</div>;
  const basePawns = pawns[color].map((pos, index) => ({ pos, index })).filter((p) => p.pos === -1);
  return (
    <div className="pawn-base">
      {basePawns.map((p) => {
        const isLegal = turn === color && phase === 'move' && legalPawns.includes(p.index);
        return <div key={p.index} className={`base-pawn ${isLegal ? 'legal' : ''}`} style={{ background: colors[color].hex, '--glow': colors[color].hex } as React.CSSProperties} onClick={() => isLegal && onPawnClick(p.index)} />;
      })}
    </div>
  );
}

function MatrixPanel({ onClose, onMinimize, matrixDice, setMatrixDice, unlimited, setUnlimited, applyMe, setApplyMe, applyOpponents, setApplyOpponents }: { onClose: () => void; onMinimize: () => void; matrixDice: number; setMatrixDice: (v: number) => void; unlimited: boolean; setUnlimited: (v: boolean) => void; applyMe: boolean; setApplyMe: (v: boolean) => void; applyOpponents: boolean; setApplyOpponents: (v: boolean) => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragState = useRef<{ touchX: number; touchY: number; startLeft: number; startTop: number; rafId: number | null } | null>(null);

  const clampPos = (left: number, top: number, w: number, h: number) => {
    const maxLeft = window.innerWidth - 40;
    const maxTop = window.innerHeight - 40;
    return {
      left: Math.max(-(w - 60), Math.min(left, maxLeft)),
      top: Math.max(0, Math.min(top, maxTop)),
    };
  };

  const onTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = e.touches[0];
    dragState.current = { touchX: t.clientX, touchY: t.clientY, startLeft: rect.left, startTop: rect.top, rafId: null };
  };

  const onTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - dragState.current.touchX;
    const dy = t.clientY - dragState.current.touchY;
    const rect = panelRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 300;
    const h = rect?.height ?? 300;
    const clamped = clampPos(dragState.current.startLeft + dx, dragState.current.startTop + dy, w, h);
    if (dragState.current.rafId) cancelAnimationFrame(dragState.current.rafId);
    dragState.current.rafId = requestAnimationFrame(() => { setPos(clamped); });
  };

  const onTouchEnd = () => {
    if (dragState.current?.rafId) cancelAnimationFrame(dragState.current.rafId);
    dragState.current = null;
  };

  return <div ref={panelRef} className="matrix-panel matrix-scaled" style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}><div className="matrix-header" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}><span className="drag-handle">:::</span><strong>MATRIX</strong><button onClick={onClose} aria-label="Close matrix"><X size={17} /></button></div><div className="matrix-body" onClick={(event) => { if (event.target === event.currentTarget) onMinimize(); }}><div className="matrix-numbers">{[1, 2, 3, 4, 5, 6].map((value) => <button key={value} className={matrixDice === value ? 'selected' : ''} onClick={() => setMatrixDice(matrixDice === value ? 0 : value)}>{value}</button>)}</div><button className={unlimited ? 'matrix-action active' : 'matrix-action'} onClick={() => setUnlimited(!unlimited)}><Flame size={15} /> Unlimited 6 <Toggle active={unlimited} /></button><MatrixToggle label="Apply to Me" active={applyMe} setActive={setApplyMe} /><MatrixToggle label="Apply to Opponents" active={applyOpponents} setActive={setApplyOpponents} /><p className="matrix-hint">Tap empty space to minimize</p></div></div>;
}

function MatrixHIcon({ onOpen }: { onOpen: () => void }) {
  const iconRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragState = useRef<{ touchX: number; touchY: number; startLeft: number; startTop: number; rafId: number | null; moved: boolean } | null>(null);

  const clampPos = (left: number, top: number) => {
    const size = 52;
    const maxLeft = window.innerWidth - size;
    const maxTop = window.innerHeight - size;
    return { left: Math.max(0, Math.min(left, maxLeft)), top: Math.max(0, Math.min(top, maxTop)) };
  };

  const onTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = e.touches[0];
    dragState.current = { touchX: t.clientX, touchY: t.clientY, startLeft: rect.left, startTop: rect.top, rafId: null, moved: false };
  };

  const onTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - dragState.current.touchX;
    const dy = t.clientY - dragState.current.touchY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragState.current.moved = true;
    const clamped = clampPos(dragState.current.startLeft + dx, dragState.current.startTop + dy);
    if (dragState.current.rafId) cancelAnimationFrame(dragState.current.rafId);
    dragState.current.rafId = requestAnimationFrame(() => { setPos(clamped); });
  };

  const onTouchEnd = () => {
    if (dragState.current?.rafId) cancelAnimationFrame(dragState.current.rafId);
    const wasTap = dragState.current && !dragState.current.moved;
    dragState.current = null;
    if (wasTap) onOpen();
  };

  return <div ref={iconRef} className="matrix-h-icon" style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}><span>H</span></div>;
}

function MatrixToggle({ label, active, setActive }: { label: string; active: boolean; setActive: (v: boolean) => void }) { return <button className="matrix-toggle" onClick={() => setActive(!active)}><span>{label}</span><Toggle active={active} /></button>; }

export default App;
