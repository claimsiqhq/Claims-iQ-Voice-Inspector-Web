# Voice Tool Contract: Openings + Realtime Round-Trip

## Openings contract (canonical)
Use `add_opening` with:
- `roomName` (required)
- `openingType` (required)
- `widthFt` (required)
- `heightFt` (required)
- optional: `wallDirection`, `wallIndex`, `label`, `positionOnWall`, `notes`, `opensInto`, `quantity`

Backward compatibility is supported for aliases:
- `width` → normalized to `widthFt`
- `height` → normalized to `heightFt`

Dimension conversion accepts values like `36 inches`, `80 in`, `6 feet`, `6'8"` and normalizes to decimal feet. Numeric values are interpreted as feet.

## Realtime tool round-trip contract
For every Realtime function call event:
1. Receive `response.function_call_arguments.done`
2. Execute tool handler in `try/catch`
3. Always send `conversation.item.create` with `function_call_output` payload (success or structured error)
4. Always send `response.create` immediately after tool output

### Deferred exception
`trigger_photo_capture` is deferred until photo capture resolves. All other tools must complete the immediate output + response round-trip.

## Structured tool errors
Tool failures should return:

```json
{
  "success": false,
  "errorType": "VALIDATION_ERROR | API_ERROR | RUNTIME_ERROR",
  "message": "Short summary",
  "details": { "status": 422, "response": {} },
  "hint": "How to correct args and retry"
}
```
