import {
  GameState,
  Player,
  Planet,
  Ship,
  CardInstance,
  CommandType,
  ClientCommand,
  ShipType,
  ShipState,
  PlanetType,
  PlanetSubType,
  ActiveEffect,
} from './types';
import { CARD_DEFINITIONS, DECK_POOL } from './cardsData';

// Unique ID generators for server-side
export function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
}

// Visual layout dimension parameters
export const MAP_WIDTH = 3000;
export const MAP_HEIGHT = 2000;

// Ship configuration database
export const SHIP_CONFIGS = {
  [ShipType.SCOUT]: {
    hp: 15,
    attack: 0,
    shield: 0,
    speed: 120, // pixels per second
    capturePower: 2, // capture progress per second
    desc: '探索船：无攻击力，占领星系与开采矿物的主力。',
  },
  [ShipType.FRIGATE]: {
    hp: 40,
    attack: 8,
    shield: 20,
    speed: 0, // cannot move from home planet
    capturePower: 0,
    desc: '护卫舰：只能守卫主星球，火力强大。',
  },
  [ShipType.DREADNOUGHT]: {
    hp: 80,
    attack: 15,
    shield: 40,
    speed: 75,
    capturePower: 5,
    desc: '主力舰：强力战斗和占领飞船，速度较慢。',
  },
  [ShipType.SPY]: {
    hp: 10,
    attack: 0,
    shield: 10,
    speed: 100,
    capturePower: 0,
    desc: '间谍船：潜入敌占星系，窃取敌方矿物（使敌方每5秒-2矿物，我方+1矿物）。',
  },
};

// Initial state creation
export function createGame(
  roomId: string,
  playersList: { id: string; name: string; isBot: boolean }[]
): GameState {
  const players: Record<string, Player> = {};
  const planets: Record<string, Planet> = {};
  const ships: Record<string, Ship> = {};

  const colors = [
    '#3b82f6', // Sapphire Blue (Player 1 / Friendly player)
    '#ef4444', // Crimson Red (Player 2 / Enemy player)
    '#10b981', // Emerald Green (Player 3)
    '#ec4899', // Rose Pink (Player 4)
    '#a855f7', // Purple (Player 5)
  ];

  // Map out planet locations asymmetrically for an organic, non-symmetrical strategic RTS battlefield layout
  // 1. Procedural randomized planet placement with minimum spacing constraint
  const positions: { x: number; y: number }[] = [];
  const minDistance = 500; // Expanded spacing by another 2x!
  const maxAttempts = 3000;
  // Generate home planets for each player, plus 8 neutral/resource strategic nodes
  const totalNumPlanets = playersList.length + 8;

  for (let i = 0; i < totalNumPlanets; i++) {
    let found = false;
    let attempts = 0;
    while (!found && attempts < maxAttempts) {
      attempts++;
      // Edge margins: 150 to MAP_WIDTH-150, 150 to MAP_HEIGHT-150
      const rx = 150 + Math.random() * (MAP_WIDTH - 300);
      const ry = 150 + Math.random() * (MAP_HEIGHT - 300);

      let tooClose = false;
      for (const pos of positions) {
        const dx = pos.x - rx;
        const dy = pos.y - ry;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistance) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        positions.push({ x: rx, y: ry });
        found = true;
      }
    }
    if (!found) {
      // Fallback with looser spacing constraint if congested
      const rx = 150 + Math.random() * (MAP_WIDTH - 300);
      const ry = 150 + Math.random() * (MAP_HEIGHT - 300);
      positions.push({ x: rx, y: ry });
    }
  }

  // Shuffle positions to randomly distribute home bases and neutral nodes
  const shuffledPositions = [...positions].sort(() => Math.random() - 0.5);

  // 2. Setup names pool
  const prefixPool = [
    '奥瑞恩', '奥德赛', '泰坦', '塞拉菲姆', '柯罗诺斯', '赫尔墨斯', '索拉里斯',
    '天狼星', '织女星', '仙女座', '猎户座', '普罗米修斯', '美杜莎', '潘多拉',
    '波塞冬', '阿瑞斯', '雅典娜', '阿波罗', '赫拉', '宙斯', '雷神'
  ];
  const shuffledPrefixes = [...prefixPool].sort(() => Math.random() - 0.5);

  // Create Players and their Home Planets (assigned to first shuffled positions)
  playersList.forEach((p, idx) => {
    const factionId = colors[idx % colors.length];
    const homePos = shuffledPositions[idx];
    const homePlanetId = generateId('planet_home');

    // Draw initial 5 cards (restricted to Stage 1 cards at start, since techPoints = 0)
    const hand: CardInstance[] = [];
    const eligibleInitial = DECK_POOL.filter((defId) => {
      const def = CARD_DEFINITIONS[defId];
      return (def?.techStage || 1) <= 1;
    });
    for (let i = 0; i < 5; i++) {
      const defId = eligibleInitial[Math.floor(Math.random() * eligibleInitial.length)];
      hand.push({ id: generateId('card_inst'), definitionId: defId });
    }

    players[p.id] = {
      id: p.id,
      name: p.name,
      factionId,
      minerals: 12, // Starting minerals
      techPoints: 0,
      homePlanetHp: 100,
      isAlive: true,
      hand,
      effects: [],
      isBot: p.isBot,
    };

    planets[homePlanetId] = {
      id: homePlanetId,
      name: `${p.name} 的母星`,
      x: homePos.x,
      y: homePos.y,
      type: PlanetType.HOME,
      ownerId: p.id,
      hp: 100,
      maxHp: 100,
      captureProgress: 100,
      capturingFactionId: null,
      isContested: false,
      debuffs: [],
    };
  });

  // Create 8 neutral/strategic planets distributed on the remaining shuffled positions
  const neutralNodeTypes = [
    { type: PlanetType.RESOURCE, subType: PlanetSubType.MINERAL, nameSuffix: '富矿星' },
    { type: PlanetType.RESOURCE, subType: PlanetSubType.MINERAL, nameSuffix: '碎星矿区' },
    { type: PlanetType.RESOURCE, subType: PlanetSubType.TECH, nameSuffix: '工业重构星' },
    { type: PlanetType.RESOURCE, subType: PlanetSubType.TECH, nameSuffix: '科研枢纽' },
    { type: PlanetType.SPECIAL, subType: PlanetSubType.SHIELD, nameSuffix: '虚空防护星' },
    { type: PlanetType.SPECIAL, subType: PlanetSubType.HEAL, nameSuffix: '生命温床' },
    { type: PlanetType.NEUTRAL, subType: undefined, nameSuffix: '前哨站' },
    { type: PlanetType.NEUTRAL, subType: undefined, nameSuffix: '中转空天站' },
  ];

  neutralNodeTypes.forEach((node, idx) => {
    const posIdx = playersList.length + idx;
    const pos = shuffledPositions[posIdx] || { x: 500, y: 400 };
    const planetId = generateId('planet_neu');
    const prefix = shuffledPrefixes[idx % shuffledPrefixes.length] || '未知';

    planets[planetId] = {
      id: planetId,
      name: `${prefix}${node.nameSuffix}`,
      x: pos.x,
      y: pos.y,
      type: node.type,
      subType: node.subType,
      ownerId: null,
      hp: 100, // Initialized fully to 100% full as requested
      maxHp: 100,
      captureProgress: 0,
      capturingFactionId: null,
      isContested: false,
      debuffs: [],
    };
  });

  // Pre-spawn initial defensive and offensive fleets to make the battlefield immediately feel alive and dynamic as requested
  const spawnInitialShip = (
    ownerId: string,
    planetId: string,
    type: ShipType,
    stateType: ShipState = ShipState.ORBIT
  ) => {
    const shipId = generateId(`ship_init_${type.toLowerCase()}`);
    const pl = planets[planetId];
    if (!pl) return;
    ships[shipId] = {
      id: shipId,
      type,
      ownerId,
      hp: SHIP_CONFIGS[type].hp,
      maxHp: SHIP_CONFIGS[type].hp,
      attack: SHIP_CONFIGS[type].attack,
      shield: SHIP_CONFIGS[type].shield,
      maxShield: SHIP_CONFIGS[type].shield,
      state: stateType,
      planetId,
      targetPlanetId: null,
      x: pl.x + (Math.random() * 40 - 20),
      y: pl.y + (Math.random() * 40 - 20),
      speed: SHIP_CONFIGS[type].speed,
      travelProgress: 0,
      spyDisguisedAs: null,
    };
  };

  // Spawn fleets on players' home planets - each starts with exactly ONE small exploration ship
  Object.keys(players).forEach((pId) => {
    const homePl = Object.values(planets).find(pl => pl.type === PlanetType.HOME && pl.ownerId === pId);
    if (homePl) {
      spawnInitialShip(pId, homePl.id, ShipType.SCOUT);
    }
  });

  return {
    roomId,
    players,
    planets,
    ships,
    gameStarted: true,
    gameOver: false,
    winnerId: null,
    logs: ['太空战役正式打响！通过卡牌发展舰队并派遣占领。'],
  };
}

// Calculate actual mineral cost of card in hand
export function getCardMineralCost(cardDefId: string, player: Player): number {
  const def = CARD_DEFINITIONS[cardDefId];
  if (!def) return 0;

  let cost = def.costMinerals;

  // Check if player has "全民皆兵" (armed_citizenry) in hand
  const hasArmedCitizenry = player.hand.some(
    (c) => c.definitionId === 'armed_citizenry'
  );

  // If it's a ship building card and player has armed_citizenry in hand, cost -1
  const isShipCard =
    cardDefId === 'build_scout' ||
    cardDefId === 'build_frigate' ||
    cardDefId === 'build_dreadnought' ||
    cardDefId === 'spy';

  if (isShipCard && hasArmedCitizenry) {
    cost = Math.max(0, cost - 1);
  }

  return cost;
}

// Handle player playing a card
export function playCard(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targetPlanetId?: string
): GameState {
  const player = state.players[playerId];
  if (!player || !player.isAlive) throw new Error('玩家未激活或已阵亡');

  const cardIdx = player.hand.findIndex((c) => c.id === cardInstanceId);
  if (cardIdx === -1) throw new Error('未在手牌中找到该卡牌');

  const cardInst = player.hand[cardIdx];
  const def = CARD_DEFINITIONS[cardInst.definitionId];
  if (!def) throw new Error('未定义卡牌');

  const costMinerals = getCardMineralCost(def.id, player);
  const costTech = def.costTech;

  if (player.minerals < costMinerals || player.techPoints < costTech) {
    throw new Error('资源不足以打出该卡牌');
  }

  // Find player's home planet id for ship spawning
  const homePlanet = Object.values(state.planets).find(
    (pl) => pl.type === PlanetType.HOME && pl.ownerId === playerId
  );

  if (!homePlanet) {
    throw new Error('未找到主星球，无法施放卡牌');
  }

  // Deduct resources
  player.minerals -= costMinerals;
  player.techPoints -= costTech;

  // Remove card from hand
  player.hand.splice(cardIdx, 1);

  // Trigger effect
  switch (def.id) {
    case 'blood_well': {
      // Add continuous healing effect
      const effectId = generateId('effect');
      player.effects.push({
        id: effectId,
        definitionId: 'blood_well',
        name: '血泉滋养',
        timeLeft: 5,
        maxTime: 5,
      });
      state.logs.unshift(`${player.name} 启动了【血泉】，将每 5 秒为主星球恢复生命值。`);
      break;
    }
    case 'loaded_dice': {
      // Add continuous minerals effect
      const effectId = generateId('effect');
      player.effects.push({
        id: effectId,
        definitionId: 'loaded_dice',
        name: '灌铅骰子',
        timeLeft: 5,
        maxTime: 5,
      });
      state.logs.unshift(`${player.name} 启动了【灌铅骰子】，将每 5 秒获得额外矿物。`);
      break;
    }
    case 'build_scout': {
      const shipId = generateId('ship_scout');
      state.ships[shipId] = {
        id: shipId,
        type: ShipType.SCOUT,
        ownerId: playerId,
        hp: SHIP_CONFIGS[ShipType.SCOUT].hp,
        maxHp: SHIP_CONFIGS[ShipType.SCOUT].hp,
        attack: SHIP_CONFIGS[ShipType.SCOUT].attack,
        shield: SHIP_CONFIGS[ShipType.SCOUT].shield,
        maxShield: SHIP_CONFIGS[ShipType.SCOUT].shield,
        state: ShipState.ORBIT,
        planetId: homePlanet.id,
        targetPlanetId: null,
        x: homePlanet.x + (Math.random() * 40 - 20),
        y: homePlanet.y + (Math.random() * 40 - 20),
        speed: SHIP_CONFIGS[ShipType.SCOUT].speed,
        travelProgress: 0,
        spyDisguisedAs: null,
      };
      state.logs.unshift(`${player.name} 建造了一艘 【探索船】`);
      break;
    }
    case 'build_frigate': {
      const shipId = generateId('ship_frig');
      state.ships[shipId] = {
        id: shipId,
        type: ShipType.FRIGATE,
        ownerId: playerId,
        hp: SHIP_CONFIGS[ShipType.FRIGATE].hp,
        maxHp: SHIP_CONFIGS[ShipType.FRIGATE].hp,
        attack: SHIP_CONFIGS[ShipType.FRIGATE].attack,
        shield: SHIP_CONFIGS[ShipType.FRIGATE].shield,
        maxShield: SHIP_CONFIGS[ShipType.FRIGATE].shield,
        state: ShipState.GUARDING,
        planetId: homePlanet.id,
        targetPlanetId: null,
        x: homePlanet.x + (Math.random() * 50 - 25),
        y: homePlanet.y + (Math.random() * 50 - 25),
        speed: SHIP_CONFIGS[ShipType.FRIGATE].speed,
        travelProgress: 0,
        spyDisguisedAs: null,
      };
      state.logs.unshift(`${player.name} 建造了一艘 【护卫舰】 驻防母星`);
      break;
    }
    case 'build_dreadnought': {
      const shipId = generateId('ship_dread');
      state.ships[shipId] = {
        id: shipId,
        type: ShipType.DREADNOUGHT,
        ownerId: playerId,
        hp: SHIP_CONFIGS[ShipType.DREADNOUGHT].hp,
        maxHp: SHIP_CONFIGS[ShipType.DREADNOUGHT].hp,
        attack: SHIP_CONFIGS[ShipType.DREADNOUGHT].attack,
        shield: SHIP_CONFIGS[ShipType.DREADNOUGHT].shield,
        maxShield: SHIP_CONFIGS[ShipType.DREADNOUGHT].shield,
        state: ShipState.ORBIT,
        planetId: homePlanet.id,
        targetPlanetId: null,
        x: homePlanet.x + (Math.random() * 40 - 20),
        y: homePlanet.y + (Math.random() * 40 - 20),
        speed: SHIP_CONFIGS[ShipType.DREADNOUGHT].speed,
        travelProgress: 0,
        spyDisguisedAs: null,
      };
      state.logs.unshift(`${player.name} 建造了强力主力战舰 【主力舰】`);
      break;
    }
    case 'spy': {
      const shipId = generateId('ship_spy');
      state.ships[shipId] = {
        id: shipId,
        type: ShipType.SPY,
        ownerId: playerId,
        hp: SHIP_CONFIGS[ShipType.SPY].hp,
        maxHp: SHIP_CONFIGS[ShipType.SPY].hp,
        attack: SHIP_CONFIGS[ShipType.SPY].attack,
        shield: SHIP_CONFIGS[ShipType.SPY].shield,
        maxShield: SHIP_CONFIGS[ShipType.SPY].shield,
        state: ShipState.ORBIT,
        planetId: homePlanet.id,
        targetPlanetId: null,
        x: homePlanet.x + (Math.random() * 40 - 20),
        y: homePlanet.y + (Math.random() * 40 - 20),
        speed: SHIP_CONFIGS[ShipType.SPY].speed,
        travelProgress: 0,
        spyDisguisedAs: null,
      };
      state.logs.unshift(`${player.name} 建造了一艘 【间谍船】。将其派遣到敌占星可以实施资源窃取。`);
      break;
    }
    case 'blood_sacrifice': {
      if (player.homePlanetHp <= 25) {
        throw new Error('主星球生命值过低，无法支付生命代价（不可自杀）');
      }

      // Deduct home HP
      player.homePlanetHp -= 25;
      const homePlanetObj = Object.values(state.planets).find(
        (pl) => pl.type === PlanetType.HOME && pl.ownerId === playerId
      );
      if (homePlanetObj) homePlanetObj.hp = player.homePlanetHp;

      // Grant 15 minerals
      player.minerals += 15;

      state.logs.unshift(
        `${player.name} 施放了【血祭】，以 25 点母星生命为代价，换取了 15 点晶体矿资源！`
      );
      break;
    }
    case 'purge': {
      if (!targetPlanetId) throw new Error('【大清洗】 需要指定目标星球');
      const targetPl = state.planets[targetPlanetId];
      if (!targetPl) throw new Error('目标星球未找到');

      // Purge all enemy disguised spies orbiting this planet
      let spiesPurged = 0;
      Object.values(state.ships).forEach((sh) => {
        if (sh.planetId === targetPlanetId && sh.type === ShipType.SPY && sh.ownerId !== playerId) {
          delete state.ships[sh.id];
          spiesPurged++;
        }
      });

      // Clear spy list from planet debuffs
      targetPl.debuffs = [];

      state.logs.unshift(
        `${player.name} 在 ${targetPl.name} 执行了 【大清洗】，消灭了 ${spiesPurged} 艘敌方间谍船并驱散了所有 Debuff！`
      );
      break;
    }
    default:
      break;
  }

  // Draw a replacement card instantly (restricted to player's current tech stage)
  const playerTechStage = Math.floor(player.techPoints / 10) + 1;
  const eligibleCardIds = DECK_POOL.filter((defId) => {
    const def = CARD_DEFINITIONS[defId];
    return (def?.techStage || 1) <= playerTechStage;
  });
  const defId = eligibleCardIds[Math.floor(Math.random() * eligibleCardIds.length)] || DECK_POOL[0];
  player.hand.push({ id: generateId('card_inst'), definitionId: defId });

  return state;
}

// Dispatch fleet command from radial menu
export function dispatchFleet(
  state: GameState,
  playerId: string,
  sourcePlanetId: string,
  targetPlanetId: string,
  shipType: ShipType,
  count: number
): GameState {
  const player = state.players[playerId];
  if (!player || !player.isAlive) throw new Error('玩家未激活或已阵亡');

  const srcPlanet = state.planets[sourcePlanetId];
  const tgtPlanet = state.planets[targetPlanetId];

  if (!srcPlanet || !tgtPlanet) throw new Error('星球未找到');
  if (sourcePlanetId === targetPlanetId) throw new Error('出发地与目的地不能相同');

  // Verify ownership or access
  if (srcPlanet.ownerId !== playerId) {
    // Check if player has active ships orbiting this planet
    const hasShips = Object.values(state.ships).some(
      (s) => s.planetId === sourcePlanetId && s.ownerId === playerId && s.state !== ShipState.MOVING
    );
    if (!hasShips) throw new Error('你在该星球没有任何可调遣飞船');
  }

  // Find idle eligible ships
  const idleShips = Object.values(state.ships).filter(
    (s) =>
      s.ownerId === playerId &&
      s.planetId === sourcePlanetId &&
      s.type === shipType &&
      s.state !== ShipState.MOVING
  );

  if (shipType === ShipType.FRIGATE) {
    throw new Error('护卫舰无法离开所属星球！');
  }

  if (idleShips.length < count) {
    throw new Error(`无可支配的空闲飞船 (请求: ${count}, 空闲: ${idleShips.length})`);
  }

  // Dispatched ships change to moving state, preserving current exact 3D position for direct orbital breakout
  const nowMs = Date.now();
  const shipsToDispatch = idleShips.slice(0, count);
  shipsToDispatch.forEach((sh) => {
    if (srcPlanet) {
      const orbPos = computeShipOrbitPosition(sh, srcPlanet, nowMs);
      sh.startX = orbPos.x;
      sh.startY = orbPos.y;
      sh.startZ = orbPos.z;
      sh.headingAngle = orbPos.headingAngle;
      sh.x = orbPos.x;
      sh.y = orbPos.y;
      sh.z = orbPos.z;
    } else {
      sh.startX = sh.x;
      sh.startY = sh.y;
      sh.startZ = sh.z || 0;
    }
    sh.state = ShipState.MOVING;
    sh.targetPlanetId = targetPlanetId;
    sh.travelProgress = 0;
    sh.lastUpdateMs = nowMs;
  });

  state.logs.unshift(
    `${player.name} 向 ${tgtPlanet.name} 派出了舰队 (飞船: ${shipType === ShipType.SCOUT ? '探索船' : shipType === ShipType.DREADNOUGHT ? '主力舰' : '间谍船'}, 数量: ${count})`
  );

  return state;
}

// Seeded random for deterministic planet radius calculation matching visual renderer
function seededRandom(seedStr: string) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return function () {
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
  };
}

export function getPlanetRadius(planet: Planet): number {
  const rand = seededRandom(planet.id + '_style');
  return Math.floor((22 + rand() * 22) * 2); // 44 to 88 pixels matching getPlanetStyleConfig
}

// Compute deterministic 3D orbit parameters per ship ID
export interface OrbitParams {
  orbitRad: number;
  nodeAngle: number;
  incAngle: number;
  dir: number;
  orbitSpeed: number;
}

export function getShipOrbitParams(sh: Ship, planet: Planet): OrbitParams {
  let hash = 0;
  for (let i = 0; i < sh.id.length; i++) {
    hash = (hash * 31 + sh.id.charCodeAt(i)) & 0x7fffffff;
  }

  const baseSpeed = sh.type === ShipType.SCOUT ? 0.0016 : sh.type === ShipType.SPY ? 0.0013 : sh.type === ShipType.FRIGATE ? 0.0009 : 0.0005;
  const orbitSpeed = baseSpeed * (0.85 + (hash % 4) * 0.12);
  const dir = (hash % 2 === 0) ? 1 : -1;

  // Node angle (longitude of ascending node): golden ratio distribution 0 to 2PI
  const nodeAngle = ((hash % 100) / 100) * Math.PI * 2;

  // Inclination angle: steep, varied 3D orbital planes (-65° to +65°)
  const incDegPattern = [55, -40, 65, -30, 45, -55, 35, -65];
  const incDeg = incDegPattern[hash % incDegPattern.length];
  const incAngle = incDeg * (Math.PI / 180);

  const baseOffset = sh.type === ShipType.SCOUT ? 22 : sh.type === ShipType.FRIGATE ? 34 : sh.type === ShipType.DREADNOUGHT ? 48 : 18;
  const staggerOffset = (hash % 5) * 6 - 12;
  const pRadius = getPlanetRadius(planet);
  const orbitRad = Math.max(pRadius + 14, pRadius + baseOffset + staggerOffset);

  return { orbitRad, nodeAngle, incAngle, dir, orbitSpeed };
}

export function getOrbitPosFromPhase(planet: Planet, params: OrbitParams, phi: number) {
  const u = Math.cos(phi) * params.orbitRad;
  const v = Math.sin(phi) * params.orbitRad;

  const du = -params.dir * Math.sin(phi) * params.orbitRad;
  const dv = params.dir * Math.cos(phi) * params.orbitRad;

  // 1) Rotate by inclination (incAngle) around Y-axis
  const x1 = u * Math.cos(params.incAngle);
  const y1 = v;
  const z1 = -u * Math.sin(params.incAngle);

  const vx1 = du * Math.cos(params.incAngle);
  const vy1 = dv;
  const vz1 = -du * Math.sin(params.incAngle);

  // 2) Rotate by node longitude (nodeAngle) around Z-axis
  const x2 = x1 * Math.cos(params.nodeAngle) - y1 * Math.sin(params.nodeAngle);
  const y2 = x1 * Math.sin(params.nodeAngle) + y1 * Math.cos(params.nodeAngle);
  const z2 = z1;

  const vx2 = vx1 * Math.cos(params.nodeAngle) - vy1 * Math.sin(params.nodeAngle);
  const vy2 = vx1 * Math.sin(params.nodeAngle) + vy1 * Math.cos(params.nodeAngle);
  const vz2 = vz1;

  return {
    x: planet.x + x2,
    y: planet.y + y2,
    z: z2,
    velo3D: { x: vx2, y: vy2, z: vz2 },
    headingAngle: Math.atan2(vy2, vx2),
  };
}

export function getOrbitEntryAngle(sx: number, sy: number, sz: number, planet: Planet, params: OrbitParams): number {
  const px = sx - planet.x;
  const py = sy - planet.y;
  const pz = sz - 0;

  // Un-rotate nodeAngle around Z
  const x1 = px * Math.cos(-params.nodeAngle) - py * Math.sin(-params.nodeAngle);
  const y1 = px * Math.sin(-params.nodeAngle) + py * Math.cos(-params.nodeAngle);
  const z1 = pz;

  // Un-rotate incAngle around Y
  const u_local = x1 * Math.cos(-params.incAngle) - z1 * Math.sin(-params.incAngle);
  const v_local = y1;

  return Math.atan2(v_local, u_local);
}

export function computeShipOrbitPosition(sh: Ship, planet: Planet, nowMs: number) {
  const params = getShipOrbitParams(sh, planet);
  if (sh.orbitPhaseStart === undefined || sh.orbitTimeStart === undefined) {
    let hash = 0;
    for (let i = 0; i < sh.id.length; i++) {
      hash = (hash * 31 + sh.id.charCodeAt(i)) & 0x7fffffff;
    }
    const startPhase = ((hash % 360) * Math.PI) / 180;
    sh.orbitPhaseStart = params.dir * startPhase;
    sh.orbitTimeStart = nowMs;
  }

  const elapsedMs = nowMs - sh.orbitTimeStart;
  const currentPhase = sh.orbitPhaseStart + params.dir * params.orbitSpeed * elapsedMs;
  return getOrbitPosFromPhase(planet, params, currentPhase);
}

// Run a full simulation frame
export function tickGame(state: GameState, dt: number): GameState {
  if (state.gameOver) return state;

  const nowMs = Date.now();

  // 1. Update ship positions, travel status, steering physics, and orbital movement
  Object.values(state.ships).forEach((sh) => {
    if (sh.state === ShipState.MOVING && sh.targetPlanetId) {
      const srcPl = state.planets[sh.planetId];
      const tgtPl = state.planets[sh.targetPlanetId];

      if (tgtPl) {
        let sx = sh.startX;
        let sy = sh.startY;
        let sz = sh.startZ;

        if (sx === undefined || sy === undefined || sz === undefined) {
          if (srcPl) {
            const orbPos = computeShipOrbitPosition(sh, srcPl, nowMs);
            sx = orbPos.x;
            sy = orbPos.y;
            sz = orbPos.z;
            sh.startX = sx;
            sh.startY = sy;
            sh.startZ = sz;
          } else {
            sx = sh.x;
            sy = sh.y;
            sz = sh.z || 0;
          }
        }

        const params = getShipOrbitParams(sh, tgtPl);
        const entryAngle = getOrbitEntryAngle(sx, sy, sz, tgtPl, params);
        const entryPos = getOrbitPosFromPhase(tgtPl, params, entryAngle);

        const dx = entryPos.x - sx;
        const dy = entryPos.y - sy;
        const dz = entryPos.z - sz;
        const dist = Math.hypot(dx, dy, dz);

        if (dist > 0) {
          sh.travelProgress += (sh.speed * dt) / dist;
          sh.lastUpdateMs = nowMs;

          if (sh.travelProgress >= 1.0) {
            // Arrived! Join orbit seamlessly
            sh.planetId = sh.targetPlanetId;
            sh.targetPlanetId = null;
            sh.travelProgress = 0;
            sh.startX = undefined;
            sh.startY = undefined;
            sh.startZ = undefined;

            sh.orbitPhaseStart = entryAngle;
            sh.orbitTimeStart = nowMs;
            sh.x = entryPos.x;
            sh.y = entryPos.y;
            sh.z = entryPos.z;
            sh.headingAngle = entryPos.headingAngle;

            // Determine arrived state
            if (sh.type === ShipType.SPY) {
              sh.state = ShipState.ORBIT;
              if (tgtPl.ownerId && tgtPl.ownerId !== sh.ownerId) {
                sh.spyDisguisedAs = tgtPl.ownerId;
                const alreadyDebuffed = tgtPl.debuffs.some((d) => d.shipId === sh.id);
                if (!alreadyDebuffed) {
                  tgtPl.debuffs.push({
                    id: generateId('debuff'),
                    type: 'spy',
                    ownerId: sh.ownerId,
                    shipId: sh.id,
                  });
                }
              } else {
                sh.spyDisguisedAs = null;
              }
            } else if (sh.type === ShipType.SCOUT) {
              if (tgtPl.type === PlanetType.RESOURCE && tgtPl.ownerId === sh.ownerId) {
                sh.state = ShipState.MINING;
              } else if (tgtPl.ownerId !== sh.ownerId) {
                sh.state = ShipState.CAPTURING;
              } else {
                sh.state = ShipState.ORBIT;
              }
            } else if (sh.type === ShipType.DREADNOUGHT) {
              if (tgtPl.ownerId !== sh.ownerId) {
                sh.state = ShipState.CAPTURING;
              } else {
                sh.state = ShipState.ORBIT;
              }
            } else {
              sh.state = ShipState.ORBIT;
            }
          } else {
            // Interpolate coordinates in 3D directly to orbit insertion point
            const p = sh.travelProgress;
            sh.x = sx + dx * p;
            sh.y = sy + dy * p;
            sh.z = sz + dz * p + Math.sin(Math.PI * p) * Math.min(30, dist * 0.1);

            // Facing angle steering: turn smoothly from current heading toward target angle with max turn rate
            const approachAngle = Math.atan2(dy, dx);
            let desiredAngle = approachAngle;
            if (p >= 0.7) {
              const blend = (p - 0.7) / 0.3;
              let diff = entryPos.headingAngle - approachAngle;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              desiredAngle = approachAngle + diff * blend;
            }

            const currentHeading = sh.headingAngle ?? desiredAngle;
            let angleDiff = desiredAngle - currentHeading;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            const turnRate = sh.type === ShipType.SCOUT ? 3.5 : sh.type === ShipType.DREADNOUGHT ? 1.5 : 2.5;
            const maxTurn = turnRate * dt;

            if (Math.abs(angleDiff) <= maxTurn) {
              sh.headingAngle = desiredAngle;
            } else {
              sh.headingAngle = currentHeading + Math.sign(angleDiff) * maxTurn;
            }
          }
        }
      }
    } else {
      // Deterministic 3D orbit rotation
      const pl = state.planets[sh.planetId];
      if (pl) {
        const orbPos = computeShipOrbitPosition(sh, pl, nowMs);
        sh.x = orbPos.x;
        sh.y = orbPos.y;
        sh.z = orbPos.z;
        sh.headingAngle = orbPos.headingAngle;
      }
    }
  });

  // 2. Real-time Combat Resolution (Grouped per Planet)
  Object.keys(state.planets).forEach((planetId) => {
    const pl = state.planets[planetId];
    // Gather all orbiting ships at this planet (exclude travelling ships)
    const shipsAtPlanet = Object.values(state.ships).filter(
      (sh) => sh.planetId === planetId && sh.state !== ShipState.MOVING
    );

    // Group by owner
    const ownersPresent = Array.from(new Set(shipsAtPlanet.map((sh) => sh.ownerId)));

    // Contested flag: More than one player's active ships are at this planet
    pl.isContested = ownersPresent.length > 1;

    if (pl.isContested) {
      // Resolve continuous real-time combat
      // Non-combat ships (Scouts, Spies) can be shot by combat ships (Frigates, Dreadnoughts)
      shipsAtPlanet.forEach((attacker) => {
        const attackerConfig = SHIP_CONFIGS[attacker.type];
        if (attackerConfig.attack > 0) {
          // Choose a target from other players
          const eligibleTargets = shipsAtPlanet.filter((t) => t.ownerId !== attacker.ownerId);
          if (eligibleTargets.length > 0) {
            // Priority target: enemy combat ships, then explorers/spies
            const combatTargets = eligibleTargets.filter((t) => SHIP_CONFIGS[t.type].attack > 0);
            const chosenTarget =
              combatTargets.length > 0
                ? combatTargets[Math.floor(Math.random() * combatTargets.length)]
                : eligibleTargets[Math.floor(Math.random() * eligibleTargets.length)];

            // Deal damage
            const dmg = attackerConfig.attack * dt;
            if (chosenTarget.shield > 0) {
              chosenTarget.shield = Math.max(0, chosenTarget.shield - dmg);
            } else {
              chosenTarget.hp -= dmg;
            }

            // Remove destroyed ships
            if (chosenTarget.hp <= 0) {
              const victimOwner = state.players[chosenTarget.ownerId]?.name || '未知';
              const killerOwner = state.players[attacker.ownerId]?.name || '未知';
              state.logs.unshift(
                `${killerOwner} 的飞船击毁了 ${victimOwner} 的一艘 ${
                  chosenTarget.type === ShipType.SCOUT ? '探索船' : chosenTarget.type === ShipType.DREADNOUGHT ? '主力战舰' : chosenTarget.type === ShipType.SPY ? '间谍船' : '护卫舰'
                }`
              );

              // Clean up planet spy list if it was a spy
              if (chosenTarget.type === ShipType.SPY) {
                pl.debuffs = pl.debuffs.filter((d) => d.shipId !== chosenTarget.id);
              }

              delete state.ships[chosenTarget.id];
            }
          }
        }
      });
    }

    // 3. Planet Capturing Mechanics
    // Only capture if uncontested AND capturing ships are present
    if (!pl.isContested) {
      const remainingShips = shipsAtPlanet;
      const capturingShips = remainingShips.filter(
        (sh) => sh.type === ShipType.SCOUT || sh.type === ShipType.DREADNOUGHT
      );

      if (capturingShips.length > 0) {
        const capturerId = capturingShips[0].ownerId;
        const capturerPlayer = state.players[capturerId];

        if (capturerPlayer && capturerPlayer.isAlive) {
          // If planet is neutral or owned by someone else
          if (pl.ownerId !== capturerId) {
            // Total capturing speed
            const totalPower = capturingShips.reduce(
              (acc, sh) => acc + SHIP_CONFIGS[sh.type].capturePower,
              0
            );

            pl.capturingFactionId = capturerId;

            if (pl.ownerId !== null) {
              // Reduce existing owner's capture progress first
              pl.captureProgress = Math.max(0, pl.captureProgress - totalPower * dt);
              if (pl.captureProgress === 0) {
                // Relinquish ownership, becomes neutral
                const prevOwnerName = state.players[pl.ownerId]?.name || '中立';
                state.logs.unshift(`${pl.name} 被中立化（原所有者: ${prevOwnerName}）`);
                pl.ownerId = null;
                pl.hp = 0;
              }
            } else {
              // Increase capture progress towards 100
              pl.captureProgress = Math.min(100, pl.captureProgress + totalPower * dt);
              if (pl.captureProgress >= 100) {
                // Planet fully captured!
                pl.ownerId = capturerId;
                pl.capturingFactionId = null;
                state.logs.unshift(`🎉 ${capturerPlayer.name} 成功占领了星系: ${pl.name}！`);

                // Convert captured explorers state to mining / orbit
                capturingShips.forEach((sh) => {
                  if (sh.type === ShipType.SCOUT && pl.type === PlanetType.RESOURCE) {
                    sh.state = ShipState.MINING;
                  } else {
                    sh.state = ShipState.ORBIT;
                  }
                });
              }
            }
          } else {
            // Already owned, recover health/capture progress to 100
            pl.captureProgress = Math.min(100, pl.captureProgress + 5 * dt);
            pl.capturingFactionId = null;
          }
        }
      } else {
        // No capturing ships present, progress slowly decays if neutral
        if (pl.ownerId === null && pl.captureProgress > 0) {
          pl.captureProgress = Math.max(0, pl.captureProgress - 4 * dt);
          if (pl.captureProgress === 0) {
            pl.capturingFactionId = null;
          }
        }
      }
    }
  });

  // 4. Resource Income generation & Continuous card ticker timers
  Object.values(state.players).forEach((player) => {
    if (!player.isAlive) return;

    // A. Mining scout rates (+1 item per 5s) => continuous (1/5) * dt
    const ownedPlanets = Object.values(state.planets).filter((pl) => pl.ownerId === player.id);
    ownedPlanets.forEach((pl) => {
      if (pl.type === PlanetType.RESOURCE) {
        // Count mining scouts orbiting
        const miners = Object.values(state.ships).filter(
          (sh) => sh.planetId === pl.id && sh.ownerId === player.id && sh.type === ShipType.SCOUT
        );
        const count = miners.length;

        if (count > 0) {
          if (pl.subType === PlanetSubType.MINERAL) {
            player.minerals += (1 / 5) * count * dt;
          } else if (pl.subType === PlanetSubType.TECH) {
            player.techPoints += (1 / 5) * count * dt;
          }
        }
      } else if (pl.type === PlanetType.SPECIAL) {
        // Special planets regeneration mechanics
        const orbitingFriendlyShips = Object.values(state.ships).filter(
          (sh) => sh.planetId === pl.id && sh.ownerId === player.id && sh.state !== ShipState.MOVING
        );

        orbitingFriendlyShips.forEach((sh) => {
          if (pl.subType === PlanetSubType.HEAL) {
            // Heal ship hp
            sh.hp = Math.min(sh.maxHp, sh.hp + 2 * dt);
          } else if (pl.subType === PlanetSubType.SHIELD) {
            // Regen shield
            sh.shield = Math.min(sh.maxShield, sh.shield + 5 * dt);
          }
        });
      }
    });

    // B. Base passive income: 0.4 mineral / second
    player.minerals += 0.4 * dt;

    // C. Continuous card effects
    player.effects.forEach((eff) => {
      eff.timeLeft -= dt;
      if (eff.timeLeft <= 0) {
        eff.timeLeft = eff.maxTime; // reset trigger
        if (eff.definitionId === 'blood_well') {
          player.homePlanetHp = Math.min(100, player.homePlanetHp + 5);
          // Sync with planet hp
          const homePl = Object.values(state.planets).find(
            (pl) => pl.type === PlanetType.HOME && pl.ownerId === player.id
          );
          if (homePl) homePl.hp = player.homePlanetHp;
        } else if (eff.definitionId === 'loaded_dice') {
          player.minerals += 2;
        }
      }
    });

    // D. Spy stealing resolution
    // Spies orbiting other player's planet drain 2 minerals, give 1 mineral to spy owner every 5 seconds.
    // Let's implement it inside a global timer or continuously:
    // drain = 2/5 * dt, yield = 1/5 * dt per spy
    const spiesOwned = Object.values(state.ships).filter(
      (sh) => sh.type === ShipType.SPY && sh.ownerId === player.id && sh.state !== ShipState.MOVING
    );

    spiesOwned.forEach((spy) => {
      const pl = state.planets[spy.planetId];
      if (pl && pl.ownerId && pl.ownerId !== player.id) {
        const victim = state.players[pl.ownerId];
        if (victim && victim.isAlive) {
          const drain = (2 / 5) * dt;
          const actualDrain = Math.min(victim.minerals, drain);
          victim.minerals -= actualDrain;
          player.minerals += (1 / 5) * dt; // gains 1/5 minerals per sec
        }
      }
    });
  });

  // 5. Check Game Over / Victory Conditions
  const activePlayers = Object.values(state.players).filter((p) => p.isAlive);
  activePlayers.forEach((p) => {
    // A player dies if home HP falls to 0
    const homePl = Object.values(state.planets).find(
      (pl) => pl.type === PlanetType.HOME && pl.ownerId === p.id
    );

    if (homePl && homePl.hp <= 0) {
      p.isAlive = false;
      state.logs.unshift(`💀 ${p.name} 的母星被彻底摧毁了！该玩家宣告出局！`);

      // Destroy all their ships
      Object.keys(state.ships).forEach((shipId) => {
        if (state.ships[shipId].ownerId === p.id) {
          delete state.ships[shipId];
        }
      });

      // Relinquish all owned planets
      Object.values(state.planets).forEach((pl) => {
        if (pl.ownerId === p.id) {
          pl.ownerId = null;
          pl.captureProgress = 0;
          pl.capturingFactionId = null;
          pl.isContested = false;
          pl.debuffs = [];
        }
      });
    }
  });

  const survivors = Object.values(state.players).filter((p) => p.isAlive);
  if (survivors.length <= 1 && state.gameStarted) {
    state.gameOver = true;
    state.winnerId = survivors.length === 1 ? survivors[0].id : null;
    const winnerName = state.winnerId ? state.players[state.winnerId].name : '无生还者';
    state.logs.unshift(`🏆 战役结束！获胜者: ${winnerName}`);
  }

  return state;
}

// Autonomous Bot AI strategy logic
export function runBotAI(state: GameState, botId: string): ClientCommand | null {
  const bot = state.players[botId];
  if (!bot || !bot.isAlive) return null;

  // 1. Deciding which card to play
  for (let i = 0; i < bot.hand.length; i++) {
    const cardInst = bot.hand[i];
    const def = CARD_DEFINITIONS[cardInst.definitionId];
    if (!def) continue;

    const mineralCost = getCardMineralCost(def.id, bot);
    const techCost = def.costTech;

    if (bot.minerals >= mineralCost && bot.techPoints >= techCost) {
      // Logic triggers based on card definition
      if (def.id === 'blood_well' && bot.homePlanetHp < 80) {
        return {
          type: CommandType.PLAY_CARD,
          cardInstanceId: cardInst.id,
        };
      }
      if (def.id === 'loaded_dice') {
        return {
          type: CommandType.PLAY_CARD,
          cardInstanceId: cardInst.id,
        };
      }
      if (
        def.id === 'build_scout' ||
        def.id === 'build_frigate' ||
        def.id === 'build_dreadnought' ||
        def.id === 'spy'
      ) {
        // Build ships if affordable and hand mineral levels are good
        return {
          type: CommandType.PLAY_CARD,
          cardInstanceId: cardInst.id,
        };
      }

      // If low health on home, play Blood Well anyway
      if (def.id === 'blood_well' && bot.homePlanetHp < 60) {
        return {
          type: CommandType.PLAY_CARD,
          cardInstanceId: cardInst.id,
        };
      }

      // Purge if spy debuffs exist on our home planet
      if (def.id === 'purge') {
        const homePlanet = Object.values(state.planets).find(
          (pl) => pl.type === PlanetType.HOME && pl.ownerId === botId
        );
        if (homePlanet && homePlanet.debuffs.length > 0) {
          return {
            type: CommandType.PLAY_CARD,
            cardInstanceId: cardInst.id,
            targetPlanetId: homePlanet.id,
          };
        }
      }

      // Blood sacrifice to convert HP to minerals when minerals are low and HP is healthy
      if (def.id === 'blood_sacrifice' && bot.homePlanetHp > 45 && bot.minerals < 8) {
        return {
          type: CommandType.PLAY_CARD,
          cardInstanceId: cardInst.id,
        };
      }
    }
  }

  // 2. Dispatching fleet decisions (cooldown/throttle simulated by caller on server)
  // Find bot-owned planets or planets containing bot ships
  const activePlanets = Object.values(state.planets).filter(
    (pl) =>
      pl.ownerId === botId ||
      Object.values(state.ships).some(
        (sh) => sh.planetId === pl.id && sh.ownerId === botId && sh.state !== ShipState.MOVING
      )
  );

  if (activePlanets.length > 0) {
    const srcPl = activePlanets[Math.floor(Math.random() * activePlanets.length)];

    // Get idle scouts and dreadnoughts at this source planet
    const idleScouts = Object.values(state.ships).filter(
      (sh) =>
        sh.ownerId === botId &&
        sh.planetId === srcPl.id &&
        sh.type === ShipType.SCOUT &&
        sh.state !== ShipState.MOVING
    );

    const idleDreads = Object.values(state.ships).filter(
      (sh) =>
        sh.ownerId === botId &&
        sh.planetId === srcPl.id &&
        sh.type === ShipType.DREADNOUGHT &&
        sh.state !== ShipState.MOVING
    );

    const idleSpies = Object.values(state.ships).filter(
      (sh) =>
        sh.ownerId === botId &&
        sh.planetId === srcPl.id &&
        sh.type === ShipType.SPY &&
        sh.state !== ShipState.MOVING
    );

    // Target choices: resource planets, neutral planets, or other homes
    const targets = Object.values(state.planets).filter((pl) => pl.id !== srcPl.id);

    if (targets.length > 0) {
      const tgtPl = targets[Math.floor(Math.random() * targets.length)];

      // Rules based on ship availability:
      if (idleDreads.length > 0) {
        // Attack/conquer! Send all dreadnoughts
        return {
          type: CommandType.DISPATCH_FLEET,
          sourcePlanetId: srcPl.id,
          targetPlanetId: tgtPl.id,
          shipType: ShipType.DREADNOUGHT,
          count: idleDreads.length,
        };
      }

      if (idleScouts.length > 0) {
        // Send scouts to capture neutral/resource or mine owned resource
        return {
          type: CommandType.DISPATCH_FLEET,
          sourcePlanetId: srcPl.id,
          targetPlanetId: tgtPl.id,
          shipType: ShipType.SCOUT,
          count: Math.min(2, idleScouts.length), // Send 1 or 2
        };
      }

      if (idleSpies.length > 0 && tgtPl.ownerId && tgtPl.ownerId !== botId) {
        // Send spy to enemy planet
        return {
          type: CommandType.DISPATCH_FLEET,
          sourcePlanetId: srcPl.id,
          targetPlanetId: tgtPl.id,
          shipType: ShipType.SPY,
          count: 1,
        };
      }
    }
  }

  return null;
}
