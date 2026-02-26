import { ComposeConfig } from "../../types";
import { RESTART_NO } from "../lib/constants";

export const QEMU_NATIVE_DEFAULT_COMPOSE: ComposeConfig = {
    name: "winboat-qemu-native",
    volumes: {
        data: null,
    },
    services: {
        windows: {
            // Informational placeholder; native QEMU runtime does not pull this image.
            image: "local/windows-arm64",
            container_name: "WinBoatQemuNative",
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
                ARGUMENTS: "",
            },
            cap_add: [],
            ports: [
                "127.0.0.1:47270:8006", // Reserved for future web display integration
                "127.0.0.1:47280:7148", // WinBoat Guest Server API
                "127.0.0.1:47290:7149", // QMP (for compatibility with current logic)
                "127.0.0.1:47300:3389/tcp", // RDP TCP
                "127.0.0.1:47301:3389/udp", // RDP UDP
            ],
            stop_grace_period: "120s",
            restart: RESTART_NO,
            volumes: ["${HOME}:/shared"],
            devices: [],
        },
    },
};
