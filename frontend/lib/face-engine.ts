// The "face" device of plugin screens, run in the school page (plugin screens receive vectors and scores
// only). Models are served from /face-models (scripts/copy-face-models.js):
//   - MediaPipe Face Landmarker (Apache-2.0): faces, 478 landmarks, blink scores — detection, alignment,
//     liveness;
//   - face recognition: dlib's ResNet model (weights CC0, by Davis King) as converted in @vladmandic/face-api
//     (MIT): an aligned 150×150 face → 128 numbers.
//     Replaceable: a different recognition model only changes FACE_MODEL_VERSION and needs re-enrolment.
// Licence notices are served next to the models (/face-models/LICENSES.txt).

import type { FaceLandmarker } from '@mediapipe/tasks-vision';

// Stored with every enrolled face: vectors of different versions are never compared.
export const FACE_MODEL_VERSION = 'mediapipe-face-landmarker-1/face-recognition-128-v2';
const MODELS = '/face-models';

type FaceApi = typeof import('@vladmandic/face-api');
export type FaceEngine = { video: FaceLandmarker; image: () => Promise<FaceLandmarker>; faceapi: FaceApi };
let loading: Promise<FaceEngine> | null = null;

/** Loads MediaPipe and the recognition model once per page (cached by the browser after the first time). */
export function loadFaceEngine(): Promise<FaceEngine> {
  if (!loading) {
    loading = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      const files = await vision.FilesetResolver.forVisionTasks(`${MODELS}/wasm`);
      const create = async (runningMode: 'VIDEO' | 'IMAGE') => {
        const options = (delegate: 'GPU' | 'CPU') => ({
          baseOptions: { modelAssetPath: `${MODELS}/face_landmarker.task`, delegate },
          runningMode, numFaces: 3, outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.5,
        });
        // the GPU is faster; some tablets only manage the CPU
        try { return await vision.FaceLandmarker.createFromOptions(files, options('GPU')); }
        catch { return vision.FaceLandmarker.createFromOptions(files, options('CPU')); }
      };
      const faceapi = await import('@vladmandic/face-api');
      // the bundled TensorFlow.js (its typings in face-api leave these out)
      const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
      try { await tf.setBackend('webgl'); } catch { /* the library falls back to its default backend */ }
      await tf.ready();
      const [video] = await Promise.all([create('VIDEO'), faceapi.nets.faceRecognitionNet.loadFromUri(MODELS)]);
      let image: Promise<FaceLandmarker> | null = null;
      return { video, faceapi, image: () => (image ||= create('IMAGE')) };
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export type FaceReading = {
  count: number;                 // faces in the frame
  score: number;                 // 1 when a face passed MediaPipe's detection and presence checks
  size: number;                  // the largest face's width as a share of the frame width (0..1)
  yaw: number;                   // head turn: about 0 facing the camera; sign = direction in the raw image
  blink: number;                 // eyes closed, 0..1 (MediaPipe blendshapes)
  descriptor: number[] | null;   // 128 numbers of the largest face
  box?: { x: number; y: number; width: number; height: number }; // the largest face, in pixels
};
type Point = { x: number; y: number };
type Source = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
const sizeOf = (source: Source) => source instanceof HTMLVideoElement
  ? { w: source.videoWidth, h: source.videoHeight }
  : source instanceof HTMLImageElement ? { w: source.naturalWidth, h: source.naturalHeight } : { w: source.width, h: source.height };

// MediaPipe face mesh points: outer and inner eye corners, nose tip, the face oval
const EYE_A = [33, 133], EYE_B = [362, 263], NOSE = 1;
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The face, upright and cropped like the recognition model expects: rotated so the eyes are level,
 * centred a little below the eyes, about twice the eye-to-mouth span wide, at 150×150 pixels.
 */
function alignedFace(source: Source, points: Point[]): HTMLCanvasElement {
  const eyeA = mid(points[EYE_A[0]], points[EYE_A[1]]), eyeB = mid(points[EYE_B[0]], points[EYE_B[1]]);
  const angle = Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x);
  // the face oval's extent along the eyes' direction (rotation-free size)
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const turned = points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
  const xs = turned.map((p) => p.x), ys = turned.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  const side = Math.max(width, height) * 1.1;
  const centreTurned = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
  const centre = { x: centreTurned.x * Math.cos(angle) - centreTurned.y * Math.sin(angle), y: centreTurned.x * Math.sin(angle) + centreTurned.y * Math.cos(angle) };
  const canvas = document.createElement('canvas');
  canvas.width = 150; canvas.height = 150;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(75, 75);
  ctx.rotate(-angle);
  ctx.scale(150 / side, 150 / side);
  ctx.translate(-centre.x, -centre.y);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** Every face of one frame (video) or picture (image), largest first, with the vector of the largest. */
export async function readFace(engine: FaceEngine, source: Source): Promise<FaceReading> {
  const { w, h } = sizeOf(source);
  const result = source instanceof HTMLVideoElement
    ? engine.video.detectForVideo(source, performance.now())
    : (await engine.image()).detect(source);
  const faces = (result.faceLandmarks || []).map((landmarks, index) => {
    const points = landmarks.map((p) => ({ x: p.x * w, y: p.y * h }));
    const xs = points.map((p) => p.x);
    const scores = new Map((result.faceBlendshapes?.[index]?.categories || []).map((c) => [c.categoryName, c.score]));
    const ys = points.map((p) => p.y);
    return { points, width: Math.max(...xs) - Math.min(...xs), box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }, blink: ((scores.get('eyeBlinkLeft') || 0) + (scores.get('eyeBlinkRight') || 0)) / 2 };
  }).sort((a, b) => b.width - a.width);
  if (!faces.length) return { count: 0, score: 0, size: 0, yaw: 0, blink: 0, descriptor: null };
  const main = faces[0];
  const eyeA = mid(main.points[EYE_A[0]], main.points[EYE_A[1]]), eyeB = mid(main.points[EYE_B[0]], main.points[EYE_B[1]]);
  const between = mid(main.points[33], main.points[263]);
  const eyes = Math.max(1, Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y));
  const descriptor = await engine.faceapi.computeFaceDescriptor(alignedFace(source, main.points)) as Float32Array;
  return {
    count: faces.length,
    score: 1,
    size: main.width / Math.max(1, w),
    yaw: (main.points[NOSE].x - between.x) / eyes,
    blink: main.blink,
    descriptor: Array.from(descriptor),
    box: main.box,
  };
}

/** The mean of several vectors of the same face (steadier than one frame), rounded to 5 decimals. */
export function meanDescriptor(list: number[][]): number[] {
  const size = list[0]?.length || 0;
  const mean = new Array(size).fill(0);
  list.forEach((d) => d.forEach((v, i) => { mean[i] += v / list.length; }));
  return mean.map((v) => Math.round(v * 1e5) / 1e5);
}

export const FACE_RULES = {
  minScore: 0.7,      // a face that passed MediaPipe's checks scores 1
  minSize: 0.18,      // close enough: at least 18% of the frame width
  frontal: 0.12,      // |yaw| below this: facing the camera
  turned: 0.2,        // |yaw| above this (towards the asked side): the head turned
  blinkClosed: 0.5,   // blink score above this: eyes closed
  blinkOpen: 0.25,    // below this: eyes open
  stableFrames: 3,    // frontal frames averaged into one vector
  stepSeconds: 6,     // time allowed for each liveness step
};

// Test hook for the browser tests (development builds only): read faces from pictures.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as { __wattanamFace?: unknown }).__wattanamFace = { loadFaceEngine, readFace, FACE_MODEL_VERSION };
}
