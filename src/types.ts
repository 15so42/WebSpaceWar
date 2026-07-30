export type PlayerId = string;
export type PlanetId = string;
export type ShipId = string;
export type CardInstanceId = string;

export enum CardType {
  CONTINUOUS = 'continuous',
  ABILITY = 'ability',
  INSTANT = 'instant',
}

export enum ShipType {
  SCOUT = 'scout',
  FRIGATE = 'frigate',
  DREADNOUGHT = 'dreadnought',
  SPY = 'spy',
}

export enum PlanetType {
  HOME = 'home',
  RESOURCE = 'resource',
  NEUTRAL = 'neutral',
  SPECIAL = 'special',
}

export enum PlanetSubType {
  MINERAL = 'mineral',
  TECH = 'tech',
  HEAL = 'heal',
  SHIELD = 'shield',
}

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  costMinerals: number;
  costTech: number;
  description: string;
  techStage?: number;
}

export interface CardInstance {
  id: CardInstanceId;
  definitionId: string;
}

export interface ActiveEffect {
  id: string;
  definitionId: string;
  name: string;
  timeLeft: number; // in seconds until next trigger
  maxTime: number;  // trigger interval (e.g. 5s)
}

export interface Player {
  id: PlayerId;
  name: string;
  factionId: string; // Faction/Player color identification
  minerals: number;
  techPoints: number;
  homePlanetHp: number;
  isAlive: boolean;
  hand: CardInstance[];
  effects: ActiveEffect[];
  isBot: boolean;
}

export interface Planet {
  id: PlanetId;
  name: string;
  x: number;
  y: number;
  type: PlanetType;
  subType?: PlanetSubType;
  ownerId: PlayerId | null; // owner player id
  hp: number; // Only for HOME planet
  maxHp: number;
  captureProgress: number; // 0 to 100
  capturingFactionId: PlayerId | null; // which player faction is capturing it
  isContested: boolean; // multiple hostile players present
  debuffs: {
    id: string;
    type: 'spy';
    ownerId: PlayerId; // spy's real owner
    shipId: string;
  }[];
}

export enum ShipState {
  ORBIT = 'orbit',
  MOVING = 'moving',
  MINING = 'mining',
  CAPTURING = 'capturing',
  GUARDING = 'guarding',
}

export interface Ship {
  id: ShipId;
  type: ShipType;
  ownerId: PlayerId;
  hp: number;
  maxHp: number;
  attack: number;
  shield: number;
  maxShield: number;
  state: ShipState;
  planetId: PlanetId; // current orbit planet or starting point
  targetPlanetId: PlanetId | null; // destination if moving
  x: number; // visual x
  y: number; // visual y
  z?: number; // visual z
  headingAngle?: number; // facing direction angle
  // Chosen once when a ship reaches its target altitude. +1/-1 determines
  // which way the continuous distance-guided flight circles the planet.
  orbitDirection?: 1 | -1;
  speed: number;
  spyDisguisedAs: PlayerId | null; // client view uses this if spy is disguised
}

export interface GameState {
  roomId: string;
  players: Record<PlayerId, Player>;
  planets: Record<PlanetId, Planet>;
  ships: Record<ShipId, Ship>;
  gameStarted: boolean;
  gameOver: boolean;
  winnerId: PlayerId | null;
  logs: string[];
}

export interface LobbyInfo {
  roomId: string;
  playerCount: number;
  maxPlayers: number;
  gameStarted: boolean;
}

// Client to Server Commands
export enum CommandType {
  JOIN_ROOM = 'join_room',
  START_GAME = 'start_game',
  PLAY_CARD = 'play_card',
  DISPATCH_FLEET = 'dispatch_fleet',
  ADD_BOT = 'add_bot',
  LEAVE_ROOM = 'leave_room',
}

export interface JoinRoomCommand {
  type: CommandType.JOIN_ROOM;
  roomId: string;
  playerName: string;
  playerId: string;
}

export interface StartGameCommand {
  type: CommandType.START_GAME;
}

export interface PlayCardCommand {
  type: CommandType.PLAY_CARD;
  cardInstanceId: string;
  targetPlanetId?: string;
  targetPlayerId?: string;
}

export interface DispatchFleetCommand {
  type: CommandType.DISPATCH_FLEET;
  sourcePlanetId: string;
  targetPlanetId: string;
  shipType: ShipType;
  count: number;
}

export interface AddBotCommand {
  type: CommandType.ADD_BOT;
}

export interface LeaveRoomCommand {
  type: CommandType.LEAVE_ROOM;
}

export type ClientCommand =
  | JoinRoomCommand
  | StartGameCommand
  | PlayCardCommand
  | DispatchFleetCommand
  | AddBotCommand
  | LeaveRoomCommand;

// Server to Client Messages
export enum MessageType {
  ROOM_STATE = 'room_state',
  JOIN_SUCCESS = 'join_success',
  ERROR = 'error',
  LOBBY_LIST = 'lobby_list',
}

export interface RoomStateMessage {
  type: MessageType.ROOM_STATE;
  state: GameState;
  playerId: PlayerId;
  /** Host wall-clock time at which this snapshot was emitted. Presentation only. */
  serverTimeMs: number;
}

export interface JoinSuccessMessage {
  type: MessageType.JOIN_SUCCESS;
  playerId: PlayerId;
  roomId: string;
}

export interface ErrorMessage {
  type: MessageType.ERROR;
  message: string;
}

export interface LobbyListMessage {
  type: MessageType.LOBBY_LIST;
  lobbies: LobbyInfo[];
}

export type ServerMessage =
  | RoomStateMessage
  | JoinSuccessMessage
  | ErrorMessage
  | LobbyListMessage;
