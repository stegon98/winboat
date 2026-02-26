const fs: typeof import("fs") = require("node:fs");
const path: typeof import("path") = require("node:path");
import { type GuestArchitecture, type WinApp } from "../../types";
import { WINBOAT_DIR } from "./constants";
import { type PTSerializableDeviceInfo } from "./usbmanager";
import { RuntimeKinds, getPreferredGuestArchitecture, type RuntimeKind } from "./runtimes/common";
import { logger } from "./winboat";

export type RdpArg = {
    original?: string;
    newArg: string;
    isReplacement: boolean;
};

export class WinboatVersion {
    public readonly generation: number;
    public readonly major: number;
    public readonly minor: number;
    public readonly alpha: boolean;

    constructor(public readonly versionToken: string) {
        const versionTags = versionToken.split("-");
        const versionNumbers = versionTags[0].split(".").map(value => {
            const parsedValue = parseInt(value);

            if (Number.isNaN(parsedValue)) {
                throw new Error(`Invalid winboat version format: '${versionToken}'`);
            }

            return parsedValue;
        });

        this.alpha = !!versionTags[1]?.includes("alpha");
        this.generation = versionNumbers[0];
        this.major = versionNumbers[1];
        this.minor = versionNumbers[2];
    }

    toString(): string {
        return this.versionToken;
    }

    toJSON(): string {
        return this.toString();
    }
}

type WinboatVersionData = {
    previous: WinboatVersion;
    current: WinboatVersion;
};

export enum MultiMonitorMode {
    None = "None",
    MultiMon = "MultiMon",
    Span = "Span",
}

export const CONFIG_SCHEMA_VERSION = 2;

export type WinboatConfigObj = {
    scale: number;
    scaleDesktop: number;
    smartcardEnabled: boolean;
    rdpMonitoringEnabled: boolean;
    passedThroughDevices: PTSerializableDeviceInfo[];
    customApps: WinApp[];
    experimentalFeatures: boolean;
    advancedFeatures: boolean;
    multiMonitor: MultiMonitorMode;
    rdpArgs: RdpArg[];
    disableAnimations: boolean;
    containerRuntime: RuntimeKind;
    guestArch: GuestArchitecture;
    schemaVersion: number;
    versionData: WinboatVersionData;
    appsSortOrder: string;
};

const currentVersion = new WinboatVersion(import.meta.env.VITE_APP_VERSION);
const LEGACY_RUNTIME_KEYS = ["runtime", "container", "containerType"] as const;

function createDefaultConfig(): WinboatConfigObj {
    const defaultRuntime = RuntimeKinds.DOCKER;

    return {
        scale: 100,
        scaleDesktop: 100,
        smartcardEnabled: false,
        rdpMonitoringEnabled: false,
        passedThroughDevices: [],
        customApps: [],
        experimentalFeatures: false,
        advancedFeatures: false,
        multiMonitor: MultiMonitorMode.None,
        rdpArgs: [],
        disableAnimations: false,
        containerRuntime: defaultRuntime,
        guestArch: getPreferredGuestArchitecture(defaultRuntime),
        schemaVersion: CONFIG_SCHEMA_VERSION,
        versionData: {
            previous: currentVersion,
            current: currentVersion,
        },
        appsSortOrder: "name",
    };
}

const defaultConfig = createDefaultConfig();
const configKeys = Object.keys(defaultConfig) as Array<keyof WinboatConfigObj>;

type ConfigRecord = Record<string, unknown>;

type ConfigMigrationResult = {
    migratedConfig: WinboatConfigObj;
    wasMigrated: boolean;
    startedFrom: number;
};

function normalizeRuntimeKind(value: unknown, fallback: RuntimeKind = RuntimeKinds.DOCKER): RuntimeKind {
    if (typeof value !== "string") {
        return fallback;
    }

    const token = value.trim().toLowerCase();
    const tokenMap: Record<string, RuntimeKind> = {
        docker: RuntimeKinds.DOCKER,
        [RuntimeKinds.DOCKER.toLowerCase()]: RuntimeKinds.DOCKER,
        podman: RuntimeKinds.PODMAN,
        [RuntimeKinds.PODMAN.toLowerCase()]: RuntimeKinds.PODMAN,
        "qemu-native": RuntimeKinds.QEMU_NATIVE,
        "qemu_native": RuntimeKinds.QEMU_NATIVE,
        qemunative: RuntimeKinds.QEMU_NATIVE,
        [RuntimeKinds.QEMU_NATIVE.toLowerCase()]: RuntimeKinds.QEMU_NATIVE,
    };

    return tokenMap[token] ?? fallback;
}

function normalizeGuestArchitecture(value: unknown, runtime: RuntimeKind): GuestArchitecture {
    if (value === "amd64" || value === "arm64") {
        return value;
    }

    return getPreferredGuestArchitecture(runtime);
}

function normalizeVersionToken(value: unknown, fallback: WinboatVersion): WinboatVersion {
    if (value instanceof WinboatVersion) {
        return value;
    }

    if (typeof value === "string") {
        try {
            return new WinboatVersion(value);
        } catch {
            return fallback;
        }
    }

    return fallback;
}

function normalizeVersionData(value: unknown): WinboatVersionData {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
            previous: currentVersion,
            current: currentVersion,
        };
    }

    const rawVersionData = value as Record<string, unknown>;
    return {
        previous: normalizeVersionToken(rawVersionData.previous, currentVersion),
        current: normalizeVersionToken(rawVersionData.current, currentVersion),
    };
}

function inferSchemaVersion(configObj: ConfigRecord): number {
    const explicitVersion = configObj.schemaVersion;
    if (typeof explicitVersion === "number" && Number.isInteger(explicitVersion) && explicitVersion >= 0) {
        return explicitVersion;
    }

    if ("guestArch" in configObj) {
        return 1;
    }

    return 0;
}

function migrateConfigV0ToV1(configObj: ConfigRecord): ConfigRecord {
    const runtimeValue =
        configObj.containerRuntime ?? LEGACY_RUNTIME_KEYS.map(key => configObj[key]).find(value => value !== undefined);

    configObj.containerRuntime = normalizeRuntimeKind(runtimeValue);

    for (const legacyKey of LEGACY_RUNTIME_KEYS) {
        delete configObj[legacyKey];
    }

    configObj.schemaVersion = 1;
    return configObj;
}

function migrateConfigV1ToV2(configObj: ConfigRecord): ConfigRecord {
    const runtime = normalizeRuntimeKind(configObj.containerRuntime);
    configObj.containerRuntime = runtime;
    configObj.guestArch = normalizeGuestArchitecture(configObj.guestArch, runtime);
    configObj.schemaVersion = 2;
    return configObj;
}

function normalizeConfigObject(configObj: ConfigRecord, schemaVersion = CONFIG_SCHEMA_VERSION): WinboatConfigObj {
    const defaults = createDefaultConfig();
    const runtime = normalizeRuntimeKind(configObj.containerRuntime, defaults.containerRuntime);

    return {
        ...defaults,
        ...(configObj as Partial<WinboatConfigObj>),
        containerRuntime: runtime,
        guestArch: normalizeGuestArchitecture(configObj.guestArch, runtime),
        schemaVersion,
        versionData: normalizeVersionData(configObj.versionData),
    };
}

function migrateVersionedConfig(configObj: ConfigRecord): ConfigMigrationResult {
    const startingSchemaVersion = inferSchemaVersion(configObj);

    if (startingSchemaVersion > CONFIG_SCHEMA_VERSION) {
        logger.warn(
            `Detected config schema version ${startingSchemaVersion}, which is newer than supported version ${CONFIG_SCHEMA_VERSION}.`,
        );
        return {
            migratedConfig: normalizeConfigObject(configObj, startingSchemaVersion),
            wasMigrated: false,
            startedFrom: startingSchemaVersion,
        };
    }

    let workingConfig = structuredClone(configObj) as ConfigRecord;
    let schemaVersion = startingSchemaVersion;

    while (schemaVersion < CONFIG_SCHEMA_VERSION) {
        switch (schemaVersion) {
            case 0:
                workingConfig = migrateConfigV0ToV1(workingConfig);
                break;
            case 1:
                workingConfig = migrateConfigV1ToV2(workingConfig);
                break;
            default:
                throw new Error(`No migration step available for schema version ${schemaVersion}`);
        }

        schemaVersion = inferSchemaVersion(workingConfig);
    }

    return {
        migratedConfig: normalizeConfigObject(workingConfig, schemaVersion),
        wasMigrated: startingSchemaVersion !== schemaVersion,
        startedFrom: startingSchemaVersion,
    };
}

export class WinboatConfig {
    private static readonly configPath: string = path.join(WINBOAT_DIR, "winboat.config.json");
    private static instance: WinboatConfig | null = null;

    // Due to us wrapping WinboatConfig in reactive, this can't be private
    configData: WinboatConfigObj = createDefaultConfig();

    static getInstance() {
        WinboatConfig.instance ??= new WinboatConfig();
        return WinboatConfig.instance;
    }

    private constructor() {
        this.configData = WinboatConfig.readConfigObject()!;

        // Set correct versionData
        if (this.config.versionData.current.versionToken !== currentVersion.versionToken) {
            this.config.versionData.previous = this.config.versionData.current;
            this.config.versionData.current = currentVersion;

            logger.info(
                `Updated version data from '${this.config.versionData.previous.toString()}' to '${currentVersion.toString()}'`,
            );
        }

        const preferredGuestArch = getPreferredGuestArchitecture(this.config.containerRuntime);
        if (this.config.guestArch !== preferredGuestArch) {
            logger.info(
                `Updating guest architecture from '${this.config.guestArch}' to '${preferredGuestArch}' for runtime '${this.config.containerRuntime}'`,
            );
            this.config.guestArch = preferredGuestArch;
        }

        if (this.config.schemaVersion < CONFIG_SCHEMA_VERSION) {
            logger.info(
                `Normalizing config schema version from '${this.config.schemaVersion}' to '${CONFIG_SCHEMA_VERSION}'`,
            );
            this.config.schemaVersion = CONFIG_SCHEMA_VERSION;
        }

        console.log("Reading current config", this.configData);
    }

    get config(): WinboatConfigObj {
        // Return a proxy to intercept property sets
        return new Proxy(this.configData, {
            get: (target, key) => Reflect.get(target, key),
            set: (target, key, value: WinboatConfigObj) => {
                const result = Reflect.set(target, key, value);

                WinboatConfig.writeConfigObject(target);
                console.info("Wrote modified config to disk");

                return result;
            },
        });
    }

    set config(newConfig: WinboatConfigObj) {
        this.configData = { ...newConfig };
        WinboatConfig.writeConfigObject(newConfig);
        console.info("Wrote modified config to disk");
    }

    static writeConfigObject(configObj: WinboatConfigObj): void {
        fs.writeFileSync(WinboatConfig.configPath, JSON.stringify(configObj, null, 4), "utf-8");
    }

    private static ensureConfigDirectoryExists(): void {
        if (!fs.existsSync(WINBOAT_DIR)) {
            fs.mkdirSync(WINBOAT_DIR, { recursive: true });
        }
    }

    private static writeDefaultConfig(): WinboatConfigObj {
        const freshDefault = createDefaultConfig();
        WinboatConfig.ensureConfigDirectoryExists();
        fs.writeFileSync(WinboatConfig.configPath, JSON.stringify(freshDefault, null, 4), "utf-8");
        return freshDefault;
    }

    private static backupCorruptedConfig(rawConfig: string): void {
        WinboatConfig.ensureConfigDirectoryExists();
        const backupFilePath = path.join(WINBOAT_DIR, `winboat.config.corrupt.${Date.now()}.json`);
        fs.writeFileSync(backupFilePath, rawConfig, "utf-8");
        logger.error(`Backed up corrupted config to '${backupFilePath}'`);
    }

    static readConfigObject(writeDefault = true): WinboatConfigObj | null {
        if (!fs.existsSync(WinboatConfig.configPath)) {
            if (!writeDefault) {
                return null;
            }

            return WinboatConfig.writeDefaultConfig();
        }

        const rawConfig = fs.readFileSync(WinboatConfig.configPath, "utf-8");
        let parsedConfig: ConfigRecord;

        try {
            const parsedUnknown = JSON.parse(rawConfig);
            if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) {
                throw new Error("Config root must be a JSON object");
            }

            parsedConfig = parsedUnknown as ConfigRecord;
        } catch (e) {
            logger.error("Failed to parse config, falling back to defaults");
            logger.error((e as Error)?.message ?? e);
            WinboatConfig.backupCorruptedConfig(rawConfig);

            if (writeDefault) {
                return WinboatConfig.writeDefaultConfig();
            }

            return createDefaultConfig();
        }

        const inputFingerprint = JSON.stringify(parsedConfig);

        try {
            const migrationResult = migrateVersionedConfig(parsedConfig);
            const migratedConfig = migrationResult.migratedConfig;

            if (migrationResult.wasMigrated) {
                logger.info(
                    `Migrated config schema version from ${migrationResult.startedFrom} to ${migratedConfig.schemaVersion}`,
                );
            }

            const outputFingerprint = JSON.stringify(migratedConfig);
            const hasAllKeys = configKeys.every(key => key in parsedConfig);

            if (migrationResult.wasMigrated || inputFingerprint !== outputFingerprint || !hasAllKeys) {
                WinboatConfig.writeConfigObject(migratedConfig);
                logger.info("Wrote normalized config to disk");
            }

            return migratedConfig;
        } catch (e) {
            logger.error("Versioned config migration failed, keeping previous valid values in memory");
            logger.error((e as Error)?.message ?? e);

            try {
                const fallbackSchemaVersion = inferSchemaVersion(parsedConfig);
                return normalizeConfigObject(parsedConfig, fallbackSchemaVersion);
            } catch (fallbackError) {
                logger.error("Failed to normalize config fallback, returning defaults");
                logger.error((fallbackError as Error)?.message ?? fallbackError);
                return createDefaultConfig();
            }
        }
    }
}
