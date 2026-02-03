import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { HandDetectionService } from '../services/handDetection';
import { HandGesture, HandData, SimulationStats } from '../types';

interface SimulationCanvasProps {
  onStatsUpdate: (stats: SimulationStats) => void;
  particleCount: number;
}

// Physics Constants
const GRAVITY = 30;          
const FRICTION_AIR = 0.98;   
const BOUNCE_WALL = 0.3;
const BOUNCE_GROUND = 0.3;
const HAND_RADIUS_SQ = 150 * 150;
const INTERACTION_FORCE = 800;

// Visual Constants for Velocity Coloring
const COLOR_SLOW_R = 20;
const COLOR_SLOW_G = 30;
const COLOR_SLOW_B = 150;
const COLOR_FAST_R = 180;
const COLOR_FAST_G = 20;
const COLOR_FAST_B = 20;

const DELTA_R = COLOR_FAST_R - COLOR_SLOW_R;
const DELTA_G = COLOR_FAST_G - COLOR_SLOW_G;
const DELTA_B = COLOR_FAST_B - COLOR_SLOW_B;

const COLOR_MAX_SPEED = 200;
const INV_COLOR_MAX_SPEED = 1 / COLOR_MAX_SPEED;

const SimulationCanvas: React.FC<SimulationCanvasProps> = React.memo(({ onStatsUpdate, particleCount }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const handServiceRef = useRef<HandDetectionService | null>(null);
  
  // Store array of detected hands
  const handDataRef = useRef<HandData[]>([]);

  // Use a ref to hold particle data
  const particlesRef = useRef<{
    x: Float32Array;
    y: Float32Array;
    vx: Float32Array;
    vy: Float32Array;
    radius: Float32Array;
  } | null>(null);

  // Initialize data structures based on the particleCount prop
  if (!particlesRef.current || particlesRef.current.x.length !== particleCount) {
    particlesRef.current = {
      x: new Float32Array(particleCount),
      y: new Float32Array(particleCount),
      vx: new Float32Array(particleCount),
      vy: new Float32Array(particleCount),
      radius: new Float32Array(particleCount),
    };
  }

  useEffect(() => {
    if (!containerRef.current || !videoRef.current || !particlesRef.current) return;

    // 1. Initialize PixiJS Application
    const app = new PIXI.Application({
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      resizeTo: containerRef.current,
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    appRef.current = app;
    containerRef.current.appendChild(app.view as unknown as HTMLCanvasElement);

    // --- Interaction Field Aura (Create Pool of 2) ---
    const auraRadius = Math.sqrt(HAND_RADIUS_SQ);
    const canvasSize = auraRadius * 4;
    const auraCanvas = document.createElement('canvas');
    auraCanvas.width = canvasSize;
    auraCanvas.height = canvasSize;
    const ctx = auraCanvas.getContext('2d');
    
    if (ctx) {
      const cx = canvasSize / 2;
      const cy = canvasSize / 2;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, auraRadius);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.25)'); 
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvasSize, canvasSize);
    }
    
    const auraTexture = PIXI.Texture.from(auraCanvas);
    
    // Create 2 aura sprites for multi-hand support
    const auraSprites: PIXI.Sprite[] = [
        new PIXI.Sprite(auraTexture),
        new PIXI.Sprite(auraTexture)
    ];

    auraSprites.forEach(sprite => {
        sprite.anchor.set(0.5);
        sprite.blendMode = ((PIXI as any).BLEND_MODES?.ADD ?? 1) as any;
        sprite.alpha = 0;
        app.stage.addChild(sprite);
    });

    // 2. Setup Particles
    const particleContainer = new PIXI.Container();
    app.stage.addChild(particleContainer);

    const particleGraphics = new PIXI.Graphics();
    particleGraphics.beginFill(0xFFFFFF); 
    particleGraphics.drawCircle(0, 0, 4);
    particleGraphics.endFill();
    const particleTexture = app.renderer.generateTexture(particleGraphics);

    const sprites: PIXI.Sprite[] = [];
    const p = particlesRef.current;
    const width = app.screen.width;
    const height = app.screen.height;
    
    const initialTint = (COLOR_SLOW_R << 16) | (COLOR_SLOW_G << 8) | COLOR_SLOW_B;

    // Initialize Randomly
    for (let i = 0; i < particleCount; i++) {
      const sprite = new PIXI.Sprite(particleTexture);
      sprite.anchor.set(0.5);
      
      p.x[i] = Math.random() * width;
      p.y[i] = Math.random() * height;
      
      p.vx[i] = (Math.random() - 0.5) * 5;
      p.vy[i] = (Math.random() - 0.5) * 5;
      
      const sizeVar = 0.5 + Math.random() * 0.5;
      p.radius[i] = 3 * sizeVar;

      sprite.scale.set(sizeVar * 0.5);
      sprite.tint = initialTint;
      
      sprites.push(sprite);
      particleContainer.addChild(sprite);
    }

    // --- Spatial Grid Setup ---
    const CELL_SIZE = 12;
    const gridW = Math.ceil(width / CELL_SIZE);
    const gridH = Math.ceil(height / CELL_SIZE);
    const gridHead = new Int32Array(gridW * gridH).fill(-1);
    const nextParticle = new Int32Array(particleCount).fill(-1);

    onStatsUpdate({ fps: 60, particleCount: particleCount, hands: [] });

    // Smooth tracking for 2 hands
    const smoothHands = [
        { x: width / 2, y: height / 2 },
        { x: width / 2, y: height / 2 }
    ];

    // 3. Physics Loop
    let tickerCount = 0;
    app.ticker.add(() => {
      const dt = 1 / 60; 
      const screenW = app.screen.width;
      const screenH = app.screen.height;
      const hands = handDataRef.current;

      // --- Update Auras ---
      // Reset auras first
      auraSprites.forEach(s => s.alpha *= 0.9);

      hands.forEach((hand, index) => {
          if (index >= 2) return; 
          const sprite = auraSprites[index];
          
          let handX = hand.x * screenW;
          let handY = hand.y * screenH;

          // Smooth Movement
          smoothHands[index].x += (handX - smoothHands[index].x) * 0.2;
          smoothHands[index].y += (handY - smoothHands[index].y) * 0.2;

          sprite.x = smoothHands[index].x;
          sprite.y = smoothHands[index].y;

          if (hand.gesture === HandGesture.OPEN_PALM) {
            sprite.tint = 0xFFD700; 
            sprite.alpha = 0.4;
            sprite.scale.set(1.1);
          } else if (hand.gesture === HandGesture.CLOSED_FIST) {
            sprite.tint = 0xFFFFFF; 
            sprite.alpha = 0.5;
            sprite.scale.set(0.9);
          } else {
            sprite.tint = 0xFFE0B2; 
            sprite.alpha = 0.2;
            sprite.scale.set(1.0);
          }
      });

      gridHead.fill(-1);

      // --- Pass 1: Integration & Grid Insertion & Coloring ---
      for (let i = 0; i < particleCount; i++) {
        // Respawn safety
        if (!Number.isFinite(p.x[i]) || !Number.isFinite(p.y[i])) {
            p.x[i] = Math.random() * screenW;
            p.y[i] = screenH - 50;
            p.vx[i] = 0;
            p.vy[i] = 0;
        }

        let ax = 0;
        let ay = GRAVITY;

        // Hand Interaction (Loop through all hands)
        for (const hand of hands) {
            const handX = hand.x * screenW;
            const handY = hand.y * screenH;
            const dx = p.x[i] - handX;
            const dy = p.y[i] - handY;
            const distSq = dx * dx + dy * dy;

            if (distSq < HAND_RADIUS_SQ) {
                const dist = Math.sqrt(distSq);
                const nx = dx / (dist || 0.1);
                const ny = dy / (dist || 0.1);
                const falloff = 1 - (dist / Math.sqrt(HAND_RADIUS_SQ));

                // Add hand velocity
                const handVelX = (hand.velocity?.x || 0) * screenW * 0.04;
                const handVelY = (hand.velocity?.y || 0) * screenH * 0.04;
                
                p.vx[i] += handVelX * falloff;
                p.vy[i] += handVelY * falloff;

                let force = 0;
                if (hand.gesture === HandGesture.OPEN_PALM) force = INTERACTION_FORCE * falloff;
                else if (hand.gesture === HandGesture.CLOSED_FIST) force = -INTERACTION_FORCE * falloff;
                
                ax += nx * force;
                ay += ny * force;
            }
        }

        // Integration
        p.vx[i] += ax * dt;
        p.vy[i] += ay * dt;
        p.vx[i] *= FRICTION_AIR; 
        p.vy[i] *= FRICTION_AIR;

        // Max Velocity
        const MAX_VEL = 250;
        if (p.vx[i] > MAX_VEL) p.vx[i] = MAX_VEL;
        else if (p.vx[i] < -MAX_VEL) p.vx[i] = -MAX_VEL;
        if (p.vy[i] > MAX_VEL) p.vy[i] = MAX_VEL;
        else if (p.vy[i] < -MAX_VEL) p.vy[i] = -MAX_VEL;

        // Color Gradient
        const speedSq = p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i];
        const speed = Math.sqrt(speedSq);
        
        let t = speed * INV_COLOR_MAX_SPEED;
        if (t > 1) t = 1;

        const r = (COLOR_SLOW_R + DELTA_R * t) | 0;
        const g = (COLOR_SLOW_G + DELTA_G * t) | 0;
        const b = (COLOR_SLOW_B + DELTA_B * t) | 0;

        sprites[i].tint = (r << 16) | (g << 8) | b;

        p.x[i] += p.vx[i] * dt * 5;
        p.y[i] += p.vy[i] * dt * 5;

        // Boundaries
        const rRad = p.radius[i];

        if (p.y[i] > screenH - rRad) { 
            p.y[i] = screenH - rRad; 
            p.vy[i] *= -BOUNCE_GROUND; 
        } else if (p.y[i] < rRad) { 
            p.y[i] = rRad; 
            p.vy[i] *= -BOUNCE_WALL; 
        }

        if (p.x[i] > screenW - rRad) { 
            p.x[i] = screenW - rRad; 
            p.vx[i] *= -BOUNCE_WALL; 
        } else if (p.x[i] < rRad) { 
            p.x[i] = rRad; 
            p.vx[i] *= -BOUNCE_WALL; 
        }

        // Insert into Grid
        const cx = (p.x[i] / CELL_SIZE) | 0;
        const cy = (p.y[i] / CELL_SIZE) | 0;

        if (cx >= 0 && cx < gridW && cy >= 0 && cy < gridH) {
          const cellIdx = cy * gridW + cx;
          nextParticle[i] = gridHead[cellIdx];
          gridHead[cellIdx] = i;
        }
      }

      // --- Pass 2: Particle-Particle Collisions (Same as before) ---
      for (let i = 0; i < particleCount; i++) {
        const cx = (p.x[i] / CELL_SIZE) | 0;
        const cy = (p.y[i] / CELL_SIZE) | 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ncx = cx + dx;
            const ncy = cy + dy;

            if (ncx >= 0 && ncx < gridW && ncy >= 0 && ncy < gridH) {
              const cellIdx = ncy * gridW + ncx;
              let j = gridHead[cellIdx];

              let iterations = 0;
              while (j !== -1 && iterations < 50) {
                if (i !== j) {
                  const dx = p.x[i] - p.x[j];
                  const dy = p.y[i] - p.y[j];
                  const distSq = dx * dx + dy * dy;
                  const rSum = p.radius[i] + p.radius[j]; 

                  if (distSq < rSum * rSum && distSq > 0.001) {
                    const dist = Math.sqrt(distSq);
                    const overlap = rSum - dist;
                    const nx = dx / dist;
                    const ny = dy / dist;

                    const percent = 0.5;
                    p.x[i] += nx * overlap * percent;
                    p.y[i] += ny * overlap * percent;
                    p.x[j] -= nx * overlap * percent;
                    p.y[j] -= ny * overlap * percent;

                    const dvx = p.vx[i] - p.vx[j];
                    const dvy = p.vy[i] - p.vy[j];
                    const dot = dvx * nx + dvy * ny;

                    if (dot < 0) {
                        const impulse = 0.5;
                        const impulseX = nx * dot * impulse;
                        const impulseY = ny * dot * impulse;

                        p.vx[i] -= impulseX;
                        p.vy[i] -= impulseY;
                        p.vx[j] += impulseX;
                        p.vy[j] += impulseY;
                    }
                  }
                }
                j = nextParticle[j];
                iterations++;
              }
            }
          }
        }

        sprites[i].x = p.x[i];
        sprites[i].y = p.y[i];
      }

      tickerCount++;
      if (tickerCount % 15 === 0) {
        onStatsUpdate({
          fps: Math.round(app.ticker.FPS),
          particleCount: particleCount,
          hands: handDataRef.current
        });
      }
    });

    const service = new HandDetectionService(
      videoRef.current,
      (data) => { handDataRef.current = data; }
    );
    service.initialize().catch(console.error);
    handServiceRef.current = service;

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
      if (handServiceRef.current) {
        handServiceRef.current.stop();
        handServiceRef.current = null;
      }
    };
  }, [particleCount]);

  return (
    <div className="relative w-full h-full bg-zinc-950 overflow-hidden">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      <video
        ref={videoRef}
        className="absolute top-0 right-0 opacity-0 pointer-events-none"
        width="640"
        height="480"
        playsInline
        muted
        autoPlay
      />
    </div>
  );
});

export default SimulationCanvas;