# ExtractSpeechPatterns_persona_builder_test

**Timestamp:** 2025-05-28T19:28:45.045Z

## Prompt

```
Speech Content: You know what? I'm totally stoked about this approach! Like, seriously, it's gonna be absolutely game-changing. I mean, we're talking next-level innovation here, folks. This is the kind of breakthrough that makes you go 'holy cow' and just... wow.
```

## Response

```json
{
  "speechPatterns": [
    {
      "patternType": "catchphrase",
      "textPattern": "You know what?",
      "frequency": 0.1,
      "emotionalContexts": [
        "excited",
        "enthusiastic"
      ],
      "socialContexts": [
        "informal",
        "casual conversation"
      ],
      "variations": [
        "You know something?",
        "Guess what?"
      ]
    },
    {
      "patternType": "filler",
      "textPattern": "Like, seriously",
      "frequency": 0.1,
      "emotionalContexts": [
        "excited",
        "emphatic"
      ],
      "socialContexts": [
        "informal",
        "building anticipation"
      ],
      "variations": [
        "Like, honestly",
        "Seriously"
      ]
    },
    {
      "patternType": "emotional expression",
      "textPattern": "absolutely game-changing",
      "frequency": 0.05,
      "emotionalContexts": [
        "enthusiastic",
        "optimistic"
      ],
      "socialContexts": [
        "informal",
        "discussion about innovation"
      ],
      "variations": [
        "utterly transformative",
        "completely revolutionary"
      ]
    },
    {
      "patternType": "catchphrase",
      "textPattern": "next-level innovation",
      "frequency": 0.05,
      "emotionalContexts": [
        "impressed",
        "excited"
      ],
      "socialContexts": [
        "informal",
        "idea presentation"
      ],
      "variations": [
        "groundbreaking",
        "cutting-edge"
      ]
    },
    {
      "patternType": "emotional expression",
      "textPattern": "holy cow",
      "frequency": 0.05,
      "emotionalContexts": [
        "astonished",
        "excited"
      ],
      "socialContexts": [
        "informal",
        "light-hearted conversation"
      ],
      "variations": [
        "oh my gosh",
        "incredible"
      ]
    },
    {
      "patternType": "emotional expression",
      "textPattern": "wow",
      "frequency": 0.05,
      "emotionalContexts": [
        "amazed",
        "excited"
      ],
      "socialContexts": [
        "informal",
        "conversation about surprises"
      ],
      "variations": [
        "whoa",
        "amazing"
      ]
    }
  ]
}
```
