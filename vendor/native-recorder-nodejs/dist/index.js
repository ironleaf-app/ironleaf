"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeBindings = exports.AudioRecorder = exports.SYSTEM_AUDIO_DEVICE_ID = void 0;
const bindings_1 = __importDefault(require("./bindings"));
const events_1 = require("events");
/**
 * Special device ID for system-wide audio capture (macOS)
 */
exports.SYSTEM_AUDIO_DEVICE_ID = "system";
const native = bindings_1.default;
class AudioRecorder extends events_1.EventEmitter {
    constructor() {
        super();
        this.isRecording = false;
        this.controller = new native.AudioController();
    }
    /**
     * Starts the recording session.
     * @param config Configuration object with deviceType and deviceId (both required)
     */
    async start(config) {
        if (this.isRecording) {
            throw new Error("Already recording");
        }
        // Validate config
        if (!config.deviceType || !config.deviceId) {
            throw new Error("Both deviceType and deviceId are required");
        }
        if (config.deviceType !== "input" && config.deviceType !== "output") {
            throw new Error("deviceType must be 'input' or 'output'");
        }
        return new Promise((resolve, reject) => {
            try {
                this.controller.start(config, (error, data) => {
                    if (error) {
                        this.emit("error", error);
                    }
                    else if (data) {
                        this.emit("data", data);
                    }
                });
                this.isRecording = true;
                resolve();
            }
            catch (error) {
                reject(error);
            }
        });
    }
    async stop() {
        if (!this.isRecording) {
            return;
        }
        return new Promise((resolve, reject) => {
            try {
                this.controller.stop();
                this.isRecording = false;
                resolve();
            }
            catch (error) {
                reject(error);
            }
        });
    }
    /**
     * Lists available audio devices.
     * @param type Optional filter by device type
     * @returns Array of AudioDevice objects (all with valid id values)
     */
    static getDevices(type) {
        const devices = native.AudioController.getDevices();
        if (type) {
            return devices.filter((d) => d.type === type);
        }
        return devices;
    }
    /**
     * Gets the audio format of a specific device.
     * @param deviceId The device ID to query
     * @returns AudioFormat object
     */
    static getDeviceFormat(deviceId) {
        return native.AudioController.getDeviceFormat(deviceId);
    }
    /**
     * Checks the current permission status for audio recording.
     * On Windows, always returns { mic: true, system: true } as no explicit permissions are required.
     * On macOS, checks actual permission status for microphone and screen recording.
     * @returns PermissionStatus object with mic and system boolean fields
     */
    static checkPermission() {
        return native.AudioController.checkPermission();
    }
    /**
     * Requests permission for the specified type.
     * On Windows, always returns true as no explicit permissions are required.
     * On macOS, prompts the user to grant the requested permission.
     * @param type The permission type to request: 'mic' for microphone, 'system' for system audio
     * @returns true if permission was granted, false otherwise
     */
    static requestPermission(type) {
        return native.AudioController.requestPermission(type);
    }
}
exports.AudioRecorder = AudioRecorder;
// Export raw bindings for testing if needed
exports.nativeBindings = bindings_1.default;
