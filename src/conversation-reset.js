import {
  parseConversationMemoryClearAcknowledgement,
  parseConversationResetAcknowledgement
} from "./dclaw.js";

function invalidAcknowledgement(message) {
  return new Error(message);
}

export async function runConversationResetRequests({
  workspaceRequest,
  memoryClearRequest,
  invoke
}) {
  let workspaceInvocation = null;
  let memoryInvocation = null;
  let workspaceError = null;
  let memoryError = null;

  try {
    workspaceInvocation = await invoke(workspaceRequest);
    if (!parseConversationResetAcknowledgement(workspaceInvocation?.reply).ok) {
      workspaceError = invalidAcknowledgement("invalid conversation reset acknowledgement");
    }
  } catch (error) {
    workspaceError = error;
  }

  if (memoryClearRequest) {
    try {
      memoryInvocation = await invoke(memoryClearRequest);
      if (!parseConversationMemoryClearAcknowledgement(memoryInvocation?.reply).ok) {
        memoryError = invalidAcknowledgement("invalid conversation memory clear acknowledgement");
      }
    } catch (error) {
      memoryError = error;
    }
  }

  return {
    ok: !workspaceError && !memoryError,
    workspaceInvocation,
    memoryInvocation,
    workspaceError,
    memoryError
  };
}
