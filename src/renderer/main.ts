import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { MotionPlugin } from "@vueuse/motion";
import "./index.css";
import { autoScroll } from "./directives/autoscroll";
import { getDefaultExtraPathEntries } from "./lib/constants";
import VueApexCharts from "vue3-apexcharts";

const process: typeof import("process") = require("node:process");
const path: typeof import("node:path") = require("node:path");

/**
 * @note A big chunk of our userbase uses WinBoat under an immutable distro through GearLever.
 * In case it's the flatpak version of GearLever, PATH, and some other environment variables are stripped by default.
 * We include the default homebrew bin directory for exactly this reason.
 * It's not WinBoat's responsibility if the PATH envvar is incomplete, but in this case it affects a lot of users.
 */
const extraPathEntries = getDefaultExtraPathEntries();
if (extraPathEntries.length > 0) {
    const existingPath = process.env.PATH ?? "";
    const pathEntries = existingPath.split(path.delimiter).filter(Boolean);

    for (const extraPath of extraPathEntries) {
        if (!pathEntries.includes(extraPath)) {
            pathEntries.push(extraPath);
        }
    }

    process.env.PATH = pathEntries.join(path.delimiter);
}

createApp(App)
    .directive("auto-scroll", autoScroll)
    .use(router)
    .use(MotionPlugin)
    .use(VueApexCharts as any) // TODO: See https://github.com/apexcharts/vue3-apexcharts/issues/141
    .mount("#app");
