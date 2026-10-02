# Configure bots and profiles

All bots and profiles appear in one list. Exactly one is primary: it is the default for new conversations and coordinates the team. Plugin actions continue to use their own profiles.

## Before you begin {#before-you-begin}

Enable the AI feature. A cloud provider requires valid credentials and may charge for use; a local model requires its service to be running.

## Steps {#steps}

1. Open the model/provider settings and configure a supported provider or local endpoint. Save its credentials in Settings and select an available model.

2. Open Settings → Plugins → AI → Assistants. Choose **Create the first assistant** when the list is empty, or **Create profile** to add one. Select its model, name the profile and assign the required skills.

3. Open chat and confirm the selected agent and model. Start with a short question to check the connection.

4. Add the particular page, table or file needed as context. Ask for a bounded task, for example “Summarize the questions in this page”.

5. If you want the agent to act, check that its model supports tools and that the required skills and tools are available. Review any confirmation request before accepting it.

6. Inspect the result and its sources. Save useful conclusions to a page; keep your own interpretation distinct from generated text.

### Profiles and conversations

Each card has a settings icon and, unless it is already primary, **Make principal**. Choosing another preserves the bots and their configurations; the new primary takes over team coordination. Existing conversations keep their profiles. In chat, the **Conversation profile** selector changes the profile for subsequent requests without losing history or affecting other conversations.

### One model per profile

Each profile has exactly one LLM. To use another model, choose another profile or edit the profile model. There is no automatic model selection or fallback to alternative models. If a profile is deleted or its model becomes unavailable, choose another profile in chat. To delete the default profile, first set another default. Disable the AI plugin to turn off AI.

### Edit instructions in Markdown

Agent and skill instructions share a block editor, active by default, with **/** commands. The formatting toolbar appears when you select text, as in the page editor. As in the page editor, one **</>** button switches between the editable normal view and Markdown source. Switching views does not change the text. Expand the editor for a larger view; press **Esc** or reduce it to return to the form. In Markdown source, **Ctrl/Cmd + ]** indents selected lines and **Ctrl/Cmd + [** outdents them. Changes save automatically after a short pause. **Close** saves pending changes before leaving. If a required field is incomplete or saving fails, the form stays open and shows the problem. Skill drafts use the same behavior; successive saves update the same skill.

Skill assignments save automatically when a toggle changes. Opening the form preselects agents and automations that already use this skill or its original version. Required skills and skills still needed by other automations are preserved. The assignment form opens inside the selected skill’s card, showing its name and version. Only one assignment form is open at a time; Close dismisses it.

## Expected result {#expected-result}

The selected agent can respond with the intended context and exposes the capabilities available to it.

## If something goes wrong {#troubleshooting}

A model may chat successfully while lacking tool support. For authentication, timeout or unavailable-tool messages, check the provider, selected model and assigned skills separately. Never assume a described action was completed without checking its result.

## Related guides {#related-guides}

- [Ask questions about selected sources](notebooks.md)
- [Frequently asked questions and recovery](troubleshooting.md)

## Plugin profiles

Each AI plugin has an editable profile in the same list as personal profiles, labelled with the plugin that uses it. You can edit its model, instructions, sources and skills, and explicitly make it primary. This does not change which profile handles the plugin’s actions. Disabling the plugin suspends its bot while preserving configuration. A missing model or required skill is reported without substituting another profile. Executions already in progress retain the configuration they started with.

## Primary assistant and team participation

Every bot, including team participants, keeps handling its tasks with its own model, instructions and skills. Asking for help is optional: the assistant chooses it only when another specialty or coordinated work is needed. It decides before executing tools; received assignments cannot be delegated again.

The primary assistant belongs to the same list and coordinates the team when other bots receive tasks. On every other bot’s card, **Team participation** offers:

- **Works independently**: Handles its tasks with its own model and skills. It neither receives team tasks nor asks the team for help.
- **Receives team tasks**: Keeps handling its tasks with its own model. It can also receive assignments from the primary assistant, but does not ask the team for help.
- **Asks the team for help**: Handles its tasks with its own model and asks the team for help only when another specialty is needed. It does not receive assignments from the primary assistant.
- **Receives tasks and asks for help**: Handles its tasks with its own model. It also receives assignments and can ask for help when another specialty is needed; it does not automatically delegate all work.

The settings icon on each card opens its model, instructions, sources and skills. Specialties are selected inside the same card. Task assignments and temporary specialists are optional, in a collapsed advanced section.

Complete selections save automatically. If task receivers or temporary permissions are missing, the form explains what is pending; closing it keeps the last complete configuration. Removing the last task receiver disables collaboration. There is no second place to activate the same bots. Only the coordination skill is added to the primary assistant when collaboration is active.

Open a task type and select one or more bots. With no selection, the primary coordinates it; if there are no receivers, guidance explains how to add them. Temporary models and skills also allow multiple selections, with a separate switch for each option. These are available permissions, not tasks that all run at once.

With focus on reading text or a switch, Up/Down and page keys scroll the form. Text fields and selectors retain their editing and selection keys.



Advanced assignments and direct routes apply only after an assistant requests help. Direct routes associate known operations with executor lists. The server checks availability, skills, context and limits before comparing estimated assignment cost. Unknown cost remains unknown. Direct routes bypass the primary assistant; ambiguous requests require a plan. Valid results are delivered without automatic Director review.

Limits are four assignments, two temporary specialists and two simultaneous reading tasks. Modifications run sequentially. Structured operations allow eight total calls within the original budget. Format repair gets one attempt and never repeats actions. Automatic replanning is limited to reading work; uncertain effects require review.

Explicitly allow models and skills for temporary agents. Creating one cannot install tools or expand permissions. Temporary agents belong to one execution and are absent from the general selector. In **Activity**, review a retention proposal, edit reusable instructions, then accept or reject. Acceptance creates a personal profile without history or memories; you can then add it to the team. Rejection prevents the same proposal from recurring.

Confirmations identify the executor and do not authorize additional actions. Resuming reuses the saved plan and completed assignments. Failed or uncertain actions are never repeated automatically. Cancellation prevents descendants from continuing. Private records follow execution retention settings.

The catalog provides independent assessments for Director, All-rounder, Documentalist, Expert, Administrative and Worker, with evidence and missing tests. Declared compatibility does not certify Catalan, citations or delegation economy. Legacy labels remain for compatibility but do not select executors. Automated tests use simulated providers, with no paid evaluations. Compare quality and total cost on identical cases before expanding routes.

The optional **Command** field in each agent’s settings assigns a unique command such as `/traductor`. Write `/traductor Translate this text…` in chat to send that turn directly to the agent with its own model, instructions and skills, without consulting the primary assistant. The conversation’s usual selection stays unchanged. Commands do not expand permissions or allow disabled agents to run. After `/`, use 1–32 unaccented letters, digits, hyphens or underscores, starting with a letter; commands are case-insensitive.

## Role assessments and missing evidence

Guidance, not certification: at least 60/100 and 60% data coverage, with role-specific requirements. Intelligence, coding and agentic benchmarks are ranked within the current catalog; context and speed saturate at 200,000 tokens and 100 tokens/s. Latency and price use 1/(1+x/2). Price uses a fixed mix of 4 input tokens per output token, not actual task cost. Context does not demonstrate citation fidelity, Catalan quality or reliability.

Use Refresh to retrieve available data (provider caching still applies). If a value remains absent, the source must publish it; it is not invented or inferred from model name or size.


How to verify: run identical synthetic cases with an allrounder, an always-active director and a director with direct routes; validate plans, executor selection, avoidable calls and total cost.

How to verify: test Catalan instructions and simulated tools; assess language quality, instruction following and each action’s result.

How to verify: ask questions over synthetic documents with known passages and answers; check retrieval, exact citations and source coverage.

How to verify: solve known-answer problems and cases with insufficient information; measure accuracy, cross-checking and acknowledged uncertainty.

How to verify: extract synthetic data with expected outputs, validate both content and schema, and execute procedures with verifiable steps.

How to verify: repeat known-output transformations and record accuracy, time and tokens; calculate cost per correct task including retries.

The Use column shows only the selected role and its percentage; sorting compares that score with unknown values last. Estimated cost and Provider follow it. Without a role filter, Use sorts by each model’s highest available score.

The comparison’s Role and strategy tests panel lets users select enabled agents and explicitly authorize each run with real usage. Role suites use 2–3 synthetic cases with deterministic validators. Strategy comparison applies the same three cases to an all-rounder, an always-on director and a director with direct routes; these include two known routes and conflicting-source resolution with dependencies. It compares valid contracts, calls, avoidable interventions and cost; missing values do not become zero. This isolated laboratory reuses economic selection without business tools. It does not comprehensively certify language, long-context retrieval or real tool use.

Each result records version, date, model, provider and per-case checks within its original user and Vault. Assessments with sufficient catalog evidence combine 50% catalog and 50% synthetic results; broader limitations and evidence gaps stay visible. Refresh comparison after reviewing results. The global cap is 24 calls, each capped at 512 output tokens; the three-strategy comparison makes 17 calls. These tests retain metadata-only traces. Cancel from Activity. Assigned models never change.

Retention proposals show reusable skills, coverage/model differences from existing agents and completed executions. Completion does not certify every task-specific acceptance criterion. Permanent instructions start from a registered-skill template without copying the assignment; users can review them. Acceptance can also add the personal profile to the team. An existing equivalent configuration prevents a duplicate proposal. Rejection prevents repeating the same proposal.

For an unresolved parameter count, select **Pending verification** in the Parameters column. **Consult the official source** attempts an exact-version match against supported manufacturer model cards. An unavailable source or no match leaves the value pending. You can instead record total and active billions, or a reviewed non-disclosure, with an HTTPS source and explicit confirmation that you checked the exact model. Manually reviewed values retain their provenance and date; merely failing to find a number never establishes non-disclosure. Supplied links are not fetched by the server.

## Recommended LLM profile and disabled plugins

Each card shows a recommended LLM profile and its reason. The principal recommends Director; other bots consider plugin tasks, assigned skills —including customized copies—, team specialties and task assignments. When several requirements apply, the most demanding is shown. For example, literature research recommends Documentalist, mail Administrative and complex analysis Expert. Unknown tasks receive All-rounder guidance. Check the evidence for this profile in the model comparison before choosing a model. The recommendation does not change the assigned model or certify its quality.

Disabling a plugin makes its bot inactive and hides it from the list and selectors. Its model, instructions, sources and skills are kept for reactivation. The bot is removed from active team recipients and task assignments; collaboration is disabled if it was the last recipient or the principal. If it was the principal, choose another or enable the plugin again. Existing conversations keep their profile and report unavailability instead of switching automatically.

## Reasoning effort

When an OpenRouter model supports selecting reasoning effort, its settings show **Reasoning effort** with that model’s supported choices. **Model default** keeps the provider’s behavior; **Medium** explicitly requests that level. More effort can increase latency and token use. Changes save automatically, apply only to this assistant, and also apply when it uses tools. Changing models resets effort to the new model’s default.
