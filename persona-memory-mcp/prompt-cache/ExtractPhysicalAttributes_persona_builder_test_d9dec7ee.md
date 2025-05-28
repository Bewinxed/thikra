# ExtractPhysicalAttributes_persona_builder_test

**Timestamp:** 2025-05-28T17:28:44.170Z

## Prompt

```
Physical Content: I have curly auburn hair that catches the light beautifully. My eyes are a deep emerald green with gold flecks that become more prominent when I'm excited. There's a small scar on my left wrist from a childhood accident.
```

## Response

```json
{
  "attributes": [
    {
      "bodyPartId": null,
      "attributeType": "texture",
      "attributeValue": "curly",
      "isPermanent": true,
      "context": "Describing hair texture"
    },
    {
      "bodyPartId": null,
      "attributeType": "color",
      "attributeValue": "auburn",
      "isPermanent": true,
      "context": "Describing hair color"
    },
    {
      "bodyPartId": null,
      "attributeType": "color",
      "attributeValue": "deep emerald green with gold flecks",
      "isPermanent": true,
      "context": "Describing eye color"
    },
    {
      "bodyPartId": null,
      "attributeType": "sensitivity",
      "attributeValue": "gold flecks become more prominent",
      "isPermanent": false,
      "context": "When excited"
    },
    {
      "bodyPartId": null,
      "attributeType": "scar",
      "attributeValue": "small scar",
      "isPermanent": true,
      "context": "From a childhood accident on the left wrist"
    }
  ]
}
```
