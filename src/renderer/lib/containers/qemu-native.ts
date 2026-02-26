import { ComposeConfig } from "../../../types";
import { QEMU_NATIVE_DEFAULT_COMPOSE } from "../../data/qemu-native";
import { ComposeArguments, ComposeDirection, ContainerAction, ContainerManager, ContainerStatus } from "./container";
import { ComposePortEntry } from "../../utils/port";
import { containerLogger } from "./container";
import { WINBOAT_DIR } from "../constants";
import YAML from "yaml";

const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const process: typeof import("node:process") = require("node:process");
const { spawn, execFile }: typeof import("node:child_process") = require("node:child_process");
const { promisify }: typeof import("node:util") = require("node:util");
const execFileAsync = promisify(execFile);

export type QemuNativeSpecs = {
    qemuInstalled: boolean;
    qemuImgInstalled: boolean;
    hvfSupported: boolean;
};

type QemuRuntimeState = {
    qemuBinary: string;
    qemuImgBinary: string;
    firmwareCodePath: string;
    firmwareVarsTemplatePath: string;
    vmDiskPath: string;
    vmVarsPath: string;
    pidPath: string;
    stdoutLogPath: string;
    stderrLogPath: string;
};

const QEMU_BIN_CANDIDATES = ["/opt/homebrew/bin/qemu-system-aarch64", "/usr/local/bin/qemu-system-aarch64", "qemu-system-aarch64"];
const QEMU_IMG_CANDIDATES = ["/opt/homebrew/bin/qemu-img", "/usr/local/bin/qemu-img", "qemu-img"];

const EDK2_CODE_CANDIDATES = [
    "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
    "/usr/local/share/qemu/edk2-aarch64-code.fd",
];

const EDK2_VARS_CANDIDATES = [
    "/opt/homebrew/share/qemu/edk2-arm-vars.fd",
    "/usr/local/share/qemu/edk2-arm-vars.fd",
];

function parseGibToken(token: string | undefined, fallbackGiB: number): number {
    if (!token) return fallbackGiB;
    const parsed = Number.parseInt(token.replace(/[^0-9]/g, ""), 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return fallbackGiB;
    }
    return parsed;
}

function pidIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function killPidWithGrace(pid: number, timeoutMs = 5000): Promise<void> {
    try {
        process.kill(pid, "SIGTERM");
    } catch {
        return;
    }

    const start = Date.now();
    while (pidIsAlive(pid) && Date.now() - start < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (pidIsAlive(pid)) {
        process.kill(pid, "SIGKILL");
    }
}

function resolveFirstExisting(candidates: string[]): string | null {
    for (const candidate of candidates) {
        if (candidate.includes(path.sep)) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
            continue;
        }

        // For PATH binaries we'll return the token; execFile will resolve it.
        return candidate;
    }
    return null;
}

type VolumeMapping = {
    hostPath: string;
    guestPath: string;
};

function parseVolumeMapping(volume: string): VolumeMapping | null {
    const separatorIndex = volume.lastIndexOf(":");
    if (separatorIndex <= 0 || separatorIndex >= volume.length - 1) {
        return null;
    }

    return {
        hostPath: volume.slice(0, separatorIndex),
        guestPath: volume.slice(separatorIndex + 1),
    };
}

export class QemuNativeContainer extends ContainerManager {
    defaultCompose = structuredClone(QEMU_NATIVE_DEFAULT_COMPOSE);
    composeFilePath = path.join(WINBOAT_DIR, "qemu-native-compose.yml");
    executableAlias = "qemu-system-aarch64";
    cachedPortMappings: ComposePortEntry[] | null = null;

    readonly #runtimeDir = path.join(WINBOAT_DIR, "qemu-native");

    constructor() {
        super();
    }

    get containerName(): string {
        return this.defaultCompose.services.windows.container_name;
    }

    writeCompose(compose: ComposeConfig): void {
        this.#ensureRuntimeDir();
        fs.writeFileSync(this.composeFilePath, YAML.stringify(compose, { nullStr: "" }), "utf8");
        containerLogger.info(`[QemuNative] wrote runtime compose to ${this.composeFilePath}`);
    }

    async compose(direction: ComposeDirection, _extraArgs: ComposeArguments[] = []): Promise<void> {
        switch (direction) {
            case "up":
                await this.#startVM();
                break;
            case "down":
                await this.#stopVM();
                break;
        }
    }

    async container(action: ContainerAction): Promise<void> {
        switch (action) {
            case "start":
                await this.#startVM();
                break;
            case "stop":
                await this.#stopVM();
                break;
            case "restart":
                await this.#stopVM();
                await this.#startVM();
                break;
            case "pause": {
                const pid = this.#readPid();
                if (pid && pidIsAlive(pid)) process.kill(pid, "SIGSTOP");
                break;
            }
            case "unpause": {
                const pid = this.#readPid();
                if (pid && pidIsAlive(pid)) process.kill(pid, "SIGCONT");
                break;
            }
        }
    }

    async port(): Promise<ComposePortEntry[]> {
        if (!fs.existsSync(this.composeFilePath)) {
            this.writeCompose(structuredClone(this.defaultCompose));
        }

        const compose = this.#readCompose();
        const ret: ComposePortEntry[] = [];

        for (const mapping of compose.services.windows.ports) {
            if (typeof mapping === "string") {
                ret.push(new ComposePortEntry(mapping));
                continue;
            }

            if (typeof mapping.target !== "number") continue;
            if (!mapping.published) continue;

            const host = Number.parseInt(mapping.published, 10);
            if (Number.isNaN(host)) continue;

            ret.push(
                new ComposePortEntry(host, mapping.target, {
                    hostIP: mapping.host_ip ?? "127.0.0.1",
                    protocol: mapping.protocol ?? "tcp",
                }),
            );
        }

        this.cachedPortMappings = ret;
        return ret;
    }

    async remove(): Promise<void> {
        await this.#stopVM();
        const pidPath = path.join(this.#runtimeDir, "qemu.pid");
        if (fs.existsSync(pidPath)) {
            fs.rmSync(pidPath, { force: true });
        }
    }

    async getStatus(): Promise<ContainerStatus> {
        const pid = this.#readPid();
        if (pid && pidIsAlive(pid)) {
            return ContainerStatus.RUNNING;
        }

        return ContainerStatus.EXITED;
    }

    async exists(): Promise<boolean> {
        return fs.existsSync(this.composeFilePath);
    }

    async #startVM(): Promise<void> {
        if (await this.getStatus() === ContainerStatus.RUNNING) {
            containerLogger.info("[QemuNative] VM already running");
            return;
        }

        if (!fs.existsSync(this.composeFilePath)) {
            this.writeCompose(structuredClone(this.defaultCompose));
        }

        const compose = this.#readCompose();
        const state = await this.#resolveRuntimeState(compose);

        this.#ensureRuntimeDir();
        this.#ensureFirmwareVars(state);
        await this.#ensureDisk(state, compose);

        const args = this.#buildQemuArgs(compose, state);
        containerLogger.info(`[QemuNative] launching VM with args: ${JSON.stringify(args)}`);

        const stdoutFd = fs.openSync(state.stdoutLogPath, "a");
        const stderrFd = fs.openSync(state.stderrLogPath, "a");
        const child = spawn(state.qemuBinary, args, {
            detached: true,
            stdio: ["ignore", stdoutFd, stderrFd],
        });
        child.unref();
        fs.closeSync(stdoutFd);
        fs.closeSync(stderrFd);

        fs.writeFileSync(state.pidPath, String(child.pid), "utf8");
        await this.port();
    }

    async #stopVM(): Promise<void> {
        const pid = this.#readPid();
        if (!pid) return;

        await killPidWithGrace(pid);
        const pidPath = path.join(this.#runtimeDir, "qemu.pid");
        if (fs.existsSync(pidPath)) {
            fs.rmSync(pidPath, { force: true });
        }
    }

    #buildQemuArgs(compose: ComposeConfig, state: QemuRuntimeState): string[] {
        const env = compose.services.windows.environment;
        const memoryGiB = parseGibToken(env.RAM_SIZE, 4);
        const cpuCores = parseGibToken(env.CPU_CORES, 4);

        const hostFwdTokens = this.#extractHostForwardTokens(compose);

        return [
            "-accel",
            "hvf",
            "-machine",
            "virt,highmem=on",
            "-cpu",
            "host",
            "-smp",
            String(cpuCores),
            "-m",
            String(memoryGiB * 1024),
            "-drive",
            `if=pflash,format=raw,readonly=on,file=${state.firmwareCodePath}`,
            "-drive",
            `if=pflash,format=raw,file=${state.vmVarsPath}`,
            "-drive",
            `if=virtio,file=${state.vmDiskPath},format=qcow2`,
            "-netdev",
            `user,id=net0${hostFwdTokens.length ? `,${hostFwdTokens.join(",")}` : ""}`,
            "-device",
            "virtio-net-pci,netdev=net0",
            "-qmp",
            "tcp:127.0.0.1:7149,server,wait=off",
            "-display",
            "none",
            "-monitor",
            "none",
            "-serial",
            "none",
        ];
    }

    #extractHostForwardTokens(compose: ComposeConfig): string[] {
        const tokens: string[] = [];

        for (const mapping of compose.services.windows.ports) {
            if (typeof mapping !== "string") continue;

            try {
                const entry = new ComposePortEntry(mapping);
                if (typeof entry.host !== "number" || typeof entry.container !== "number") continue;
                if (Number.isNaN(entry.host) || Number.isNaN(entry.container)) continue;

                tokens.push(`hostfwd=${entry.protocol}:${entry.hostIP}:${entry.host}-:${entry.container}`);
            } catch (e) {
                containerLogger.warn(`[QemuNative] failed to parse port mapping '${mapping}'`);
                containerLogger.warn(e);
            }
        }

        return tokens;
    }

    #readCompose(): ComposeConfig {
        const raw = fs.readFileSync(this.composeFilePath, "utf8");
        return YAML.parse(raw) as ComposeConfig;
    }

    #ensureRuntimeDir(): void {
        if (!fs.existsSync(this.#runtimeDir)) {
            fs.mkdirSync(this.#runtimeDir, { recursive: true });
        }
    }

    async #ensureDisk(state: QemuRuntimeState, compose: ComposeConfig): Promise<void> {
        if (fs.existsSync(state.vmDiskPath)) return;

        fs.mkdirSync(path.dirname(state.vmDiskPath), { recursive: true });
        const diskGiB = parseGibToken(compose.services.windows.environment.DISK_SIZE, 64);
        await execFileAsync(state.qemuImgBinary, ["create", "-f", "qcow2", state.vmDiskPath, `${diskGiB}G`]);
    }

    #ensureFirmwareVars(state: QemuRuntimeState): void {
        if (fs.existsSync(state.vmVarsPath)) return;
        fs.copyFileSync(state.firmwareVarsTemplatePath, state.vmVarsPath);
    }

    #readPid(): number | null {
        const pidPath = path.join(this.#runtimeDir, "qemu.pid");
        if (!fs.existsSync(pidPath)) return null;

        const pidRaw = fs.readFileSync(pidPath, "utf8");
        const pid = Number.parseInt(pidRaw, 10);
        if (Number.isNaN(pid) || pid <= 0) return null;
        return pid;
    }

    #resolveDiskPath(compose: ComposeConfig): string {
        const storageVolume = compose.services.windows.volumes
            .map(parseVolumeMapping)
            .find(mapping => mapping?.guestPath === "/storage");

        if (!storageVolume) {
            return path.join(this.#runtimeDir, "windows-arm64.qcow2");
        }

        const resolvedStoragePath = storageVolume.hostPath.replace("${HOME}", os.homedir());
        return path.join(resolvedStoragePath, "windows-arm64.qcow2");
    }

    async #resolveRuntimeState(compose?: ComposeConfig): Promise<QemuRuntimeState> {
        const qemuBinary = await this.#resolveBinaryPath(QEMU_BIN_CANDIDATES);
        const qemuImgBinary = await this.#resolveBinaryPath(QEMU_IMG_CANDIDATES);

        const firmwareCodePath = resolveFirstExisting(EDK2_CODE_CANDIDATES);
        const firmwareVarsTemplatePath = resolveFirstExisting(EDK2_VARS_CANDIDATES);

        if (!firmwareCodePath || !fs.existsSync(firmwareCodePath)) {
            throw new Error("Could not locate EDK2 AArch64 firmware code file");
        }
        if (!firmwareVarsTemplatePath || !fs.existsSync(firmwareVarsTemplatePath)) {
            throw new Error("Could not locate EDK2 AArch64 firmware vars template");
        }

        let vmDiskPath = path.join(this.#runtimeDir, "windows-arm64.qcow2");
        if (compose) {
            vmDiskPath = this.#resolveDiskPath(compose);
        } else if (fs.existsSync(this.composeFilePath)) {
            try {
                vmDiskPath = this.#resolveDiskPath(this.#readCompose());
            } catch (e) {
                containerLogger.warn("[QemuNative] failed to parse compose for disk path, falling back to runtime dir");
                containerLogger.warn(e);
            }
        }

        return {
            qemuBinary,
            qemuImgBinary,
            firmwareCodePath,
            firmwareVarsTemplatePath,
            vmDiskPath,
            vmVarsPath: path.join(this.#runtimeDir, "edk2-vars.fd"),
            pidPath: path.join(this.#runtimeDir, "qemu.pid"),
            stdoutLogPath: path.join(this.#runtimeDir, "qemu.stdout.log"),
            stderrLogPath: path.join(this.#runtimeDir, "qemu.stderr.log"),
        };
    }

    async #resolveBinaryPath(candidates: string[]): Promise<string> {
        for (const candidate of candidates) {
            try {
                await execFileAsync(candidate, ["--version"]);
                return candidate;
            } catch {}
        }

        throw new Error(`Could not resolve executable from candidates: ${candidates.join(", ")}`);
    }

    static override async _getSpecs(): Promise<QemuNativeSpecs> {
        const specs: QemuNativeSpecs = {
            qemuInstalled: false,
            qemuImgInstalled: false,
            hvfSupported: false,
        };

        for (const candidate of QEMU_BIN_CANDIDATES) {
            try {
                await execFileAsync(candidate, ["--version"]);
                specs.qemuInstalled = true;
                break;
            } catch {}
        }

        for (const candidate of QEMU_IMG_CANDIDATES) {
            try {
                await execFileAsync(candidate, ["--version"]);
                specs.qemuImgInstalled = true;
                break;
            } catch {}
        }

        if (process.platform === "darwin") {
            try {
                const { stdout } = await execFileAsync("sysctl", ["-n", "kern.hv_support"]);
                specs.hvfSupported = stdout.trim() === "1";
            } catch {}
        }

        return specs;
    }
}
