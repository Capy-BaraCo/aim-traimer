"""Build the coding-agent handoff (TODOS.md + todos.json) from the compiled plan.

Run after every recompile:  python3 -I .plan/plans/rhythm-drill/handoff/make_handoff.py
Task text comes from out/model/plan.json; routing, waves and read-first refs are set here.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLAN = HERE.parent / "out" / "model" / "plan.json"

# model: opus = hard / cross-cutting / timing-critical; sonnet = well-specified app code;
# gpt = pure functions with crisp tests (handed off through the Codex plugin).
ROUTING = {
    "T1": ("sonnet", "Types only, fully specified. Orchestrator reviews it: everything builds on it."),
    "T2": ("gpt", "Pure, seeded signal generator with a clear contract."),
    "T3": ("opus", "DSP: tempo prior, octave errors, DP beat tracking. Hardest correctness bar (R2)."),
    "T4": ("opus", "Heuristic segmentation with fallbacks (R4)."),
    "T5": ("gpt", "Data tables + small pure helpers, numbers given."),
    "T6": ("opus", "Many interacting constraints (density, spacing, caps, low-confidence fallback)."),
    "T7": ("gpt", "Pure judging/combo maths, boundary tests spelled out."),
    "T8": ("sonnet", "IndexedDB wrapper, plain-words errors."),
    "T9": ("sonnet", "Vite module worker + cache wiring."),
    "T10": ("opus", "Sync-critical audio clock; touches the game loop (R1)."),
    "T11": ("sonnet", "Settings UI + one pure helper; follow existing settings screen idioms."),
    "T12": ("sonnet", "three.js scene; human eyeballs the look."),
    "T13": ("opus", "Integration core: DrillDef.make ctx, ShotResult.press, song-time judging."),
    "T14": ("sonnet", "Well-specified target shapes on top of T13."),
    "T15": ("opus", "Beat-locked brains and walls; subtle timing."),
    "T16": ("sonnet", "HUD + cues following V3; human checks readability."),
    "T17": ("sonnet", "Screen + routing in existing UI idioms."),
    "T18": ("sonnet", "Registration, debrief charts, coach findings in existing idioms."),
    "T19": ("opus", "Playtest with the human, then tune numbers."),
}

READ_FIRST = {
    "T1": ["D2", "D4", "D7", "D14", "glossary"],
    "T2": ["D11"],
    "T3": ["D3", "R2"],
    "T4": ["D7", "R4"],
    "T5": ["D7", "D8", "D9", "D10", "D17", "V5"],
    "T6": ["D4", "D7", "D12", "D14", "R2", "V4", "V5"],
    "T7": ["D4", "D13"],
    "T8": ["D11", "scope"],
    "T9": ["D3", "V1"],
    "T10": ["R1", "glossary: Song time, Audio offset"],
    "T11": ["R1", "glossary: Audio offset"],
    "T12": ["D6"],
    "T13": ["D4", "D12", "D13", "V6"],
    "T14": ["D13", "D14"],
    "T15": ["D1", "D13"],
    "T16": ["D5", "V3", "R3"],
    "T17": ["D9", "D10", "D11", "D17"],
    "T18": ["D15", "D17"],
    "T19": ["G5", "R3", "R4"],
}

NEEDS_HUMAN = {
    "T12": "the human checks the synthwave look in the browser",
    "T16": "the human checks readability at Expert on a fast song",
    "T19": "the human playtests on their own songs",
}

MODEL_LABEL = {"opus": "Opus", "sonnet": "Sonnet", "gpt": "GPT (via Codex plugin)"}


def main() -> None:
    plan = json.loads(PLAN.read_text())
    els = plan["elements"]
    by_id = {e["id"]: e for e in els}
    tasks = [e for e in els if e["type"] == "task"]
    deps: dict[str, list[str]] = {t["ref"]: [] for t in tasks}
    impl: dict[str, list[str]] = {t["ref"]: [] for t in tasks}
    mit: dict[str, list[str]] = {t["ref"]: [] for t in tasks}
    for link in plan["links"]:
        src, dst = by_id.get(link["from"]), by_id.get(link["to"])
        if not src or not dst or src["type"] != "task":
            continue
        bucket = {"dependsOn": deps, "implements": impl, "mitigates": mit}.get(link["rel"])
        if bucket is not None:
            bucket[src["ref"]].append(dst["ref"])

    missing = [t["ref"] for t in tasks if t["ref"] not in ROUTING]
    if missing:
        sys.exit(f"No routing for {missing}: add them to ROUTING and READ_FIRST.")

    # Waves = longest dependency chain depth (tasks in the same wave can run in parallel).
    wave: dict[str, int] = {}

    def depth(ref: str) -> int:
        if ref not in wave:
            wave[ref] = 1 + max((depth(d) for d in deps[ref]), default=0)
        return wave[ref]

    for t in tasks:
        depth(t["ref"])

    # Files touched by more than one task in the same wave -> run those serially or merge carefully.
    clashes: list[str] = []
    for w in sorted(set(wave.values())):
        seen: dict[str, list[str]] = {}
        for t in tasks:
            if wave[t["ref"]] == w:
                for f in t["data"].get("touches", []):
                    seen.setdefault(f, []).append(t["ref"])
        clashes += [f"wave {w}: {f} ({', '.join(r)})" for f, r in seen.items() if len(r) > 1]

    todos = []
    for t in sorted(tasks, key=lambda t: (wave[t["ref"]], int(t["ref"][1:]))):
        d, ref = t["data"], t["ref"]
        model, why = ROUTING[ref]
        todos.append({
            "ref": ref,
            "title": d["title"],
            "wave": wave[ref],
            "model": model,
            "modelWhy": why,
            "size": d.get("size"),
            "status": d.get("status", "todo"),
            "milestone": d.get("milestone"),
            "dependsOn": deps[ref],
            "implements": impl[ref],
            "mitigates": mit[ref],
            "readFirst": READ_FIRST.get(ref, []),
            "touches": d.get("touches", []),
            "description": d.get("description", ""),
            "doneWhen": d.get("doneWhen", []),
            "needsHuman": NEEDS_HUMAN.get(ref),
        })

    (HERE / "todos.json").write_text(json.dumps({"plan": plan["plan"]["slug"], "seq": plan["seq"], "todos": todos}, indent=2) + "\n")

    out: list[str] = []
    w = out.append
    w("# Overdrive: coding-agent handoff\n")
    w(f"Generated from plan `{plan['plan']['slug']}` at seq {plan['seq']} by `handoff/make_handoff.py`. "
      "Regenerate after any plan change; don't edit by hand.\n")
    w("Model pack (source of truth): `.plan/plans/rhythm-drill/out/model/`. Machine-readable copy of this list: `handoff/todos.json`.\n")
    w("## Orchestrator protocol\n")
    w("1. Work on a feature branch off `aim-trainer-experimental` (e.g. `overdrive`). Give each worker its own git worktree; the orchestrator merges.")
    w("2. Hand a worker exactly one task, using the brief template below. Launch every task in a wave together, but respect the file clashes listed.")
    w("3. Gate each hand-back: check every *Done when* item yourself, run `npm run typecheck && npm test`, and scan the diff against the pack's **Do not** rules (INDEX.md). Merge, then mark the task done on the planner board.")
    w("4. If a worker says the plan is wrong or unclear, don't let it improvise: change the plan on the board, recompile, regenerate this file, then re-brief.")
    w("5. Stop and ask the human at tasks marked 🧑.\n")
    w("**Routing:** **Opus** orchestrates and takes the hard, cross-cutting and timing-critical tasks. **Sonnet** takes well-specified app code. **GPT** takes pure functions with crisp tests, handed off through the Codex plugin. Run `/codex:setup` first to confirm the Codex CLI is ready and see which model it runs.\n")
    w("### Worker brief template\n")
    w("```text\nYou are implementing {ref} \"{title}\" for Overdrive, a rhythm drill in the Azimuth aim trainer\n"
      "(repo: TypeScript + Vite + three.js). Do only this task.\n\n"
      "Read first: .plan/plans/rhythm-drill/out/model/INDEX.md, then {readFirst} in decisions.md /\n"
      "visuals.md / risks.md / glossary.md, and the task itself in tasks.md.\n"
      "Files you are expected to touch: {touches}\n\n"
      "Rules: decided items are binding; follow the glossary names; never edit .plan/; add no npm\n"
      "dependencies; match the surrounding code style. If the plan and the code disagree, stop and\n"
      "report the question instead of guessing.\n\n"
      "Finish with `npm run typecheck && npm test` green, one commit \"{ref}: {title}\", and a report:\n"
      "files changed, each Done-when item with evidence (test name or how you checked), and open questions.\n```\n")
    w("## Waves at a glance\n")
    w("| Wave | Task | Model | Size | Depends on |")
    w("|---|---|---|---|---|")
    for td in todos:
        flag = " 🧑" if td["needsHuman"] else ""
        w(f"| {td['wave']} | **{td['ref']}** {td['title']}{flag} | {MODEL_LABEL[td['model']]} | {td['size'] or ''} | {', '.join(td['dependsOn']) or '-'} |")
    w("")
    if clashes:
        w("**File clashes inside a wave** (serialise these, or merge with care):\n")
        for c in clashes:
            w(f"- {c}")
        w("")
    w("Also note: T10, T12 and T13 all edit `src/core/game.ts`; T13 and T18 both edit `src/drills/registry.ts`; "
      "T14, T15 and T16 share `src/drills/overdrive-targets.ts` (run them one after another, or have T13 split it into per-kind files first).\n")
    w("## Tasks\n")
    for td in todos:
        w(f"### [ ] {td['ref']} · {td['title']}\n")
        meta = [f"wave {td['wave']}", MODEL_LABEL[td["model"]], f"size {td['size']}" if td["size"] else None]
        w("- " + " · ".join(m for m in meta if m) + f": {td['modelWhy']}")
        w(f"- Depends on: {', '.join(td['dependsOn']) or 'nothing'} · Implements: {', '.join(td['implements']) or '-'}"
          + (f" · Mitigates: {', '.join(td['mitigates'])}" if td["mitigates"] else ""))
        w(f"- Read first: {', '.join(td['readFirst']) or '-'}")
        w(f"- Touches: {', '.join('`' + f + '`' for f in td['touches']) or '-'}")
        if td["needsHuman"]:
            w(f"- 🧑 Human gate: {td['needsHuman']}")
        w(f"\n{td['description']}\n")
        w("Done when:")
        for c in td["doneWhen"]:
            w(f"- [ ] {c}")
        w("")
    (HERE / "TODOS.md").write_text("\n".join(out))
    print(f"Wrote {HERE / 'TODOS.md'} and todos.json: {len(todos)} tasks in {max(wave.values())} waves; {len(clashes)} in-wave file clashes.")


if __name__ == "__main__":
    main()
