import { ComposeConfig } from "../../types";
import { IS_APPLE_SILICON, IS_LINUX, RESTART_ON_FAILURE } from "../lib/constants";

export function createDefaultDockerCompose(): ComposeConfig {
    const volumes = ["data:/storage", "${HOME}:/shared", "./oem:/oem"];
    const devices: string[] = [];

    if (IS_LINUX) {
        volumes.splice(2, 0, "/dev/bus/usb:/dev/bus/usb"); // QEMU Dynamic USB Passthrough
        devices.push("/dev/kvm");
    }

    return {
        name: "winboat",
        volumes: {
            data: null,
        },
        services: {
            windows: {
                image: "ghcr.io/dockur/windows:5.14",
                ...(IS_APPLE_SILICON ? { platform: "linux/amd64" } : {}),
                container_name: "WinBoat",
                environment: {
                    VERSION: "11",
                    RAM_SIZE: "4G",
                    CPU_CORES: "4",
                    DISK_SIZE: "64G",
                    USERNAME: "MyWindowsUser",
                    PASSWORD: "MyWindowsPassword",
                    HOME: "${HOME}",
                    LANGUAGE: "English",
                    USER_PORTS: "7148",
                    HOST_PORTS: "7149",
                    ARGUMENTS: "-qmp tcp:0.0.0.0:7149,server,wait=off",
                },
                cap_add: ["NET_ADMIN"],
                privileged: true,
                ports: [
                    "127.0.0.1:47270-47279:8006", // VNC Web Interface
                    "127.0.0.1:47280-47289:7148", // Winboat Guest Server API
                    "127.0.0.1:47290-47299:7149", // QEMU QMP Port
                    "127.0.0.1:47300-47309:3389/tcp", // RDP
                    "127.0.0.1:47310-47319:3389/udp", // RDP
                ],
                stop_grace_period: "120s",
                restart: RESTART_ON_FAILURE,
                volumes,
                devices,
            },
        },
    };
}

export const DOCKER_DEFAULT_COMPOSE: ComposeConfig = createDefaultDockerCompose();
