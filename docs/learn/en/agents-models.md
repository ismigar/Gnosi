# Configure the assistant and its profiles

The default profile is used for new conversations. Each conversation can choose another profile without affecting the others.

## Before you begin {#before-you-begin}

Enable the AI feature. A cloud provider requires valid credentials and may charge for use; a local model requires its service to be running.

## Steps {#steps}

1. Open the model/provider settings and configure a supported provider or local endpoint. Save its credentials in Settings and select an available model.

2. Open Settings → Plugins → AI → Assistant and choose **Set up assistant**. Select the model, name the profile and assign the required skills.

3. Open chat and confirm the selected agent and model. Start with a short question to check the connection.

4. Add the particular page, table or file needed as context. Ask for a bounded task, for example “Summarize the questions in this page”.

5. If you want the agent to act, check that its model supports tools and that the required skills and tools are available. Review any confirmation request before accepting it.

6. Inspect the result and its sources. Save useful conclusions to a page; keep your own interpretation distinct from generated text.

### Profiles and conversations

Create profiles under **Additional profiles (advanced)**. In chat, open the selector at the assistant name and choose the **Conversation profile**. The change applies to subsequent requests and preserves history. Each conversation remembers its profile. **Use as default** in Settings selects the profile for new conversations; it does not change existing chats.

### One model per profile

Each profile has exactly one LLM. To use another model, choose another profile or edit the profile model. There is no automatic model selection or fallback to alternative models. If a profile is deleted or its model becomes unavailable, choose another profile in chat. To delete the default profile, first set another default. Disable the AI plugin to turn off AI.

## Expected result {#expected-result}

The selected agent can respond with the intended context and exposes the capabilities available to it.

## If something goes wrong {#troubleshooting}

A model may chat successfully while lacking tool support. For authentication, timeout or unavailable-tool messages, check the provider, selected model and assigned skills separately. Never assume a described action was completed without checking its result.

## Related guides {#related-guides}

- [Ask questions about selected sources](notebooks.md)
- [Frequently asked questions and recovery](troubleshooting.md)

## Plugin profiles

Each AI plugin declares an editable profile and the skills its actions use. Settings → AI → Assistant shows plugin profiles separately from personal profiles. Edit the single model, instructions, sources and skill assignments there. Initial profiles copy only the current default model; plugin updates preserve user edits. Disabling a plugin suspends its profile without deleting settings. A missing model or required skill fails explicitly instead of falling back to the personal default. New standalone actions and scheduled plugin skills resolve the plugin profile; existing jobs retain their frozen snapshot. A manually selected conversation profile still governs that conversation.

## Director and specialist team

In **Configure team**, choose the Director, members and their roles. An agent can have several roles. Select which plugin profiles may delegate; their actions remain owned by the plugin. Coordination takes effect when you save settings. Only the coordination skill is added to the Director; existing models, instructions and other skills are preserved.

Direct routes associate known operations with executor lists. The server checks availability, skills, context and limits before comparing estimated assignment cost. Unknown cost remains unknown. Direct routes bypass the Director; ambiguous requests require a plan. Valid results are delivered without automatic Director review.

Limits are four assignments, two temporary specialists and two simultaneous reading tasks. Modifications run sequentially. Structured operations allow eight total calls within the original budget. Format repair gets one attempt and never repeats actions. Automatic replanning is limited to reading work; uncertain effects require review.

Explicitly allow models and skills for temporary agents. Creating one cannot install tools or expand permissions. Temporary agents belong to one execution and are absent from the general selector. In **Activity**, review a retention proposal, edit reusable instructions, then accept or reject. Acceptance creates a personal profile without history or memories; you can then add it to the team. Rejection prevents the same proposal from recurring.

Confirmations identify the executor and do not authorize additional actions. Resuming reuses the saved plan and completed assignments. Failed or uncertain actions are never repeated automatically. Cancellation prevents descendants from continuing. Private records follow execution retention settings.

The catalog provides independent assessments for Director, All-rounder, Documentalist, Expert, Administrative and Worker, with evidence and missing tests. Declared compatibility does not certify Catalan, citations or delegation economy. Legacy labels remain for compatibility but do not select executors. Automated tests use simulated providers, with no paid evaluations. Compare quality and total cost on identical cases before expanding routes.

The optional **Command** field in each agent’s settings assigns a unique command such as `/traductor`. Write `/traductor Translate this text…` in chat to send that turn directly to the agent with its own model, instructions and skills, without consulting the Director. The conversation’s usual selection stays unchanged. Commands do not expand permissions or allow disabled agents to run. After `/`, use 1–32 unaccented letters, digits, hyphens or underscores, starting with a letter; commands are case-insensitive.
