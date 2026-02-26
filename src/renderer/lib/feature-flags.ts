const process: typeof import("node:process") = require("node:process");

export const FEATURE_FLAG_EXPERIMENTAL_MAC_NATIVE_RUNTIME = "WINBOAT_EXPERIMENTAL_MAC_NATIVE_RUNTIME";
export const LEGACY_FEATURE_FLAG_EXPERIMENTAL_QEMU_NATIVE = "WINBOAT_EXPERIMENTAL_QEMU_NATIVE";

function envFlagEnabled(name: string): boolean {
    const token = (process.env[name] ?? "").trim().toLowerCase();
    return token === "1" || token === "true" || token === "yes";
}

/**
 * Canonical rollout gate for macOS native runtime.
 * Legacy env flag is still honored for backward compatibility.
 */
export function isExperimentalMacNativeRuntimeEnabled(): boolean {
    return (
        envFlagEnabled(FEATURE_FLAG_EXPERIMENTAL_MAC_NATIVE_RUNTIME) ||
        envFlagEnabled(LEGACY_FEATURE_FLAG_EXPERIMENTAL_QEMU_NATIVE)
    );
}

