export enum HandGesture {
  NONE = 'NONE',
  OPEN_PALM = 'OPEN_PALM',
  CLOSED_FIST = 'CLOSED_FIST'
}

export interface HandData {
  id: string;          // 'Left' or 'Right'
  x: number;           // Normalized 0-1
  y: number;           // Normalized 0-1
  gesture: HandGesture;
  velocity: { x: number; y: number };
}

export interface SimulationStats {
  fps: number;
  particleCount: number;
  hands: HandData[]; // Changed from single gesture to array of hands
}

export interface ParticleConfig {
  count: number;
  gravity: number;
  friction: number;
  wallBounciness: number;
  interactionRadius: number;
  interactionForce: number;
}