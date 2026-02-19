export interface QueuedToolCall {
  callId: string;
  name: string;
  argsString: string;
  receivedAt: number;
}

export function shouldQueueToolCall(agentSpeaking: boolean, isImmediateTool: boolean): boolean {
  return agentSpeaking && !isImmediateTool;
}

export async function drainToolQueue(
  queue: QueuedToolCall[],
  execute: (call: QueuedToolCall) => Promise<void>,
): Promise<number> {
  let drained = 0;
  while (queue.length > 0) {
    const call = queue.shift();
    if (!call) continue;
    await execute(call);
    drained += 1;
  }
  return drained;
}
