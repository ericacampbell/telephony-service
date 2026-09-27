#!/usr/bin/env bash
# Generate a sample call recording with macOS `say` + `afconvert` (both built in).
# One voice reads a two-speaker script; the spoken "Caller:"/"Agent:" labels
# survive into the transcript, which is what a diarized recording would give us.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p fixtures

SCRIPT_FILE="fixtures/sample-call.txt"
AIFF="fixtures/sample-call.aiff"
WAV="fixtures/sample-call.wav"

cat > "$SCRIPT_FILE" <<'EOF'
Agent: Thanks for calling Northwind Energy, this is Dan. Who am I speaking with?
Caller: Hi, it's Priya Raman. Account ending four one nine two.
Agent: Thanks Priya. What's going on today?
Caller: I've been double charged for my September bill. Two hundred and forty pounds went out twice on the fourth. I called last Tuesday and someone said it would be refunded within three working days and it still hasn't arrived. This is the third time I've had to chase this and honestly I'm about ready to switch supplier.
Agent: I'm sorry, that's not good enough. Let me look. Okay, I can see the duplicate payment on the fourth and I can see the refund was raised but it failed on our side.
Caller: So it never went through at all.
Agent: It didn't, and I can see why you're frustrated. I've re-raised it now and I'm going to put you through to our billing team so they can confirm the date with you directly.
Caller: I need it before the fifteenth, my direct debit comes out then and I can't cover both.
Agent: Understood. I'll tell them it needs to land before the fifteenth. Bear with me while I transfer you.
EOF

say -v Daniel -f "$SCRIPT_FILE" -o "$AIFF"
afconvert -f WAVE -d LEI16@16000 -c 1 "$AIFF" "$WAV"
rm -f "$AIFF"

echo "Wrote $WAV ($(du -h "$WAV" | cut -f1))"
echo "Run: node scripts/run-pipeline.js --file $WAV --mode transfer"
