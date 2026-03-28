import { describe, expect, it } from "vitest";
import {
  parseSocketIoAckFrame,
  parseSocketIoChatFrame,
  parseSocketIoSendFrame
} from "../src/services/browser-chat-relay.js";

describe("parseSocketIoChatFrame", () => {
  it("normalizes a live radioChatter frame into a relay chat message", () => {
    const message = parseSocketIoChatFrame(
      '42["radioChatter",{"id":"26a84a93-a200-479b-805f-ad85cbfb3b7f","user":"641e3303734eb3916678fb07","timestamp":1774661423600,"sentAt":"2026-03-28T01:30:23.600Z","userGUID":"641e3303734eb3916678fb07","username":"SJW5135","channel":"/live/5c13f3c006f1be15e08e05c0","channelId":"5c13f3c006f1be15e08e05c0","message":"with chinese made components lol","emotes":[],"userType":"Normal","success":true}]'
    );

    expect(message).toMatchObject({
      id: "26a84a93-a200-479b-805f-ad85cbfb3b7f",
      authorName: "SJW5135",
      authorRole: "member",
      body: "with chinese made components lol",
      sentAt: "2026-03-28T01:30:23.600Z",
      source: "relay"
    });
  });

  it("maps privileged chat user types to host, admin, or moderator roles", () => {
    const moderator = parseSocketIoChatFrame(
      '42["message",{"id":"pilot-1","username":"Linus","message":"hello","userType":"Pilot","timestamp":1774661423600}]'
    );
    const admin = parseSocketIoChatFrame(
      '42["message",{"id":"admin-1","username":"Nick","message":"keep it civil","userType":"Admin","timestamp":1774661423600}]'
    );
    const host = parseSocketIoChatFrame(
      '42["message",{"id":"creator-1","username":"Luke","message":"hi","userType":"Creator","timestamp":1774661423600}]'
    );

    expect(moderator?.authorRole).toBe("moderator");
    expect(admin?.authorRole).toBe("admin");
    expect(host?.authorRole).toBe("host");
  });

  it("ignores non-chat socket frames", () => {
    expect(parseSocketIoChatFrame("430[{\"body\":{\"success\":true},\"statusCode\":200}]")).toBeNull();
    expect(parseSocketIoChatFrame("40")).toBeNull();
    expect(parseSocketIoChatFrame("not-json")).toBeNull();
  });

  it("extracts outgoing upstream chat send frames", () => {
    const sendFrame = parseSocketIoSendFrame(
      '422["post",{"method":"post","headers":{},"data":{"channel":"/live/5c13f3c006f1be15e08e05c0","message":"hello WAN"},"url":"/RadioMessage/sendLivestreamRadioChatter/"}]'
    );

    expect(sendFrame).toEqual({
      ackId: "2",
      body: "hello WAN",
      channel: "/live/5c13f3c006f1be15e08e05c0",
      route: "/RadioMessage/sendLivestreamRadioChatter/"
    });
  });

  it("extracts socket ack frames for upstream sends", () => {
    const ackFrame = parseSocketIoAckFrame(
      '432[{"body":{"success":true,"message":"sent"},"statusCode":200}]'
    );

    expect(ackFrame).toEqual({
      ackId: "2",
      statusCode: 200,
      body: {
        success: true,
        message: "sent"
      }
    });
  });
});
