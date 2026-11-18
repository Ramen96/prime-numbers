import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequestStops, yieldToMessages } from "./requestStops.ts";

describe("RequestStops", () => {
  it("lets a request run until it's paused", () => {
    const stops = new RequestStops();
    stops.arrived();
    stops.started();
    assert.equal(stops.shouldStop(1), false);
    stops.paused(1);
    assert.equal(stops.shouldStop(1), true);
  });

  it("stops a request when a newer one is waiting behind it (a jump)", () => {
    const stops = new RequestStops();
    stops.arrived();
    stops.started();
    stops.arrived(); // request 2, while 1 runs
    assert.equal(stops.shouldStop(1), true);
    stops.started();
    assert.equal(stops.shouldStop(2), false, "the newer one runs");
  });

  it("covers a pause for a request that hasn't started yet, and every earlier one", () => {
    const stops = new RequestStops();
    stops.paused(5);
    assert.equal(stops.shouldStop(3), true);
    assert.equal(stops.shouldStop(5), true);
    assert.equal(stops.shouldStop(6), false, "a later request isn't paused");
  });
});

describe("yieldToMessages", () => {
  it("lets a message that arrived meanwhile be handled first", async () => {
    const order: string[] = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = () => order.push("message");
    channel.port2.postMessage(null);
    await yieldToMessages();
    order.push("after yield");
    channel.port1.close();
    assert.deepEqual(order, ["message", "after yield"]);
  });
});
