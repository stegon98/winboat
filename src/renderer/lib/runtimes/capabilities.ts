import { IS_APPLE_SILICON, IS_LINUX, IS_MACOS } from "../constants";
import { ContainerRuntimes } from "../containers/common";
import { getPreferredGuestArchitecture, getSupportedRuntimeKinds, type RuntimeGuestArchitecture, type RuntimeKind } from "./common";
import {
    FEATURE_FLAG_EXPERIMENTAL_MAC_NATIVE_RUNTIME,
    LEGACY_FEATURE_FLAG_EXPERIMENTAL_QEMU_NATIVE,
    isExperimentalMacNativeRuntimeEnabled,
} from "../feature-flags";

export type HostProfile = {
    platform: NodeJS.Platform;
    arch: string;
    isLinux: boolean;
    isMacOS: boolean;
    isAppleSilicon: boolean;
    virtualizationLabel: string;
    virtualizationHelpURL: string;
    dockerComposeGuideURL: string;
    dockerDaemonGuideURL: string;
    podmanComposeGuideURL: string;
    qemuInstallGuideURL: string;
    freeRDPInstallGuideURL: string;
};

export type RuntimeCapabilities = {
    runtime: RuntimeKind;
    supportedOnHost: boolean;
    experimental: boolean;
    supportsCompose: boolean;
    supportsUsbPassthrough: boolean;
    supportsQmp: boolean;
    supportsAutoStart: boolean;
    supportsGuidedInstall: boolean;
    guestArchitecture: RuntimeGuestArchitecture;
    installGuideURL: string;
    unsupportedReason?: string;
    guidedInstallReason?: string;
    usbPassthroughReason?: string;
    autoStartReason?: string;
};

export function getHostProfile(): HostProfile {
    return {
        platform: process.platform,
        arch: process.arch,
        isLinux: IS_LINUX,
        isMacOS: IS_MACOS,
        isAppleSilicon: IS_APPLE_SILICON,
        virtualizationLabel: IS_LINUX ? "Virtualization (KVM) enabled" : "Virtualization (Hypervisor) enabled",
        virtualizationHelpURL: IS_LINUX
            ? "https://duckduckgo.com/?t=h_&q=how+to+enable+virtualization+in+%3Cmotherboard+brand%3E+bios&ia=web"
            : "https://support.apple.com/guide/security/virtualization-security-sec7f7da5f4/web",
        dockerComposeGuideURL: IS_LINUX
            ? "https://docs.docker.com/compose/install/#plugin-linux-only"
            : "https://docs.docker.com/compose/install/",
        dockerDaemonGuideURL: IS_LINUX
            ? "https://docs.docker.com/config/daemon/start/"
            : "https://docs.docker.com/desktop/setup/install/mac-install/",
        podmanComposeGuideURL: "https://github.com/containers/podman-compose?tab=readme-ov-file#installation",
        qemuInstallGuideURL: "https://formulae.brew.sh/formula/qemu",
        freeRDPInstallGuideURL: IS_LINUX
            ? "https://github.com/FreeRDP/FreeRDP/wiki/PreBuilds"
            : "https://formulae.brew.sh/formula/freerdp",
    };
}

export function getRuntimeInstallGuideURL(runtime: RuntimeKind, hostProfile = getHostProfile()): string {
    if (runtime === ContainerRuntimes.PODMAN) {
        return "https://podman.io/docs/installation";
    }

    if (runtime === ContainerRuntimes.QEMU_NATIVE) {
        return hostProfile.qemuInstallGuideURL;
    }

    return hostProfile.isLinux
        ? "https://docs.docker.com/engine/install/"
        : "https://docs.docker.com/desktop/setup/install/mac-install/";
}

function getUnsupportedReason(runtime: RuntimeKind, hostProfile: HostProfile): string | undefined {
    if (runtime === ContainerRuntimes.PODMAN && !hostProfile.isLinux) {
        return "Podman runtime is currently supported only on Linux hosts.";
    }

    if (runtime === ContainerRuntimes.QEMU_NATIVE) {
        if (!hostProfile.isMacOS || !hostProfile.isAppleSilicon) {
            return "QEMU Native runtime currently requires macOS on Apple Silicon.";
        }
        if (!isExperimentalMacNativeRuntimeEnabled()) {
            return `QEMU Native runtime is currently hidden behind ${FEATURE_FLAG_EXPERIMENTAL_MAC_NATIVE_RUNTIME}=1 (legacy: ${LEGACY_FEATURE_FLAG_EXPERIMENTAL_QEMU_NATIVE}=1).`;
        }
    }

    return undefined;
}

export function getRuntimeCapabilities(runtime: RuntimeKind, hostProfile = getHostProfile()): RuntimeCapabilities {
    const supportedOnHost = getSupportedRuntimeKinds().includes(runtime);
    const guestArchitecture = getPreferredGuestArchitecture(runtime);

    const base: RuntimeCapabilities = {
        runtime,
        supportedOnHost,
        experimental: false,
        supportsCompose: true,
        supportsUsbPassthrough: false,
        supportsQmp: true,
        supportsAutoStart: true,
        supportsGuidedInstall: true,
        guestArchitecture,
        installGuideURL: getRuntimeInstallGuideURL(runtime, hostProfile),
        unsupportedReason: getUnsupportedReason(runtime, hostProfile),
    };

    switch (runtime) {
        case ContainerRuntimes.DOCKER:
            return {
                ...base,
                supportsCompose: true,
                supportsUsbPassthrough: hostProfile.isLinux,
                usbPassthroughReason: hostProfile.isLinux
                    ? undefined
                    : "USB passthrough is currently supported only on Linux hosts.",
            };
        case ContainerRuntimes.PODMAN:
            return {
                ...base,
                supportsCompose: true,
                supportsUsbPassthrough: false,
                usbPassthroughReason: "USB passthrough is not yet supported while using Podman as the runtime.",
            };
        case ContainerRuntimes.QEMU_NATIVE:
            return {
                ...base,
                experimental: true,
                supportsCompose: false,
                supportsUsbPassthrough: false,
                supportsAutoStart: false,
                supportsGuidedInstall: false,
                usbPassthroughReason: "USB passthrough is not yet available for QEMU Native runtime.",
                autoStartReason: "Auto-start is not available for QEMU Native runtime.",
                guidedInstallReason:
                    "Guided Windows installation is not available for QEMU Native runtime yet (manual flow only).",
            };
        default:
            return base;
    }
}

export function getRuntimeCapabilityMatrix(hostProfile = getHostProfile()): Record<RuntimeKind, RuntimeCapabilities> {
    return {
        [ContainerRuntimes.DOCKER]: getRuntimeCapabilities(ContainerRuntimes.DOCKER, hostProfile),
        [ContainerRuntimes.PODMAN]: getRuntimeCapabilities(ContainerRuntimes.PODMAN, hostProfile),
        [ContainerRuntimes.QEMU_NATIVE]: getRuntimeCapabilities(ContainerRuntimes.QEMU_NATIVE, hostProfile),
    };
}
