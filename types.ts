export enum HandGesture {
  NONE = 'NONE',
  OPEN_PALM = 'OPEN_PALM',
  CLOSED_FIST = 'CLOSED_FIST'
}

export interface HandData {
  x: number; // Normalized 0-1
  y: number; // Normalized 0-1
  gesture: HandGesture;
  velocity: { x: number; y: number };
}

export interface SimulationStats {
  fps: number;
  particleCount: number;
  gesture: HandGesture;
}

export interface ParticleConfig {
  count: number;
  gravity: number;
  friction: number;
  wallBounciness: number;
  interactionRadius: number;
  interactionForce: number;
}