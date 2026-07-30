import React, { useRef, useEffect, useState, MouseEvent, useMemo, useCallback } from 'react';
import { GameState, Planet, Ship, ShipType, ShipState, PlanetType, PlanetSubType } from '../types';
import { SHIP_CONFIGS, MAP_WIDTH, MAP_HEIGHT, computeShipOrbitPosition, getShipOrbitParams, getOrbitEntryAngle, getOrbitPosFromPhase } from '../gameEngine';
import { Target, Shield, Compass, Swords, Eye, X, ChevronRight, Sliders, Sun, Camera, RotateCcw, Activity } from 'lucide-react';

interface SpaceBattlefieldProps {
  state: GameState;
  playerId: string;
  onDispatchFleet: (sourceId: string, targetId: string, shipType: ShipType, count: number) => void;
  onPlayCardTarget: (planetId: string) => void;
  selectedCardId: string | null;
  setSelectedCardId: (id: string | null) => void;
}

interface RadialMenuState {
  isOpen: boolean;
  sourcePlanetId: string;
  targetPlanetId: string;
  x: number;
  y: number;
}

// 3D Perspective Camera Parameters & F3 Debug Interface
export interface DebugSettings {
  f3Open: boolean;
  lightX: number;
  lightY: number;
  lightZ: number;
  pitch: number;      // Camera Pitch angle in degrees (0 = top-down)
  yaw: number;        // Camera Yaw angle in degrees
  cameraD: number;    // Camera Distance / Height
  focalLength: number;// Focal length
  nameOffsetY: number;// Planet Name Y Offset relative to health bar
  iconOffsetY: number;// Planet Icon Y Offset relative to planet name
}

export const defaultDebugSettings: DebugSettings = {
  f3Open: false,
  lightX: -0.354,
  lightY: -0.354,
  lightZ: 0.866,
  pitch: 0,
  yaw: 0,
  cameraD: 1564,
  focalLength: 1000,
  nameOffsetY: -8,  // Brought closer to health bar
  iconOffsetY: -13, // Brought closer to planet name
};

// Global mutable debug settings reference for 60FPS canvas loop access
export let currentDebugSettings: DebugSettings = { ...defaultDebugSettings };

let PITCH = 0; // Legacy fallback pitch
let YAW = 0;   // Legacy fallback yaw
let D = 1564;  // Legacy fallback camera distance
let FOCAL_LENGTH = 1000; // Legacy fallback focal length

// Shared global zoom factor for perspective calculations
let globalCurrentZoom = 1.0;

interface Vertex3D {
  x: number;
  y: number;
  z: number;
}

interface SphereFace {
  indices: number[];
  colorType: 'water' | 'shore' | 'land' | 'mountain' | 'ice' | 'grid' | 'storm' | 'band';
  noiseVal: number;
  centerLocal: Vertex3D;
  normalLocal: Vertex3D;
}

interface PlanetCachedData {
  vertices: Vertex3D[];
  faces: SphereFace[];
  cloudVertices?: Vertex3D[];
  cloudFaces?: SphereFace[];
  style: {
    primaryColor: string;
    waterColors: string[];
    landColors: string[];
    hasClouds: boolean;
    hasRing: boolean;
    ringColor: string;
    atmosphereColor: string;
    radius: number;
    ringParticles?: Array<{
      r: number;
      thetaOffset: number;
      size: number;
      color: string;
      speed: number;
    }>;
  };
}

interface RingSegment {
  p0: { x: number; y: number; z: number; scale: number };
  p1: { x: number; y: number; z: number; scale: number };
  p2: { x: number; y: number; z: number; scale: number };
  p3: { x: number; y: number; z: number; scale: number };
  depth: number;
}

interface BackgroundStar {
  x: number;
  y: number;
  size: number;
  color: string;
  twinkleSpeed: number;
  twinkleOffset: number;
  depth: number;
}

interface BackgroundNebula {
  x: number;
  y: number;
  radius: number;
  color: string;
  depth: number;
}

// Global planet cache to keep performance at a buttery smooth 60 FPS
const planetCache: Record<string, PlanetCachedData> = {};

// --- 3D Procedural Generator & Shading Cache ---
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

// Lightweight 3D Perlin Noise for high-fidelity planet generation
class SeededNoise3D {
  private perm: number[] = [];
  constructor(seed: string) {
    const rand = seededRandom(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const temp = p[i];
      p[i] = p[j];
      p[j] = temp;
    }
    this.perm = [...p, ...p];
  }

  private fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number) {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number, z: number) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  public noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);

    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;

    return this.lerp(
      w,
      this.lerp(
        v,
        this.lerp(u, this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z)),
        this.lerp(u, this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z))
      ),
      this.lerp(
        v,
        this.lerp(u, this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1)),
        this.lerp(u, this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1))
      )
    );
  }

  public fbm(x: number, y: number, z: number, octaves = 3): number {
    let value = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.noise(x * frequency, y * frequency, z * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value / maxValue;
  }
}

// Converts HEX faction or accent colors to RGBA easily
function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  const rgb = result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 100, g: 110, b: 130 };
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Scale RGB values based on light incidence
function getShadedColor(baseHex: string, brightness: number): string {
  const rgb = hexToRgb(baseHex) || { r: 120, g: 120, b: 120 };
  const r = Math.round(rgb.r * brightness);
  const g = Math.round(rgb.g * brightness);
  const b = Math.round(rgb.b * brightness);
  return `rgb(${r}, ${g}, ${b})`;
}

// Projects any 3D coordinate in the world space onto the 2D Canvas screen space
export function projectPoint(
  wx: number,
  wy: number,
  wz: number,
  focus: { x: number; y: number },
  width: number,
  height: number
) {
  const dx = wx - focus.x;
  const dy = wy - focus.y;
  const dz = wz;

  const pitchRad = (currentDebugSettings?.pitch ?? 0) * (Math.PI / 180);
  const yawRad = (currentDebugSettings?.yaw ?? 0) * (Math.PI / 180);
  const camD = currentDebugSettings?.cameraD ?? 1564;
  const fLength = currentDebugSettings?.focalLength ?? 1000;

  const cosY = Math.cos(yawRad);
  const sinY = Math.sin(yawRad);
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);

  // 1. Rotate around Z (Yaw)
  const rx1 = dx * cosY - dy * sinY;
  const ry1 = dx * sinY + dy * cosY;
  const rz1 = dz;

  // 2. Rotate around X (Pitch)
  const rx2 = rx1;
  const ry2 = ry1 * cosP - rz1 * sinP;
  const rz2 = ry1 * sinP + rz1 * cosP;

  const depth = (camD / globalCurrentZoom) + rz2;
  const scale = (fLength * globalCurrentZoom) / Math.max(100, depth);

  const sx = width / 2 + rx2 * scale;
  const sy = height / 2 + ry2 * scale;

  return { x: sx, y: sy, z: depth, scale };
}

// Generate the procedural aesthetics style mapping for a planet
function getPlanetStyleConfig(planet: Planet, ownerColor?: string) {
  const rand = seededRandom(planet.id + '_style');

  let primaryColor = ownerColor || '#38bdf8';
  let waterColors = ['#0a122c', '#0f1b40', '#152654']; // deep, medium, shallow blue
  let landColors = ['#3d563f', '#4e6d50', '#5e8561', '#709d73', '#82b585']; // beautiful desaturated greens (sage, forest, moss)
  let hasClouds = true;
  let hasRing = false;
  let ringColor = 'rgba(56, 189, 248, 0)';
  let atmosphereColor = 'rgba(14, 165, 233, 0.25)';

  // Random sizes for all planets (doubled 2x size as requested)
  const radius = Math.floor((22 + rand() * 22) * 2); // 44 to 88 pixels: doubled 2x planet visual size


  if (planet.type === PlanetType.HOME) {
    const baseCol = ownerColor || '#3b82f6';
    primaryColor = baseCol;
    waterColors = ['#060c22', '#0a1436', '#10204d'];
    landColors = ['#324634', '#415a43', '#506f52', '#618663', '#729d74']; // premium desaturated green
    hasClouds = true;
    hasRing = rand() > 0.65; // 35% chance for home planets to have defensive orbital rings
    ringColor = hexToRgba(baseCol, 0.45);
    atmosphereColor = hexToRgba(baseCol, 0.3);
  } else if (planet.type === PlanetType.RESOURCE) {
    if (planet.subType === PlanetSubType.MINERAL) {
      primaryColor = '#c084fc';
      waterColors = ['#080a1e', '#0d1230', '#131d45'];
      landColors = ['#2e3240', '#3b4052', '#4b5266', '#7c5ba6', '#9a7ecc']; // desat dark stone with subtle violet crystals
      hasClouds = true;
      hasRing = rand() > 0.65; // 35% chance for mineral giant rings!
      ringColor = 'rgba(192, 132, 252, 0.55)';
      atmosphereColor = 'rgba(192, 132, 252, 0.3)';
    } else {
      primaryColor = '#06b6d4';
      waterColors = ['#050a1a', '#0a1330', '#0e1d47'];
      landColors = ['#283c3e', '#324c4e', '#3c5a5d', '#0891b2', '#22d3ee']; // dark teal-gray with bright cyan nodes
      hasClouds = false;
      hasRing = rand() > 0.8; // 20% chance
      ringColor = 'rgba(6, 182, 212, 0.5)';
      atmosphereColor = 'rgba(6, 182, 212, 0.3)';
    }
  } else if (planet.type === PlanetType.SPECIAL) {
    if (planet.subType === PlanetSubType.HEAL) {
      primaryColor = '#10b981';
      waterColors = ['#04091c', '#081330', '#0e2254'];
      landColors = ['#2a4030', '#36523e', '#43654d', '#10b981', '#34d399']; // deep desat green with soft emerald highlight clusters
      hasClouds = true;
      hasRing = rand() > 0.8; // 20% chance
      ringColor = 'rgba(16, 185, 129, 0.45)';
      atmosphereColor = 'rgba(52, 211, 153, 0.3)';
    } else {
      primaryColor = '#0284c7';
      waterColors = ['#050d22', '#0a173a', '#102354'];
      landColors = ['#2b3c46', '#374d59', '#445e6d', '#0284c7', '#38bdf8']; // cold steel/blue tiles
      hasClouds = true;
      hasRing = rand() > 0.7; // 30% chance for tactical shield ring structures!
      ringColor = 'rgba(14, 165, 233, 0.55)';
      atmosphereColor = 'rgba(14, 165, 233, 0.3)';
    }
  } else {
    primaryColor = '#f59e0b';
    waterColors = ['#080a1c', '#0d1230', '#141c4f'];
    landColors = ['#3d3a33', '#4d4940', '#5e594f', '#f59e0b', '#fbbf24']; // desert clay and gold ores
    hasClouds = rand() > 0.4;
    hasRing = rand() > 0.85; // 15% chance for generic neutral planets
    ringColor = 'rgba(245, 158, 11, 0.45)';
    atmosphereColor = 'rgba(245, 158, 11, 0.25)';
  }

  // Generate 3D meteorite particles if hasRing is true
  let ringParticles: Array<{ r: number; thetaOffset: number; size: number; color: string; speed: number; }> | undefined = undefined;
  if (hasRing) {
    ringParticles = [];
    const count = Math.floor(140 + rand() * 80); // 140 to 220 orbiting meteorites for dense, solid ring appearance
    for (let i = 0; i < count; i++) {
      const pRand = seededRandom(planet.id + '_ring_p_' + i);
      
      // Distribute into two extremely tight concentric bands to form a perfect structured ring system with a gap division
      const beltSelect = pRand();
      let r = 1.6;
      if (beltSelect > 0.45) {
        // Inner dense belt: radius 1.48 to 1.64 (width 0.16)
        r = 1.48 + pRand() * 0.16;
      } else {
        // Outer dense belt: radius 1.70 to 1.86 (width 0.16)
        r = 1.70 + pRand() * 0.16;
      }
      
      const thetaOffset = pRand() * Math.PI * 2;
      const size = 0.5 + pRand() * 1.5; // smaller, finer particles for a clean, non-clunky dust belt
      
      // Keplerian speed (inner particles rotate faster: 1/r^1.5 approx)
      const speed = (0.12 + pRand() * 0.12) * (1.0 / (r * Math.sqrt(r)));
      
      const colSelect = pRand();
      let color = ringColor;
      if (colSelect > 0.65) {
        // rocky grey/brown meteorite shade
        const greyVal = Math.floor(110 + pRand() * 70);
        color = `rgba(${greyVal}, ${greyVal - Math.floor(pRand() * 10)}, ${greyVal - Math.floor(pRand() * 20)}, ${0.55 + pRand() * 0.45})`;
      } else if (colSelect > 0.25) {
        // planet-accented crystal/dust shade
        color = hexToRgba(primaryColor, 0.35 + pRand() * 0.45);
      } else {
        // bright icy white reflection
        color = `rgba(255, 255, 255, ${0.65 + pRand() * 0.35})`;
      }
      ringParticles.push({ r, thetaOffset, size, color, speed });
    }
  }

  return { primaryColor, waterColors, landColors, hasClouds, hasRing, ringColor, atmosphereColor, radius, ringParticles };
}

// Procedurally generates detailed vertices, faces, and cloud meshes for the planet (simplified stub since we render pixels procedurally)
function generatePlanetData(planet: Planet, ownerFactionColor?: string): PlanetCachedData {
  const style = getPlanetStyleConfig(planet, ownerFactionColor);
  return {
    vertices: [],
    faces: [],
    style,
  };
}

// Retro pixel-art color palettes for each planet category to achieve high-quality handcrafted game-asset styling
function getPixelPlanetPalette(pl: Planet, factionColor?: string) {
  if (pl.type === PlanetType.HOME) {
    const baseCol = factionColor || '#38bdf8';
    const s1 = getShadedColor(baseCol, 0.45);
    const s2 = baseCol;
    const s3 = getShadedColor(baseCol, 1.35);

    const ds1 = getShadedColor(s1, 0.7);
    const ds2 = getShadedColor(s2, 0.8);
    const ds3 = getShadedColor(s3, 0.8);

    return {
      deepWater: ['#060a1f', '#091230', '#11204d'],
      water: ['#091230', '#11204d', '#1b3270'],
      shore: ['#141930', '#252e59', '#3b4a8c'],
      land: [s1, s2, s3],
      forest: [ds1, ds2, ds3],
      mountain: ['#94a3b8', '#cbd5e1', '#f1f5f9'],
      ice: ['#cbd5e1', '#e2e8f0', '#ffffff']
    };
  }

  if (pl.type === PlanetType.RESOURCE) {
    if (pl.subType === PlanetSubType.MINERAL) {
      // Purple crystal planet
      return {
        deepWater: ['#120421', '#230940', '#3a1169'],
        water: ['#230940', '#3a1169', '#571c9c'],
        shore: ['#191524', '#2d2640', '#443b5e'],
        land: ['#0f0d14', '#1e1a26', '#312c3d'],
        forest: ['#511e82', '#7b35bf', '#aa64ed'],
        mountain: ['#8f40e6', '#be81ff', '#e8d4ff'],
        ice: ['#d8b4fe', '#f3e8ff', '#ffffff']
      };
    } else {
      // TECH: cyber teal/cyan planet
      return {
        deepWater: ['#020a12', '#051524', '#0a253d'],
        water: ['#051524', '#0a253d', '#113e66'],
        shore: ['#0d1a24', '#1c3245', '#2c4a63'],
        land: ['#0a0e14', '#161d2b', '#263147'],
        forest: ['#005d73', '#0891b2', '#22d3ee'],
        mountain: ['#0e7490', '#67e8f9', '#cffafe'],
        ice: ['#22d3ee', '#ecfeff', '#ffffff']
      };
    }
  }

  if (pl.type === PlanetType.SPECIAL) {
    if (pl.subType === PlanetSubType.HEAL) {
      // Emerald / Gaia garden
      return {
        deepWater: ['#030a14', '#061326', '#0b2345'],
        water: ['#061326', '#0b2345', '#123970'],
        shore: ['#121d1b', '#243b35', '#395c52'],
        land: ['#0a2e16', '#145c2c', '#209145'],
        forest: ['#064e3b', '#10b981', '#34d399'],
        mountain: ['#047857', '#a7f3d0', '#ecfdf5'],
        ice: ['#10b981', '#f0fdf4', '#ffffff']
      };
    } else {
      // SHIELD: blue/steel shield ice planet
      return {
        deepWater: ['#020612', '#050f26', '#091b45'],
        water: ['#050f26', '#091b45', '#0f2d70'],
        shore: ['#111929', '#21304f', '#364d7d'],
        land: ['#111622', '#242e47', '#3c4c73'],
        forest: ['#035380', '#0284c7', '#38bdf8'],
        mountain: ['#0284c7', '#bae6fd', '#f0f9ff'],
        ice: ['#38bdf8', '#f0f9ff', '#ffffff']
      };
    }
  }

  // NEUTRAL planets get beautifully diversified procedurally so that every node feels unique!
  const rand = seededRandom(pl.id + '_pixel_palette');
  const randVal = rand();
  if (randVal < 0.25) {
    // 1. Ice / Tundra (beautiful pale blue, snow & white tundra)
    return {
      deepWater: ['#050b1e', '#0a1538', '#11235c'],
      water: ['#0a1538', '#11235c', '#1b368c'],
      shore: ['#122238', '#233e63', '#396196'],
      land: ['#1b2d3d', '#334e68', '#4b6e8f'],
      forest: ['#4b6e8f', '#9fb3c8', '#bcccdc'],
      mountain: ['#9fb3c8', '#f0f4f8', '#ffffff'],
      ice: ['#d9e2ec', '#f0f4f8', '#ffffff']
    };
  } else if (randVal < 0.5) {
    // 2. Volcanic / Lava (dark stone, bright glowing red/orange lava)
    return {
      deepWater: ['#170503', '#2e0a06', '#4a110a'], // lava shadow
      water: ['#2e0a06', '#4a110a', '#991b1b'], // lava base
      shore: ['#f97316', '#ea580c', '#ca8a04'], // glowing flows
      land: ['#0d0c0c', '#1a1818', '#2e2b2b'], // volcanic rock shadow
      forest: ['#1a1818', '#2e2b2b', '#454040'], // volcanic rock base
      mountain: ['#b91c1c', '#f97316', '#fdba74'], // hot magma highlights
      ice: ['#ea580c', '#fdba74', '#ffedd5']
    };
  } else if (randVal < 0.75) {
    // 3. Terran / Jungle (sandy shore, emerald forest, grassy lands, deep oceans)
    return {
      deepWater: ['#030a1a', '#061433', '#0a2354'],
      water: ['#061433', '#0a2354', '#103985'],
      shore: ['#423420', '#7a603a', '#bfa073'], // golden sandy shores
      land: ['#173315', '#2a5c26', '#3f8c3a'], // green grass
      forest: ['#0e2612', '#1b4721', '#286b32'], // dense jungle trees
      mountain: ['#3e5c3b', '#628f5d', '#8fc989'],
      ice: ['#e2e8f0', '#f1f5f9', '#ffffff']
    };
  } else {
    // 4. Desert / Copper / Clay canyons (original)
    return {
      deepWater: ['#0a0705', '#140f0a', '#241a11'],
      water: ['#140f0a', '#241a11', '#38281a'],
      shore: ['#1c1611', '#30251c', '#4a3a2c'],
      land: ['#3b1f0b', '#633513', '#9c531d'], // red desert dust
      forest: ['#573418', '#8f5527', '#c2793e'], // copper sands
      mountain: ['#9e5f0d', '#d98214', '#f5a63d'], // golden dunes
      ice: ['#fbbf24', '#fef08a', '#ffffff']
    };
  }
}

// Draw a beautiful procedural layered 3D planet with depth-sorted orbital satellite rings
function draw3DPlanetWithLayers(
  ctx: CanvasRenderingContext2D,
  pl: Planet,
  camFocus: { x: number; y: number },
  width: number,
  height: number,
  planetColor: string,
  isHovered: boolean
) {
  let cache = planetCache[pl.id];
  if (!cache) {
    cache = generatePlanetData(pl, planetColor);
    planetCache[pl.id] = cache;
  } else {
    const expectedStyle = getPlanetStyleConfig(pl, planetColor);
    if (cache.style.primaryColor !== expectedStyle.primaryColor) {
      cache = generatePlanetData(pl, planetColor);
      planetCache[pl.id] = cache;
    }
  }

  const R = cache.style.radius;
  const projCenter = projectPoint(pl.x, pl.y, 0, camFocus, width, height);
  const screenR = R * projCenter.scale;

  // Let the planet surface have radius = 1.0 (normalized)
  // Let the clouds float above the surface at radius = 1.12
  const cMult = 1.12; // Cloud altitude

  // --- 3D Ring Meteorites Depth-Sorting and Projection Math ---
  const backParticles: any[] = [];
  const frontParticles: any[] = [];

  const getRingPoint = (rVal: number, theta: number) => {
    const rx0 = rVal * Math.cos(theta);
    const ry0 = rVal * Math.sin(theta);
    
    // 18-degree axial tilt to make it look visually magnificent and tilted
    const beta = 0.31; // pitch tilt of ring plane
    const alpha = 0.8; // yaw rotation of ring plane
    
    const rx1 = rx0;
    const ry1 = ry0 * Math.cos(beta);
    const rz1 = ry0 * Math.sin(beta);
    
    const wx = pl.x + (rx1 * Math.cos(alpha) - ry1 * Math.sin(alpha));
    const wy = pl.y + (rx1 * Math.sin(alpha) + ry1 * Math.cos(alpha));
    const wz = rz1;
    
    return projectPoint(wx, wy, wz, camFocus, width, height);
  };

  if (cache.style.hasRing && cache.style.ringParticles) {
    const elapsedSeconds = Date.now() / 1000;
    cache.style.ringParticles.forEach((part) => {
      // Calculate current angle based on its speed and starting offset
      const currentTheta = part.thetaOffset + part.speed * elapsedSeconds;
      const p = getRingPoint(part.r * R, currentTheta);
      
      const particleRender = {
        x: p.x,
        y: p.y,
        size: part.size * p.scale,
        color: part.color,
        z: p.z
      };
      
      // Depth-sort relative to the planet's projected center z-depth
      if (p.z > projCenter.z + 0.05) {
        backParticles.push(particleRender);
      } else {
        frontParticles.push(particleRender);
      }
    });
    
    // Sort particles from back to front
    backParticles.sort((a, b) => b.z - a.z);
    frontParticles.sort((a, b) => b.z - a.z);
  }

  const drawRingParticles = (parts: any[]) => {
    parts.forEach((part) => {
      ctx.fillStyle = part.color;
      if (part.size > 2) {
        ctx.fillRect(Math.floor(part.x - part.size / 2), Math.floor(part.y - part.size / 2), Math.ceil(part.size), Math.ceil(part.size));
      } else {
        ctx.fillRect(Math.floor(part.x), Math.floor(part.y), Math.max(1, Math.ceil(part.size)), Math.max(1, Math.ceil(part.size)));
      }
    });
  };

  // --- Draw BACK Particles of the 3D Ring ---
  drawRingParticles(backParticles);

  // 2. Procedural Volumetric 3D Pixel Shader for Core Planet, Clouds & Fading Atmosphere
  const screenR_render = screenR * 1.30; // Cover atmosphere too
  const res = 34; // Retro pixel grid resolution
  const pixelSize = (screenR_render * 2) / res;
  const startX = projCenter.x - screenR_render;
  const startY = projCenter.y - screenR_render;
  const halfRes = res / 2;

  // Seeded noise objects for landmass and clouds
  const noise = new SeededNoise3D(pl.id);
  const cloudNoise = new SeededNoise3D(pl.id + '_pixel_clouds');

  // Slow 3D rotation angles
  const spinSpeed = 0.00015;
  const angle = Date.now() * spinSpeed + (pl.id.charCodeAt(pl.id.length - 1) * 15);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const cloudAngle = -Date.now() * (spinSpeed * 1.35) + (pl.id.charCodeAt(pl.id.length - 1) * 32);
  const cosAC = Math.cos(cloudAngle);
  const sinAC = Math.sin(cloudAngle);

  // Directional Toon Lighting source (from debug settings)
  const rawLx = currentDebugSettings.lightX ?? -0.354;
  const rawLy = currentDebugSettings.lightY ?? -0.354;
  const rawLz = currentDebugSettings.lightZ ?? 0.866;
  const lLen = Math.hypot(rawLx, rawLy, rawLz) || 1;
  const L = { x: rawLx / lLen, y: rawLy / lLen, z: rawLz / lLen };

  // Select custom color palette
  const palette = getPixelPlanetPalette(pl, planetColor);

  // 12-degree axial tilt
  const tilt = 0.22;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  // Draw pixel grid
  for (let px = 0; px < res; px++) {
    const colStart = Math.round(startX + px * pixelSize);
    const colEnd = Math.round(startX + (px + 1) * pixelSize);
    const w = colEnd - colStart;

    for (let py = 0; py < res; py++) {
      const rowStart = Math.round(startY + py * pixelSize);
      const rowEnd = Math.round(startY + (py + 1) * pixelSize);
      const h_px = rowEnd - rowStart;

      // Coordinates normalized to atmosphere render bounds [-1.0, 1.0]
      const dx_render = (px - halfRes + 0.5) / halfRes;
      const dy_render = (py - halfRes + 0.5) / halfRes;
      const distSq_render = dx_render * dx_render + dy_render * dy_render;

      if (distSq_render > 1.0) continue; // Outside atmosphere render bounds

      // Calculate atmosphere 3D hemisphere coordinates to find normal and apply lighting
      const dz_render = Math.sqrt(Math.max(0, 1.0 - distSq_render));
      const dot_atmo = dx_render * L.x + dy_render * L.y + dz_render * L.z;
      // Map dot_atmo to a light multiplier that dims the shadow side of the atmosphere
      const atmoLight = Math.max(0.04, Math.min(1.0, (dot_atmo + 0.25) / 1.15));

      // Convert coordinates back to original screenR_cloud scale
      const cMult_render = 1.30 / 1.12; // screenR_render / screenR_cloud
      const dx = dx_render * cMult_render;
      const dy = dy_render * cMult_render;
      const distSq = dx * dx + dy * dy;

      if (distSq > 1.0) {
        // --- Pixelated Fading Atmosphere Glow Outside Clouds ---
        const dist = Math.sqrt(distSq);
        const maxDist = 1.30 / 1.12;
        const t = (dist - 1.0) / (maxDist - 1.0);
        // Fades beautifully outwards and respects global shading
        const opacity = Math.max(0, 0.40 * Math.pow(1 - t, 1.4)) * atmoLight;
        if (opacity > 0.01) {
          ctx.fillStyle = hexToRgba(cache.style.primaryColor, opacity);
          ctx.fillRect(colStart, rowStart, w, h_px);
        }
        continue;
      }

      let isCloudPixel = false;
      let cloudColor = '';

      // Check Cloud Layer
      if (cache.style.hasClouds) {
        const dz_c = Math.sqrt(1.0 - distSq);

        // Apply axial tilt to clouds
        const tx_c = dx * cosT - dy * sinT;
        const ty_c = dx * sinT + dy * cosT;
        const tz_c = dz_c;

        // 3D rotation around Y-axis for clouds
        const rcx = tx_c * cosAC - tz_c * sinAC;
        const rcy = ty_c;
        const rcz = tx_c * sinAC + tz_c * cosAC;

        // FBM noise for clouds (no quantization of coordinates to avoid popping!)
        const ch = cloudNoise.fbm(rcx * 1.5, rcy * 1.5, rcz * 1.5, 2);

        if (ch > 0.16) {
          isCloudPixel = true;
          const dot_c = dx * L.x + dy * L.y + dz_c * L.z;
          // Atmospheric light intensity on cloud layer
          const cloudLight = Math.max(0.06, Math.min(1.0, (dot_c + 0.35) / 1.15));

          if (dot_c > 0.22) {
            cloudColor = '#ffffff';
          } else if (dot_c > -0.25) {
            cloudColor = '#cbd5e1';
          } else {
            cloudColor = '#475569';
          }

          // Apply global directional light to clouds
          cloudColor = getShadedColor(cloudColor, cloudLight);
        }
      }

      if (isCloudPixel) {
        ctx.fillStyle = cloudColor;
        ctx.fillRect(colStart, rowStart, w, h_px);
        continue;
      }

      // Check Planet Surface (radius <= 1.0, scaled relative to screenR_cloud)
      const dx_p = dx * cMult;
      const dy_p = dy * cMult;
      const distSq_p = dx_p * dx_p + dy_p * dy_p;

      if (distSq_p <= 1.0) {
        // Crisp outline around the core
        if (distSq_p > 0.91) {
          ctx.fillStyle = '#080c1d';
          ctx.fillRect(colStart, rowStart, w, h_px);
          continue;
        }

        const dz_p = Math.sqrt(1.0 - distSq_p);

        // Apply axial tilt to planet
        const tx_p = dx_p * cosT - dy_p * sinT;
        const ty_p = dx_p * sinT + dy_p * cosT;
        const tz_p = dz_p;

        // 3D rotation around Y-axis for planet
        const rx = tx_p * cosA - tz_p * sinA;
        const ry = ty_p;
        const rz = tx_p * sinA + tz_p * cosA;

        // FBM noise for terrain (no quantization of coordinates to ensure perfect stability!)
        const h = noise.fbm(rx * 1.8, ry * 1.8, rz * 1.8, 3);

        const dot_p = dx_p * L.x + dy_p * L.y + dz_p * L.z;
        // Surface illumination intensity that drops off smoothly into space shadow
        const surfLight = Math.max(0.08, Math.min(1.0, (dot_p + 0.30) / 1.10));

        let shadeIndex = 1; // Midtone
        if (dot_p > 0.22) {
          shadeIndex = 2; // Highlight
        } else if (dot_p < -0.25) {
          shadeIndex = 0; // Shadow
        }

        let terrainColor = '#ffffff';
        if (h < -0.15) {
          terrainColor = palette.deepWater[shadeIndex];
        } else if (h < 0.04) {
          terrainColor = palette.water[shadeIndex];
        } else if (h < 0.15) {
          terrainColor = palette.shore[shadeIndex];
        } else if (h < 0.45) {
          terrainColor = palette.land[shadeIndex];
        } else if (h < 0.68) {
          terrainColor = palette.forest[shadeIndex];
        } else {
          terrainColor = palette.mountain[shadeIndex];
        }

        // Apply global directional light to terrain
        terrainColor = getShadedColor(terrainColor, surfLight);

        ctx.fillStyle = terrainColor;
        ctx.fillRect(colStart, rowStart, w, h_px);
      } else {
        // Inside cloud bounds but outside planet surface, and not a cloud pixel!
        // Draw the pixelated atmosphere here
        const dist = Math.sqrt(distSq);
        const maxDist = 1.30 / 1.12;
        const t = (dist - 1.0) / (maxDist - 1.0);
        // Fades beautifully outwards and respects global shading
        const opacity = Math.max(0, 0.40 * Math.pow(1 - t, 1.4)) * atmoLight;
        if (opacity > 0.01) {
          ctx.fillStyle = hexToRgba(cache.style.primaryColor, opacity);
          ctx.fillRect(colStart, rowStart, w, h_px);
        }
      }
    }
  }

  // --- Draw FRONT Particles of the 3D Ring ---
  drawRingParticles(frontParticles);


}

// Draw elegant flat horizontal helper circles on the 3D plane in perspective projection
function draw3DFlatCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  camFocus: { x: number; y: number },
  width: number,
  height: number,
  strokeStyle: string,
  lineWidth: number,
  lineDash?: number[],
  startAngle = 0,
  endAngle = Math.PI * 2
) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  if (lineDash) ctx.setLineDash(lineDash);

  ctx.beginPath();
  const steps = 60;
  const angleRange = endAngle - startAngle;

  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (i / steps) * angleRange;
    const wx = cx + Math.cos(a) * r;
    const wy = cy + Math.sin(a) * r;
    const proj = projectPoint(wx, wy, 0, camFocus, width, height);
    if (i === 0) ctx.moveTo(proj.x, proj.y);
    else ctx.lineTo(proj.x, proj.y);
  }
  ctx.stroke();
  if (lineDash) ctx.setLineDash([]);
}

// Draw elegant tilted helper circles on the 3D plane in perspective projection
function draw3DTiltedCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  camFocus: { x: number; y: number },
  width: number,
  height: number,
  strokeStyle: string,
  lineWidth: number,
  lineDash?: number[],
  startAngle = 0,
  endAngle = Math.PI * 2
) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  if (lineDash) ctx.setLineDash(lineDash);

  ctx.beginPath();
  const steps = 60;
  const angleRange = endAngle - startAngle;

  // 18-degree axial tilt to make it look visually magnificent and tilted
  const beta = 0.31; // pitch tilt of ring plane
  const alpha = 0.8; // yaw rotation of ring plane

  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (i / steps) * angleRange;
    const rx0 = r * Math.cos(a);
    const ry0 = r * Math.sin(a);
    
    const rx1 = rx0;
    const ry1 = ry0 * Math.cos(beta);
    const rz1 = ry0 * Math.sin(beta);
    
    const wx = cx + (rx1 * Math.cos(alpha) - ry1 * Math.sin(alpha));
    const wy = cy + (rx1 * Math.sin(alpha) + ry1 * Math.cos(alpha));
    const wz = rz1;

    const proj = projectPoint(wx, wy, wz, camFocus, width, height);
    if (i === 0) ctx.moveTo(proj.x, proj.y);
    else ctx.lineTo(proj.x, proj.y);
  }
  ctx.stroke();
  if (lineDash) ctx.setLineDash([]);
}

// Procedurally draws beautiful, high-detail 3D spacecraft scaling with perspective camera depth
function draw3DShip(
  ctx: CanvasRenderingContext2D,
  type: ShipType,
  sx: number, // world X
  sy: number, // world Y
  sz: number, // world Z
  headingAngle: number,
  baseColorHex: string,
  isMoving: boolean,
  camFocus: { x: number; y: number },
  width: number,
  height: number,
  planetCenter?: { x: number; y: number; z?: number },
  velo3D?: { x: number; y: number; z: number }
) {
  const scale = (type === ShipType.DREADNOUGHT ? 0.90 : type === ShipType.FRIGATE ? 0.72 : type === ShipType.SPY ? 0.58 : 0.52) * 2.0;
  const baseRgb = hexToRgb(baseColorHex) || { r: 255, g: 255, b: 255 };

  interface ShipFace {
    indices: number[];
    isGlow?: boolean;
    glowColor?: string;
    isDarkPanel?: boolean;
  }

  let vertices: Vertex3D[] = [];
  let faces: ShipFace[] = [];

  if (type === ShipType.SCOUT) {
    // High-speed Interceptor: Sleek needle nose, dual delta wings, glowing canopy
    vertices = [
      { x: 18, y: 0, z: 0 },       // 0: Nose tip
      { x: 3, y: 0, z: 3.5 },       // 1: Canopy top peak
      { x: 3, y: 0, z: -2.0 },      // 2: Belly mid
      { x: -6, y: -13, z: -1.0 },   // 3: Left wingtip
      { x: -6, y: 13, z: -1.0 },    // 4: Right wingtip
      { x: -4, y: -4, z: 1.0 },     // 5: Left wing root top
      { x: -4, y: 4, z: 1.0 },      // 6: Right wing root top
      { x: -14, y: 0, z: 5.5 },     // 7: Tail fin top peak
      { x: -14, y: -4, z: -0.5 },   // 8: Left engine nozzle
      { x: -14, y: 4, z: -0.5 },    // 9: Right engine nozzle
      { x: 10, y: 0, z: 1.5 },      // 10: Canopy front slope
    ];
    faces = [
      // Cockpit Windshield (Glowing Cyan Accent)
      { indices: [0, 10, 1], isGlow: true, glowColor: '#38bdf8' },
      { indices: [10, 6, 1], isGlow: true, glowColor: '#0284c7' },
      { indices: [10, 1, 5], isGlow: true, glowColor: '#0284c7' },

      // Nose & Upper Fuselage
      { indices: [0, 5, 10] },
      { indices: [0, 10, 6] },
      { indices: [0, 2, 5] },
      { indices: [0, 6, 2] },

      // Wings Top
      { indices: [10, 3, 5], isDarkPanel: true },
      { indices: [10, 6, 4], isDarkPanel: true },
      { indices: [5, 3, 8] },
      { indices: [6, 9, 4] },

      // Wings Bottom
      { indices: [2, 3, 8] },
      { indices: [2, 9, 4] },

      // Tail Vertical Stabilizer Fin
      { indices: [1, 7, 8] },
      { indices: [1, 9, 7] },

      // Engine Exhaust Rear
      { indices: [8, 7, 9], isGlow: true, glowColor: '#f97316' },
    ];
  } else if (type === ShipType.FRIGATE) {
    // Heavy Escort Frigate: Wedge bow, dorsal bridge, side weapon sponsons, quad engines
    vertices = [
      { x: 22, y: -3.5, z: 0.5 },   // 0: Left bow tip
      { x: 22, y: 3.5, z: 0.5 },    // 1: Right bow tip
      { x: 14, y: 0, z: -2.0 },     // 2: Bow center notch
      { x: 6, y: 0, z: 6.5 },       // 3: Dorsal bridge peak
      { x: 12, y: 0, z: 3.0 },      // 4: Bridge visor front
      { x: -6, y: -15, z: -1.5 },   // 5: Left wingtip sponson
      { x: -6, y: 15, z: -1.5 },    // 6: Right wingtip sponson
      { x: -2, y: -6, z: 2.0 },     // 7: Upper left hull ridge
      { x: -2, y: 6, z: 2.0 },      // 8: Upper right hull ridge
      { x: -16, y: -6, z: 1.0 },    // 9: Stern left engine bay
      { x: -16, y: 6, z: 1.0 },     // 10: Stern right engine bay
      { x: -16, y: 0, z: -3.5 },    // 11: Stern lower keel
    ];
    faces = [
      // Command Bridge Visor (Glowing Amber Accent)
      { indices: [4, 3, 7], isGlow: true, glowColor: '#fbbf24' },
      { indices: [4, 8, 3], isGlow: true, glowColor: '#f59e0b' },

      // Bow Prow Plates
      { indices: [0, 4, 1] },
      { indices: [0, 2, 4] },
      { indices: [1, 4, 2] },

      // Hull Sponsons / Wings
      { indices: [0, 7, 5], isDarkPanel: true },
      { indices: [1, 6, 8], isDarkPanel: true },
      { indices: [5, 7, 9] },
      { indices: [6, 10, 8] },

      // Dorsal Armor Deck
      { indices: [3, 9, 7] },
      { indices: [3, 8, 10] },
      { indices: [3, 10, 9] },

      // Keel & Underbelly
      { indices: [2, 5, 11] },
      { indices: [2, 11, 6] },

      // Thruster Exhaust Block
      { indices: [9, 10, 11], isGlow: true, glowColor: '#a855f7' },
    ];
  } else if (type === ShipType.DREADNOUGHT) {
    // Capital Battlecruiser: Heavy armored prow, dual broadside decks, towering bridge, quad heavy engines
    vertices = [
      { x: 28, y: 0, z: 1.0 },      // 0: Prow ramming tip
      { x: 18, y: -4, z: 4.5 },     // 1: Bow upper left ridge
      { x: 18, y: 4, z: 4.5 },      // 2: Bow upper right ridge
      { x: 16, y: 0, z: -4.5 },     // 3: Bow lower keel
      { x: 0, y: -19, z: -1.5 },    // 4: Left broadside wingtip
      { x: 0, y: 19, z: -1.5 },     // 5: Right broadside wingtip
      { x: -4, y: 0, z: 11.5 },     // 6: Citadel Command Tower Top
      { x: 4, y: 0, z: 7.0 },       // 7: Citadel Bridge Front
      { x: -20, y: -9, z: 0.5 },    // 8: Stern left thruster casing
      { x: -20, y: 9, z: 0.5 },     // 9: Stern right thruster casing
      { x: -22, y: 0, z: -2.5 },    // 10: Stern main center exhaust
      { x: -8, y: -8, z: 3.0 },     // 11: Middeck left armor plate
      { x: -8, y: 8, z: 3.0 },      // 12: Middeck right armor plate
    ];
    faces = [
      // Citadel Command Visor (Glowing Royal Blue/Cyan)
      { indices: [7, 6, 11], isGlow: true, glowColor: '#38bdf8' },
      { indices: [7, 12, 6], isGlow: true, glowColor: '#0284c7' },

      // Heavy Prow Armor Shield
      { indices: [0, 1, 7] },
      { indices: [0, 7, 2] },
      { indices: [0, 3, 1] },
      { indices: [0, 2, 3] },

      // Broadside Deck Wings
      { indices: [1, 4, 11], isDarkPanel: true },
      { indices: [2, 12, 5], isDarkPanel: true },
      { indices: [4, 8, 11] },
      { indices: [5, 12, 9] },

      // Middeck Citadel Spire
      { indices: [7, 11, 12] },
      { indices: [6, 8, 11] },
      { indices: [6, 12, 9] },

      // Underbelly Keel Armor
      { indices: [3, 4, 10] },
      { indices: [3, 10, 5] },

      // Heavy Stern Engine Quad Exhaust
      { indices: [8, 9, 10], isGlow: true, glowColor: '#38bdf8' },
    ];
  } else {
    // Spy Stealth Vessel: Diamond razor wing, glowing sensor dome
    vertices = [
      { x: 18, y: 0, z: 0 },        // 0: Stealth prow tip
      { x: -6, y: -16, z: -1.0 },   // 1: Left razor wingtip
      { x: -6, y: 16, z: -1.0 },    // 2: Right razor wingtip
      { x: 0, y: 0, z: 5.0 },       // 3: Stealth sensor dome top
      { x: 6, y: 0, z: 2.5 },       // 4: Sensor dome front slope
      { x: -14, y: -6, z: 2.0 },    // 5: Left tail fin peak
      { x: -14, y: 6, z: 2.0 },     // 6: Right tail fin peak
      { x: -14, y: 0, z: -2.5 },    // 7: Rear stealth engine port
    ];
    faces = [
      // Stealth Sensor Dome (Glowing Purple Crystal Matrix)
      { indices: [4, 3, 1], isGlow: true, glowColor: '#c084fc' },
      { indices: [4, 2, 3], isGlow: true, glowColor: '#a855f7' },

      // Stealth Faceted Top Wings
      { indices: [0, 4, 1] },
      { indices: [0, 2, 4] },
      { indices: [1, 5, 7] },
      { indices: [2, 7, 6] },

      // Belly Stealth Hull
      { indices: [0, 1, 7], isDarkPanel: true },
      { indices: [0, 7, 2], isDarkPanel: true },

      // Twin Tail Fins
      { indices: [3, 5, 7] },
      { indices: [3, 7, 6] },

      // Engine Glow
      { indices: [5, 6, 7], isGlow: true, glowColor: '#e066ff' },
    ];
  }

  // 1. Calculate Forward Unit Vector f
  let fx = Math.cos(headingAngle);
  let fy = Math.sin(headingAngle);
  let fz = 0;

  if (velo3D) {
    const vMag = Math.sqrt(velo3D.x * velo3D.x + velo3D.y * velo3D.y + velo3D.z * velo3D.z);
    if (vMag > 0.0001) {
      fx = velo3D.x / vMag;
      fy = velo3D.y / vMag;
      fz = velo3D.z / vMag;
    }
  }

  // 2. Calculate Gravity Up Unit Vector u (Roof/top points along +u, Belly/ground points along -u towards planet center)
  let ux = 0;
  let uy = 0;
  let uz = 1;

  if (planetCenter) {
    const pcZ = planetCenter.z ?? 0;
    const rx = sx - planetCenter.x;
    const ry = sy - planetCenter.y;
    const rz = sz - pcZ;
    const rMag = Math.sqrt(rx * rx + ry * ry + rz * rz);

    if (rMag > 0.001) {
      // Radially outward vector from planet center to ship
      const urx = rx / rMag;
      const ury = ry / rMag;
      const urz = rz / rMag;

      // Orthonormalize u against f
      const dotUF = urx * fx + ury * fy + urz * fz;
      let ox = urx - dotUF * fx;
      let oy = ury - dotUF * fy;
      let oz = urz - dotUF * fz;
      const oMag = Math.sqrt(ox * ox + oy * oy + oz * oz);

      if (oMag > 0.001) {
        ux = ox / oMag;
        uy = oy / oMag;
        uz = oz / oMag;
      }
    }
  }

  // 3. Calculate Right/Starboard Unit Vector s = u x f
  let sx_unit = uy * fz - uz * fy;
  let sy_unit = uz * fx - ux * fz;
  let sz_unit = ux * fy - uy * fx;
  const sMag = Math.sqrt(sx_unit * sx_unit + sy_unit * sy_unit + sz_unit * sz_unit);
  if (sMag > 0.001) {
    sx_unit /= sMag;
    sy_unit /= sMag;
    sz_unit /= sMag;
  }

  // Rotate, translate, and project vertices using full 3D orthonormal basis matrix
  interface TransformedVertex {
    rx: number;
    ry: number;
    rz: number;
    projected: { x: number; y: number; z: number; scale: number };
  }

  const transformedVertices: TransformedVertex[] = vertices.map((v) => {
    const lx = v.x * scale;
    const ly = v.y * scale;
    const lz = v.z * scale;

    const rx = lx * fx + ly * sx_unit + lz * ux;
    const ry = lx * fy + ly * sy_unit + lz * uy;
    const rz = lx * fz + ly * sz_unit + lz * uz;

    const wx = sx + rx;
    const wy = sy + ry;
    const wz = sz + rz;

    return {
      rx, ry, rz,
      projected: projectPoint(wx, wy, wz, camFocus, width, height)
    };
  });

  const projected = transformedVertices.map((tv) => tv.projected);

  const light = { x: -0.5, y: -0.5, z: 0.7 };
  const mag = Math.sqrt(light.x * light.x + light.y * light.y + light.z * light.z);
  light.x /= mag; light.y /= mag; light.z /= mag;

  const faceDepths = faces.map((faceObj, index) => {
    const sumZ = faceObj.indices.reduce((acc, idx) => acc + projected[idx].z, 0);
    return { index, avgZ: sumZ / faceObj.indices.length };
  });
  faceDepths.sort((a, b) => a.avgZ - b.avgZ);

  faceDepths.forEach(({ index }) => {
    const faceObj = faces[index];
    const face = faceObj.indices;
    const p0 = projected[face[0]];
    const p1 = projected[face[1]];
    const p2 = projected[face[2]];

    const val = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
    if (val >= 0) return;

    const tv0 = transformedVertices[face[0]];
    const tv1 = transformedVertices[face[1]];
    const tv2 = transformedVertices[face[2]];

    const ux_edge = tv1.rx - tv0.rx;
    const uy_edge = tv1.ry - tv0.ry;
    const uz_edge = tv1.rz - tv0.rz;

    const wx_edge = tv2.rx - tv0.rx;
    const wy_edge = tv2.ry - tv0.ry;
    const wz_edge = tv2.rz - tv0.rz;

    let nx = uy_edge * wz_edge - uz_edge * wy_edge;
    let ny = uz_edge * wx_edge - ux_edge * wz_edge;
    let nz = ux_edge * wy_edge - uy_edge * wx_edge;
    const nMag = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nMag > 0) {
      nx /= nMag; ny /= nMag; nz /= nMag;
    }

    const dot = nx * light.x + ny * light.y + nz * light.z;
    const brightness = Math.max(0.30, (dot + 1) / 2);

    if (faceObj.isGlow && faceObj.glowColor) {
      ctx.fillStyle = faceObj.glowColor;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.8;
    } else {
      const mult = faceObj.isDarkPanel ? 0.65 : 1.0;
      const r = Math.round(baseRgb.r * brightness * mult);
      const g = Math.round(baseRgb.g * brightness * mult);
      const b = Math.round(baseRgb.b * brightness * mult);

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.strokeStyle = `rgba(${Math.min(255, Math.round(r * 1.35))}, ${Math.min(255, Math.round(g * 1.35))}, ${Math.min(255, Math.round(b * 1.35))}, 0.55)`;
      ctx.lineWidth = 0.7;
    }

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < face.length; i++) {
      ctx.lineTo(projected[face[i]].x, projected[face[i]].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  if (isMoving) {
    // Engine thruster particle jet
    for (let d = 1; d <= 4; d++) {
      const trailDist = (d * 5 + Math.random() * 2) * scale;
      const rearX = sx - fx * trailDist;
      const rearY = sy - fy * trailDist;
      const rearZ = sz - fz * trailDist;

      const projRear = projectPoint(rearX, rearY, rearZ, camFocus, width, height);
      const alpha = (0.85 - d * 0.18) * (0.65 + Math.random() * 0.35);

      ctx.fillStyle = type === ShipType.DREADNOUGHT ? '#38bdf8' : type === ShipType.FRIGATE ? '#a855f7' : '#f97316';
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.beginPath();
      ctx.arc(projRear.x, projRear.y, Math.max(0.4, (6.0 - d * 1.1) * projRear.scale * 0.65), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }
}

// Generate stable procedural star systems and deep space nebula clouds for background scrolling
const generateBackgroundAssets = (): { stars: BackgroundStar[]; nebulae: BackgroundNebula[] } => {
  const stars: BackgroundStar[] = [];
  const nebulae: BackgroundNebula[] = [];

  const rand = seededRandom('galaxy_nebula_field_seed_882');

  // Distant twinkling stellar field
  for (let i = 0; i < 350; i++) {
    const depth = 0.04 + rand() * 0.16;
    const size = 0.35 + rand() * 1.15;

    const starColors = ['#ffffff', '#e0f2fe', '#bae6fd', '#fed7aa', '#fecdd3', '#fef08a'];
    const color = starColors[Math.floor(rand() * starColors.length)];

    stars.push({
      x: rand(),
      y: rand(),
      size,
      color,
      twinkleSpeed: 0.001 + rand() * 0.003,
      twinkleOffset: rand() * Math.PI * 2,
      depth,
    });
  }

  // Large bright stars with diffraction lens flares
  for (let i = 0; i < 12; i++) {
    stars.push({
      x: rand(),
      y: rand(),
      size: 2.5 + rand() * 1.5,
      color: '#ffffff',
      twinkleSpeed: 0.0006 + rand() * 0.001,
      twinkleOffset: rand() * Math.PI * 2,
      depth: 0.22,
    });
  }

  // Overlapping nebulae for deep volumetric layering
  // Left side gets blue/cyan, right side gets red/purple, center gets mixed dark/cosmic dust
  for (let i = 0; i < 15; i++) {
    const depth = 0.03 + (i % 3) * 0.05; // parallax depth layering
    const nebX = rand() * 1.4 - 0.2; // normalized x coordinate (ranges from -0.2 to 1.2)
    const nebY = rand() * 1.4 - 0.2;
    const radius = 220 + rand() * 260;

    let color = '';
    if (nebX < 0.45) {
      // Friendly side: subtle blue/cyan nebulae
      const blues = [
        'rgba(30, 64, 175, 0.11)',  // Deep sapphire blue
        'rgba(6, 182, 212, 0.07)',  // Electric cyan
        'rgba(37, 99, 235, 0.09)',  // Cobalt blue
        'rgba(14, 116, 144, 0.06)'  // Dark teal
      ];
      color = blues[Math.floor(rand() * blues.length)];
    } else if (nebX > 0.55) {
      // Enemy side: subtle red/purple nebulae
      const reds = [
        'rgba(185, 28, 28, 0.07)',  // Crimson red
        'rgba(124, 58, 237, 0.08)', // Royal purple
        'rgba(109, 40, 217, 0.07)', // Violet
        'rgba(153, 27, 27, 0.06)'   // Dark wine red
      ];
      color = reds[Math.floor(rand() * reds.length)];
    } else {
      // Centered contested lane: mixed cosmic violet and dark silhouetted dust voids
      const centers = [
        'rgba(88, 28, 135, 0.07)',  // Cosmic purple dust
        'rgba(3, 7, 18, 0.35)',     // Dense dark cosmic void dust (shadow blocker)
        'rgba(124, 58, 237, 0.05)'  // Violet haze
      ];
      color = centers[Math.floor(rand() * centers.length)];
    }

    nebulae.push({
      x: nebX,
      y: nebY,
      radius,
      color,
      depth,
    });
  }

  return { stars, nebulae };
};

export default function SpaceBattlefield({
  state,
  playerId,
  onDispatchFleet,
  onPlayCardTarget,
  selectedCardId,
  setSelectedCardId,
}: SpaceBattlefieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 3D Perspective Camera Focus (world coordinate space)
  const [camFocus, setCamFocus] = useState({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panFocusStartRef = useRef({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 });

  // Zoom level state and wheel scroll handler
  const [zoom, setZoom] = useState(1.0);
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom((prev) => {
      const newZoom = prev - e.deltaY * 0.0015; // smooth scrolling
      return Math.min(2.5, Math.max(0.4, newZoom));
    });
  }, []);

  // Generate stable high-fidelity background assets once
  const bgAssets = useMemo(() => generateBackgroundAssets(), []);

  // Drag-and-drop planet dispatch coordinates (stored in screen pixels relative to canvas)
  const [dragStartPlanet, setDragStartPlanet] = useState<Planet | null>(null);
  const [dragCurrentPos, setDragCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredPlanet, setHoveredPlanet] = useState<Planet | null>(null);

  // Radial instruction ring menu state
  const [radialMenu, setRadialMenu] = useState<RadialMenuState>({
    isOpen: false,
    sourcePlanetId: '',
    targetPlanetId: '',
    x: 0,
    y: 0,
  });

  // F3 Debug Overlay State
  const [debugSettings, setDebugSettings] = useState<DebugSettings>(defaultDebugSettings);
  currentDebugSettings = debugSettings; // Always keep in sync during render pass
  const [fps, setFps] = useState(60);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(Date.now());

  // Smooth client-side interpolation refs for lag-free 60fps ship movement & flight trails
  const smoothProgressMapRef = useRef<Record<string, number>>({});
  const smoothTrailMapRef = useRef<Record<string, Array<{ wx: number; wy: number; wz: number; time: number }>>>({});
  const lastFrameTimeRef = useRef<number>(Date.now());

  // Keep global debug reference updated
  useEffect(() => {
    currentDebugSettings = debugSettings;
  }, [debugSettings]);

  // Keyboard shortcut listener for F3 key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setDebugSettings((prev) => ({ ...prev, f3Open: !prev.f3Open }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Particle list for combat spark explosions
  const sparksRef = useRef<{ x: number; y: number; vx: number; vy: number; color: string; life: number }[]>([]);
  // Bullets list for combat scatter projectile fire
  const bulletsRef = useRef<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; color: string; life: number }[]>([]);

  // Center camera Focus on the center of all planets initially when started
  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current) return;
    const allPlanets = Object.values(state.planets);
    if (allPlanets.length > 0) {
      let sumX = 0;
      let sumY = 0;
      allPlanets.forEach((p) => {
        sumX += p.x;
        sumY += p.y;
      });
      setCamFocus({
        x: sumX / allPlanets.length,
        y: sumY / allPlanets.length,
      });
      centeredRef.current = true;
    }
  }, [state]);

  // Handle canvas sizing correctly
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check if clicked near a planet's projected screen center bounds
    const clickedPlanet = Object.values(state.planets).find((pl) => {
      const proj = projectPoint(pl.x, pl.y, 0, camFocus, rect.width, rect.height);
      const dx = proj.x - mouseX;
      const dy = proj.y - mouseY;
      const cache = planetCache[pl.id];
      const radius = cache ? cache.style.radius : 24;
      const visualRadius = radius * proj.scale;
      return Math.sqrt(dx * dx + dy * dy) <= Math.max(30, visualRadius + 15);
    });

    if (clickedPlanet) {
      if (selectedCardId) {
        onPlayCardTarget(clickedPlanet.id);
        setSelectedCardId(null);
        return;
      }

      const ownsPlanet = clickedPlanet.ownerId === playerId;
      const hasMyShips = Object.values(state.ships).some(
        (s) => s.planetId === clickedPlanet.id && s.ownerId === playerId && s.state !== ShipState.MOVING
      );

      if (ownsPlanet || hasMyShips) {
        setDragStartPlanet(clickedPlanet);
        const proj = projectPoint(clickedPlanet.x, clickedPlanet.y, 0, camFocus, rect.width, rect.height);
        setDragCurrentPos({ x: proj.x, y: proj.y });
        setRadialMenu((prev) => ({ ...prev, isOpen: false }));
      }
    } else {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panFocusStartRef.current = { x: camFocus.x, y: camFocus.y };
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const currentHover = Object.values(state.planets).find((pl) => {
      const proj = projectPoint(pl.x, pl.y, 0, camFocus, rect.width, rect.height);
      const dx = proj.x - mouseX;
      const dy = proj.y - mouseY;
      const cache = planetCache[pl.id];
      const radius = cache ? cache.style.radius : 24;
      const visualRadius = radius * proj.scale;
      return Math.sqrt(dx * dx + dy * dy) <= Math.max(30, visualRadius + 15);
    });
    setHoveredPlanet(currentHover || null);

    if (dragStartPlanet) {
      setDragCurrentPos({ x: mouseX, y: mouseY });
    } else if (isPanningRef.current) {
      const dx_pixels = e.clientX - panStartRef.current.x;
      const dy_pixels = e.clientY - panStartRef.current.y;

      const zoomAdjust = 1.0;
      setCamFocus({
        x: panFocusStartRef.current.x - dx_pixels / zoomAdjust,
        y: panFocusStartRef.current.y - dy_pixels / (zoomAdjust * Math.cos(PITCH)),
      });
    }
  };

  const handleMouseUp = (e: MouseEvent<HTMLCanvasElement>) => {
    isPanningRef.current = false;

    if (dragStartPlanet && dragCurrentPos) {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const targetPl = Object.values(state.planets).find((pl) => {
        if (pl.id === dragStartPlanet.id) return false;
        const proj = projectPoint(pl.x, pl.y, 0, camFocus, rect.width, rect.height);
        const dx = proj.x - mouseX;
        const dy = proj.y - mouseY;
        const cache = planetCache[pl.id];
        const radius = cache ? cache.style.radius : 24;
        const visualRadius = radius * proj.scale;
        return Math.sqrt(dx * dx + dy * dy) <= Math.max(30, visualRadius + 15);
      });

      if (targetPl) {
        const projTgt = projectPoint(targetPl.x, targetPl.y, 0, camFocus, rect.width, rect.height);

        setRadialMenu({
          isOpen: true,
          sourcePlanetId: dragStartPlanet.id,
          targetPlanetId: targetPl.id,
          x: projTgt.x,
          y: projTgt.y,
        });
      }

      setDragStartPlanet(null);
      setDragCurrentPos(null);
    }
  };

  const closeRadial = () => {
    setRadialMenu((prev) => ({ ...prev, isOpen: false }));
  };

  const srcPl = radialMenu.isOpen ? state.planets[radialMenu.sourcePlanetId] : null;
  const tgtPl = radialMenu.isOpen ? state.planets[radialMenu.targetPlanetId] : null;

  const srcShips = srcPl
    ? Object.values(state.ships).filter(
        (sh) => sh.planetId === srcPl.id && sh.ownerId === playerId && sh.state !== ShipState.MOVING
      )
    : [];

  const idleScoutsCount = srcShips.filter((s) => s.type === ShipType.SCOUT).length;
  const idleDreadsCount = srcShips.filter((s) => s.type === ShipType.DREADNOUGHT).length;
  const idleSpiesCount = srcShips.filter((s) => s.type === ShipType.SPY).length;

  const handleRadialAction = (action: string) => {
    if (!srcPl || !tgtPl) return;

    if (action === 'mine') {
      onDispatchFleet(srcPl.id, tgtPl.id, ShipType.SCOUT, idleScoutsCount);
    } else if (action === 'capture') {
      if (idleScoutsCount > 0) {
        onDispatchFleet(srcPl.id, tgtPl.id, ShipType.SCOUT, idleScoutsCount);
      } else if (idleDreadsCount > 0) {
        onDispatchFleet(srcPl.id, tgtPl.id, ShipType.DREADNOUGHT, idleDreadsCount);
      }
    } else if (action === 'attack') {
      onDispatchFleet(srcPl.id, tgtPl.id, ShipType.DREADNOUGHT, idleDreadsCount);
    } else if (action === 'station') {
      if (idleScoutsCount > 0) {
        onDispatchFleet(srcPl.id, tgtPl.id, ShipType.SCOUT, idleScoutsCount);
      }
      if (idleDreadsCount > 0) {
        onDispatchFleet(srcPl.id, tgtPl.id, ShipType.DREADNOUGHT, idleDreadsCount);
      }
    } else if (action === 'spy') {
      onDispatchFleet(srcPl.id, tgtPl.id, ShipType.SPY, idleSpiesCount);
    }

    closeRadial();
  };

  // Main Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      // FPS measurement for F3 Debug Overlay
      frameCountRef.current++;
      const nowMs = Date.now();
      if (nowMs - lastFpsTimeRef.current >= 500) {
        setFps(Math.round((frameCountRef.current * 1000) / (nowMs - lastFpsTimeRef.current)));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = nowMs;
      }

      const frameDeltaSec = Math.min(0.08, Math.max(0.001, (nowMs - (lastFrameTimeRef.current || nowMs)) / 1000));
      lastFrameTimeRef.current = nowMs;

      // Update global zoom reference for 3D projections on each frame
      globalCurrentZoom = zoom;

      // Render the entire background on a low-res buffer to create a beautiful, authentic retro "pixel art nebula" feel!
      let bgCanvas = bgCanvasRef.current;
      if (!bgCanvas) {
        bgCanvas = document.createElement('canvas');
        bgCanvasRef.current = bgCanvas;
      }

      const pixelScale = 5; // Each pixel is 5x5 screen pixels for a distinct retro texture feel
      const bgW = Math.ceil(canvas.width / pixelScale);
      const bgH = Math.ceil(canvas.height / pixelScale);
      if (bgCanvas.width !== bgW || bgCanvas.height !== bgH) {
        bgCanvas.width = bgW;
        bgCanvas.height = bgH;
      }

      const bgCtx = bgCanvas.getContext('2d');
      const parallaxX = -camFocus.x;
      const parallaxY = -camFocus.y;

      if (bgCtx) {
        bgCtx.imageSmoothingEnabled = false;

        // Clear low-res background with rich space gradient
        const spaceGrad = bgCtx.createRadialGradient(
          bgW / 2,
          bgH / 2,
          5,
          bgW / 2,
          bgH / 2,
          bgW * 0.95
        );
        spaceGrad.addColorStop(0, '#040714');   // Deep space core
        spaceGrad.addColorStop(0.5, '#020308'); // Dark depth
        spaceGrad.addColorStop(1, '#000103');   // Pitch black
        bgCtx.fillStyle = spaceGrad;
        bgCtx.fillRect(0, 0, bgW, bgH);

        // 1. Draw Beautiful Pixelated Nebula Gaseous Clouds
        bgAssets.nebulae.forEach((neb) => {
          const px = (neb.x * bgW) + ((parallaxX / pixelScale) * neb.depth);
          const py = (neb.y * bgH) + ((parallaxY / pixelScale) * neb.depth);
          const radius = neb.radius / pixelScale;

          const gradient = bgCtx.createRadialGradient(px, py, 2, px, py, radius);
          gradient.addColorStop(0, neb.color);
          gradient.addColorStop(0.4, neb.color.replace('0.', '0.05'));
          gradient.addColorStop(0.8, 'transparent');

          bgCtx.fillStyle = gradient;
          bgCtx.beginPath();
          bgCtx.arc(px, py, radius, 0, Math.PI * 2);
          bgCtx.fill();
        });

        // 2. Draw Pixelated Twinkling Stars
        bgAssets.stars.forEach((star) => {
          const px = ((star.x * bgW + (parallaxX / pixelScale) * star.depth) % bgW + bgW) % bgW;
          const py = ((star.y * bgH + (parallaxY / pixelScale) * star.depth) % bgH + bgH) % bgH;

          const twinkle = Math.sin(Date.now() * star.twinkleSpeed + star.twinkleOffset) * 0.45 + 0.55;
          bgCtx.globalAlpha = twinkle;
          bgCtx.fillStyle = star.color;

          if (star.size > 2.5) {
            // Retro cross diffraction lens flare
            bgCtx.fillRect(Math.floor(px - 1), Math.floor(py), 3, 1);
            bgCtx.fillRect(Math.floor(px), Math.floor(py - 1), 1, 3);
            bgCtx.fillStyle = '#ffffff';
            bgCtx.fillRect(Math.floor(px), Math.floor(py), 1, 1);
          } else {
            const size = Math.max(1, Math.round(star.size / pixelScale));
            bgCtx.fillRect(Math.floor(px), Math.floor(py), size, size);
          }
        });
        bgCtx.globalAlpha = 1.0;
      }

      // Render pixelated background onto main high-res canvas (with crisp nearest-neighbor scale)
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bgCanvas, 0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true; // reset for normal rendering of text, ship vectors, UI, and dynamic components

      // --- 3D ENVIRONMENT GEOMETRIES ---
      // 2.5 & 3. Fixed connection paths and orbital lines removed as requested to keep the battlefield clean

      // Map to cache actual projected screen locations of ships for laser beam synchronization
      const shipProjectedMap: Record<string, { x: number; y: number }> = {};

      // 1. Calculate world positions & 3D depths for all ships
      interface ShipRenderInfo {
        sh: Ship;
        wx: number;
        wy: number;
        wz: number;
        headingAngle: number;
        shipColor: string;
        planetCenter?: { x: number; y: number; z: number };
        velo3D?: { x: number; y: number; z: number };
      }

      // Pre-group orbiting ships per planet for well-distributed 3D orbital plane assignments
      const orbitingShipsMap: Record<string, Ship[]> = {};
      Object.values(state.ships).forEach((sh) => {
        if (sh.state !== ShipState.MOVING && sh.planetId && state.planets[sh.planetId]) {
          if (!orbitingShipsMap[sh.planetId]) {
            orbitingShipsMap[sh.planetId] = [];
          }
          orbitingShipsMap[sh.planetId].push(sh);
        }
      });

      // Sort deterministically by ship ID
      Object.keys(orbitingShipsMap).forEach((pId) => {
        orbitingShipsMap[pId].sort((a, b) => a.id.localeCompare(b.id));
      });

      const shipInfoList: ShipRenderInfo[] = Object.values(state.ships).map((sh) => {
        const owner = state.players[sh.ownerId];
        let shipColor = owner?.factionId || '#ffffff';

        if (sh.type === ShipType.SPY && sh.spyDisguisedAs) {
          const fakeOwner = state.players[sh.spyDisguisedAs];
          if (sh.ownerId !== playerId) {
            shipColor = fakeOwner?.factionId || '#ffffff';
          }
        }

        let wx = sh.x;
        let wy = sh.y;
        let wz = 0;
        let headingAngle = 0;
        let planetCenter: { x: number; y: number; z: number } | undefined = undefined;
        let velo3D: { x: number; y: number; z: number } | undefined = undefined;

        if (sh.state === ShipState.MOVING && sh.targetPlanetId) {
          const src = state.planets[sh.planetId];
          const tgt = state.planets[sh.targetPlanetId];
          if (tgt) {
            let sx = sh.startX;
            let sy = sh.startY;
            let sz = sh.startZ;

            if (sx === undefined || sy === undefined || sz === undefined) {
              sx = sh.x;
              sy = sh.y;
              sz = sh.z || 0;
            }

            const params = getShipOrbitParams(sh, tgt);
            const entryAngle = getOrbitEntryAngle(sx, sy, sz, tgt, params);
            const entryPos = getOrbitPosFromPhase(tgt, params, entryAngle);

            const dx = entryPos.x - sx;
            const dy = entryPos.y - sy;
            const dz = entryPos.z - sz;
            const dist = Math.hypot(dx, dy, dz);

            if (dist > 0) {
              const dtFrame = Math.max(0, Math.min(0.1, (nowMs - (sh.lastUpdateMs || nowMs)) / 1000));
              const p = Math.min(0.999, Math.max(0.0, sh.travelProgress + (sh.speed * dtFrame) / dist));

              wx = sx + dx * p;
              wy = sy + dy * p;
              wz = sz + dz * p + Math.sin(Math.PI * p) * Math.min(30, dist * 0.1);

              headingAngle = sh.headingAngle ?? Math.atan2(dy, dx);
              velo3D = { x: dx, y: dy, z: dz };
            } else {
              wx = sh.x;
              wy = sh.y;
              wz = sh.z || 0;
              headingAngle = sh.headingAngle || 0;
            }
          } else {
            wx = sh.x;
            wy = sh.y;
            wz = sh.z || 0;
            headingAngle = sh.headingAngle || 0;
          }
        } else {
          const pl = state.planets[sh.planetId];
          if (pl) {
            planetCenter = { x: pl.x, y: pl.y, z: 0 };
            const orb = computeShipOrbitPosition(sh, pl, nowMs);

            // Check if enemy ships exist at this planet for combat pursuit disengagement
            const enemyShipsAtPl = Object.values(state.ships).filter(
              (other) => other.planetId === sh.planetId && other.ownerId !== sh.ownerId && other.state !== ShipState.MOVING
            );

            if (enemyShipsAtPl.length > 0 && SHIP_CONFIGS[sh.type].attack > 0) {
              // Combat Pursuit Mode: disengage tight orbit to chase target enemy ship
              const target = enemyShipsAtPl[0];
              const targetOrb = computeShipOrbitPosition(target, pl, nowMs);

              const dx = targetOrb.x - orb.x;
              const dy = targetOrb.y - orb.y;
              const dz = targetOrb.z - orb.z;

              const chaseFactor = 0.35;
              wx = orb.x + dx * chaseFactor;
              wy = orb.y + dy * chaseFactor;
              wz = orb.z + dz * chaseFactor;

              headingAngle = Math.atan2(dy, dx);
              velo3D = { x: dx, y: dy, z: dz };
            } else {
              // Peaceful Orbit
              wx = orb.x;
              wy = orb.y;
              wz = orb.z;
              velo3D = orb.velo3D;
              headingAngle = orb.headingAngle;
            }
          }
        }

        return { sh, wx, wy, wz, headingAngle, shipColor, planetCenter, velo3D };
      });

      // Combine planets and ships into a single depth-sorted render queue
      type RenderQueueItem =
        | { kind: 'planet'; planet: Planet; wz: number }
        | { kind: 'ship'; info: ShipRenderInfo; wz: number };

      const renderQueue: RenderQueueItem[] = [];

      Object.values(state.planets).forEach((pl) => {
        renderQueue.push({ kind: 'planet', planet: pl, wz: 0 });
      });

      shipInfoList.forEach((info) => {
        renderQueue.push({ kind: 'ship', info, wz: info.wz });
      });

      // Sort by 3D Z depth (lowest wz / furthest away first, highest wz / closest front last)
      renderQueue.sort((a, b) => a.wz - b.wz);

      // Render 3D Scene Geometry in Depth Order
      renderQueue.forEach((item) => {
        if (item.kind === 'planet') {
          const pl = item.planet;
          const isHovered = hoveredPlanet?.id === pl.id;
          let planetColor = '#64748b';
          if (pl.ownerId) {
            const owner = state.players[pl.ownerId];
            if (owner) planetColor = owner.factionId;
          }
          draw3DPlanetWithLayers(ctx, pl, camFocus, canvas.width, canvas.height, planetColor, isHovered);
        } else {
          const { sh, wx, wy, wz, headingAngle, shipColor, planetCenter, velo3D } = item.info;

          // Ribbon trail for moving ships
          if (sh.state === ShipState.MOVING) {
            let trailList = smoothTrailMapRef.current[sh.id];
            if (!trailList) {
              trailList = [];
              smoothTrailMapRef.current[sh.id] = trailList;
            }

            const lastPt = trailList[0];
            if (!lastPt || Math.hypot(wx - lastPt.wx, wy - lastPt.wy) > 1.2) {
              trailList.unshift({ wx, wy, wz, time: nowMs });
            }

            while (trailList.length > 0 && nowMs - trailList[trailList.length - 1].time > 450) {
              trailList.pop();
            }

            if (trailList.length > 1) {
              ctx.save();
              for (let i = 0; i < trailList.length - 1; i++) {
                const pt1 = trailList[i];
                const pt2 = trailList[i + 1];

                const proj1 = projectPoint(pt1.wx, pt1.wy, pt1.wz, camFocus, canvas.width, canvas.height);
                const proj2 = projectPoint(pt2.wx, pt2.wy, pt2.wz, camFocus, canvas.width, canvas.height);

                const lifeProgress = i / trailList.length;
                const alpha = (1 - lifeProgress) * 0.75;
                const lineWidth = Math.max(1.2, (14 - i * 0.7) * proj1.scale);

                ctx.strokeStyle = shipColor;
                ctx.globalAlpha = alpha;
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(proj1.x, proj1.y);
                ctx.lineTo(proj2.x, proj2.y);
                ctx.stroke();

                ctx.strokeStyle = '#ffffff';
                ctx.globalAlpha = alpha * 0.85;
                ctx.lineWidth = Math.max(0.8, lineWidth * 0.35);
                ctx.beginPath();
                ctx.moveTo(proj1.x, proj1.y);
                ctx.lineTo(proj2.x, proj2.y);
                ctx.stroke();
              }
              ctx.restore();
            }
          } else {
            delete smoothTrailMapRef.current[sh.id];
          }

          // Cache projected screen coords for laser & UI alignment
          const projShip = projectPoint(wx, wy, wz, camFocus, canvas.width, canvas.height);
          shipProjectedMap[sh.id] = { x: projShip.x, y: projShip.y };

          // Draw the high-detail 3D ship
          draw3DShip(ctx, sh.type, wx, wy, wz, headingAngle, shipColor, sh.state === ShipState.MOVING, camFocus, canvas.width, canvas.height, planetCenter, velo3D);

          // Draw mini HP/shield bar for injured ships (always visible as long as not full health)
          const isInjured = sh.hp < sh.maxHp || (sh.maxShield > 0 && sh.shield < sh.maxShield);
          if (isInjured) {
            const barW = Math.max(22, Math.min(36, 26 * projShip.scale));
            const barH = 3.5;
            const barX = projShip.x - barW / 2;
            const barY = projShip.y - (18 * projShip.scale);

            ctx.save();
            // Black backdrop
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

            // Shield bar (cyan/blue)
            if (sh.maxShield > 0) {
              const shieldPct = Math.max(0, Math.min(1.0, sh.shield / sh.maxShield));
              if (shieldPct > 0) {
                ctx.fillStyle = '#38bdf8';
                ctx.fillRect(barX, barY - 2.5, barW * shieldPct, 2);
              }
            }

            // Health bar (green/yellow/red)
            const hpPct = Math.max(0, Math.min(1.0, sh.hp / sh.maxHp));
            const hpColor = hpPct > 0.6 ? '#4ade80' : hpPct > 0.25 ? '#facc15' : '#f87171';
            ctx.fillStyle = hpColor;
            ctx.fillRect(barX, barY, barW * hpPct, barH);
            ctx.restore();
          }
        }
      });

      // 2D Planet Status Panel & HUD Overlay
      Object.values(state.planets).forEach((pl) => {
        const isHovered = hoveredPlanet?.id === pl.id;
        const projPl = projectPoint(pl.x, pl.y, 0, camFocus, canvas.width, canvas.height);
        const cache = planetCache[pl.id];
        const radius = cache ? cache.style.radius : 24;
        const visualRadius = radius * projPl.scale;

        const uRadius = visualRadius * 1.50;
        const barPct = Math.max(0, Math.min(1.0, pl.hp / (pl.maxHp || 100)));
        let barColor = '#fde047';
        if (pl.ownerId) {
          if (pl.ownerId === playerId) {
            barColor = '#4ade80';
          } else {
            barColor = '#f87171';
          }
        }

        const panelBottomY = Math.round(projPl.y - uRadius - 2);
        const resY = panelBottomY - 6;
        const barY = resY - 14;
        const nameY = barY + (currentDebugSettings.nameOffsetY ?? -8);
        const topIconY = nameY + (currentDebugSettings.iconOffsetY ?? -13);

        ctx.save();
        ctx.translate(projPl.x, topIconY);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;

        if (pl.type === PlanetType.HOME) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(-10, -9, 20, 18);

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-8, -2, 16, 9);
          ctx.fillRect(-3, -7, 6, 5);
          ctx.fillRect(-2, -9, 4, 2);
          ctx.fillRect(-8, -5, 4, 3);
          ctx.fillRect(-7, -7, 2, 2);
          ctx.fillRect(4, -5, 4, 3);
          ctx.fillRect(5, -7, 2, 2);
          ctx.fillStyle = '#000000';
          ctx.fillRect(-2, 2, 4, 5);
        } else if (pl.type === PlanetType.RESOURCE) {
          if (pl.subType === PlanetSubType.TECH) {
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            for (let a = 0; a < 8; a++) {
              const r = a % 2 === 0 ? 10.5 : 4.0;
              const angle = (a * Math.PI) / 4 - Math.PI / 2;
              ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            for (let a = 0; a < 8; a++) {
              const r = a % 2 === 0 ? 9.0 : 3.0;
              const angle = (a * Math.PI) / 4 - Math.PI / 2;
              ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.moveTo(0, -2.5); ctx.lineTo(2.5, 0); ctx.lineTo(0, 2.5); ctx.lineTo(-2.5, 0);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.moveTo(0, -10.5); ctx.lineTo(9.5, 0); ctx.lineTo(0, 10.5); ctx.lineTo(-9.5, 0);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(0, -9); ctx.lineTo(8, 0); ctx.lineTo(0, 9); ctx.lineTo(-8, 0);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.moveTo(0, -4); ctx.lineTo(3.5, 0.5); ctx.lineTo(0, 5); ctx.lineTo(-3.5, 0.5);
            ctx.closePath();
            ctx.fill();
          }
        } else if (pl.type === PlanetType.SPECIAL) {
          if (pl.subType === PlanetSubType.HEAL) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(-9, -3.5, 18, 7);
            ctx.fillRect(-3.5, -9, 7, 18);

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-8, -2.5, 16, 5);
            ctx.fillRect(-2.5, -8, 5, 16);
          } else {
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.moveTo(-8, -8); ctx.lineTo(8, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 9.5); ctx.lineTo(-8, 0);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(-7, -7); ctx.lineTo(7, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 8); ctx.lineTo(-7, 0);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#000000';
            ctx.fillRect(-4, -1, 8, 2);
            ctx.fillRect(-1, -4, 2, 8);
          }
        } else {
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.arc(0, 0, 9, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(0, 0, 2.0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Planet Name
        ctx.save();
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(pl.name, projPl.x, nameY);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(pl.name, projPl.x, nameY);
        ctx.restore();

        // Health Bar
        const barW = 80;
        const barH = 7;
        const barX = Math.round(projPl.x - barW / 2);

        ctx.fillStyle = '#000000';
        ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

        const numSegments = 5;
        const gap = 2;
        const segW = (barW - (numSegments - 1) * gap) / numSegments;

        for (let i = 0; i < numSegments; i++) {
          const segX = Math.round(barX + i * (segW + gap));
          const segThreshold = (i + 1) / numSegments;
          const isFilled = barPct >= segThreshold - 0.08;

          if (isFilled) {
            ctx.fillStyle = barColor;
          } else {
            ctx.fillStyle = '#1e293b';
          }
          ctx.fillRect(segX, barY, Math.round(segW), barH);
        }

        // Resources
        const owner = pl.ownerId ? state.players[pl.ownerId] : null;
        const minVal = owner ? Math.floor(owner.minerals) : 0;
        const techVal = owner ? Math.floor(owner.techPoints) : 0;

        ctx.save();
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 12px monospace, sans-serif';
        ctx.textAlign = 'left';

        const diamondCenterX = projPl.x - 34;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(diamondCenterX, resY - 6.5);
        ctx.lineTo(diamondCenterX + 6.5, resY);
        ctx.lineTo(diamondCenterX, resY + 6.5);
        ctx.lineTo(diamondCenterX - 6.5, resY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.moveTo(diamondCenterX, resY - 5);
        ctx.lineTo(diamondCenterX + 5, resY);
        ctx.lineTo(diamondCenterX, resY + 5);
        ctx.lineTo(diamondCenterX - 5, resY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(diamondCenterX, resY - 2);
        ctx.lineTo(diamondCenterX + 2, resY);
        ctx.lineTo(diamondCenterX, resY + 2);
        ctx.lineTo(diamondCenterX - 2, resY);
        ctx.closePath();
        ctx.fill();

        const minTextX = diamondCenterX + 9;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(`${minVal}`, minTextX, resY);
        ctx.fillStyle = '#00f0ff';
        ctx.fillText(`${minVal}`, minTextX, resY);

        const starCenterX = projPl.x + 8;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        for (let a = 0; a < 8; a++) {
          const r = a % 2 === 0 ? 7.0 : 2.8;
          const angle = (a * Math.PI) / 4 - Math.PI / 2;
          ctx.lineTo(starCenterX + Math.cos(angle) * r, resY + Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#e066ff';
        ctx.beginPath();
        for (let a = 0; a < 8; a++) {
          const r = a % 2 === 0 ? 5.2 : 2.0;
          const angle = (a * Math.PI) / 4 - Math.PI / 2;
          ctx.lineTo(starCenterX + Math.cos(angle) * r, resY + Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#000000';
        ctx.fillRect(starCenterX - 1, resY - 1, 2, 2);

        const techTextX = starCenterX + 9;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(`${techVal}`, techTextX, resY);
        ctx.fillStyle = '#e066ff';
        ctx.fillText(`${techVal}`, techTextX, resY);

        ctx.restore();

        // Capture ring HUD
        if (pl.captureProgress > 0) {
          let capColor = '#ffffff';
          if (pl.capturingFactionId) {
            capColor = state.players[pl.capturingFactionId]?.factionId || '#ffffff';
          } else if (pl.ownerId) {
            capColor = state.players[pl.ownerId]?.factionId || '#ffffff';
          }

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(projPl.x, projPl.y, uRadius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = capColor;
          ctx.lineWidth = 1.25;
          ctx.lineCap = 'round';
          ctx.beginPath();
          const startAngle = -Math.PI / 2;
          const endAngle = startAngle + (Math.PI * 2 * pl.captureProgress) / 100;
          ctx.arc(projPl.x, projPl.y, uRadius, startAngle, endAngle);
          ctx.stroke();
          ctx.lineCap = 'butt';

          if (pl.captureProgress > 0 && pl.captureProgress < 100) {
            ctx.font = 'bold 9px monospace';
            ctx.fillStyle = capColor;
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2.0;
            ctx.strokeText(`${Math.floor(pl.captureProgress)}%`, projPl.x, projPl.y + uRadius + 12);
            ctx.fillText(`${Math.floor(pl.captureProgress)}%`, projPl.x, projPl.y + uRadius + 12);
          }
        }

        if (pl.debuffs.length > 0) {
          const mySpyPresent = pl.debuffs.some((d) => d.ownerId === playerId);
          if (mySpyPresent) {
            ctx.fillStyle = '#c084fc';
            ctx.font = 'bold 10px monospace';
            ctx.fillText('🕵️', projPl.x - barW / 2 - 10, barY + barH);
          }
        }
      });

      // Drag vector direct screen-space overlay
      if (dragStartPlanet && dragCurrentPos) {
        const projStart = projectPoint(dragStartPlanet.x, dragStartPlanet.y, 0, camFocus, canvas.width, canvas.height);

        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(projStart.x, projStart.y);
        ctx.lineTo(dragCurrentPos.x, dragCurrentPos.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#3b82f6';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('释放以派遣舰队', dragCurrentPos.x, dragCurrentPos.y - 12);
      }

      // Visual HP and shield overlay bars for 3D ships
      shipInfoList.forEach(({ sh, wx, wy, wz }) => {
        const projShip = projectPoint(wx, wy, wz, camFocus, canvas.width, canvas.height);

        if (sh.hp < sh.maxHp || sh.type === ShipType.DREADNOUGHT) {
          const hpPct = sh.hp / sh.maxHp;
          const barW = 28;
          const barH = 4;
          const barY = projShip.y - 24;

          ctx.fillStyle = 'rgba(0,0,0,0.75)';
          ctx.fillRect(projShip.x - barW / 2 - 1, barY - 1, barW + 2, barH + 2);

          let shipBarColor = '#fde047'; // Neutral
          if (sh.ownerId) {
            if (sh.ownerId === playerId) {
              shipBarColor = '#4ade80'; // Player Green
            } else {
              shipBarColor = '#f87171'; // Enemy Red
            }
          }
          ctx.fillStyle = shipBarColor;
          ctx.fillRect(projShip.x - barW / 2, barY, barW * hpPct, barH);
        }

        if (sh.shield > 0) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(projShip.x, projShip.y, 16 * projShip.scale, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(14, 165, 233, 0.22)';
          ctx.lineWidth = 3.0;
          ctx.beginPath();
          ctx.arc(projShip.x, projShip.y, 19 * projShip.scale, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // 7. Scatter Bullet Projectiles & Combat Lasers
      Object.keys(state.planets).forEach((planetId) => {
        const shipsAtPl = Object.values(state.ships).filter(
          (sh) => sh.planetId === planetId && sh.state !== ShipState.MOVING
        );

        if (shipsAtPl.length > 1) {
          shipsAtPl.forEach((attacker) => {
            if (SHIP_CONFIGS[attacker.type].attack > 0 && Math.random() < 0.28) {
              const targets = shipsAtPl.filter((t) => t.ownerId !== attacker.ownerId);
              if (targets.length > 0) {
                const target = targets[Math.floor(Math.random() * targets.length)];

                const sAttacker = shipProjectedMap[attacker.id];
                const sTarget = shipProjectedMap[target.id];

                if (sAttacker && sTarget) {
                  // Fire bullet with slight angular scatter
                  const dx = sTarget.x - sAttacker.x;
                  const dy = sTarget.y - sAttacker.y;
                  const baseAngle = Math.atan2(dy, dx);
                  const scatter = (Math.random() - 0.5) * 0.16; // light scatter ±4.6°
                  const fireAngle = baseAngle + scatter;
                  const bSpeed = 10 + Math.random() * 5;

                  bulletsRef.current.push({
                    x: sAttacker.x,
                    y: sAttacker.y,
                    z: 0,
                    vx: Math.cos(fireAngle) * bSpeed,
                    vy: Math.sin(fireAngle) * bSpeed,
                    vz: (Math.random() - 0.5) * 1.5,
                    color: attacker.ownerId === playerId ? '#38bdf8' : '#f87171',
                    life: 18,
                  });

                  // Dual glowing tracer laser beam
                  ctx.strokeStyle = attacker.ownerId === playerId ? 'rgba(56, 189, 248, 0.45)' : 'rgba(248, 113, 113, 0.45)';
                  ctx.lineWidth = attacker.type === ShipType.DREADNOUGHT ? 2.5 : 1.5;
                  ctx.beginPath();
                  ctx.moveTo(sAttacker.x, sAttacker.y);
                  ctx.lineTo(sTarget.x, sTarget.y);
                  ctx.stroke();
                }
              }
            }
          });
        }
      });

      // Update & Draw Bullets
      for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
        const b = bulletsRef.current[i];
        b.x += b.vx;
        b.y += b.vy;
        b.life--;

        ctx.save();
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 6;
        ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(b.x - 0.5, b.y - 0.5, 1, 1);
        ctx.restore();

        if (b.life <= 0) {
          // Exploding spark impact
          sparksRef.current.push({
            x: b.x,
            y: b.y,
            vx: (Math.random() - 0.5) * 4.5,
            vy: (Math.random() - 0.5) * 4.5,
            color: b.color,
            life: 14,
          });
          bulletsRef.current.splice(i, 1);
        }
      }

      // 8. Update & Draw Sparkling combat particles
      const sparks = sparksRef.current;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 16;
        ctx.fillRect(p.x, p.y, 2, 2);

        if (p.life <= 0) {
          sparks.splice(i, 1);
        }
      }
      ctx.globalAlpha = 1.0;

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [state, camFocus, dragStartPlanet, dragCurrentPos, hoveredPlanet, selectedCardId, bgAssets, zoom]);

  return (
    <div
      ref={containerRef}
      id="space_battlefield_container"
      className="w-full h-full relative overflow-hidden bg-[#010103] rounded-2xl border-2 border-[#101944] shadow-2xl shadow-black/95 flex-1 min-h-[480px]"
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full block cursor-grab active:cursor-grabbing"
      />

      {/* Floating Radial Instruction Ring Menu */}
      {radialMenu.isOpen && srcPl && tgtPl && (
        <div
          className="absolute z-40 p-4 bg-[#05081c]/98 border-2 border-indigo-500 rounded-2xl shadow-2xl shadow-indigo-950/50 w-[300px] flex flex-col animate-fade-in translate-x-[-50%] translate-y-[-50%]"
          style={{
            left: `${radialMenu.x}px`,
            top: `${radialMenu.y}px`,
          }}
        >
          <div className="flex justify-between items-center pb-2 border-b border-[#1b2b5d] mb-3">
            <div className="text-left">
              <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">下达舰队派遣指令</span>
              <div className="text-xs font-bold text-slate-200 truncate flex items-center gap-1">
                <span>{srcPl.name}</span>
                <ChevronRight className="w-3 h-3 text-indigo-400" />
                <span className="text-indigo-300">{tgtPl.name}</span>
              </div>
            </div>
            <button
              onClick={closeRadial}
              className="p-1 hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {/* Action 1: Mine */}
            {tgtPl.type === PlanetType.RESOURCE && (
              <button
                onClick={() => handleRadialAction('mine')}
                disabled={idleScoutsCount === 0 || tgtPl.ownerId !== playerId}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/40 hover:bg-emerald-950/50 border border-slate-800 hover:border-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-slate-200 text-xs transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="text-yellow-400">💎</span>
                  <div className="text-left">
                    <div className="font-bold">开采矿物</div>
                    <div className="text-[10px] text-slate-400">仅限我方控制的资源星球</div>
                  </div>
                </div>
                <span className="font-mono text-emerald-400 font-bold">派探索船 x{idleScoutsCount}</span>
              </button>
            )}

            {/* Action 2: Capture */}
            {tgtPl.ownerId !== playerId && (
              <button
                onClick={() => handleRadialAction('capture')}
                disabled={(idleScoutsCount === 0 && idleDreadsCount === 0)}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/40 hover:bg-indigo-950/50 border border-slate-800 hover:border-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-slate-200 text-xs transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-indigo-400" />
                  <div className="text-left">
                    <div className="font-bold">推进占领</div>
                    <div className="text-[10px] text-slate-400">派遣船只提升该星占领度</div>
                  </div>
                </div>
                <span className="font-mono text-indigo-400 font-bold">
                  派
                  {idleScoutsCount > 0
                    ? `探索船 x${idleScoutsCount}`
                    : `主力舰 x${idleDreadsCount}`}
                </span>
              </button>
            )}

            {/* Action 3: Attack */}
            <button
              onClick={() => handleRadialAction('attack')}
              disabled={idleDreadsCount === 0}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/40 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-slate-200 text-xs transition-all cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Swords className="w-4 h-4 text-rose-400" />
                <div className="text-left">
                  <div className="font-bold">派遣远征军 (进攻)</div>
                  <div className="text-[10px] text-slate-400">派遣火力单位扫荡该星空域</div>
                </div>
              </div>
              <span className="font-mono text-rose-400 font-bold">主力舰 x{idleDreadsCount}</span>
            </button>

            {/* Action 4: Station */}
            <button
              onClick={() => handleRadialAction('station')}
              disabled={idleScoutsCount === 0 && idleDreadsCount === 0}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/40 hover:bg-slate-800/50 border border-slate-800 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-slate-200 text-xs transition-all cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-400" />
                <div className="text-left">
                  <div className="font-bold">舰队驻守</div>
                  <div className="text-[10px] text-slate-400">派遣船只原地防御轨道</div>
                </div>
              </div>
              <span className="font-mono text-slate-300">
                派 x{idleScoutsCount + idleDreadsCount}
              </span>
            </button>

            {/* Action 5: Send Spy */}
            <button
              onClick={() => handleRadialAction('spy')}
              disabled={idleSpiesCount === 0}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/40 hover:bg-purple-950/50 border border-slate-800 hover:border-purple-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-slate-200 text-xs transition-all cursor-pointer"
              id="radial_spy_button"
            >
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-purple-400" />
                <div className="text-left">
                  <div className="font-bold">潜入间谍</div>
                  <div className="text-[10px] text-slate-400">窃取目标阵营的矿物资源</div>
                </div>
              </div>
              <span className="font-mono text-purple-400 font-bold">间谍船 x{idleSpiesCount}</span>
            </button>
          </div>
        </div>
      )}

      {/* --- Top-Right HUD Controls: Camera Height Indicator & F3 Panel Button --- */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2 pointer-events-auto shadow-2xl">
        {/* Real-Time Camera Height Badge */}
        <div className="px-3 py-2 bg-slate-950/95 border border-cyan-500/60 text-cyan-300 font-mono text-xs rounded-xl flex items-center gap-3 backdrop-blur-xl shadow-cyan-950/50">
          <div className="flex items-center gap-1.5 text-cyan-400">
            <Camera className="w-4 h-4 text-cyan-400 shrink-0 animate-pulse" />
            <span className="text-slate-300 font-sans text-xs font-extrabold tracking-wide">相机高度</span>
          </div>

          <div className="flex items-baseline gap-1 font-mono bg-cyan-950/60 px-2.5 py-0.5 rounded-lg border border-cyan-800/60">
            <span className="font-extrabold text-amber-300 text-base">
              {Math.round((debugSettings.cameraD || 1564) / zoom)}
            </span>
            <span className="text-[10px] text-slate-400 font-normal">px</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setDebugSettings((p) => ({ ...p, cameraD: Math.max(300, (p.cameraD || 1564) - 50) }))}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[10px] font-bold text-slate-200 cursor-pointer transition-all active:scale-95"
              title="降低相机高度 -50"
            >
              -50
            </button>
            <button
              onClick={() => setDebugSettings((p) => ({ ...p, cameraD: Math.min(2500, (p.cameraD || 1564) + 50) }))}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[10px] font-bold text-slate-200 cursor-pointer transition-all active:scale-95"
              title="升高相机高度 +50"
            >
              +50
            </button>
            <button
              onClick={() => {
                setZoom(1.0);
                setDebugSettings((p) => ({ ...p, cameraD: 1564, pitch: 0, yaw: 0 }));
              }}
              className="ml-1 px-2 py-0.5 bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 text-[10px] rounded flex items-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm"
              title="重置相机高度至基准 1564px"
            >
              <RotateCcw className="w-3 h-3 text-cyan-400" />
              <span>1564 重置</span>
            </button>
          </div>
        </div>

        {/* F3 Debug Panel Toggle Button */}
        <button
          onClick={() => setDebugSettings((prev) => ({ ...prev, f3Open: !prev.f3Open }))}
          className="px-3 py-2 bg-slate-950/95 hover:bg-slate-900 border border-cyan-500/60 text-cyan-300 font-mono text-xs rounded-xl shadow-2xl flex items-center gap-1.5 cursor-pointer backdrop-blur-xl transition-all active:scale-95"
          title="按 F3 或点击展开高级 3D 调试面板"
        >
          <Sliders className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>F3 面板</span>
        </button>
      </div>

      {/* --- F3 Debug Overlay Window --- */}
      {debugSettings.f3Open && (
        <div className="absolute top-16 right-4 z-40 w-84 max-h-[85vh] bg-slate-950/95 border border-cyan-500/50 shadow-2xl rounded-xl p-4 text-xs font-mono text-slate-200 backdrop-blur-xl overflow-y-auto space-y-4 animate-in fade-in zoom-in-95">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span className="font-bold text-cyan-300 text-sm">F3 渲染与镜头 Debug</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 font-bold rounded text-[10px]">
                {fps} FPS
              </span>
              <button
                onClick={() => setDebugSettings((prev) => ({ ...prev, f3Open: false }))}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Section 1: Light Direction */}
          <div className="space-y-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-amber-300 font-bold">
              <span className="flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-amber-400" /> 3D Toon 光照方向 (Light Vector)
              </span>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>Light X (左右):</span>
                  <span className="text-amber-300">{debugSettings.lightX.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="-1.0"
                  max="1.0"
                  step="0.02"
                  value={debugSettings.lightX}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, lightX: parseFloat(e.target.value) }))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>Light Y (上下):</span>
                  <span className="text-amber-300">{debugSettings.lightY.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="-1.0"
                  max="1.0"
                  step="0.02"
                  value={debugSettings.lightY}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, lightY: parseFloat(e.target.value) }))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>Light Z (前后高度):</span>
                  <span className="text-amber-300">{debugSettings.lightZ.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.5"
                  step="0.02"
                  value={debugSettings.lightZ}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, lightZ: parseFloat(e.target.value) }))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>
            </div>

            {/* Light Presets */}
            <div className="grid grid-cols-2 gap-1 pt-1">
              <button
                onClick={() => setDebugSettings((p) => ({ ...p, lightX: -0.354, lightY: -0.354, lightZ: 0.866 }))}
                className="px-2 py-1 bg-slate-800 hover:bg-amber-950/60 border border-slate-700 hover:border-amber-500/50 text-[10px] rounded text-slate-200 transition-all cursor-pointer"
              >
                ↖️ 左上 (默认)
              </button>
              <button
                onClick={() => setDebugSettings((p) => ({ ...p, lightX: 0.354, lightY: -0.354, lightZ: 0.866 }))}
                className="px-2 py-1 bg-slate-800 hover:bg-amber-950/60 border border-slate-700 hover:border-amber-500/50 text-[10px] rounded text-slate-200 transition-all cursor-pointer"
              >
                ↗️ 右上
              </button>
              <button
                onClick={() => setDebugSettings((p) => ({ ...p, lightX: 0.0, lightY: 0.0, lightZ: 1.0 }))}
                className="px-2 py-1 bg-slate-800 hover:bg-amber-950/60 border border-slate-700 hover:border-amber-500/50 text-[10px] rounded text-slate-200 transition-all cursor-pointer"
              >
                ☀️ 正前 90°
              </button>
              <button
                onClick={() => setDebugSettings((p) => ({ ...p, lightX: -0.85, lightY: 0.0, lightZ: 0.5 }))}
                className="px-2 py-1 bg-slate-800 hover:bg-amber-950/60 border border-slate-700 hover:border-amber-500/50 text-[10px] rounded text-slate-200 transition-all cursor-pointer"
              >
                🌘 侧强光
              </button>
            </div>
          </div>

          {/* Section 2: Camera Heights & Pitch */}
          <div className="space-y-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-cyan-300 font-bold">
              <span className="flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-cyan-400" /> 3D 镜头参数 (Pitch / Height)
              </span>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>俯仰角 Pitch (°):</span>
                  <span className="text-cyan-300">{debugSettings.pitch}°</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="65"
                  step="1"
                  value={debugSettings.pitch}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, pitch: parseInt(e.target.value) }))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>偏航角 Yaw (°):</span>
                  <span className="text-cyan-300">{debugSettings.yaw}°</span>
                </div>
                <input
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  value={debugSettings.yaw}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, yaw: parseInt(e.target.value) }))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>镜头高度 Distance D:</span>
                  <span className="text-cyan-300">{debugSettings.cameraD}</span>
                </div>
                <input
                  type="range"
                  min="300"
                  max="2500"
                  step="10"
                  value={debugSettings.cameraD}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, cameraD: parseInt(e.target.value) }))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>焦距 Focal Length:</span>
                  <span className="text-cyan-300">{debugSettings.focalLength}</span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="1800"
                  step="20"
                  value={debugSettings.focalLength}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, focalLength: parseInt(e.target.value) }))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>
            </div>

            {/* Camera Presets */}
            <div className="grid grid-cols-2 gap-1 pt-1">
              <button
                onClick={() => setDebugSettings((p) => ({ ...p, pitch: 0, yaw: 0, cameraD: 1564 }))}
                className="px-2 py-1 bg-slate-800 hover:bg-cyan-950/60 border border-slate-700 hover:border-cyan-500/50 text-[10px] rounded text-slate-200 transition-all cursor-pointer"
              >
                🎯 正俯视 90° (默认 1564)
              </button>
              <button
                onClick={() => setDebugSettings((p) => ({ ...p, pitch: 22, yaw: 0, cameraD: 1564 }))}
                className="px-2 py-1 bg-slate-800 hover:bg-cyan-950/60 border border-slate-700 hover:border-cyan-500/50 text-[10px] rounded text-slate-200 transition-all cursor-pointer"
              >
                🎮 RTS 倾角 22°
              </button>
              <button
                onClick={() => setDebugSettings((p) => ({ ...p, pitch: 38, yaw: 0, cameraD: 1600 }))}
                className="px-2 py-1 bg-slate-800 hover:bg-cyan-950/60 border border-slate-700 hover:border-cyan-500/50 text-[10px] rounded text-slate-200 transition-all cursor-pointer"
              >
                🎥 电影低视角 38°
              </button>
              <button
                onClick={() => setDebugSettings((p) => ({ ...p, pitch: 0, yaw: 15, cameraD: 1564 }))}
                className="px-2 py-1 bg-slate-800 hover:bg-cyan-950/60 border border-slate-700 hover:border-cyan-500/50 text-[10px] rounded text-slate-200 transition-all cursor-pointer"
              >
                🔄 偏航角 15°
              </button>
            </div>
          </div>

          {/* Section 3: Planet HUD Vertical Offsets */}
          <div className="space-y-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-indigo-300 font-bold">
              <span className="flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-indigo-400" /> 星球 HUD 间距微调 (UI Y-Offsets)
              </span>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>名字与血条间距 (Name Offset):</span>
                  <span className="text-indigo-300">{debugSettings.nameOffsetY}px</span>
                </div>
                <input
                  type="range"
                  min="-25"
                  max="-2"
                  step="1"
                  value={debugSettings.nameOffsetY}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, nameOffsetY: parseInt(e.target.value) }))}
                  className="w-full accent-indigo-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-0.5">
                  <span>图标与名字间距 (Icon Offset):</span>
                  <span className="text-indigo-300">{debugSettings.iconOffsetY}px</span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="-5"
                  step="1"
                  value={debugSettings.iconOffsetY}
                  onChange={(e) => setDebugSettings((p) => ({ ...p, iconOffsetY: parseInt(e.target.value) }))}
                  className="w-full accent-indigo-400 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Reset Action */}
          <button
            onClick={() => setDebugSettings({ ...defaultDebugSettings, f3Open: true })}
            className="w-full py-1.5 bg-slate-800 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/50 text-rose-300 hover:text-rose-200 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢复默认设置 (Reset Defaults)</span>
          </button>
        </div>
      )}
    </div>
  );
}
