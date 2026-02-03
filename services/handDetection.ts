import { HandGesture, HandData } from '../types';

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface Results {
  multiHandLandmarks: Landmark[][];
  multiHandedness: Array<{ label: string, score: number }>;
}

declare global {
  interface Window {
    Hands: any;
  }
}

export class HandDetectionService {
  private hands: any | null = null;
  private videoElement: HTMLVideoElement;
  private onHandUpdate: (data: HandData[]) => void;
  
  // Store previous positions keyed by handedness label ('Left' | 'Right')
  private lastPositions: Map<string, { x: number, y: number, time: number }> = new Map();
  
  private stream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;

  constructor(videoElement: HTMLVideoElement, onHandUpdate: (data: HandData[]) => void) {
    this.videoElement = videoElement;
    this.onHandUpdate = onHandUpdate;
  }

  public async initialize() {
    console.log("Initializing Dual-Hand Detection...");

    // 1. Start Camera FIRST
    try {
      await this.startCamera();
    } catch (err) {
      console.error("Camera failed to start.", err);
    }

    // 2. Initialize MediaPipe Hands
    try {
      let attempts = 0;
      while (!window.Hands && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (!window.Hands) {
        console.error("MediaPipe Hands script unavailable.");
        return;
      }

      this.hands = new window.Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
        }
      });

      this.hands.setOptions({
        maxNumHands: 2, // Enable 2 hands
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.hands.onResults(this.onResults);

      if (this.videoElement.readyState >= 2 || this.stream) {
        this.isRunning = true;
        this.processLoop();
      }
    } catch (error) {
      console.error("Error initializing MediaPipe Hands:", error);
    }
  }

  private async startCamera() {
    if (!this.videoElement) return;

    try {
      this.videoElement.setAttribute('autoplay', '');
      this.videoElement.setAttribute('muted', '');
      this.videoElement.setAttribute('playsinline', '');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      });

      this.stream = stream;
      this.videoElement.srcObject = stream;
      
      await new Promise<void>((resolve) => {
        if (this.videoElement.readyState >= 2) {
          resolve();
          return;
        }
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play().then(() => resolve()).catch(console.error);
        };
      });
    } catch (err) {
      console.error("Camera access failed or denied:", err);
      throw err;
    }
  }

  private processLoop = async () => {
    if (!this.isRunning) return;

    if (this.hands && this.videoElement && this.videoElement.readyState >= 2) {
      try {
        await this.hands.send({ image: this.videoElement });
      } catch (e) {
        // Suppress transient errors
      }
    }

    this.animationFrameId = requestAnimationFrame(this.processLoop);
  };

  private onResults = (results: Results) => {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.onHandUpdate([]);
      this.lastPositions.clear();
      return;
    }

    const currentHands: HandData[] = [];
    const now = performance.now();

    results.multiHandLandmarks.forEach((landmarks, index) => {
      // Get raw handedness from MediaPipe
      const mpLabel = results.multiHandedness && results.multiHandedness[index] 
        ? results.multiHandedness[index].label 
        : (index === 0 ? 'Right' : 'Left'); // Fallback

      // FIX: Swap Left/Right labels. 
      // MediaPipe assumes unmirrored input. Since we are using a front-facing camera 
      // which acts as a mirror, and we are flipping X coordinates for the UI,
      // the labels from MediaPipe are effectively inverted relative to the user's perception.
      // 'Left' (MP) -> User's Right Hand -> Label 'Right'
      const label = mpLabel === 'Left' ? 'Right' : 'Left';

      // Mirror X coordinate for intuitive interaction
      const wrist = landmarks[0];
      const middleMCP = landmarks[9];
      const centerX = 1 - ((wrist.x + middleMCP.x) / 2); 
      const centerY = (wrist.y + middleMCP.y) / 2;

      const gesture = this.detectGesture(landmarks);
      
      // Calculate velocity specific to this hand (Left vs Right)
      let velocity = { x: 0, y: 0 };
      const lastPos = this.lastPositions.get(label);

      if (lastPos) {
        const dt = (now - lastPos.time) / 1000;
        if (dt > 0.01) {
          velocity = {
            x: (centerX - lastPos.x) / dt,
            y: (centerY - lastPos.y) / dt
          };
        }
      }

      // Update history for this hand
      this.lastPositions.set(label, { x: centerX, y: centerY, time: now });

      currentHands.push({
        id: label,
        x: centerX,
        y: centerY,
        gesture,
        velocity
      });
    });

    this.onHandUpdate(currentHands);
  };

  private detectGesture(landmarks: any[]): HandGesture {
    const wrist = landmarks[0];
    
    const isFingerOpen = (tipIdx: number, mcpIdx: number) => {
      const tip = landmarks[tipIdx];
      const mcp = landmarks[mcpIdx];
      const distTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
      const distMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
      return distTip > distMcp * 1.3; 
    };

    const indexOpen = isFingerOpen(8, 5);
    const middleOpen = isFingerOpen(12, 9);
    const ringOpen = isFingerOpen(16, 13);
    const pinkyOpen = isFingerOpen(20, 17);
    
    const thumbTip = landmarks[4];
    const thumbIP = landmarks[3];
    const thumbOpen = Math.hypot(thumbTip.x - wrist.x, thumbTip.y - wrist.y) > 
                      Math.hypot(thumbIP.x - wrist.x, thumbIP.y - wrist.y);

    const openCount = [indexOpen, middleOpen, ringOpen, pinkyOpen, thumbOpen].filter(Boolean).length;

    if (openCount >= 3) return HandGesture.OPEN_PALM;
    return HandGesture.CLOSED_FIST;
  }

  public stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    if (this.hands) {
      this.hands.close();
    }
  }
}