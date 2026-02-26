# WinBoat macOS ARM64 QEMU Refactor Backlog

## Scope
Build a native macOS ARM64 runtime based on QEMU + HVF while preserving current Linux behavior (Docker/Podman) without regressions.

## Constraints
- Linux compatibility is mandatory.
- Current Linux install, run, app launch, and config flows must continue to work.
- macOS backend must not depend on Docker Desktop for VM execution.
- Rollout must be gradual behind feature flags.

## Definition Of Done (Global)
- macOS ARM64: install Windows ARM, boot VM, guest API online, app launch through FreeRDP.
- Linux: no behavior regressions in existing Docker/Podman paths.
- Config migrations are forward-safe and backward-safe.
- CI includes Linux regression checks and macOS runtime sanity checks.

## Labels
- `epic`
- `runtime`
- `macos`
- `linux-compat`
- `breaking-change`
- `migration`
- `qa`
- `docs`

## Epic E0 - Baseline And Guardrails
Goal: freeze current Linux behavior and add regression guardrails before architecture work.

- [ ] WB-001 Baseline Linux smoke test checklist (`linux-compat`)
  - Priority: P0
  - Depends on: none
  - Acceptance:
    - Documented smoke path for fresh install, restart, app launch, config save, reset.
    - Includes expected logs and pass/fail output.

- [ ] WB-002 Add baseline telemetry markers in logs (`runtime`)
  - Priority: P1
  - Depends on: none
  - Acceptance:
    - Log runtime id, host OS/arch, and selected capabilities at startup.

- [ ] WB-003 Add Linux regression script (non-destructive) (`qa`)
  - Priority: P1
  - Depends on: WB-001
  - Acceptance:
    - Script validates config, compose generation, runtime status transitions, and port mapping.

## Epic E1 - Runtime Abstraction Layer
Goal: decouple app logic from "container-only" assumptions.

- [ ] WB-010 Define `RuntimeManager` interface (`runtime`)
  - Priority: P0
  - Depends on: WB-001
  - Acceptance:
    - Interface covers start/stop/restart/pause/unpause/status/exists/remove/port/getSpecs/writeConfig.
    - Explicit `RuntimeCapabilities` contract added.

- [ ] WB-011 Introduce `RuntimeStatus` enum and mapper (`runtime`)
  - Priority: P0
  - Depends on: WB-010
  - Acceptance:
    - Existing container statuses map 1:1 to runtime statuses.

- [ ] WB-012 Wrap Docker backend with runtime adapter (`runtime`, `linux-compat`)
  - Priority: P0
  - Depends on: WB-010, WB-011
  - Acceptance:
    - Docker behavior unchanged in Linux smoke tests.

- [ ] WB-013 Wrap Podman backend with runtime adapter (`runtime`, `linux-compat`)
  - Priority: P0
  - Depends on: WB-010, WB-011
  - Acceptance:
    - Podman behavior unchanged in Linux smoke tests.

- [ ] WB-014 Replace direct container references in `Winboat` with runtime API (`runtime`)
  - Priority: P0
  - Depends on: WB-012, WB-013
  - Acceptance:
    - No direct imports of container managers from Winboat core loop.

- [ ] WB-015 Replace direct container references in installer flow (`runtime`)
  - Priority: P0
  - Depends on: WB-014
  - Acceptance:
    - Install manager works with generic runtime manager.

## Epic E2 - Host And Capability Discovery
Goal: centralize host detection and feature gating.

- [ ] WB-020 Create host profile service (`runtime`)
  - Priority: P0
  - Depends on: WB-010
  - Acceptance:
    - Exposes host OS, arch, and runtime support matrix.

- [ ] WB-021 Add runtime capability matrix (`runtime`)
  - Priority: P0
  - Depends on: WB-020
  - Acceptance:
    - Capabilities include: usb passthrough, qmp, auto-start, compose support, guest arch.

- [ ] WB-022 Wire setup/config UI to capability matrix (`runtime`, `linux-compat`)
  - Priority: P1
  - Depends on: WB-021
  - Acceptance:
    - Unsupported features are hidden or disabled with clear messages.

## Epic E3 - QEMU Native Backend For macOS ARM64
Goal: implement a non-container runtime that uses QEMU + HVF.

- [ ] WB-030 Add `QemuNativeRuntimeManager` skeleton (`macos`, `runtime`)
  - Priority: P0
  - Depends on: WB-015, WB-021
  - Acceptance:
    - Implements `RuntimeManager` interface with real process lifecycle.

- [ ] WB-031 Define VM state model and files (`macos`)
  - Priority: P0
  - Depends on: WB-030
  - Acceptance:
    - `vm.json`, qcow2 path, nvram path, logs path, pid file format defined.

- [ ] WB-032 Implement QEMU command builder (`macos`)
  - Priority: P0
  - Depends on: WB-031
  - Acceptance:
    - Uses `qemu-system-aarch64`, `-accel hvf`, ARM machine config, virtio disk/net.

- [ ] WB-033 Implement networking and host port forwards (`macos`)
  - Priority: P0
  - Depends on: WB-032
  - Acceptance:
    - Forwards RDP/API/QMP/NOVNC equivalents to host with conflict handling.

- [ ] WB-034 Add QMP connectivity for native runtime (`macos`)
  - Priority: P1
  - Depends on: WB-033
  - Acceptance:
    - Existing QMP manager can connect using runtime-provided host port.

- [ ] WB-035 Add graceful shutdown and hard-stop semantics (`macos`)
  - Priority: P1
  - Depends on: WB-034
  - Acceptance:
    - `stop` sends graceful signal, timeout fallback to force kill.

- [ ] WB-036 Implement runtime status resolution (`macos`)
  - Priority: P1
  - Depends on: WB-035
  - Acceptance:
    - Status reflects process state and VM readiness probes.

- [ ] WB-037 Auto-recovery of stale PID / zombie processes (`macos`)
  - Priority: P2
  - Depends on: WB-036
  - Acceptance:
    - Startup cleans stale state safely.

## Epic E4 - Windows ARM Guest Pipeline
Goal: make installation/update flows architecture-aware.

- [ ] WB-040 Add guest arch concept to config and install model (`migration`)
  - Priority: P0
  - Depends on: WB-015
  - Acceptance:
    - `guestArch` supports at least `amd64` and `arm64`.

- [ ] WB-041 Build guest server for `windows/arm64` (`runtime`)
  - Priority: P0
  - Depends on: WB-040
  - Acceptance:
    - Build outputs include amd64 and arm64 artifacts.

- [ ] WB-042 Package guest server artifacts by runtime/arch (`runtime`)
  - Priority: P0
  - Depends on: WB-041
  - Acceptance:
    - Packaged resources expose deterministic paths for each arch.

- [ ] WB-043 Update guest server updater to choose correct artifact (`runtime`)
  - Priority: P1
  - Depends on: WB-042
  - Acceptance:
    - Updater selects artifact by runtime capabilities + guest arch.

- [ ] WB-044 Implement Windows ARM install source strategy (`macos`)
  - Priority: P0
  - Depends on: WB-040, WB-032
  - Acceptance:
    - Installer can consume Windows ARM image and create bootable VM state.

- [ ] WB-045 Add unattended install assets for ARM flow (`macos`)
  - Priority: P1
  - Depends on: WB-044
  - Acceptance:
    - Setup reaches post-install guest API state without manual steps.

## Epic E5 - UI/UX Refactor For Multi-Runtime
Goal: present clear runtime-specific UX without leaking unsupported options.

- [ ] WB-050 Setup wizard runtime selector by host support (`macos`, `linux-compat`)
  - Priority: P0
  - Depends on: WB-021
  - Acceptance:
    - macOS ARM defaults to native QEMU runtime once available.

- [ ] WB-051 Runtime-specific prerequisite checks (`macos`, `linux-compat`)
  - Priority: P0
  - Depends on: WB-050
  - Acceptance:
    - Linux checks retain KVM/docker/podman logic.
    - macOS checks verify QEMU/HVF/FreeRDP toolchain.

- [ ] WB-052 Config page capability-driven sections (`runtime`)
  - Priority: P1
  - Depends on: WB-022
  - Acceptance:
    - USB/QMP/advanced controls follow capability flags.

- [ ] WB-053 Add runtime diagnostics panel (`runtime`)
  - Priority: P2
  - Depends on: WB-022
  - Acceptance:
    - Shows selected runtime, host capabilities, critical paths, and active ports.

## Epic E6 - Data Migration And Backward Compatibility
Goal: upgrade existing configs safely and keep Linux users unaffected.

- [ ] WB-060 Add config schema versioning (`migration`)
  - Priority: P0
  - Depends on: WB-040
  - Acceptance:
    - Config stores explicit schema version.

- [ ] WB-061 Write migration v1: container runtime -> generic runtime (`migration`)
  - Priority: P0
  - Depends on: WB-060
  - Acceptance:
    - Existing Linux users migrate with no manual intervention.

- [ ] WB-062 Write migration v2: add guest arch and runtime metadata (`migration`)
  - Priority: P0
  - Depends on: WB-061
  - Acceptance:
    - Defaults are deterministic by host OS/arch.

- [ ] WB-063 Migration rollback safety and corruption fallback (`migration`)
  - Priority: P1
  - Depends on: WB-062
  - Acceptance:
    - Failed migration restores previous valid config and logs reason.

## Epic E7 - CI And QA Matrix
Goal: keep Linux stable while adding macOS runtime confidence.

- [ ] WB-070 Linux regression workflow in CI (`qa`, `linux-compat`)
  - Priority: P0
  - Depends on: WB-003
  - Acceptance:
    - Runs smoke checks on every PR touching runtime/config/install code.

- [ ] WB-071 macOS ARM static validation workflow (`qa`, `macos`)
  - Priority: P1
  - Depends on: WB-030
  - Acceptance:
    - Validates command generation, config output, and required asset presence.

- [ ] WB-072 Runtime contract tests (`qa`)
  - Priority: P1
  - Depends on: WB-015
  - Acceptance:
    - Shared tests executed against Docker, Podman, and QEMU managers.

- [ ] WB-073 Pre-release checklist for runtime changes (`qa`)
  - Priority: P1
  - Depends on: WB-070, WB-071, WB-072
  - Acceptance:
    - Checklist includes Linux + macOS signoff gates.

## Epic E8 - Rollout Strategy
Goal: controlled launch with clear rollback.

- [ ] WB-080 Add feature flag `experimentalMacNativeRuntime` (`runtime`)
  - Priority: P0
  - Depends on: WB-030
  - Acceptance:
    - New runtime is opt-in in first release.

- [ ] WB-081 Alpha release channel notes and telemetry plan (`docs`)
  - Priority: P1
  - Depends on: WB-080
  - Acceptance:
    - Includes known limitations and bug-report template fields.

- [ ] WB-082 Rollback plan for runtime selector and config migration (`migration`)
  - Priority: P0
  - Depends on: WB-062, WB-080
  - Acceptance:
    - One-step rollback documented and tested.

- [ ] WB-083 Final GA criteria and flag removal (`epic`)
  - Priority: P2
  - Depends on: all previous epics
  - Acceptance:
    - macOS runtime exits experimental only after Linux stability window.

## Suggested Milestone Order
1. M1: E0 + E1 + E2
2. M2: E3 (boot lifecycle + status)
3. M3: E4 (Windows ARM pipeline)
4. M4: E5 + E6
5. M5: E7 + E8 (alpha rollout)

## Immediate Next Sprint (Recommended)
- [ ] WB-001
- [ ] WB-010
- [ ] WB-011
- [ ] WB-012
- [ ] WB-013
- [ ] WB-014
- [ ] WB-020
- [ ] WB-021
