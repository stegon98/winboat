import { getFreeRDP } from "../utils/getFreeRDP";
import { ContainerSpecs } from "./containers/common";
const fs: typeof import("fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const process: typeof import("node:process") = require("node:process");
const { execFile }: typeof import("child_process") = require("node:child_process");
const { promisify }: typeof import("util") = require("node:util");
const execFileAsync = promisify(execFile);

export function satisfiesPrequisites(specs: Specs, containerSpecs?: ContainerSpecs) {
    return (
        containerSpecs &&
        Object.values(containerSpecs).every(x => x) &&
        specs.freeRDP3Installed &&
        specs.kvmEnabled &&
        specs.ramGB >= 4 &&
        specs.cpuCores >= 2
    );
}

export const defaultSpecs: Specs = {
    cpuCores: 0,
    ramGB: 0,
    kvmEnabled: false,
    freeRDP3Installed: false,
};

function roundBytesToGB(bytes: number): number {
    return Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;
}

function getAvailableCpuCores(): number {
    if ("availableParallelism" in os && typeof os.availableParallelism === "function") {
        return os.availableParallelism();
    }

    return os.cpus().length;
}

async function hasVirtualizationBackendSupport(): Promise<boolean> {
    if (process.platform === "linux") {
        return fs.existsSync("/dev/kvm");
    }

    if (process.platform === "darwin") {
        try {
            const { stdout } = await execFileAsync("sysctl", ["-n", "kern.hv_support"]);
            return stdout.trim() === "1";
        } catch (e) {
            console.error("Error checking macOS hypervisor support, falling back to architecture check:", e);
            return process.arch === "arm64";
        }
    }

    return false;
}

export async function getSpecs() {
    const specs: Specs = { ...defaultSpecs };

    // CPU cores check
    try {
        specs.cpuCores = getAvailableCpuCores();
    } catch (e) {
        console.error("Error getting CPU cores:", e);
    }

    try {
        const memoryInfo = await getMemoryInfo();
        specs.ramGB = memoryInfo.totalGB;
    } catch (e) {
        console.error("Error getting memory info:", e);
    }

    // Virtualization backend check (/dev/kvm on Linux, Hypervisor Framework on macOS)
    try {
        specs.kvmEnabled = await hasVirtualizationBackendSupport();
    } catch (e) {
        console.error("Error checking virtualization backend:", e);
    }

    // FreeRDP 3.x.x check (including Flatpak)
    try {
        const freeRDPBin = await getFreeRDP();
        specs.freeRDP3Installed = !!freeRDPBin;
    } catch (e) {
        console.error("Error checking FreeRDP 3.x.x installation (most likely not installed):", e);
    }

    console.log("Specs:", specs);
    return specs;
}

export type MemoryInfo = {
    totalGB: number;
    availableGB: number;
};

export async function getMemoryInfo() {
    return {
        totalGB: roundBytesToGB(os.totalmem()),
        availableGB: roundBytesToGB(os.freemem()),
    };
}
