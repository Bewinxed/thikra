# ExtractPhysicalAttributes_persona_builder_test

**Timestamp:** 2025-05-28T19:28:41.517Z

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
      "context": "hair"
    },
    {
      "bodyPartId": null,
      "attributeType": "color",
      "attributeValue": "auburn",
      "isPermanent": true,
      "context": "hair"
    },
    {
      "bodyPartId": null,
      "attributeType": "lighting interaction",
      "attributeValue": "catches the light beautifully",
      "isPermanent": false,
      "context": "when light hits the hair"
    },
    {
      "bodyPartId": null,
      "attributeType": "color",
      "attributeValue": "deep emerald green",
      "isPermanent": true,
      "context": "eyes"
    },
    {
      "bodyPartId": null,
      "attributeType": "detail",
      "attributeValue": "gold flecks",
      "isPermanent": true,
      "context": "eyes"
    },
    {
      "bodyPartId": null,
      "attributeType": "change in appearance",
      "attributeValue": "gold flecks become more prominent",
      "isPermanent": false,
      "context": "when excited"
    },
    {
      "bodyPartId": null,
      "attributeType": "mark",
      "attributeValue": "small scar",
      "isPermanent": true,
      "context": "left wrist from a childhood accident"
    }
  ]
}
```
