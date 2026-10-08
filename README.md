# Pendulum · Local vs. Frontier AI

**One physics task. Two coding agents. Two working simulations.**

A local **Qwen3.8-27B** and **OpenAI GPT-6 Astra** each built an interactive, multi-link pendulum simulator from the same English task prompt, using **Pi CLI**. Both delivered a self-contained HTML application with nonlinear physics, adaptive integration, and reproducible checks.

The interesting result is that a local 27B model completed a mathematically demanding application, while the frontier configuration reached a working result much faster. This repository contains the actual application outputs, the task, and the measured results—not a manually rewritten showcase.

![Side-by-side pendulum simulations: initial angles differ by just 0.1 degrees; local Qwen on the left and OpenAI GPT on the right](assets/pendulum-comparison.gif)

*Local Qwen on the left; OpenAI GPT on the right. The recording uses initial angles of 120° and 120.1° for the first links. The second links are both at 170°. The annotation highlights that tiny initial difference before the simulations start. The GIF is 47 seconds, loops automatically, and is approximately 5 MB.*

[Try the applications](#try-the-applications) · [Measurements](#measured-runs) · [Physics](#the-physics-behind-the-animation) · [Results](#what-the-results-show) · [Exact prompt](prompt.txt)

## Try the applications

```sh
git clone https://github.com/lechatpeluche/pendulum.git
cd pendulum
```

Open either file directly in your browser:

| Local model | Frontier model |
|:---|:---|
| [qwen/index.html](qwen/index.html) | [gpt/index.html](gpt/index.html) |
| **Qwen3.8-27B**, Q4_K_M | **OpenAI GPT-6 Astra** |

On macOS:

```sh
open qwen/index.html
open gpt/index.html
```

On other desktop systems, double-click the files or open them through your browser's file menu. GitHub's file links display source code; clone or download the repository to run the apps. A smartphone can open the same files through any ordinary static host.

**No build step, npm install, backend, account, or network connection is needed to run either application on desktop.** Each `index.html` contains its own HTML, CSS, JavaScript, and Canvas 2D renderer.

Both implementations provide:

- **1–4 independent pendulums**, each with **1–4 links** and a shared fixed pivot.
- Per-link length, point mass, and initial angle; valid edits update the preview.
- Start, pause, resume, reset, and **×1 / ×2 / ×5 / ×10** speeds.
- Thin, fading trails for the final masses, with a bounded 10-second history.
- An English interface and responsive layouts.

## The experiment

The task was to build a useful simulation, not merely draw a plausible swinging object. The agents had to choose and implement the coupled equations, integrate them accurately, preserve physical constraints, handle numerical edge cases, and build an interface that works on desktop and mobile.

Both completed runs used the **same task text**, [preserved verbatim in `prompt.txt`](prompt.txt). It specifies the product, HTML/CSS/plain JavaScript/Canvas stack, physical assumptions, controls, and validation requirements. It leaves the numerical implementation to the agent. It is the brief English prompt; the separate detailed implementation prompt was **not used** in this comparison.

Runs took place on **September 13–14, 2026**. Each successful session started with no application files and one task submission, without attaching previous reasoning history.

| Configuration | Local · Qwen | Frontier · OpenAI |
|:---|:---|:---|
| Recorded model ID | `qwen3.8-27b-pi` | `gpt-6-astra` |
| Model / weights | Qwen3.8-27B GGUF, Q4_K_M | Hosted GPT-6 Astra |
| Harness | **Pi CLI 0.85.1** | **Pi CLI 0.85.1** |
| Coding tools | `read`, `write`, `edit`, `bash` | `read`, `write`, `edit`, `bash` |
| Inference provider | `llamacpp` / Chat Completions | `openai-codex` / Responses |
| Execution | Local `llama-server`, distributed with Ollama | Remote OpenAI, subscription authentication |
| Reasoning | **Medium**, configured 8,192-token thinking budget per request | **High** |
| Registered context window | 131,072 tokens | 272,000 tokens |
| Output configuration | 49,152 tokens per request, including thinking | Registry maximum 128,000; no explicit output cap in recorded payloads |
| Application stack | HTML, CSS, JavaScript, Canvas 2D | HTML, CSS, JavaScript, Canvas 2D |

The local weights came from Ollama's model storage, but the successful run used the **direct `llama-server` endpoint**, rather than Ollama's HTTP service. The recorded host was an Apple M5 Pro Mac with 48 GiB RAM. That describes the local environment, not the hardware executing the hosted OpenAI model; resource utilization was not measured.

## Measured runs

### Time and agent activity

| Metric | Local · Qwen | Frontier · OpenAI |
|:---|---:|---:|
| **Active task time** | **2 h 8 min 57 s** | **17 min 57 s** |
| Active seconds, unrounded | 7,737.256914292 | 1,077.229844 |
| Time to first HTML write, approximately | 36 min 58 s | 7 min 22 s |
| Assistant responses during implementation | 50 | 24 |
| Tool calls | **52** | **27** |
| Tool results flagged as errors | 7 | 3 |
| Context compactions | **1 successful** | **0** |
| Compaction time, included in active time | 15 min 59 s | 0 |
| Sum of assistant response intervals, excluding compaction | 6,772.001 s | 1,030.398 s |
| Standalone reasoning time | Not separately measured | Not separately measured |
| Mean output throughput over response intervals¹ | **11.95 tokens/s** | **29.01 tokens/s** |
| Mean output throughput over the whole task² | **11.57 tokens/s** | **27.75 tokens/s** |
| Recorded final outcome | Completed, final `stop` | Completed, final `stop` |

**The OpenAI configuration completed its successful run 7.18× faster.** This ratio compares the recorded configurations, not isolated model capabilities.

Active time includes model requests, tool work, and compaction, and ends when the agent finishes the task. It excludes leaving an idle terminal open after the answer. The first HTML write is an intermediate milestone, not completion. Tool errors occurred during implementation and were followed by successful completion; they are not counts of process crashes.

¹ Implementation output tokens divided by the sum of SDK-message-creation-to-session-persistence intervals: `80,908 / 6,772.001` for Qwen and `29,892 / 1,030.398` for OpenAI. These intervals include input processing, reasoning, generation, transport, and recording. **This is an observed response throughput proxy, not pure model decode speed.** It excludes Qwen's compaction call from both numerator and denominator.

² All recorded output tokens divided by active task seconds. This includes Qwen's compaction output and all agent overhead. **Neither rate measures time spent reasoning alone.** The logs do not support a separate reasoning-duration comparison.

### Tokens and cache

| Recorded usage | Local · Qwen | Frontier · OpenAI |
|:---|---:|---:|
| Input tokens, excluding separately reported cache reads | **132,161** | **47,350** |
| Cache-read tokens | **2,366,097** | **629,120** |
| Cache-write tokens, as reported | 0 | 0 |
| Total input, including cache reads | 2,498,258 | 676,470 |
| Output tokens, including reasoning | **89,516** | **29,892** |
| Separately reported reasoning tokens | Unavailable | 7,411, already within output |
| **Total recorded tokens** | **2,587,774** | **706,362** |
| Compaction contribution, already within totals | 60,480 tokens | 0 |

Totals use `input + cacheRead + cacheWrite + output`. They aggregate repeated requests, so millions of tokens here do **not** mean a single context window contained millions of tokens. Qwen's compaction contributed 51,872 input and 8,608 output tokens and took 12.40% of its active task time.

Qwen's separate reasoning counter was unavailable even though its session contains thinking blocks. It should not be interpreted as zero reasoning. OpenAI's 7,411 reasoning tokens must not be added to output a second time. A reported zero cache-write count does not establish that no internal cache was populated. Cache behavior and tokenization also differ between providers.

No dollar-cost comparison is made: subscription accounting, electricity consumption, and hardware costs were not measured.

## The physics behind the animation

Multi-link pendulums are coupled nonlinear systems. One link affects the others; treating them as independent sine waves would produce the wrong dynamics. Nearby initial conditions can also develop very different trajectories, making this a useful test of implementation and numerical judgment.

**Both applications implement full nonlinear planar dynamics and adaptive Dormand–Prince 5(4) integration.** They model massless rigid rods, separate point masses at each link endpoint, gravity at 9.81 m/s², and zero initial angular velocities. There is no damping, collision response, or small-angle approximation. Angles are absolute, measured from downward vertical, and can rotate without mechanical stops.

Qwen solves the coupled acceleration system by Gaussian elimination. OpenAI uses a length-scaled Cholesky solve. Both separate the internal integration step from rendering and check numerical error before accepting steps.

<details>
<summary><strong>The coupled equations implemented by both applications</strong></summary>

For lengths $l_i$, point masses $m_i$, and absolute angles $\theta_i$, define the downstream mass sum:

$$S_{ij}=\sum_{k=\max(i,j)}^n m_k.$$

The mass matrix is:

$$M_{ij}=S_{ij}l_i l_j\cos(\theta_i-\theta_j).$$

Accelerations satisfy:

$$\sum_{j=1}^{n}M_{ij}\ddot\theta_j=-gS_{ii}l_i\sin\theta_i-\sum_{j=1}^{n}S_{ij}l_i l_j\sin(\theta_i-\theta_j)\dot\theta_j^2.$$

The velocity-dependent coupling term is essential. At each integration stage, the applications solve this linear system for the angular accelerations, then advance angles and angular velocities together.

With screen coordinates positive right and down, the position of mass $i$ is obtained from:

$$x_i=\sum_{k=1}^{i}l_k\sin\theta_k,\qquad y_i=\sum_{k=1}^{i}l_k\cos\theta_k.$$

Finite precision and local error control do not guarantee exact long-term trajectories or exact energy conservation, especially in chaotic motion.

</details>

## Validation

The models produced checks alongside their applications. Those checks passed in the original runs and were repeated afterward on preserved copies.

Before publication on **October 9, 2026**, all three model-written suites passed again on the exact files in this repository: 93 Qwen assertions, 12 OpenAI physics groups, and 11 OpenAI Chrome groups. These publication checks are excluded from the original time and token measurements.

| Verification | Local · Qwen | Frontier · OpenAI |
|:---|:---|:---|
| Model-written physics/model checks | **93 assertions passed**, including a DOM-stub smoke test | **12 physics groups passed** |
| Model-written real-browser checks | No real-browser suite in its output | **11 Chrome groups passed** |
| Same additional browser smoke check, September 14 | **14/15 conditions passed** | **15/15 conditions passed** |

Checks exercise link lengths, equilibrium, single-pendulum motion, nonlinear motion, energy drift, convergence, and main controls. The common browser check also exercised movement, pause/resume/reset, offline startup, and responsive layouts at multiple viewport sizes.

**The check counts are not interchangeable quality scores.** Qwen's assertions and OpenAI's test groups have different scopes. The results support the numerical implementations, but are not an exhaustive independent proof of mathematical accuracy across all configurations or browsers.

**Preserved Qwen limitation:** after starting or pausing, configuration inputs remain visually enabled. Its model rejects edits in those states, but the form does not satisfy the requirement to disable the fields. The common browser check caught this; the DOM-stub suite did not. The application is preserved with this behavior rather than silently repaired after the experiment.

Run the original checks from the repository root:

```sh
node qwen/tests/run_checks.js
node gpt/tests/physics-checks.cjs
node gpt/tests/browser-checks.cjs
```

No npm packages are needed. Use Node.js 22 or later. The last command requires installed Chrome/Chromium; set `CHROME_PATH` if the executable is not found automatically. It opens the actual local HTML and writes screenshots to a temporary directory. These checks are optional and are not required to run the applications.

## What the results show

**Both models handled a demanding task well enough to produce working, usable simulations with substantive numerical implementations and passing physics checks.** The local model's result demonstrates that a quantized 27B model can complete this kind of coupled physics application with agent tools and bounded reasoning. The frontier configuration delivered its result with less active time, fewer output tokens, and fewer tool calls, and independently exercised its interface in Chrome.

Qwen also continued successfully after context compaction and reached a final answer. Its longer run included more implementation iterations and a roughly 16-minute compaction. The remaining form issue shows why testing an application's state model is not sufficient to establish its real-browser behavior.

The side-by-side animation makes the outputs tangible. It is an edited demonstration, not a synchronized numerical comparison or evidence that one solver is more accurate: different starts, numerical tolerances, and chaotic sensitivity can all produce visible differences.

### Limits of the comparison

This is a case study of **one completed run per configuration**. The task text, Pi version, and four coding tools matched; reasoning levels, system instructions, provider adapters, context/output limits, initial cache conditions, and logging detail did not.

Qwen used a bounded-thinking system note and minimal metrics logging. OpenAI's context included global instructions and a skill catalog, and its requests were recorded in more detail. Local configuration details are supported by the saved profile and pre-launch command, rather than immutable captures of every request. Earlier interrupted local attempts and configuration tuning preceded the successful fresh run; their time and tokens are **not included** in the main table. The comparison therefore does not measure total effort to obtain the local result or prove a general 7.18× model-speed advantage.

Hardware utilization, standalone reasoning duration, and pure decode speed were not recorded. Later verification and video editing are outside the original run metrics. Repeated, randomized runs with matched system context and measurement boundaries would be needed for a stronger benchmark.

## Repository contents and provenance

```text
pendulum/
├── README.md
├── prompt.txt                       # exact task submitted to both successful runs
├── assets/pendulum-comparison.gif   # annotated side-by-side recording
├── qwen/
│   ├── index.html                  # local model's application
│   └── tests/run_checks.js
└── gpt/
    ├── index.html                  # frontier model's application
    └── tests/
        ├── physics-checks.cjs
        └── browser-checks.cjs
```

The HTML applications, model-written tests, and prompt are copied byte-for-byte from the saved experiment artifacts. This README and the video annotations were prepared afterward. Raw sessions, private machine configuration, previous attempts, and scratch files are outside this publication.

Measurements come from the archived Pi session usage, metrics observers, and the September 14, 2026 experiment audit. The public table summarizes that audit; raw request/response journals are not included here.

<details>
<summary><strong>Exact prompt and weight provenance</strong></summary>

Task file: 8,701 bytes; SHA-256:

```text
0086b024243237a385b5ef74d631f92d86aa3c618256b6093b5be615a8c331de
```

The local model alias and the saved `hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_M` manifest point to the same weight layer digest:

```text
sha256:7e78da5d7e3ae28d178121f58646953305f3e5bd3cb46f4a75584e8b6c6fe169
```

This is the saved manifest's digest; the 17 GB weight blob was not independently rehashed during report preparation.

</details>
