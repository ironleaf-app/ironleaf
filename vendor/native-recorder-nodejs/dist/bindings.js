"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const fs_1 = require("fs");
function getBinding() {
    const moduleName = "NativeAudioSDK.node";
    // Try prebuild first (installed via npm)
    const prebuildsDir = (0, path_1.join)(__dirname, "..", "prebuilds");
    const platform = process.platform;
    const arch = process.arch;
    const platformDir = (0, path_1.join)(prebuildsDir, `${platform}-${arch}`);
    const paths = [];
    // Try prebuild (works for both Node.js and Electron via N-API)
    const prebuildPath = (0, path_1.join)(platformDir, moduleName);
    paths.push(prebuildPath);
    if ((0, fs_1.existsSync)(prebuildPath)) {
        return require(prebuildPath);
    }
    // Fallback to local build (development)
    const localPath = (0, path_1.join)(__dirname, "..", "build", "Release", moduleName);
    paths.push(localPath);
    if ((0, fs_1.existsSync)(localPath)) {
        return require(localPath);
    }
    // Final fallback for different build configurations
    const debugPath = (0, path_1.join)(__dirname, "..", "build", "Debug", moduleName);
    paths.push(debugPath);
    if ((0, fs_1.existsSync)(debugPath)) {
        return require(debugPath);
    }
    throw new Error(`Could not find native module ${moduleName}. ` +
        `Tried:\n  - ${paths.join("\n  - ")}\n` +
        `Please run 'npm run build:native' or reinstall the package.`);
}
const bindings = getBinding();
exports.default = bindings;
