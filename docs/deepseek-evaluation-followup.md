# DeepSeek research evaluation follow-up

The comparison used `deepseek-flash` for both GlossX and DeepSeek Harness
(DSH). It therefore compares the harness configurations and their execution
conditions, rather than different base models. The pilot does not establish
that either complete research product is better.

## What explains the observed gap

Across 90 task IDs, the final comparison retained 180 run attempts. GlossX
returned normally in 69 and DSH in 85. Fourteen GlossX attempts ended on HTTP
429; the OpenAI-compatible provider previously raised immediately instead of
recovering from a transient rate limit. Another seven GlossX and five DSH
attempts ended on payment errors. These execution failures must remain visible
in operational success rates and must not be described as incorrect scientific
reasoning. The two systems used different compatible API routes and native
retry policies, so the counts do not isolate a causal harness effect.

In the controlled tasks where both systems completed normally, core decision
and numerical correctness was 34/36 for GlossX and 33/36 for DSH under the
original strict tolerance. Both had 32/36 passes on the composite format and
citation-location check. In 18 normally completed SciFact pairs, the correct
classifications were 13 and 14. The small samples, correlated synthetic task
families, single repeats, and selection of successful pairs limit inference.

The output contract also affected measurement. A correct yes/no accompanied by
a long explanation received low token F1 when the entire `answer` was scored.
Explicit verdicts outside the final JSON were sometimes lost when only the
JSON answer field was inspected. A citation that merely contains the word
"REFUTED" is not a model verdict and must not be used to recover one.

The research prompt had a separate product issue: it unconditionally requested
Markdown and paper span markers even when the user requested JSON and only
workspace file tools were available. Those instructions conflicted with the
requested output and could encourage invented source locations. There were
also genuine reasoning errors, including a weighted-average arithmetic error
and confusing absence of evidence with direct contradiction; these are not
fixed by changing evaluation labels.

## Changes

The OpenAI-compatible provider now allows two additional attempts for HTTP
429, 500, 502, 503, and 504, or a connection failure before a response. Backoff
is cancellable, includes jitter, and respects `Retry-After` seconds or an HTTP
date. A requested delay above 30 seconds fails instead of retrying early.
Permanent errors such as 401 and 402 are not retried. Progress reports the
retry count without copying response bodies or credentials. Existing bounded
400/422 capability negotiation remains independent of this retry allowance.

Once a successful stream's response headers arrive, a transport error is not
replayed, even if only a partial SSE line or no body has arrived. Non-streaming
read/write errors are likewise not retried. These conservative boundaries
avoid deliberately replaying a generation that may already have been charged
or produced tool calls; they cannot guarantee billing behavior at the remote
provider. Retries add bounded waiting and request attempts to a logical call.

The harness prompt now follows the user's output format, uses Markdown only
as a default, and reserves span markers for IDs actually returned by paper
tools. File-only sources use filenames and available source locations. It
also asks the model to check scope, units, denominators, and derived values,
and to distinguish missing evidence from contradictory evidence. Prompt
changes are instructions, not a guarantee of improved model reasoning.

The evaluation protocol `answer-fields-v2` separates direct `answer`,
`explanation`, and claim `verdict`. Every system receives the same task prompt
except the separate routing diagnostic. Legacy explicit verdict declarations
are preserved, conflicting declarations are flagged, and citation text does
not set the verdict. Raw output and format diagnostics remain available.
Execution failures keep zero task scores in the denominator, and success
rate, error type, and successful-run latency are reported separately. Repeated
latencies are averaged within task before bootstrapping. Reports reject mixed
output protocols within a benchmark suite, including comparisons across
different systems, instead of silently merging legacy and new-contract scores.

The repository's HTTP `glossx` evaluation adapter still targets the older
workflow/kernel entry point. Its results must not be mixed with the native
workbench harness results without noting the different entry point and tools.
No old benchmark answers are rewritten, and no new post-fix benchmark score is
claimed. The new prompt contract requires a separately frozen experiment.

## Validation

The offline backend suite passed: **440 passed, 11 skipped**. The skipped tests
require a real model, external network, or browser. Windows emitted non-failing
transport cleanup messages at interpreter shutdown. New tests cover transient
HTTP errors, `Retry-After`, cancellation, retry exhaustion, permanent failures,
stream replay boundaries, capability fallback, answer extraction, conflicting
verdicts, and operational failure denominators. A session API integration test
reproduces `429 -> retry -> native fs_read -> final JSON`; another confirms
that a payment failure performs only one request. All provider responses in
these tests use a local MockTransport and incur no model usage.

Before claiming research-quality gains, rerun a separately versioned protocol
with a fixed retry/total-budget policy, paired tasks and repeated trials,
adequate service capacity, and independent citation-support review. Do not
merge new-contract answer F1 with the old long-answer scores.

The provider's error meanings are documented in the [official DeepSeek API
reference](https://api-docs.deepseek.com/quick_start/error_codes/).
