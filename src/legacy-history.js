import { isSystemFriendGreeting } from "./message-rules.js";

export function isLegacyCustomerCandidate({
  message,
  binding,
  hadConversation = false,
  hadFlowSession = false
}) {
  const roomType = Number(message?.roomType);
  return Boolean(
    binding?.enabled &&
    (roomType === 2 || roomType === 4) &&
    !hadConversation &&
    !hadFlowSession &&
    !isSystemFriendGreeting(message)
  );
}

export function createKeyedSingleFlight() {
  const flights = new Map();
  return {
    has(key) {
      return flights.has(key);
    },
    run(key, task) {
      if (flights.has(key)) return flights.get(key);
      let operation;
      try {
        operation = Promise.resolve(task());
      } catch (error) {
        operation = Promise.reject(error);
      }
      const tracked = operation.finally(() => {
        if (flights.get(key) === tracked) flights.delete(key);
      });
      flights.set(key, tracked);
      return tracked;
    }
  };
}
