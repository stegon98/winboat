import { execFileAsync, stringifyExecFile } from "../lib/exec-helper";
const process: typeof import("process") = require("node:process");

export class FreeRDPInstallation {
    file: string;
    defaultArgs: string[];

    constructor(file: string, defaultArgs: string[] = []) {
        this.file = file;
        this.defaultArgs = defaultArgs;
    }

    exec(args: string[]): Promise<{
        stdout: string;
        stderr: string;
    }> {
        return execFileAsync(this.file, this.defaultArgs.concat(args));
    }

    stringifyExec(args: string[]): string {
        return stringifyExecFile(this.file, this.defaultArgs.concat(args));
    }
}

function getFreeRDPInstallations() {
    const defaultInstallations = [new FreeRDPInstallation("xfreerdp3"), new FreeRDPInstallation("xfreerdp")];

    if (process.platform === "darwin") {
        return [
            new FreeRDPInstallation("/opt/homebrew/bin/xfreerdp"),
            new FreeRDPInstallation("/usr/local/bin/xfreerdp"),
            ...defaultInstallations,
        ];
    }

    return [
        ...defaultInstallations,
        // Flatpak support is Linux specific
        new FreeRDPInstallation("flatpak", ["run", "--command=xfreerdp", "com.freerdp.FreeRDP"]),
    ];
}

/**
 * Returns the correct FreeRDP 3.x.x command available on the system or null
 */
export async function getFreeRDP() {
    const VERSION_3_STRING = "version 3.";
    for (let installation of getFreeRDPInstallations()) {
        try {
            const shellOutput = await installation.exec(["--version"]);
            if (shellOutput.stdout.includes(VERSION_3_STRING)) {
                return installation;
            }
        } catch {}
    }
    return null;
}
