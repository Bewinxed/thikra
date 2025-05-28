# ExtractSpeechPatterns_persona_builder_test

**Timestamp:** 2025-05-28T17:28:52.408Z

## Prompt

```
Speech Content: You know what? I'm totally stoked about this approach! Like, seriously, it's gonna be absolutely game-changing. I mean, we're talking next-level innovation here, folks. This is the kind of breakthrough that makes you go 'holy cow' and just... wow.
```

## Response

```json
{
  "speechPatterns": [
    {
      "patternType": "filler",
      "textPattern": "You know what?",
      "frequency": 1,
      "emotionalContexts": [
        "excited",
        "enthusiastic"
      ],
      "socialContexts": [
        "introducing an idea",
        "informal conversation"
      ],
      "variations": [
        "You know?",
        "Guess what?"
      ]
    },
    {
      "patternType": "expression of excitement",
      "textPattern": "totally stoked",
      "frequency": 1,
      "emotionalContexts": [
        "enthusiastic",
        "excited"
      ],
      "socialContexts": [
        "discussing new ideas",
        "sharing positive news"
      ],
      "variations": [
        "super excited",
        "really thrilled"
      ]
    },
    {
      "patternType": "catchphrase",
      "textPattern": "game-changing",
      "frequency": 0.5,
      "emotionalContexts": [
        "optimistic",
        "high-energy"
      ],
      "socialContexts": [
        "talking about technology",
        "business innovation"
      ],
      "variations": [
        "revolutionary",
        "ground-breaking"
      ]
    },
    {
      "patternType": "emphasis",
      "textPattern": "like, seriously",
      "frequency": 0.5,
      "emotionalContexts": [
        "insistent",
        "passionate"
      ],
      "socialContexts": [
        "casual discussion",
        "emphasizing a point"
      ],
      "variations": [
        "honestly",
        "genuinely"
      ]
    },
    {
      "patternType": "expression of amazement",
      "textPattern": "holy cow",
      "frequency": 0.5,
      "emotionalContexts": [
        "surprise",
        "amazement"
      ],
      "socialContexts": [
        "reacting to impressive news",
        "expressing admiration"
      ],
      "variations": [
        "wow",
        "unbelievable"
      ]
    }
  ]
}
```
