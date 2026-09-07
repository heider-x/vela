# Blueprint generation, story rehearsal, and content revisions

## Blueprint generation and editing

Blueprint generation rejects empty or malformed results instead of reporting a successful zero-chapter save. Valid results are written to the captured project and read back before success is reported. The editor refreshes after generation, while unsaved local edits remain available to reconcile.

The chapter editor uses an optimistic transaction for changes and explicit deletions. It rejects conflicting database changes and writes only the affected blueprints. Removing a blueprint can be undone before saving; manuscript text and draft history are retained. Chapter numbers are fixed so editing them cannot detach existing prose. The editor includes an empty-state action, accessible chapter buttons, a responsive layout, and a persistent save status.

## Story rehearsal

Open Chapter Blueprints, select a chapter, and choose Story rehearsal:

1. Enter a creative intent, optional constraints, and a generation model.
2. Generate three directions and run a constraint/diversity review. Each phase can retry a malformed response once; a normal run makes two model calls, with at most four calls after format retries. Network failures, timeouts, and truncated output stop the run.
3. Compare motivation, resistance, cost, consequences, required setup, and tradeoffs.
4. Select a direction and try a short scene with explicit viewpoint/disclosure guidance. Scenes can be edited and copied. A rewrite retains the previous scene, and a new rehearsal retains the previous round.
5. Append the selected direction to author guidance, then save the blueprint. Trial prose is not automatically written into the manuscript.

Context contains author plans and the endings of the last three finalized chapters before the target chapter, using the latest finalized version of each chapter. Excerpts are capped at 2,400 characters and shown to the author. Plans are not treated as established events. When a blueprint repeats an event already present in the supplied prose, the model is instructed to continue after the prose and flag the mismatch.

Changing the intent retains previous results but prevents adopting them until the new intent is rehearsed or the old inputs are restored. Cancellation, closing, switching projects, and unmounting stop the active request. Results are temporary page state: chapter switches retain them, but leaving the blueprint page or quitting discards them. Adopt/save or copy anything to keep.

## Writing Agent

The Agent can index and read project content, revise related settings/characters/blueprints, and rewrite the latest non-finalized draft when explicitly requested. Whole-chapter rewriting reads all pages internally, invokes the selected writing model, checks the complete result and original version, saves a revision, and opens the updated text.

Writes use version checks and a database transaction with before/after records and readback. Undo checks the current state before restoring it. Draft writes preserve old content-pool entries, and unsaved editors or active workflows prevent conflicting changes. Finalized, archived, and superseded drafts cannot be directly overwritten or blindly reverted after their lifecycle changes.

The old `start_workflow` tool only opened an output panel. It is no longer advertised as execution, and its compatibility handler returns an explicit failure. The Agent also checks complete response envelopes, retries common plan-only stalls, shows elapsed request time, and propagates cancellation/timeout to tools. These checks do not prove every natural-language task is complete.

## Model behavior and limits

Streaming and non-streaming responses stopped by the output limit are rejected. Thinking wrappers and orphan closing tags are cleaned before parsing. Rehearsal requests allow up to 16,384 output tokens, capped by the model configuration, and time out after three minutes. Complete trailing JSON can be parsed after an introduction, but missing fields, duplicate directions, and incomplete final answers are rejected.

Provider format and thinking controls remain model-dependent. Ollama Cloud requests do not send unsupported structured-output constraints. In manual testing, one cloud model still exhausted its output budget during review; another completed generation and review. No model is silently selected as a replacement. A successful model review is not a guarantee of literary quality or continuity.

The revision journal is stored in the project SQLite database. Agent conversations are persisted under the existing Vela configuration directory. Vector embeddings are not required by this content-editing path. This change does not implement whole-book simulation, full historical state reconstruction, finalized-chapter rewriting, or a rebuild of downstream knowledge after such rewriting.

## Reproducible checks

After installing the repository dependencies:

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
```

Unit suites cover blueprint generation and persistence, cross-project rejection, revision transactions/readback/undo, draft lifecycle guards, Agent execution/cancellation, rehearsal parsing and bounded recovery, and streaming cleanup.

The browser regression harness uses synthetic content and mocked IPC. It does not load personal model configuration or access a real novel:

```sh
npx playwright install chromium
node node_modules/vite/bin/vite.js --config tests/rehearsal/vite.config.mjs
# In another terminal:
node tests/rehearsal/ui-check.cjs
```

Alternatively, set `VELA_BROWSER_CHANNEL=chrome` to use installed Chrome. Screenshots and results go to ignored `.test-output/rehearsal/`, or an explicit output directory supplied to the script. The harness checks generation/review, per-direction edits, adoption/save recovery, cancellation, project changes, malformed output, and narrow light/dark layouts. It is not a substitute for a real model quality evaluation or a packaged Electron smoke test.

No version bump is included; release numbering remains with the maintainer.
