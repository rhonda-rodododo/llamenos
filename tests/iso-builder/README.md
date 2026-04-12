# ISO Builder Tests

Bats tests for the ISO builder. Run with:

    bats tests/iso-builder/

These tests cover argument parsing and template rendering. They do NOT
build a real ISO (that's a separate CI job — see `.github/workflows/iso-builder.yml`).

| File | Purpose |
|------|---------|
| `build-iso-args.bats` | Validates flag parsing and error paths in `scripts/build-iso.sh` |
| `preseed-template.bats` | Renders the preseed template with fixture inputs and diffs against golden files |
| `golden/*.cfg` | Expected preseed outputs for various flag combinations |

To regenerate a golden file after a deliberate template change:

    UPDATE_GOLDEN=1 bats tests/iso-builder/preseed-template.bats
