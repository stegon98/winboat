# Feature Flags Rollout

## Experimental macOS Native Runtime

- Canonical flag: `WINBOAT_EXPERIMENTAL_MAC_NATIVE_RUNTIME=1`
- Legacy-compatible flag (still supported): `WINBOAT_EXPERIMENTAL_QEMU_NATIVE=1`

When either flag is enabled on macOS Apple Silicon, WinBoat exposes:

- `QEMU Native (HVF)` in supported runtimes
- capability matrix entries for native runtime

When disabled, native runtime remains hidden from runtime selection.

## CI Policy

- Linux CI jobs run with `WINBOAT_EXPERIMENTAL_MAC_NATIVE_RUNTIME=0`.
- macOS ARM64 CI jobs run with `WINBOAT_EXPERIMENTAL_MAC_NATIVE_RUNTIME=1` to validate gated code paths.
- CI contains an explicit check that runtime availability toggles correctly when the flag is switched on/off.

