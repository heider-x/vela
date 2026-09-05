# Ollama model discovery

Both model configuration forms can discover the models registered with the configured Ollama server. Select Ollama, enter the service URL, and choose a model from the dropdown. Refresh and manual model-name entry remain available. An empty display name is filled from the selection; a custom display name is preserved.

Discovery calls `GET /api/tags`; it does not download model weights or run inference. URLs ending in `/v1` or `/api` are normalized while retaining reverse-proxy path prefixes. Requests time out after eight seconds, and responses from an earlier URL cannot replace the current list.

Empty lists, connection failures, HTTP failures, and malformed responses have separate messages. Failed configuration saves leave the form open and do not select a failed new model as the default. Discovery does not determine whether a model is suitable for generation or embeddings.

## Validation

After installing the repository dependencies:

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
```

`electron/__tests__/ollama-models.test.ts` uses a local HTTP fixture for response validation and covers URL normalization. It requires no personal model configuration or credentials.

API reference: [Ollama list models](https://docs.ollama.com/api/tags).
