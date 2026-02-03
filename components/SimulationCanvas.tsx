import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { HandDetectionService } from '../services/handDetection';
import { HandGesture, HandData, SimulationStats } from '../types';

interface SimulationCanvasProps {
  onStatsUpdate: (stats: SimulationStats) => void;
  particleCount: number;
}

// Physics Constants Optimized for Natural Fall
const GRAVITY = 30;          
const FRICTION_AIR = 0.98;   
const BOUNCE_WALL = 0.3;
const BOUNCE_GROUND = 0.3;
const HAND_RADIUS_SQ = 150 * 150;
const INTERACTION_FORCE = 800; // Reduced from 1500 to 800 for subtle interaction

const SimulationCanvas: React.FC<SimulationCanvasProps> = React.memo(({ onStatsUpdate, particleCount }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const handServiceRef = useRef<HandDetectionService | null>(null);
  
  const handDataRef = useRef<HandData>({
    x: 0.5,
    y: 0.5,
    gesture: HandGesture.NONE,
    velocity: { x: 0, y: 0 }
  });

  // Use a ref to hold particle data. Initialize lazily to ensure it matches prop size if re-mounted.
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

    // --- Interaction Field Aura ---
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
    const auraSprite = new PIXI.Sprite(auraTexture);
    auraSprite.anchor.set(0.5);
    auraSprite.blendMode = ((PIXI as any).BLEND_MODES?.ADD ?? 1) as any;
    auraSprite.alpha = 0;
    
    app.stage.addChild(auraSprite);

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
    
    const colors = [0xFFD700, 0xE5C100, 0xC5A000, 0xFFE066, 0xDAA520, 0xF4A460];
    
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
      sprite.tint = colors[Math.floor(Math.random() * colors.length)];
      
      sprites.push(sprite);
      particleContainer.addChild(sprite);
    }

    // --- Spatial Grid Setup ---
    const CELL_SIZE = 12;
    const gridW = Math.ceil(width / CELL_SIZE);
    const gridH = Math.ceil(height / CELL_SIZE);
    const gridHead = new Int32Array(gridW * gridH).fill(-1);
    const nextParticle = new Int32Array(particleCount).fill(-1);

    onStatsUpdate({ fps: 60, particleCount: particleCount, gesture: HandGesture.NONE });

    let smoothHandX = width / 2;
    let smoothHandY = height / 2;

    // 3. Physics Loop
    let tickerCount = 0;
    app.ticker.add(() => {
      const dt = 1 / 60; 
      const screenW = app.screen.width;
      const screenH = app.screen.height;
      const hand = handDataRef.current;
      let handX = hand.x * screenW;
      let handY = hand.y * screenH;
      const hasHand = hand.gesture !== HandGesture.NONE;
      
      if (!Number.isFinite(handX) || !Number.isFinite(handY)) {
        handX = -1000;
        handY = -1000;
      }

      // --- Update Aura ---
      if (hasHand) {
        smoothHandX += (handX - smoothHandX) * 0.2;
        smoothHandY += (handY - smoothHandY) * 0.2;
        auraSprite.x = smoothHandX;
        auraSprite.y = smoothHandY;
        
        if (hand.gesture === HandGesture.OPEN_PALM) {
          auraSprite.tint = 0xFFD700; 
          auraSprite.alpha = 0.4;
          auraSprite.scale.set(1.1);
        } else if (hand.gesture === HandGesture.CLOSED_FIST) {
          auraSprite.tint = 0xFFFFFF; 
          auraSprite.alpha = 0.5;
          auraSprite.scale.set(0.9);
        } else {
          auraSprite.tint = 0xFFE0B2; 
          auraSprite.alpha = 0.2;
          auraSprite.scale.set(1.0);
        }
      } else {
        auraSprite.alpha *= 0.9;
      }

      // Reduced velocity influence from 0.08 to 0.04
      const handVelX = (Number.isFinite(hand.velocity.x) ? hand.velocity.x : 0) * screenW * 0.04;
      const handVelY = (Number.isFinite(hand.velocity.y) ? hand.velocity.y : 0) * screenH * 0.04;

      gridHead.fill(-1);

      // --- Pass 1: Integration & Grid Insertion ---
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

        // Hand Interaction
        if (hasHand) {
          const dx = p.x[i] - handX;
          const dy = p.y[i] - handY;
          const distSq = dx * dx + dy * dy;

          if (distSq < HAND_RADIUS_SQ) {
            const dist = Math.sqrt(distSq);
            const nx = dx / (dist || 0.1);
            const ny = dy / (dist || 0.1);
            const falloff = 1 - (dist / Math.sqrt(HAND_RADIUS_SQ));

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

        // Max Velocity kept at 250 as requested previously
        const MAX_VEL = 250;
        if (p.vx[i] > MAX_VEL) p.vx[i] = MAX_VEL;
        else if (p.vx[i] < -MAX_VEL) p.vx[i] = -MAX_VEL;
        if (p.vy[i] > MAX_VEL) p.vy[i] = MAX_VEL;
        else if (p.vy[i] < -MAX_VEL) p.vy[i] = -MAX_VEL;

        p.x[i] += p.vx[i] * dt * 5;
        p.y[i] += p.vy[i] * dt * 5;

        // Screen Boundaries
        const r = p.radius[i];

        if (p.y[i] > screenH - r) { 
            p.y[i] = screenH - r; 
            p.vy[i] *= -BOUNCE_GROUND; 
        } else if (p.y[i] < r) { 
            p.y[i] = r; 
            p.vy[i] *= -BOUNCE_WALL; 
        }

        if (p.x[i] > screenW - r) { 
            p.x[i] = screenW - r; 
            p.vx[i] *= -BOUNCE_WALL; 
        } else if (p.x[i] < r) { 
            p.x[i] = r; 
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

      // --- Pass 2: Particle-Particle Collisions ---
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
          gesture: handDataRef.current.gesture
        });
      }
    });

    // 4. Initialize Hand Detection
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