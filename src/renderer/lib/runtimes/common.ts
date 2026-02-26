import {
    CommonPorts,
    ContainerRuntimes,
    createContainer as createContainerImpl,
    getActiveHostPort,
    getContainerSpecs as getContainerSpecsImpl,
    getSupportedContainerRuntimes as getSupportedContainerRuntimesImpl,
    type ContainerSpecs,
    type DockerSpecs,
    type PodmanSpecs,
    type QemuNativeSpecs,
} from "../containers/common";
import { ContainerStatus, type ContainerManager } from "../containers/container";

// Specs
export { type DockerSpecs, type PodmanSpecs, type QemuNativeSpecs };
export type RuntimeSpecs = ContainerSpecs;

// Status
export { ContainerStatus };
export { ContainerStatus as RuntimeStatus };

// Manager
export type RuntimeManager = ContainerManager;

// Runtime identifiers
export { ContainerRuntimes };
export { ContainerRuntimes as RuntimeKinds };
export type RuntimeKind = ContainerRuntimes;
export type RuntimeGuestArchitecture = "amd64" | "arm64";

export function getPreferredGuestArchitecture(type: RuntimeKind): RuntimeGuestArchitecture {
    if (type === ContainerRuntimes.QEMU_NATIVE) {
        return "arm64";
    }

    return "amd64";
}

// Common guest ports
export { CommonPorts };

// Factory/utility wrappers
export async function getRuntimeSpecs<T extends RuntimeKind>(type: T): Promise<
    T extends ContainerRuntimes.DOCKER
        ? DockerSpecs
        : T extends ContainerRuntimes.PODMAN
          ? PodmanSpecs
          : T extends ContainerRuntimes.QEMU_NATIVE
            ? QemuNativeSpecs
          : never
> {
    return (await getContainerSpecsImpl(type)) as any;
}

export function createRuntime<T extends RuntimeKind>(type: T): RuntimeManager {
    return createContainerImpl(type);
}

export function getSupportedRuntimeKinds(): RuntimeKind[] {
    return getSupportedContainerRuntimesImpl();
}

export { getActiveHostPort };

// Backward-compat aliases during migration
export const createContainer = createRuntime;
export const createContainerRuntime = createRuntime;
export const getContainerSpecs = getRuntimeSpecs;
export const getRuntimeKindSpecs = getRuntimeSpecs;
export const getSupportedContainerRuntimes = getSupportedRuntimeKinds;
export const getSupportedContainerRuntimeKinds = getSupportedRuntimeKinds;
