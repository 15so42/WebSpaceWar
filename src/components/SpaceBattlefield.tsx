import React, { useRef, useEffect, useState, MouseEvent, useMemo, useCallback } from 'react';
import { GameState, Planet, Ship, ShipType, ShipState, PlanetType, PlanetSubType } from '../types';
import { SHIP_CONFIGS, MAP_WIDTH, MAP_HEIGHT } from '../gameEngine';
import { Target, Shield, Compass, Swords, Eye, X, ChevronRight } from 'lucide-react';

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

// 3D Perspective Camera Parameters
const PITCH = -0.785398; // Tilt angle (-45 degrees)
const YAW = 0;  // Cinematic angle offset (0 degrees)
const D = 900;       // Camera distance
const FOCAL_LENGTH = 1000; // Focal length

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

  const cosY = Math.cos(YAW);
  const sinY = Math.sin(YAW);
  const cosP = Math.cos(PITCH);
  const sinP = Math.sin(PITCH);

  // 1. Rotate around Z (Yaw)
  const rx1 = dx * cosY - dy * sinY;
  const ry1 = dx * sinY + dy * cosY;
  const rz1 = dz;

  // 2. Rotate around X (Pitch)
  const rx2 = rx1;
  const ry2 = ry1 * cosP - rz1 * sinP;
  const rz2 = ry1 * sinP + rz1 * cosP;

  const depth = (D / globalCurrentZoom) + rz2;
  const scale = (FOCAL_LENGTH * globalCurrentZoom) / Math.max(100, depth);

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

  // Majestic size hierarchy for important strategic hubs
  let radius = 26;
  if (planet.type === PlanetType.HOME) {
    radius = Math.floor(45 + rand() * 10); // 45 to 55 pixels: huge majestic capitals!
  } else if (planet.name === '奥瑞恩中心晶矿') {
    radius = Math.floor(36 + rand() * 8); // 36 to 44 pixels: giant highly contested crystal star!
  } else if (planet.type === PlanetType.RESOURCE || planet.type === PlanetType.SPECIAL) {
    radius = Math.floor(25 + rand() * 8); // 25 to 33 pixels: significant resource nodes
  } else {
    radius = Math.floor(18 + rand() * 6); // 18 to 24 pixels: smaller tactical outposts
  }

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

  // --- 1. Realistic Volumetric Atmosphere Back-Glow (smooth radial gradient falling off rapidly) ---
  const backGlowRad = screenR * 1.35;
  const backGlow = ctx.createRadialGradient(
    projCenter.x,
    projCenter.y,
    0, // start from center of planet
    projCenter.x,
    projCenter.y,
    backGlowRad
  );
  backGlow.addColorStop(0, hexToRgba(cache.style.primaryColor, 0.5));
  backGlow.addColorStop(0.65, hexToRgba(cache.style.primaryColor, 0.45));
  backGlow.addColorStop(0.74, hexToRgba(cache.style.primaryColor, 0.35)); // starts sharp fade near planet edge
  backGlow.addColorStop(0.85, hexToRgba(cache.style.primaryColor, 0.08)); // rapid fade-out
  backGlow.addColorStop(0.92, hexToRgba(cache.style.primaryColor, 0.02)); // almost dark space
  backGlow.addColorStop(1, 'transparent');

  ctx.fillStyle = backGlow;
  ctx.beginPath();
  ctx.arc(projCenter.x, projCenter.y, backGlowRad, 0, Math.PI * 2);
  ctx.fill();

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

  // 2. Procedural Volumetric 3D Pixel Shader for Core Planet & Clouds
  const screenR_cloud = screenR * cMult;
  const res = 30; // High-quality retro pixel grid
  const pixelSize = (screenR_cloud * 2) / res;
  const startX = projCenter.x - screenR_cloud;
  const startY = projCenter.y - screenR_cloud;
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

  // Directional Toon Lighting source
  const L = { x: -0.55, y: -0.55, z: 0.63 };

  // Select custom color palette
  const palette = getPixelPlanetPalette(pl, planetColor);

  // 12-degree axial tilt
  const tilt = 0.22;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  // Draw pixel grid
  for (let px = 0; px < res; px++) {
    for (let py = 0; py < res; py++) {
      // Coordinates normalized to cloud sphere radius [-1.0, 1.0]
      const dx = (px - halfRes + 0.5) / halfRes;
      const dy = (py - halfRes + 0.5) / halfRes;
      const distSq = dx * dx + dy * dy;

      if (distSq > 1.0) continue; // Outside cloud layer bounds

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
          if (dot_c > 0.22) {
            cloudColor = '#ffffff';
          } else if (dot_c > -0.25) {
            cloudColor = '#cbd5e1';
          } else {
            cloudColor = '#475569';
          }
        }
      }

      if (isCloudPixel) {
        ctx.fillStyle = cloudColor;
        ctx.fillRect(
          Math.floor(startX + px * pixelSize),
          Math.floor(startY + py * pixelSize),
          Math.ceil(pixelSize),
          Math.ceil(pixelSize)
        );
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
          ctx.fillRect(
            Math.floor(startX + px * pixelSize),
            Math.floor(startY + py * pixelSize),
            Math.ceil(pixelSize),
            Math.ceil(pixelSize)
          );
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

        ctx.fillStyle = terrainColor;
        ctx.fillRect(
          Math.floor(startX + px * pixelSize),
          Math.floor(startY + py * pixelSize),
          Math.ceil(pixelSize),
          Math.ceil(pixelSize)
        );
      }
    }
  }

  // --- Draw FRONT Particles of the 3D Ring ---
  drawRingParticles(frontParticles);

  // --- 3. Beautiful Volumetric Atmosphere Glow Overlay (peaking at limb, soft overall, sharp outer falloff) ---
  const frontGlowRad = screenR * 1.35;
  const frontGlow = ctx.createRadialGradient(
    projCenter.x,
    projCenter.y,
    0, // start from center of planet
    projCenter.x,
    projCenter.y,
    frontGlowRad
  );
  frontGlow.addColorStop(0, hexToRgba(cache.style.primaryColor, 0.10)); // soft overall facial haze
  frontGlow.addColorStop(0.65, hexToRgba(cache.style.primaryColor, 0.15));
  frontGlow.addColorStop(0.72, hexToRgba(cache.style.primaryColor, 0.45)); // maximum scattering near limb
  frontGlow.addColorStop(0.74, hexToRgba(cache.style.primaryColor, 0.20)); // falls off rapidly at edge
  frontGlow.addColorStop(0.85, hexToRgba(cache.style.primaryColor, 0.03)); // almost gone just outside
  frontGlow.addColorStop(1, 'transparent');

  ctx.fillStyle = frontGlow;
  ctx.beginPath();
  ctx.arc(projCenter.x, projCenter.y, frontGlowRad, 0, Math.PI * 2);
  ctx.fill();

  // Pulse effect if selected or hovered
  if (isHovered) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(projCenter.x, projCenter.y, screenR + 4 + Math.sin(Date.now() * 0.01) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Draw any beautiful, flat helper circles on the 3D plane in perspective projection
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
  const steps = 40;
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

// Procedurally draws beautiful 3D spacecraft scaling with perspective camera depth
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
  height: number
) {
  const scale = type === ShipType.DREADNOUGHT ? 1.25 : type === ShipType.FRIGATE ? 1.0 : 0.85;
  const baseRgb = hexToRgb(baseColorHex) || { r: 255, g: 255, b: 255 };

  let vertices: Vertex3D[] = [];
  let faces: number[][] = [];

  if (type === ShipType.SCOUT) {
    vertices = [
      { x: 10, y: 0, z: 0 },
      { x: -8, y: -6, z: -1.5 },
      { x: -8, y: 6, z: -1.5 },
      { x: -3, y: 0, z: 4 },
      { x: -4, y: 0, z: -2.5 },
    ];
    faces = [
      [0, 2, 3],
      [0, 3, 1],
      [0, 1, 4],
      [0, 4, 2],
      [1, 3, 2, 4],
    ];
  } else if (type === ShipType.FRIGATE) {
    vertices = [
      { x: 12, y: 0, z: 1 },
      { x: 3, y: -4.5, z: -1.5 },
      { x: 3, y: 4.5, z: -1.5 },
      { x: -11, y: -6, z: 0 },
      { x: -11, y: 6, z: 0 },
      { x: -3, y: 0, z: 5.5 },
    ];
    faces = [
      [0, 2, 5], [0, 5, 1],
      [1, 5, 3], [2, 4, 5],
      [1, 3, 0], [2, 0, 4],
      [3, 4, 5],
    ];
  } else if (type === ShipType.DREADNOUGHT) {
    vertices = [
      { x: 19, y: 0, z: 0 },
      { x: -13, y: -12, z: -3 },
      { x: -13, y: 12, z: -3 },
      { x: -3, y: 0, z: 5.5 },
      { x: -13, y: 0, z: 2.5 },
    ];
    faces = [
      [0, 2, 3], [0, 3, 1],
      [1, 3, 4], [2, 4, 3],
      [0, 1, 2],
      [1, 4, 2],
    ];
  } else {
    // Spy
    vertices = [
      { x: 11, y: 0, z: 0 },
      { x: 0, y: -5, z: 0 },
      { x: 0, y: 5.5, z: 0 },
      { x: -9, y: 0, z: 0 },
      { x: 0, y: 0, z: 3.5 },
      { x: 0, y: 0, z: -3.5 },
    ];
    faces = [
      [0, 2, 4], [0, 4, 1], [3, 1, 4], [3, 4, 2],
      [0, 5, 2], [0, 1, 5], [3, 1, 5], [3, 5, 2],
    ];
  }

  const cosH = Math.cos(headingAngle);
  const sinH = Math.sin(headingAngle);

  // Rotate, translate, and project vertices using our 3D perspective projection
  const projected = vertices.map((v) => {
    const lx = v.x * scale;
    const ly = v.y * scale;
    const lz = v.z * scale;

    const rx = lx * cosH - ly * sinH;
    const ry = lx * sinH + ly * cosH;
    const rz = lz;

    const wx = sx + rx;
    const wy = sy + ry;
    const wz = sz + rz;

    return projectPoint(wx, wy, wz, camFocus, width, height);
  });

  const light = { x: -0.5, y: -0.5, z: 0.7 };
  const mag = Math.sqrt(light.x * light.x + light.y * light.y + light.z * light.z);
  light.x /= mag; light.y /= mag; light.z /= mag;

  const faceDepths = faces.map((face, index) => {
    const sumZ = face.reduce((acc, idx) => acc + projected[idx].z, 0);
    return { index, avgZ: sumZ / face.length };
  });
  faceDepths.sort((a, b) => a.avgZ - b.avgZ);

  faceDepths.forEach(({ index }) => {
    const face = faces[index];
    const p0 = projected[face[0]];
    const p1 = projected[face[1]];
    const p2 = projected[face[2]];

    const val = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
    if (val >= 0) return;

    const v0 = vertices[face[0]];
    const v1 = vertices[face[1]];
    const v2 = vertices[face[2]];

    const rx0 = v0.x * cosH - v0.y * sinH;
    const ry0 = v0.x * sinH + v0.y * cosH;
    const rz0 = v0.z;

    const rx1 = v1.x * cosH - v1.y * sinH;
    const ry1 = v1.x * sinH + v1.y * cosH;
    const rz1 = v1.z;

    const rx2 = v2.x * cosH - v2.y * sinH;
    const ry2 = v2.x * sinH + v2.y * cosH;
    const rz2 = v2.z;

    const ux = rx1 - rx0;
    const uy = ry1 - ry0;
    const uz = rz1 - rz0;

    const wx = rx2 - rx0;
    const wy = ry2 - ry0;
    const wz = rz2 - rz0;

    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const nMag = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nMag > 0) {
      nx /= nMag; ny /= nMag; nz /= nMag;
    }

    const dot = nx * light.x + ny * light.y + nz * light.z;
    const brightness = Math.max(0.25, (dot + 1) / 2);

    const r = Math.round(baseRgb.r * brightness);
    const g = Math.round(baseRgb.g * brightness);
    const b = Math.round(baseRgb.b * brightness);

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.strokeStyle = `rgba(${Math.round(r * 1.2)}, ${Math.round(g * 1.2)}, ${Math.round(b * 1.2)}, 0.45)`;
    ctx.lineWidth = 0.5;

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
    const rearX = sx - cosH * 11 * scale;
    const rearY = sy - sinH * 11 * scale;
    const rearZ = sz;

    const projRear = projectPoint(rearX, rearY, rearZ, camFocus, width, height);

    ctx.fillStyle = type === ShipType.DREADNOUGHT ? '#38bdf8' : '#f97316';
    ctx.globalAlpha = 0.65 + Math.random() * 0.35;
    ctx.beginPath();
    ctx.arc(projRear.x, projRear.y, 4 * projRear.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}

// Generate stable procedural star systems and deep space nebula clouds for background scrolling
const generateBackgroundAssets = (): { stars: BackgroundStar[]; nebulae: BackgroundNebula[] } => {
  const stars: BackgroundStar[] = [];
  const nebulae: BackgroundNebula[] = [];

  const rand = seededRandom('galaxy_nebula_field_seed_882');

  // Distant twinkling stellar field
  for (let i = 0; i < 200; i++) {
    const depth = 0.04 + rand() * 0.16;
    const size = 0.5 + rand() * 1.6;

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

  // Giant colorful cosmic gas clouds (nebulae)
  const nebulaColors = [
    'rgba(29, 78, 216, 0.16)',  // Sapphire Blue
    'rgba(124, 58, 237, 0.14)', // Royal Purple
    'rgba(6, 182, 212, 0.10)',  // Electric Cyan/Teal
    'rgba(219, 39, 119, 0.09)', // Magenta Dust
    'rgba(3, 7, 18, 0.40)',     // Cosmic void dark dust cloud (creates silhouettes!)
    'rgba(37, 99, 235, 0.12)',  // Cobalt Blue
    'rgba(109, 40, 217, 0.11)', // Violet Glimmer
  ];
  // Generate 12 overlapping nebulae for deep volumetric layering
  for (let i = 0; i < 12; i++) {
    const depth = 0.03 + (i % 3) * 0.05; // 0.03, 0.08, 0.13 for multi-level parallax depth
    nebulae.push({
      x: rand() * 1.4 - 0.2, // extend beyond edges for panning support
      y: rand() * 1.4 - 0.2,
      radius: 250 + rand() * 300,
      color: nebulaColors[i % nebulaColors.length],
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

  // Particle list for combat spark explosions
  const sparksRef = useRef<{ x: number; y: number; vx: number; vy: number; color: string; life: number }[]>([]);

  // Center camera Focus on Home planet initially when started
  useEffect(() => {
    const myHome = Object.values(state.planets).find(
      (p) => p.type === PlanetType.HOME && p.ownerId === playerId
    );
    if (myHome && containerRef.current) {
      setCamFocus({
        x: myHome.x,
        y: myHome.y,
      });
    }
  }, [state.gameStarted]);

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
      // Update global zoom reference for 3D projections on each frame
      globalCurrentZoom = zoom;

      // Clear with deep space backdrop gradient (deep navy to dark space indigo)
      const spaceGrad = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        10,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width * 0.95
      );
      spaceGrad.addColorStop(0, '#040714');   // subtle dark navy core
      spaceGrad.addColorStop(0.5, '#020308'); // fades out
      spaceGrad.addColorStop(1, '#000103');   // pitch black outer depth
      ctx.fillStyle = spaceGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // --- PARALLAX BACKGROUND DRAWING ---
      const parallaxX = -camFocus.x;
      const parallaxY = -camFocus.y;

      // 1. Draw Nebula Gaseous Clouds
      bgAssets.nebulae.forEach((neb) => {
        const px = (neb.x * canvas.width) + (parallaxX * neb.depth);
        const py = (neb.y * canvas.height) + (parallaxY * neb.depth);

        const gradient = ctx.createRadialGradient(px, py, 10, px, py, neb.radius);
        gradient.addColorStop(0, neb.color);
        gradient.addColorStop(0.5, neb.color.replace('0.', '0.04'));
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, neb.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // 2. Draw Twinkling Stars
      bgAssets.stars.forEach((star) => {
        // Warp around screen boundaries infinitely
        const px = ((star.x * canvas.width + parallaxX * star.depth) % canvas.width + canvas.width) % canvas.width;
        const py = ((star.y * canvas.height + parallaxY * star.depth) % canvas.height + canvas.height) % canvas.height;

        const twinkle = Math.sin(Date.now() * star.twinkleSpeed + star.twinkleOffset) * 0.45 + 0.55;
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = star.color;

        if (star.size > 2.5) {
          ctx.beginPath();
          ctx.arc(px, py, star.size, 0, Math.PI * 2);
          ctx.fill();

          // Horizontal/Vertical diffraction glow spikes
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(px - 10, py);
          ctx.lineTo(px + 10, py);
          ctx.moveTo(px, py - 10);
          ctx.lineTo(px, py + 10);
          ctx.stroke();
        } else {
          ctx.fillRect(px, py, star.size, star.size);
        }
      });
      ctx.globalAlpha = 1.0;

      // --- 3D ENVIRONMENT GEOMETRIES ---
      // 2.5. Draw Faint Curved Connection Lanes (Shipping routes) between adjacent planets
      const drawnPairs = new Set<string>();
      const planetList = Object.values(state.planets);
      for (let i = 0; i < planetList.length; i++) {
        for (let j = i + 1; j < planetList.length; j++) {
          const pl1 = planetList[i];
          const pl2 = planetList[j];
          const dx = pl1.x - pl2.x;
          const dy = pl1.y - pl2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < 360) {
            const pairId = pl1.id < pl2.id ? `${pl1.id}_${pl2.id}` : `${pl2.id}_${pl1.id}`;
            if (!drawnPairs.has(pairId)) {
              drawnPairs.add(pairId);
              
              // Draw an elegant curved tactical connection route
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              
              const steps = 24;
              const px = -(pl2.y - pl1.y) / dist;
              const py = (pl2.x - pl1.x) / dist;
              const curveIntensity = 30 * (dist / 300); 
              
              for (let k = 0; k <= steps; k++) {
                const t = k / steps;
                const lx = pl1.x + (pl2.x - pl1.x) * t;
                const ly = pl1.y + (pl2.y - pl1.y) * t;
                const disp = Math.sin(t * Math.PI) * curveIntensity;
                const wx = lx + px * disp;
                const wy = ly + py * disp;
                
                const proj = projectPoint(wx, wy, 0, camFocus, canvas.width, canvas.height);
                if (k === 0) ctx.moveTo(proj.x, proj.y);
                else ctx.lineTo(proj.x, proj.y);
              }
              ctx.stroke();
            }
          }
        }
      }

      // 3. Draw 3D Arching Flight Routes in Hyperspace
      Object.values(state.ships).forEach((sh) => {
        if (sh.state === ShipState.MOVING && sh.targetPlanetId) {
          const src = state.planets[sh.planetId];
          const tgt = state.planets[sh.targetPlanetId];
          if (src && tgt) {
            const dx = src.x - tgt.x;
            const dy = src.y - tgt.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            ctx.strokeStyle = sh.ownerId === playerId ? 'rgba(59, 130, 246, 0.25)' : 'rgba(239, 68, 68, 0.22)';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            
            const steps = 28;
            const px = -(tgt.y - src.y) / dist;
            const py = (tgt.x - src.x) / dist;
            const curveIntensity = 30 * (dist / 300);

            for (let i = 0; i <= steps; i++) {
              const p = i / steps;
              const lx = src.x + (tgt.x - src.x) * p;
              const ly = src.y + (tgt.y - src.y) * p;
              const disp = Math.sin(p * Math.PI) * curveIntensity;
              const wx = lx + px * disp;
              const wy = ly + py * disp;
              const wz = 60 * Math.sin(Math.PI * p);

              const proj = projectPoint(wx, wy, wz, camFocus, canvas.width, canvas.height);
              if (i === 0) ctx.moveTo(proj.x, proj.y);
              else ctx.lineTo(proj.x, proj.y);
            }
            ctx.stroke();
            
            const tOffset = (Date.now() * 0.001) % 1.0;
            const lx_p = src.x + (tgt.x - src.x) * tOffset;
            const ly_p = src.y + (tgt.y - src.y) * tOffset;
            const disp_p = Math.sin(tOffset * Math.PI) * curveIntensity;
            const wx_p = lx_p + px * disp_p;
            const wy_p = ly_p + py * disp_p;
            const wz_p = 60 * Math.sin(Math.PI * tOffset);
            
            const projPulse = projectPoint(wx_p, wy_p, wz_p, camFocus, canvas.width, canvas.height);
            ctx.fillStyle = sh.ownerId === playerId ? '#60a5fa' : '#f87171';
            ctx.beginPath();
            ctx.arc(projPulse.x, projPulse.y, 2.5 * projPulse.scale, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // 4. (Orbit rings under the planets flat on the 3D plane removed as requested)

      // Map to cache actual projected screen locations of ships for laser beam synchronization
      const shipProjectedMap: Record<string, { x: number; y: number }> = {};

      // 5. Draw 3D Planets (including layers: rings, oceans, continents, clouds, atmospheric glows)
      Object.values(state.planets).forEach((pl) => {
        const isHovered = hoveredPlanet?.id === pl.id;

        let planetColor = '#64748b';
        if (pl.ownerId) {
          const owner = state.players[pl.ownerId];
          if (owner) planetColor = owner.factionId;
        }

        const projPl = projectPoint(pl.x, pl.y, 0, camFocus, canvas.width, canvas.height);
        const cache = planetCache[pl.id];
        const radius = cache ? cache.style.radius : 24;
        const visualRadius = radius * projPl.scale;

        // Capture progress rings
        if (pl.captureProgress > 0 && pl.captureProgress < 100 && pl.capturingFactionId) {
          const capColor = state.players[pl.capturingFactionId]?.factionId || '#ffffff';
          const maxAng = (Math.PI * 2 * pl.captureProgress) / 100;
          draw3DFlatCircle(
            ctx,
            pl.x,
            pl.y,
            radius + 7,
            camFocus,
            canvas.width,
            canvas.height,
            capColor,
            3,
            undefined,
            -Math.PI / 2,
            maxAng - Math.PI / 2
          );
        }

        // Faction-colored high-tech orbital occupation rings
        if (pl.ownerId && pl.captureProgress === 100) {
          const owner = state.players[pl.ownerId];
          if (owner) {
            const ringCol = hexToRgba(owner.factionId, 0.45);
            const pulseSize = Math.sin(Date.now() * 0.003) * 1.2;
            
            // The first ring: thin, dashed, and pulsing
            draw3DFlatCircle(
              ctx,
              pl.x,
              pl.y,
              radius + 6 + pulseSize,
              camFocus,
              canvas.width,
              canvas.height,
              ringCol,
              1.0,
              [4, 4]
            );
            
            // The second ring: solid, very faint outer envelope
            draw3DFlatCircle(
              ctx,
              pl.x,
              pl.y,
              radius + 7.5,
              camFocus,
              canvas.width,
              canvas.height,
              hexToRgba(owner.factionId, 0.15),
              0.5
            );
            
            // Draw little rotating technical telemetry nodes on the orbit line
            const angleTick = (Date.now() * 0.0006) % (Math.PI * 2);
            for (let i = 0; i < 4; i++) {
              const tickAngle = angleTick + (i * Math.PI / 2);
              const tx = pl.x + Math.cos(tickAngle) * (radius + 6 + pulseSize);
              const ty = pl.y + Math.sin(tickAngle) * (radius + 6 + pulseSize);
              const projTick = projectPoint(tx, ty, 0, camFocus, canvas.width, canvas.height);
              
              ctx.fillStyle = owner.factionId;
              ctx.fillRect(Math.floor(projTick.x - 1.5), Math.floor(projTick.y - 1.5), 3, 3);
            }
          }
        }

        // Play card target indicator
        if (selectedCardId && isHovered) {
          draw3DFlatCircle(ctx, pl.x, pl.y, radius + 11, camFocus, canvas.width, canvas.height, '#ef4444', 1.5, [2, 3]);
        }

        // RENDER the 3D Procedural Multi-layered Planet Sphere
        draw3DPlanetWithLayers(ctx, pl, camFocus, canvas.width, canvas.height, planetColor, isHovered);

        // Name & Label details in high-readability tactical container cards
        let tag = '';
        let tagColor = '#94a3b8';
        if (pl.type === PlanetType.HOME) {
          tag = ' [母星]';
          tagColor = '#60a5fa';
        } else if (pl.type === PlanetType.RESOURCE) {
          tag = pl.subType === PlanetSubType.MINERAL ? ' [晶矿]' : ' [科技]';
          tagColor = '#fbbf24';
        } else if (pl.type === PlanetType.SPECIAL) {
          tag = pl.subType === PlanetSubType.HEAL ? ' [医疗]' : ' [重磁]';
          tagColor = '#34d399';
        } else {
          tag = ' [前哨]';
          tagColor = '#94a3b8';
        }
        
        ctx.font = 'bold 11px monospace';
        const displayName = pl.name;
        const textWidthName = ctx.measureText(displayName).width;
        ctx.font = 'bold 9px monospace';
        const textWidthTag = ctx.measureText(tag).width;
        const totalWidth = textWidthName + textWidthTag + 8;
        
        // Draw a neat dark glassmorphic label badge for maximum contrast
        ctx.fillStyle = 'rgba(8, 12, 28, 0.76)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 1;
        
        const pillX = projPl.x - totalWidth / 2;
        const pillY = projPl.y + visualRadius + 7;
        const pillW = totalWidth;
        const pillH = 26;
        
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 4);
        ctx.fill();
        ctx.stroke();
        
        // Write the name
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(displayName, pillX + 4, pillY + 11);
        
        // Write the category tag
        ctx.fillStyle = tagColor;
        ctx.font = 'bold 9px monospace';
        ctx.fillText(tag, pillX + 4 + textWidthName, pillY + 11);
        
        // Write sub-details on second row
        ctx.font = '9px sans-serif';
        if (pl.type === PlanetType.HOME) {
          ctx.fillStyle = pl.hp > 30 ? '#34d399' : '#f87171';
          ctx.fillText(`生命: ${Math.floor(pl.hp)}%`, pillX + 4, pillY + 22);
        } else if (pl.type === PlanetType.RESOURCE) {
          ctx.fillStyle = '#fbbf24';
          ctx.fillText(pl.subType === PlanetSubType.MINERAL ? '矿物资源 💎' : '科技结晶 🧬', pillX + 4, pillY + 22);
        } else if (pl.type === PlanetType.SPECIAL) {
          ctx.fillStyle = pl.subType === PlanetSubType.HEAL ? '#34d399' : '#38bdf8';
          ctx.fillText(pl.subType === PlanetSubType.HEAL ? '医疗恢复 🩹' : '强磁重盾 🛡️', pillX + 4, pillY + 22);
        } else {
          ctx.fillStyle = '#94a3b8';
          ctx.fillText(pl.ownerId ? '帝国前哨 🚩' : '废弃据点 🪐', pillX + 4, pillY + 22);
        }

        // Spies status
        if (pl.debuffs.length > 0) {
          const mySpyPresent = pl.debuffs.some((d) => d.ownerId === playerId);
          if (mySpyPresent) {
            ctx.fillStyle = '#c084fc';
            ctx.font = 'bold 8px monospace';
            ctx.fillText('🕵️ 我方间谍潜入', projPl.x, projPl.y - 38);
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

      // 6. Draw 3D Spacecrafts
      Object.values(state.ships).forEach((sh) => {
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

        if (sh.state === ShipState.MOVING && sh.targetPlanetId) {
          const src = state.planets[sh.planetId];
          const tgt = state.planets[sh.targetPlanetId];
          if (src && tgt) {
            const p = sh.travelProgress;
            const dx = src.x - tgt.x;
            const dy = src.y - tgt.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            // Linear interpolation base
            const lx = src.x + (tgt.x - src.x) * p;
            const ly = src.y + (tgt.y - src.y) * p;
            
            // Perpendicular curved displacement to follow connection lanes
            const px = -(tgt.y - src.y) / dist;
            const py = (tgt.x - src.x) / dist;
            const curveIntensity = 30 * (dist / 300);
            const disp = Math.sin(p * Math.PI) * curveIntensity;
            
            wx = lx + px * disp;
            wy = ly + py * disp;
            wz = 60 * Math.sin(Math.PI * p); // arch peak on Z-axis
            
            // Numerical tangent calculation for accurate heading direction along the curve
            const nextP = Math.min(1.0, p + 0.01);
            const nlx = src.x + (tgt.x - src.x) * nextP;
            const nly = src.y + (tgt.y - src.y) * nextP;
            const ndisp = Math.sin(nextP * Math.PI) * curveIntensity;
            const nwx = nlx + px * ndisp;
            const nwy = nly + py * ndisp;
            headingAngle = Math.atan2(nwy - wy, nwx - wx);
          }
        } else {
          // Stable orbit calculations
          const pl = state.planets[sh.planetId];
          if (pl) {
            const angle = Math.atan2(sh.y - pl.y, sh.x - pl.x);
            // Dynamic orbit radius scaling relative to the planet's visual radius to prevent clipping
            const plCache = planetCache[pl.id];
            const pRadius = plCache ? plCache.style.radius : (pl.type === PlanetType.HOME ? 50 : 24);
            const orbitRad = pRadius + (sh.type === ShipType.SCOUT ? 12 : sh.type === ShipType.FRIGATE ? 24 : sh.type === ShipType.DREADNOUGHT ? 36 : 10);

            const rx = Math.cos(angle) * orbitRad;
            const ry = Math.sin(angle) * orbitRad;

            const tiltX = 0.55;
            const tiltZ = 0.4;
            const y1 = ry * Math.cos(tiltX);
            const z1 = ry * Math.sin(tiltX);

            const x2 = rx * Math.cos(tiltZ) - y1 * Math.sin(tiltZ);
            const y2 = rx * Math.sin(tiltZ) + y1 * Math.cos(tiltZ);
            const z2 = z1;

            const zHeight =
              sh.type === ShipType.FRIGATE ? 9 : sh.type === ShipType.DREADNOUGHT ? -5 : sh.type === ShipType.SPY ? -9 : 3;

            wx = pl.x + x2;
            wy = pl.y + y2;
            wz = z2 + zHeight;

            headingAngle = angle + Math.PI / 2;
          }
        }

        // Draw and cache screen coordinates of ship
        const projShip = projectPoint(wx, wy, wz, camFocus, canvas.width, canvas.height);
        shipProjectedMap[sh.id] = { x: projShip.x, y: projShip.y };

        draw3DShip(ctx, sh.type, wx, wy, wz, headingAngle, shipColor, sh.state === ShipState.MOVING, camFocus, canvas.width, canvas.height);

        // Visual HP and shield overlay bars
        if (sh.hp < sh.maxHp || sh.type === ShipType.DREADNOUGHT) {
          const hpPct = sh.hp / sh.maxHp;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(projShip.x - 10, projShip.y - 13, 20, 3);
          ctx.fillStyle = hpPct > 0.4 ? '#10b981' : '#f43f5e';
          ctx.fillRect(projShip.x - 10, projShip.y - 13, 20 * hpPct, 3);
        }

        if (sh.shield > 0) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(projShip.x, projShip.y, 11 * projShip.scale, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // 7. Draw Real-time Combat lasers shot synchronized with projected coordinates
      Object.keys(state.planets).forEach((planetId) => {
        const pl = state.planets[planetId];
        if (pl.isContested) {
          const shipsAtPl = Object.values(state.ships).filter(
            (sh) => sh.planetId === planetId && sh.state !== ShipState.MOVING
          );

          shipsAtPl.forEach((attacker) => {
            if (SHIP_CONFIGS[attacker.type].attack > 0 && Math.random() < 0.28) {
              const targets = shipsAtPl.filter((t) => t.ownerId !== attacker.ownerId);
              if (targets.length > 0) {
                const target = targets[Math.floor(Math.random() * targets.length)];

                const sAttacker = shipProjectedMap[attacker.id];
                const sTarget = shipProjectedMap[target.id];

                if (sAttacker && sTarget) {
                  ctx.strokeStyle = attacker.ownerId === playerId ? '#10b981' : '#ef4444';
                  ctx.lineWidth = attacker.type === ShipType.DREADNOUGHT ? 2 : 1;
                  ctx.beginPath();
                  ctx.moveTo(sAttacker.x, sAttacker.y);
                  ctx.lineTo(sTarget.x, sTarget.y);
                  ctx.stroke();

                  // Exploding sparks
                  sparksRef.current.push({
                    x: sTarget.x,
                    y: sTarget.y,
                    vx: (Math.random() - 0.5) * 4.5,
                    vy: (Math.random() - 0.5) * 4.5,
                    color: attacker.ownerId === playerId ? '#34d399' : '#f87171',
                    life: 16,
                  });
                }
              }
            }
          });
        }
      });

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
    </div>
  );
}
