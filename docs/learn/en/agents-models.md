# Configure an agent and a model

A model generates responses. An agent combines a model with instructions and assigned skills; tools let it perform specific actions.

## Before you begin {#before-you-begin}

Enable the AI feature. A cloud provider requires valid credentials and may charge for use; a local model requires its service to be running.

## Steps {#steps}

1. Open the model/provider settings and configure a supported provider or local endpoint. Save its credentials in Settings and select an available model.

2. Open the agent settings, choose or create an agent and assign that model. Select the skills it needs for your task.

3. Open chat and confirm the selected agent and model. Start with a short question to check the connection.

4. Add the particular page, table or file needed as context. Ask for a bounded task, for example “Summarize the questions in this page”.

5. If you want the agent to act, check that its model supports tools and that the required skills and tools are available. Review any confirmation request before accepting it.

6. Inspect the result and its sources. Save useful conclusions to a page; keep your own interpretation distinct from generated text.

## Expected result {#expected-result}

The selected agent can respond with the intended context and exposes the capabilities available to it.

## If something goes wrong {#troubleshooting}

A model may chat successfully while lacking tool support. For authentication, timeout or unavailable-tool messages, check the provider, selected model and assigned skills separately. Never assume a described action was completed without checking its result.

## Related guides {#related-guides}

- [Ask questions about selected sources](notebooks.md)
- [Frequently asked questions and recovery](troubleshooting.md)
