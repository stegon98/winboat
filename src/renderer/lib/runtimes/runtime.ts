import type { ContainerManager } from "../containers/container";

/**
 * Transitional alias for the new runtime architecture.
 * In this phase, runtimes are backed by existing container managers.
 */
export type RuntimeManager = ContainerManager;
