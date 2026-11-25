#!/usr/bin/env bash
# Runs every assistant test file once per tier model, against the strict fake Claude API.
# Each run points the Standard tier (the default) at one model with PAVE_TEST_MODEL, so every
# kind of run (chat edits, Design, CAD and Render jobs, the photo read, the smoke journeys) is
# checked on Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5. A request the fake refuses fails the
# run that sent it, and the fake prints the rule it broke.
#
#   bash scripts/test-tiers.sh            # all four models
#   bash scripts/test-tiers.sh claude-haiku-5-5
set -u
cd "$(dirname "$0")/.."
MODELS=${*:-claude-fable-5-2 claude-opus-5-5 claude-sonnet-5-5 claude-haiku-5-5}
status=0
for m in $MODELS; do
  echo "== $m"
  PAVE_TEST_MODEL=$m npx vitest run apps/server/src/assistant apps/server/src/references/pins.test.ts \
    || status=1
done
exit $status
