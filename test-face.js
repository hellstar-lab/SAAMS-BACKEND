import { initFaceApi } from './utils/faceService.js';
import * as tf from '@tensorflow/tfjs';

async function testFaceApi() {
    console.log("Starting Face API Test...");
    try {
        await initFaceApi();
        console.log("initFaceApi finished without crashing.");
    } catch (e) {
        console.error("Crash during initFaceApi:", e);
    }
}

testFaceApi();
