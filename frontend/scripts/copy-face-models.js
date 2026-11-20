#!/usr/bin/env node
'use strict';
// The face device (plugin screens declaring "face") runs in the school page:
//   - MediaPipe Face Landmarker (Apache-2.0; @mediapipe/tasks-vision + Google's face_landmarker.task):
//     finds faces, 478 landmarks and blink scores — the face detector, alignment and liveness;
//   - dlib's ResNet face recognition model (weights CC0) as converted in @vladmandic/face-api (MIT): turns
//     an aligned face into 128 numbers. Open-source models were chosen on 2026-11-20 (see Wattanam-V2
//     architecture/face-recognition-model-plan.md).
// LICENSES.txt, written next to the models, carries their notices.
// All are served from /face-models, copied from npm packages (and the landmarker downloaded once, checked
// against a pinned SHA-256) at dev/build time instead of being committed.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'public', 'face-models');
const LANDMARKER = {
  file: 'face_landmarker.task',
  url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
};

function copy(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Face model file is missing: ${from} (run npm install)`);
  fs.copyFileSync(from, to);
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// The notices the models' licences ask to keep with copies we distribute.
function writeNotices(faceApi) {
  const faceApiLicense = fs.readFileSync(path.join(faceApi, '..', 'LICENSE'), 'utf8').trim();
  const text = [
    'Face models served by Wattanam (third-party, open source)',
    '',
    '1. MediaPipe Face Landmarker: face_landmarker.task and wasm/vision_wasm_internal.*',
    '   From @mediapipe/tasks-vision and https://storage.googleapis.com/mediapipe-models/ (Google LLC).',
    '   Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0',
    '',
    '2. Face recognition: face_recognition_model.bin and face_recognition_model-weights_manifest.json',
    '   dlib_face_recognition_resnet_model_v1 by Davis E. King (https://github.com/davisking/dlib-models),',
    '   released into the public domain (CC0-1.0). Converted to TensorFlow.js in @vladmandic/face-api,',
    '   whose licence follows:',
    '',
    faceApiLicense,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(target, 'LICENSES.txt'), text);
}

async function main() {
  fs.mkdirSync(path.join(target, 'wasm'), { recursive: true });
  // the old face-api detector and landmark models are no longer used
  for (const old of ['tiny_face_detector_model', 'face_landmark_68_model']) {
    for (const file of [`${old}-weights_manifest.json`, `${old}.bin`]) fs.rmSync(path.join(target, file), { force: true });
  }
  const faceApi = path.join(root, 'node_modules', '@vladmandic', 'face-api', 'model');
  for (const file of ['face_recognition_model-weights_manifest.json', 'face_recognition_model.bin']) copy(path.join(faceApi, file), path.join(target, file));
  const wasm = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  // FilesetResolver.forVisionTasks(base) loads the classic (non-module) runtime only
  for (const file of fs.readdirSync(path.join(target, 'wasm'))) if (!file.startsWith('vision_wasm_internal.')) fs.rmSync(path.join(target, 'wasm', file), { force: true });
  for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) copy(path.join(wasm, file), path.join(target, 'wasm', file));

  const landmarker = path.join(target, LANDMARKER.file);
  if (!fs.existsSync(landmarker) || sha256(landmarker) !== LANDMARKER.sha256) {
    const response = await fetch(LANDMARKER.url);
    if (!response.ok) throw new Error(`Could not download ${LANDMARKER.url} (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const got = crypto.createHash('sha256').update(bytes).digest('hex');
    if (got !== LANDMARKER.sha256) throw new Error(`${LANDMARKER.file} does not match its pinned SHA-256 (got ${got})`);
    fs.writeFileSync(landmarker, bytes);
  }
  writeNotices(faceApi);
  console.log('Face models ready in public/face-models (MediaPipe Face Landmarker + face recognition)');
}

main().catch((error) => { console.error(error.message); process.exit(1); });
