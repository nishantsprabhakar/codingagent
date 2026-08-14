# Wrexlyn peer benchmark and scoring

**Assessment date:** 14 August 2026  
**Scope:** Product architecture and market readiness, not an official SWE-bench or Terminal-Bench result.

## Executive result

Wrexlyn scores **81/100** on the weighted peer-capability framework. That places it in the same architectural tier as major coding-agent products, but not yet in the same proof tier. The largest deduction is deliberate: Wrexlyn has not published reproducible external benchmark runs, production adoption, or enterprise-scale operating evidence.

| Product | Weighted score | Position |
|---|---:|---|
| OpenAI Codex | 84 | Reference leader: strong execution, sandboxing, parallel workflows and external proof |
| Cursor | 82 | Reference leader: best integrated IDE and remote-agent workflow |
| **Wrexlyn** | **81** | Strongest differentiators in model freedom, verification, rollback, evidence and artifacts; proof gap remains |
| GitHub Copilot agents | 80 | Strongest distribution, GitHub workflow and enterprise ecosystem |
| Claude Code | 78 | Excellent coding and terminal agent with mature permissions, hooks and MCP |
| Aider | 62 | Efficient, model-portable terminal workflow with a narrower governance and orchestration layer |

Scores are analyst assessments based on publicly documented product capabilities and inspection of the Wrexlyn Phase 1–11 implementation. A one-point difference is not statistically meaningful; the ranking should be read by category, not as a claim of measured task accuracy.

## Weighted scoring model

| Dimension | Weight | Wrexlyn | Codex | Claude Code | Cursor | GitHub Copilot | Aider |
|---|---:|---:|---:|---:|---:|---:|---:|
| End-to-end coding execution | 20 | 13 | 19 | 19 | 18 | 17 | 15 |
| Verification and repair | 15 | 14 | 13 | 12 | 12 | 11 | 10 |
| Safety, permissions and recovery | 10 | 9 | 9 | 8 | 7 | 8 | 6 |
| Repository context intelligence | 10 | 9 | 9 | 9 | 10 | 9 | 7 |
| Model and deployment portability | 10 | 10 | 3 | 2 | 6 | 5 | 10 |
| Extensibility, MCP and reusable skills | 10 | 9 | 9 | 9 | 9 | 10 | 5 |
| Parallel and isolated execution | 10 | 8 | 9 | 8 | 9 | 9 | 3 |
| Professional artifacts and evidence | 5 | 5 | 3 | 2 | 2 | 2 | 1 |
| UX, collaboration and enterprise readiness | 5 | 3 | 5 | 4 | 5 | 5 | 2 |
| External benchmark and market proof | 5 | 1 | 5 | 5 | 4 | 4 | 3 |
| **Total** | **100** | **81** | **84** | **78** | **82** | **80** | **62** |

## Why Wrexlyn scores well

### Verification is a product primitive

Wrexlyn does not collapse every outcome into success or failure. Its six-state verification model separates verified work, warnings, partial evidence, failure, blocked execution and non-applicable checks. Project-native build, test and lint evidence outranks the model's prose. The independent critic, bounded repair loop and stuck-loop detection add a second line of control.

### Recovery is stronger than ordinary undo

Binary-safe snapshots and Git-plumbing checkpoints cover edits, creations, deletions, renames and mode changes. Staleness checks prevent rollback from overwriting newer user work. This is a meaningful technical advantage over products that rely primarily on editor undo or an unstructured Git diff.

### Model freedom is genuine

Wrexlyn supports integrated providers, arbitrary OpenAI-compatible URLs and local model servers such as Ollama, LM Studio, llama.cpp and vLLM. This makes it possible to choose frontier quality, low-cost inference, private deployment or offline/local execution without replacing the agent harness.

### Evidence extends beyond code

The evidence ledger and cross-artifact consistency checks address a category most coding agents barely cover: ensuring that claims remain sourced and consistent across reports, presentations, spreadsheets and code-related deliverables. The document engine produces editable Office outputs plus Markdown, HTML and PDF.

### Parallel work is isolated at the repository layer

Best-of-N execution uses real Git worktrees. Candidate agents do not share intermediate edits, and their results can be verified and ranked before the selected candidate is applied. This is stronger than opening several chats against one mutable working directory.

## Why Wrexlyn does not score higher yet

1. **No published external task score.** Architecture cannot substitute for SWE-bench Verified, Terminal-Bench 2 or SWE-Lancer results.
2. **No same-model ablation.** Wrexlyn must show that its critic, verification and Best-of-N modes improve results compared with the same base model using a minimal agent loop.
3. **Limited production proof.** There are no disclosed active users, retention cohorts, enterprise deployments or large-repository case studies.
4. **Enterprise deployment is intentionally local-first.** Phase 12 preserves customer custody rather than adding a mandatory Wrexlyn-hosted control plane. Buyers requiring centralized SaaS administration must evaluate customer-hosted or opt-in coordination against their own identity and compliance requirements.
5. **UX breadth trails mature platforms.** Cursor, Codex and Copilot have stronger collaboration, IDE integration, remote execution and ecosystem distribution.
6. **Implementation provenance should be packaged for diligence.** All 13 phases are represented as complete in the current product baseline; an acquisition or enterprise diligence room should map each phase to its commit, tests, architecture note and reproducible demonstration.

## External benchmark plan

### Track 1: real repository issue resolution

Run **SWE-bench Verified** using its official 500-task harness. Report resolved percentage, pass@1, cost per resolved issue, median wall time and regression failures. Start with a stratified 50-task pilot, then run all 500 for publication.

### Track 2: terminal autonomy

Adapt Wrexlyn to the official **Terminal-Bench 2 / Harbor** interface and run all 89 tasks. Report task success, unsafe-command proposals, blocked actions, timeout rate and recovery after the first failed command.

### Track 3: tool-use correctness

Use **BFCL V4** to evaluate tool selection, argument accuracy, parallel calls, multi-turn calls and relevance detection. Separate model-only results from Wrexlyn policy-layer results.

### Track 4: economic software work

Use **SWE-Lancer** to report tasks completed and historical dollar value captured. This gives buyers a more intuitive economic interpretation than a percentage alone.

## Required ablation matrix

Every benchmark should use the same model, task set and environment across four Wrexlyn modes:

| Mode | Purpose |
|---|---|
| Base model + minimal tools | Establish model capability without proprietary orchestration |
| Wrexlyn single agent | Measure the value of project intelligence, policy and verification |
| Wrexlyn + critic/repair | Measure recovery uplift after an initial failure |
| Wrexlyn Best-of-N | Measure success uplift versus additional cost and time |

Publish the result for at least three model tiers: frontier hosted, low-cost hosted and local/open-weight. This isolates whether Wrexlyn improves the system rather than simply selecting a better model.

## Commercial interpretation

Today, Wrexlyn can credibly be pitched as an **advanced pre-scale product with differentiated orchestration IP**. It cannot yet be pitched as a benchmark leader. Reaching a reproducible top-quartile result on SWE-bench Verified or Terminal-Bench, while demonstrating material same-model uplift and reasonable cost per success, would move the product from an architectural claim to a defensible technical asset.

## Primary benchmark and peer sources

- SWE-bench Verified: https://openai.com/index/introducing-swe-bench-verified/
- Terminal-Bench 2: https://github.com/harbor-framework/terminal-bench-2
- Berkeley Function Calling Leaderboard: https://gorilla.cs.berkeley.edu/leaderboard
- SWE-Lancer: https://swelancer.github.io/leaderboard/
- Claude Code CLI and permissions: https://docs.anthropic.com/en/docs/claude-code/cli-usage
- Cursor background agents: https://docs.cursor.com/background-agent
- Cursor CLI: https://docs.cursor.com/en/cli/using
- Cursor MCP: https://docs.cursor.com/context/model-context-protocol
- GitHub Copilot custom agents and MCP: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents
- GitHub Copilot hooks: https://docs.github.com/en/copilot/concepts/agents/hooks
