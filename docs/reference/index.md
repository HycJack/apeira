# Reference

This section describes the internal design models that Apeira is built from. You do not need to read it to use the library, but it is useful when building custom plugins, runners, or storage backends.

- [AgentChannel](/reference/agent-channel) — typed event bus used by agents and plugins.
- [AgentPlugin](/reference/agent-plugin) — hook interface for extending the agent lifecycle.
- [AgentQueue](/reference/agent-queue) — turn queueing, draining, aborts, and the turn loop.
- [AgentStateManager](/reference/agent-state-manager) — state manager and persistence hooks.
