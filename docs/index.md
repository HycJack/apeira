---
layout: home

hero:
  # preheading:
  ## name:
  text: stream-first Agent Runtime.
  ## tagline:
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/moeru-ai/apeira

terminal:
  tabs:
    - id: run
      label: run
      language: typescript
      code: |
        import { createAgent, run, user } from 'apeira'

        const agent = createAgent({
          instructions: 'You are a concise assistant.',
          runner: responses({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: 'https://api.openai.com/v1/',
            model: 'gpt-5.5',
          }),
        })

        for await (const event of run(agent, user('Say hello.')))
          console.log(event.turnId, event.type)
    - id: subscribe
      label: subscribe
      language: typescript
      code: |
        import { createAgent, user } from 'apeira'

        const agent = createAgent({
          instructions: 'You are a concise assistant.',
          runner: responses({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: 'https://api.openai.com/v1/',
            model: 'gpt-5.5',
          }),
        })

        agent.subscribe('apeira', (event) =>
          console.log(event.turnId, event.type)
        )

        agent.send(user('Say hello.'))

features:
  - title: Stream-first
    details: Submit a turn and consume its lifecycle and model events as a ReadableStream.
  - title: Small runtime
    details: Apeira keeps the core focused on turn queueing, aborts, and event delivery.
  - title: xsAI-based
    details: Model calls, tools, steps, and streaming events are powered by @xsai-ext/responses.
---

<Home />
